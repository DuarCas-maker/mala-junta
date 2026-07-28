-- F1 - Nucleo operativo MVP: mesas, catalogo minimo, cuentas y pedidos.

create extension if not exists pgcrypto;

-- Enums idempotentes
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_cuenta') then
    create type public.estado_cuenta as enum ('abierta','por_cobrar','pagada_parcial','pagada','pendiente','cerrada','anulada');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_pedido') then
    create type public.estado_pedido as enum ('enviado','en_preparacion','entregado','anulado');
  end if;

  if not exists (select 1 from pg_type where typname = 'medio_pago') then
    create type public.medio_pago as enum ('efectivo','datafono','nequi_daviplata','transferencia');
  end if;
end $$;

create table if not exists public.mesas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  zona text not null default 'Principal',
  es_vip boolean not null default false,
  capacidad int not null default 4 check (capacidad > 0),
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria_id uuid references public.categorias(id) on delete restrict,
  precio_venta numeric(12,0) not null check (precio_venta >= 0),
  costo_unitario_actual numeric(12,0) not null default 0 check (costo_unitario_actual >= 0),
  codigo_interno text unique,
  imagen_url text,
  activo boolean not null default true,
  stock_actual int not null default 0,
  stock_minimo int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cuentas (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid references public.mesas(id) on delete restrict,
  estado public.estado_cuenta not null default 'abierta',
  dia_negocio date not null default public.dia_negocio(now()),
  abierta_por uuid not null references public.perfiles(id) on delete restrict,
  responsable_pendiente text,
  total_cuenta numeric(12,0) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete restrict,
  mesero_id uuid not null references public.perfiles(id) on delete restrict,
  estado public.estado_pedido not null default 'enviado',
  notas text,
  enviado_at timestamptz not null default now(),
  en_preparacion_at timestamptz,
  entregado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad int not null check (cantidad > 0),
  precio_unitario_capturado numeric(12,0) not null check (precio_unitario_capturado >= 0),
  notas text,
  estado public.estado_pedido not null default 'enviado',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete restrict,
  medio public.medio_pago not null,
  monto numeric(12,0) not null check (monto > 0),
  propina numeric(12,0) not null default 0 check (propina >= 0),
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  timestamp timestamptz not null default now()
);

-- Triggers updated_at
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'mesas_set_updated_at') then
    create trigger mesas_set_updated_at before update on public.mesas for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'categorias_set_updated_at') then
    create trigger categorias_set_updated_at before update on public.categorias for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'productos_set_updated_at') then
    create trigger productos_set_updated_at before update on public.productos for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'cuentas_set_updated_at') then
    create trigger cuentas_set_updated_at before update on public.cuentas for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pedidos_set_updated_at') then
    create trigger pedidos_set_updated_at before update on public.pedidos for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pedido_items_set_updated_at') then
    create trigger pedido_items_set_updated_at before update on public.pedido_items for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.recalcular_total_cuenta(p_cuenta_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(12,0);
begin
  select coalesce(sum(pi.cantidad * pi.precio_unitario_capturado), 0)
    into v_total
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.pedido_id
  where p.cuenta_id = p_cuenta_id
    and p.estado <> 'anulado'
    and pi.estado <> 'anulado';

  update public.cuentas
  set total_cuenta = v_total
  where id = p_cuenta_id;

  return v_total;
end;
$$;

create or replace function public.crear_pedido_rapido(p_mesa_id uuid, p_items jsonb, p_notas text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
  v_cuenta_id uuid;
  v_pedido_id uuid;
  v_item jsonb;
  v_producto record;
  v_cantidad int;
  v_notas text;
begin
  v_perfil_id := public.perfil_actual_id();

  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'pedido_sin_items' using errcode = '22023';
  end if;

  if p_mesa_id is not null and not exists (select 1 from public.mesas where id = p_mesa_id and activa = true) then
    raise exception 'mesa_no_disponible' using errcode = '22023';
  end if;

  insert into public.cuentas (mesa_id, abierta_por, estado, dia_negocio)
  values (p_mesa_id, v_perfil_id, 'abierta', public.dia_negocio(now()))
  returning id into v_cuenta_id;

  insert into public.pedidos (cuenta_id, mesero_id, estado, notas)
  values (v_cuenta_id, v_perfil_id, 'enviado', nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := coalesce((v_item ->> 'cantidad')::int, 0);
    v_notas := nullif(trim(coalesce(v_item ->> 'notas', '')), '');

    if v_cantidad <= 0 then
      raise exception 'cantidad_invalida' using errcode = '22023';
    end if;

    select id, precio_venta into v_producto
    from public.productos
    where id = (v_item ->> 'producto_id')::uuid
      and activo = true;

    if v_producto.id is null then
      raise exception 'producto_no_disponible' using errcode = '22023';
    end if;

    insert into public.pedido_items (pedido_id, producto_id, cantidad, precio_unitario_capturado, notas, estado)
    values (v_pedido_id, v_producto.id, v_cantidad, v_producto.precio_venta, v_notas, 'enviado');
  end loop;

  perform public.recalcular_total_cuenta(v_cuenta_id);

  return v_pedido_id;
end;
$$;

create or replace function public.cambiar_estado_pedido(p_pedido_id uuid, p_estado public.estado_pedido)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_cambia_pedidos' using errcode = '42501';
  end if;

  if p_estado not in ('enviado','en_preparacion','entregado','anulado') then
    raise exception 'estado_pedido_invalido' using errcode = '22023';
  end if;

  update public.pedidos
  set estado = p_estado,
      en_preparacion_at = case when p_estado = 'en_preparacion' and en_preparacion_at is null then now() else en_preparacion_at end,
      entregado_at = case when p_estado = 'entregado' and entregado_at is null then now() else entregado_at end
  where id = p_pedido_id
  returning * into v_pedido;

  if v_pedido.id is null then
    raise exception 'pedido_no_encontrado' using errcode = '02000';
  end if;

  update public.pedido_items
  set estado = p_estado
  where pedido_id = p_pedido_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'cambiar_estado_pedido', 'pedidos', p_pedido_id, jsonb_build_object('estado', p_estado));

  return v_pedido;
end;
$$;

create or replace function public.registrar_pago_cuenta(p_cuenta_id uuid, p_medio public.medio_pago, p_monto numeric, p_propina numeric default 0)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago public.pagos;
  v_total numeric(12,0);
  v_pagado numeric(12,0);
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_pagos' using errcode = '42501';
  end if;

  if p_monto <= 0 then
    raise exception 'monto_invalido' using errcode = '22023';
  end if;

  insert into public.pagos (cuenta_id, medio, monto, propina, usuario_id)
  values (p_cuenta_id, p_medio, p_monto, coalesce(p_propina, 0), public.perfil_actual_id())
  returning * into v_pago;

  select total_cuenta into v_total from public.cuentas where id = p_cuenta_id;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos where cuenta_id = p_cuenta_id;

  update public.cuentas
  set estado = case when v_pagado >= v_total then 'pagada' else 'pagada_parcial' end
  where id = p_cuenta_id;

  return v_pago;
end;
$$;

-- RLS
alter table public.mesas enable row level security;
alter table public.categorias enable row level security;
alter table public.productos enable row level security;
alter table public.cuentas enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;
alter table public.pagos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mesas' and policyname = 'mesas_lectura_autenticados') then
    create policy mesas_lectura_autenticados on public.mesas for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categorias' and policyname = 'categorias_lectura_autenticados') then
    create policy categorias_lectura_autenticados on public.categorias for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'productos' and policyname = 'productos_lectura_autenticados') then
    create policy productos_lectura_autenticados on public.productos for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cuentas' and policyname = 'cuentas_lectura_por_rol') then
    create policy cuentas_lectura_por_rol on public.cuentas for select to authenticated using (public.es_caja_o_admin() or abierta_por = public.perfil_actual_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pedidos' and policyname = 'pedidos_lectura_por_rol') then
    create policy pedidos_lectura_por_rol on public.pedidos for select to authenticated using (public.es_caja_o_admin() or mesero_id = public.perfil_actual_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pedido_items' and policyname = 'pedido_items_lectura_por_rol') then
    create policy pedido_items_lectura_por_rol on public.pedido_items for select to authenticated using (
      exists (select 1 from public.pedidos p where p.id = pedido_id and (public.es_caja_o_admin() or p.mesero_id = public.perfil_actual_id()))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pagos' and policyname = 'pagos_lectura_caja_admin') then
    create policy pagos_lectura_caja_admin on public.pagos for select to authenticated using (public.es_caja_o_admin());
  end if;
end $$;

grant select on public.mesas, public.categorias, public.productos, public.cuentas, public.pedidos, public.pedido_items, public.pagos to authenticated;
grant execute on function public.recalcular_total_cuenta(uuid) to authenticated;
grant execute on function public.crear_pedido_rapido(uuid, jsonb, text) to authenticated;
grant execute on function public.cambiar_estado_pedido(uuid, public.estado_pedido) to authenticated;
grant execute on function public.registrar_pago_cuenta(uuid, public.medio_pago, numeric, numeric) to authenticated;

-- Seed F1 idempotente
insert into public.mesas (nombre, zona, es_vip, capacidad, activa)
values
  ('Mesa 1', 'Principal', false, 4, true),
  ('Mesa 2', 'Principal', false, 4, true),
  ('Mesa 3', 'Principal', false, 4, true),
  ('Mesa 4', 'Principal', false, 4, true),
  ('Mesa 5', 'Principal', false, 4, true),
  ('Mesa 6', 'Principal', false, 4, true),
  ('VIP 1', 'VIP', true, 8, true),
  ('VIP 2', 'VIP', true, 8, true)
on conflict (nombre) do update set zona = excluded.zona, es_vip = excluded.es_vip, capacidad = excluded.capacidad, activa = excluded.activa;

insert into public.categorias (nombre, activa)
values
  ('Cervezas', true),
  ('Licores', true),
  ('Gaseosas y aguas', true),
  ('Combos', true)
on conflict (nombre) do update set activa = excluded.activa;

insert into public.productos (nombre, categoria_id, precio_venta, costo_unitario_actual, codigo_interno, stock_actual, stock_minimo, activo)
select * from (
  values
    ('Cerveza Poker', 'Cervezas', 8000::numeric, 4200::numeric, 'CER-POKER', 120, 24, true),
    ('Cerveza Aguila', 'Cervezas', 8000::numeric, 4200::numeric, 'CER-AGUILA', 120, 24, true),
    ('Cerveza Club Colombia', 'Cervezas', 10000::numeric, 5200::numeric, 'CER-CLUB', 80, 18, true),
    ('Aguardiente Antioqueño Botella', 'Licores', 120000::numeric, 76000::numeric, 'LIC-AGU-ANT', 18, 4, true),
    ('Ron Viejo de Caldas Botella', 'Licores', 135000::numeric, 85000::numeric, 'LIC-RON-CALDAS', 14, 3, true),
    ('Whisky Old Parr Botella', 'Licores', 260000::numeric, 185000::numeric, 'LIC-WH-OLDPARR', 8, 2, true),
    ('Agua Cristal', 'Gaseosas y aguas', 5000::numeric, 2300::numeric, 'BEB-AGUA', 90, 24, true),
    ('Coca-Cola', 'Gaseosas y aguas', 6000::numeric, 2800::numeric, 'BEB-COCA', 96, 24, true),
    ('Ginger', 'Gaseosas y aguas', 6000::numeric, 2800::numeric, 'BEB-GINGER', 72, 18, true),
    ('Combo Aguardiente + 4 gaseosas', 'Combos', 140000::numeric, 88000::numeric, 'COM-AGU-4G', 20, 3, true)
) as v(nombre, categoria_nombre, precio_venta, costo_unitario_actual, codigo_interno, stock_actual, stock_minimo, activo)
join public.categorias c on c.nombre = v.categoria_nombre
on conflict (codigo_interno) do update set
  nombre = excluded.nombre,
  categoria_id = excluded.categoria_id,
  precio_venta = excluded.precio_venta,
  costo_unitario_actual = excluded.costo_unitario_actual,
  stock_actual = excluded.stock_actual,
  stock_minimo = excluded.stock_minimo,
  activo = excluded.activo;
