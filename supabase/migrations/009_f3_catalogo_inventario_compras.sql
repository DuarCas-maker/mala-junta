-- F3 - Catalogo, inventario, compras, combos y auditoria de inventario.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_movimiento_inventario') then
    create type public.tipo_movimiento_inventario as enum ('venta','compra','ajuste','merma','consumo_interno','devolucion');
  end if;

  if not exists (select 1 from pg_type where typname = 'modo_compra_item') then
    create type public.modo_compra_item as enum ('unidades','presentacion');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_auditoria_inventario') then
    create type public.estado_auditoria_inventario as enum ('en_curso','cerrada');
  end if;
end $$;

alter table public.productos add column if not exists presentacion_compra text not null default 'unidad';
alter table public.productos add column if not exists factor_compra int not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_factor_compra_positivo') then
    alter table public.productos add constraint productos_factor_compra_positivo check (factor_compra > 0);
  end if;
end $$;

create table if not exists public.historial_precios (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete restrict,
  precio_anterior numeric(12,0) not null check (precio_anterior >= 0),
  precio_nuevo numeric(12,0) not null check (precio_nuevo >= 0),
  usuario_id uuid references public.perfiles(id) on delete restrict,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.combos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  precio_venta numeric(12,0) not null check (precio_venta >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.combos(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad int not null check (cantidad > 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pedido_items add column if not exists combo_id uuid references public.combos(id) on delete restrict;
alter table public.pedido_items alter column producto_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedido_item_producto_o_combo') then
    alter table public.pedido_items add constraint pedido_item_producto_o_combo check (
      ((producto_id is not null)::int + (combo_id is not null)::int) = 1
    );
  end if;
end $$;

create table if not exists public.movimientos_inventario (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete restrict,
  tipo public.tipo_movimiento_inventario not null,
  cantidad int not null check (cantidad <> 0),
  stock_resultante int,
  referencia_tipo text,
  referencia_id uuid,
  motivo_id uuid references public.motivos(id) on delete restrict,
  usuario_id uuid references public.perfiles(id) on delete restrict,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint movimiento_motivo_requerido check (
    tipo not in ('ajuste','merma','consumo_interno') or motivo_id is not null
  )
);

create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  nit text,
  contacto text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid references public.proveedores(id) on delete restrict,
  fecha date not null default current_date,
  total numeric(12,0) not null default 0 check (total >= 0),
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  observacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compra_items (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  modo public.modo_compra_item not null,
  cantidad_ingresada int not null check (cantidad_ingresada > 0),
  factor_aplicado int not null check (factor_aplicado > 0),
  unidades_resultantes int not null check (unidades_resultantes > 0),
  costo_unitario numeric(12,0) not null check (costo_unitario >= 0),
  subtotal numeric(12,0) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.auditorias_inventario (
  id uuid primary key default gen_random_uuid(),
  dia_negocio date not null default public.dia_negocio(now()),
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  estado public.estado_auditoria_inventario not null default 'en_curso',
  observacion text,
  cerrada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auditoria_items (
  id uuid primary key default gen_random_uuid(),
  auditoria_id uuid not null references public.auditorias_inventario(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  teorico int not null,
  contado int,
  diferencia int,
  motivo_id uuid references public.motivos(id) on delete restrict,
  movimiento_inventario_id uuid references public.movimientos_inventario(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auditoria_id, producto_id)
);

create index if not exists movimientos_producto_timestamp_idx on public.movimientos_inventario(producto_id, timestamp desc);
create index if not exists movimientos_referencia_idx on public.movimientos_inventario(referencia_tipo, referencia_id);
create index if not exists combo_items_combo_idx on public.combo_items(combo_id) where activo = true;
create index if not exists compra_items_compra_idx on public.compra_items(compra_id);
create index if not exists auditoria_items_auditoria_idx on public.auditoria_items(auditoria_id);

create or replace function public.registrar_historial_precio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.precio_venta is distinct from new.precio_venta then
    insert into public.historial_precios (producto_id, precio_anterior, precio_nuevo, usuario_id)
    values (new.id, old.precio_venta, new.precio_venta, public.perfil_actual_id());

    insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
    values (
      public.perfil_actual_id(),
      'cambiar_precio_producto',
      'productos',
      new.id,
      jsonb_build_object('precio_anterior', old.precio_venta, 'precio_nuevo', new.precio_venta)
    );
  end if;
  return new;
end;
$$;

create or replace function public.aplicar_movimiento_inventario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock int;
  v_stock_nuevo int;
begin
  select stock_actual into v_stock
  from public.productos
  where id = new.producto_id
  for update;

  if v_stock is null then
    raise exception 'producto_no_encontrado' using errcode = '02000';
  end if;

  v_stock_nuevo := v_stock + new.cantidad;

  if v_stock_nuevo < 0 then
    raise exception 'stock_insuficiente' using errcode = '22023';
  end if;

  update public.productos
  set stock_actual = v_stock_nuevo
  where id = new.producto_id;

  new.stock_resultante := v_stock_nuevo;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'productos_historial_precio') then
    create trigger productos_historial_precio
    after update of precio_venta on public.productos
    for each row execute function public.registrar_historial_precio();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'movimientos_aplicar_stock') then
    create trigger movimientos_aplicar_stock
    before insert on public.movimientos_inventario
    for each row execute function public.aplicar_movimiento_inventario();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'combos_set_updated_at') then
    create trigger combos_set_updated_at before update on public.combos for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'combo_items_set_updated_at') then
    create trigger combo_items_set_updated_at before update on public.combo_items for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'proveedores_set_updated_at') then
    create trigger proveedores_set_updated_at before update on public.proveedores for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'compras_set_updated_at') then
    create trigger compras_set_updated_at before update on public.compras for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'auditorias_inventario_set_updated_at') then
    create trigger auditorias_inventario_set_updated_at before update on public.auditorias_inventario for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'auditoria_items_set_updated_at') then
    create trigger auditoria_items_set_updated_at before update on public.auditoria_items for each row execute function public.set_updated_at();
  end if;
end $$;

insert into public.motivos (tipo, texto, activo)
values
  ('ajuste_inventario', 'Stock inicial F3', true),
  ('ajuste_inventario', 'Compra registrada', true),
  ('ajuste_inventario', 'Ajuste por auditoria', true),
  ('ajuste_inventario', 'Merma o rotura', true),
  ('ajuste_inventario', 'Consumo interno', true)
on conflict (tipo, texto) do update set activo = excluded.activo;

with motivo as (
  select id from public.motivos where tipo = 'ajuste_inventario' and texto = 'Stock inicial F3' limit 1
),
admin as (
  select id from public.perfiles where rol = 'admin' order by created_at limit 1
),
base as (
  select p.id, p.stock_actual
  from public.productos p
  where p.stock_actual <> 0
    and not exists (
      select 1
      from public.movimientos_inventario mi
      where mi.producto_id = p.id
        and mi.referencia_tipo = 'migracion_f3_stock_inicial'
    )
),
reset as (
  update public.productos p
  set stock_actual = 0
  from base b
  where p.id = b.id
  returning p.id
)
insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo_id, usuario_id)
select b.id, 'ajuste', b.stock_actual, 'migracion_f3_stock_inicial', b.id, motivo.id, admin.id
from base b
cross join motivo
left join admin on true;

update public.productos
set presentacion_compra = 'caja x24', factor_compra = 24
where codigo_interno in ('CER-POKER','CER-AGUILA','CER-CLUB');



update public.productos
set activo = false
where codigo_interno like 'COM-%';

create or replace function public.crear_categoria_catalogo(p_nombre text)
returns public.categorias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria public.categorias;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_gestiona_catalogo' using errcode = '42501';
  end if;

  insert into public.categorias (nombre, activa)
  values (trim(p_nombre), true)
  on conflict (nombre) do update set activa = true
  returning * into v_categoria;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'guardar_categoria', 'categorias', v_categoria.id, jsonb_build_object('nombre', v_categoria.nombre));

  return v_categoria;
end;
$$;

create or replace function public.guardar_producto_catalogo(
  p_producto_id uuid default null,
  p_nombre text default null,
  p_categoria_id uuid default null,
  p_precio_venta numeric default 0,
  p_costo_unitario numeric default 0,
  p_codigo_interno text default null,
  p_stock_minimo int default 0,
  p_presentacion_compra text default 'unidad',
  p_factor_compra int default 1,
  p_activo boolean default true
)
returns public.productos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto public.productos;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_gestiona_catalogo' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_producto_invalido' using errcode = '22023';
  end if;

  if coalesce(p_precio_venta, -1) < 0 or coalesce(p_costo_unitario, -1) < 0 then
    raise exception 'valores_producto_invalidos' using errcode = '22023';
  end if;

  if coalesce(p_factor_compra, 0) <= 0 then
    raise exception 'factor_compra_invalido' using errcode = '22023';
  end if;

  if p_producto_id is null then
    insert into public.productos (
      nombre, categoria_id, precio_venta, costo_unitario_actual, codigo_interno,
      stock_minimo, presentacion_compra, factor_compra, activo
    )
    values (
      trim(p_nombre), p_categoria_id, p_precio_venta, p_costo_unitario, nullif(trim(coalesce(p_codigo_interno, '')), ''),
      greatest(coalesce(p_stock_minimo, 0), 0), nullif(trim(coalesce(p_presentacion_compra, '')), ''), p_factor_compra, coalesce(p_activo, true)
    )
    returning * into v_producto;
  else
    update public.productos
    set nombre = trim(p_nombre),
        categoria_id = p_categoria_id,
        precio_venta = p_precio_venta,
        costo_unitario_actual = p_costo_unitario,
        codigo_interno = nullif(trim(coalesce(p_codigo_interno, '')), ''),
        stock_minimo = greatest(coalesce(p_stock_minimo, 0), 0),
        presentacion_compra = nullif(trim(coalesce(p_presentacion_compra, '')), ''),
        factor_compra = p_factor_compra,
        activo = coalesce(p_activo, true)
    where id = p_producto_id
    returning * into v_producto;
  end if;

  if v_producto.id is null then
    raise exception 'producto_no_encontrado' using errcode = '02000';
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'guardar_producto', 'productos', v_producto.id, jsonb_build_object('nombre', v_producto.nombre));

  return v_producto;
end;
$$;

create or replace function public.crear_combo_catalogo(
  p_combo_id uuid default null,
  p_nombre text default null,
  p_precio_venta numeric default 0,
  p_items jsonb default '[]'::jsonb,
  p_activo boolean default true
)
returns public.combos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_combo public.combos;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad int;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_gestiona_combos' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_combo_invalido' using errcode = '22023';
  end if;

  if coalesce(p_precio_venta, -1) < 0 then
    raise exception 'precio_combo_invalido' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'combo_sin_componentes' using errcode = '22023';
  end if;

  if p_combo_id is null then
    insert into public.combos (nombre, precio_venta, activo)
    values (trim(p_nombre), p_precio_venta, coalesce(p_activo, true))
    on conflict (nombre) do update
      set precio_venta = excluded.precio_venta,
          activo = excluded.activo
    returning * into v_combo;
  else
    update public.combos
    set nombre = trim(p_nombre),
        precio_venta = p_precio_venta,
        activo = coalesce(p_activo, true)
    where id = p_combo_id
    returning * into v_combo;
  end if;

  update public.combo_items
  set activo = false
  where combo_id = v_combo.id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := (v_item ->> 'producto_id')::uuid;
    v_cantidad := coalesce((v_item ->> 'cantidad')::int, 0);

    if v_cantidad <= 0 or not exists (select 1 from public.productos where id = v_producto_id and activo = true) then
      raise exception 'componente_combo_invalido' using errcode = '22023';
    end if;

    insert into public.combo_items (combo_id, producto_id, cantidad, activo)
    values (v_combo.id, v_producto_id, v_cantidad, true);
  end loop;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'guardar_combo', 'combos', v_combo.id, jsonb_build_object('nombre', v_combo.nombre));

  return v_combo;
end;
$$;

create or replace function public.guardar_proveedor(
  p_proveedor_id uuid default null,
  p_nombre text default null,
  p_nit text default null,
  p_contacto text default null,
  p_activo boolean default true
)
returns public.proveedores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proveedor public.proveedores;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_gestiona_proveedores' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_proveedor_invalido' using errcode = '22023';
  end if;

  if p_proveedor_id is null then
    insert into public.proveedores (nombre, nit, contacto, activo)
    values (trim(p_nombre), nullif(trim(coalesce(p_nit, '')), ''), nullif(trim(coalesce(p_contacto, '')), ''), coalesce(p_activo, true))
    on conflict (nombre) do update set nit = excluded.nit, contacto = excluded.contacto, activo = excluded.activo
    returning * into v_proveedor;
  else
    update public.proveedores
    set nombre = trim(p_nombre),
        nit = nullif(trim(coalesce(p_nit, '')), ''),
        contacto = nullif(trim(coalesce(p_contacto, '')), ''),
        activo = coalesce(p_activo, true)
    where id = p_proveedor_id
    returning * into v_proveedor;
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'guardar_proveedor', 'proveedores', v_proveedor.id, jsonb_build_object('nombre', v_proveedor.nombre));

  return v_proveedor;
end;
$$;

create or replace function public.registrar_compra(
  p_proveedor_id uuid,
  p_items jsonb,
  p_fecha date default current_date,
  p_observacion text default null
)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra public.compras;
  v_compra_item public.compra_items;
  v_item jsonb;
  v_producto public.productos;
  v_modo public.modo_compra_item;
  v_cantidad int;
  v_factor int;
  v_unidades int;
  v_costo numeric(12,0);
  v_total numeric(12,0) := 0;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_registra_compras' using errcode = '42501';
  end if;

  if p_proveedor_id is not null and not exists (select 1 from public.proveedores where id = p_proveedor_id and activo = true) then
    raise exception 'proveedor_invalido' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'compra_sin_items' using errcode = '22023';
  end if;

  insert into public.compras (proveedor_id, fecha, usuario_id, observacion)
  values (p_proveedor_id, coalesce(p_fecha, current_date), public.perfil_actual_id(), nullif(trim(coalesce(p_observacion, '')), ''))
  returning * into v_compra;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_producto
    from public.productos
    where id = (v_item ->> 'producto_id')::uuid
      and activo = true;

    if v_producto.id is null then
      raise exception 'producto_compra_invalido' using errcode = '22023';
    end if;

    v_modo := coalesce(v_item ->> 'modo', 'unidades')::public.modo_compra_item;
    v_cantidad := coalesce((v_item ->> 'cantidad_ingresada')::int, 0);
    v_factor := case when v_modo = 'presentacion' then coalesce(nullif(v_item ->> 'factor_aplicado', '')::int, v_producto.factor_compra) else 1 end;
    v_unidades := v_cantidad * v_factor;
    v_costo := coalesce((v_item ->> 'costo_unitario')::numeric, v_producto.costo_unitario_actual);

    if v_cantidad <= 0 or v_factor <= 0 or v_unidades <= 0 or v_costo < 0 then
      raise exception 'item_compra_invalido' using errcode = '22023';
    end if;

    insert into public.compra_items (
      compra_id, producto_id, modo, cantidad_ingresada, factor_aplicado,
      unidades_resultantes, costo_unitario, subtotal
    )
    values (
      v_compra.id, v_producto.id, v_modo, v_cantidad, v_factor,
      v_unidades, v_costo, v_unidades * v_costo
    )
    returning * into v_compra_item;

    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id
    )
    values (
      v_producto.id, 'compra', v_unidades, 'compra_item', v_compra_item.id, public.perfil_actual_id()
    );

    update public.productos
    set costo_unitario_actual = v_costo
    where id = v_producto.id;

    v_total := v_total + (v_unidades * v_costo);
  end loop;

  update public.compras
  set total = v_total
  where id = v_compra.id
  returning * into v_compra;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_compra', 'compras', v_compra.id, jsonb_build_object('total', v_total));

  return v_compra;
end;
$$;

create or replace function public.registrar_movimiento_inventario(
  p_producto_id uuid,
  p_tipo public.tipo_movimiento_inventario,
  p_cantidad int,
  p_motivo_id uuid,
  p_observacion text default null
)
returns public.movimientos_inventario
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movimiento public.movimientos_inventario;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_ajusta_inventario' using errcode = '42501';
  end if;

  if p_tipo not in ('ajuste','merma','consumo_interno','devolucion') then
    raise exception 'tipo_movimiento_manual_invalido' using errcode = '22023';
  end if;

  if p_tipo in ('ajuste','merma','consumo_interno') and not exists (
    select 1 from public.motivos where id = p_motivo_id and tipo = 'ajuste_inventario' and activo = true
  ) then
    raise exception 'motivo_inventario_invalido' using errcode = '22023';
  end if;

  insert into public.movimientos_inventario (
    producto_id, tipo, cantidad, referencia_tipo, motivo_id, usuario_id
  )
  values (
    p_producto_id, p_tipo, p_cantidad, 'ajuste_manual', p_motivo_id, public.perfil_actual_id()
  )
  returning * into v_movimiento;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'registrar_movimiento_inventario',
    'movimientos_inventario',
    v_movimiento.id,
    jsonb_build_object('tipo', p_tipo, 'cantidad', p_cantidad, 'motivo_id', p_motivo_id, 'observacion', p_observacion)
  );

  return v_movimiento;
end;
$$;

create or replace function public.crear_auditoria_inventario(p_producto_ids jsonb, p_observacion text default null)
returns public.auditorias_inventario
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auditoria public.auditorias_inventario;
  v_item jsonb;
  v_producto public.productos;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_crea_auditorias' using errcode = '42501';
  end if;

  if jsonb_typeof(p_producto_ids) <> 'array' or jsonb_array_length(p_producto_ids) = 0 then
    raise exception 'auditoria_sin_productos' using errcode = '22023';
  end if;

  insert into public.auditorias_inventario (usuario_id, observacion)
  values (public.perfil_actual_id(), nullif(trim(coalesce(p_observacion, '')), ''))
  returning * into v_auditoria;

  for v_item in select * from jsonb_array_elements(p_producto_ids)
  loop
    select * into v_producto
    from public.productos
    where id = (v_item #>> '{}')::uuid
      and activo = true;

    if v_producto.id is null then
      raise exception 'producto_auditoria_invalido' using errcode = '22023';
    end if;

    insert into public.auditoria_items (auditoria_id, producto_id, teorico)
    values (v_auditoria.id, v_producto.id, v_producto.stock_actual)
    on conflict (auditoria_id, producto_id) do nothing;
  end loop;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'crear_auditoria_inventario', 'auditorias_inventario', v_auditoria.id, jsonb_build_object('productos', p_producto_ids));

  return v_auditoria;
end;
$$;

create or replace function public.registrar_conteo_auditoria(p_auditoria_id uuid, p_items jsonb)
returns public.auditorias_inventario
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auditoria public.auditorias_inventario;
  v_item jsonb;
  v_producto_id uuid;
  v_contado int;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_registra_conteos' using errcode = '42501';
  end if;

  select * into v_auditoria
  from public.auditorias_inventario
  where id = p_auditoria_id
    and estado = 'en_curso';

  if v_auditoria.id is null then
    raise exception 'auditoria_no_en_curso' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'conteos_invalidos' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := (v_item ->> 'producto_id')::uuid;
    v_contado := coalesce((v_item ->> 'contado')::int, -1);

    if v_contado < 0 then
      raise exception 'conteo_invalido' using errcode = '22023';
    end if;

    update public.auditoria_items
    set contado = v_contado,
        diferencia = v_contado - teorico
    where auditoria_id = p_auditoria_id
      and producto_id = v_producto_id;
  end loop;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_conteo_auditoria', 'auditorias_inventario', p_auditoria_id, jsonb_build_object('items', p_items));

  return v_auditoria;
end;
$$;

create or replace function public.cerrar_auditoria_inventario(p_auditoria_id uuid, p_resoluciones jsonb default '[]'::jsonb)
returns public.auditorias_inventario
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auditoria public.auditorias_inventario;
  v_item public.auditoria_items;
  v_res jsonb;
  v_tipo public.tipo_movimiento_inventario;
  v_motivo_id uuid;
  v_movimiento public.movimientos_inventario;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_cierra_auditorias' using errcode = '42501';
  end if;

  select * into v_auditoria
  from public.auditorias_inventario
  where id = p_auditoria_id
    and estado = 'en_curso';

  if v_auditoria.id is null then
    raise exception 'auditoria_no_en_curso' using errcode = '22023';
  end if;

  if exists (select 1 from public.auditoria_items where auditoria_id = p_auditoria_id and contado is null) then
    raise exception 'auditoria_con_conteos_pendientes' using errcode = '22023';
  end if;

  for v_item in
    select * from public.auditoria_items
    where auditoria_id = p_auditoria_id
      and coalesce(diferencia, 0) <> 0
  loop
    select r into v_res
    from jsonb_array_elements(p_resoluciones) r
    where (r ->> 'producto_id')::uuid = v_item.producto_id
    limit 1;

    if v_res is null then
      raise exception 'diferencia_requiere_resolucion' using errcode = '22023';
    end if;

    v_tipo := coalesce(v_res ->> 'tipo', 'ajuste')::public.tipo_movimiento_inventario;
    v_motivo_id := (v_res ->> 'motivo_id')::uuid;

    if v_tipo not in ('ajuste','merma','consumo_interno') then
      raise exception 'tipo_resolucion_invalido' using errcode = '22023';
    end if;

    if not exists (select 1 from public.motivos where id = v_motivo_id and tipo = 'ajuste_inventario' and activo = true) then
      raise exception 'motivo_inventario_invalido' using errcode = '22023';
    end if;

    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo_id, usuario_id
    )
    values (
      v_item.producto_id, v_tipo, v_item.diferencia, 'auditoria_item', v_item.id, v_motivo_id, public.perfil_actual_id()
    )
    returning * into v_movimiento;

    update public.auditoria_items
    set motivo_id = v_motivo_id,
        movimiento_inventario_id = v_movimiento.id
    where id = v_item.id;
  end loop;

  update public.auditorias_inventario
  set estado = 'cerrada',
      cerrada_at = now()
  where id = p_auditoria_id
  returning * into v_auditoria;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'cerrar_auditoria_inventario', 'auditorias_inventario', p_auditoria_id, jsonb_build_object('resoluciones', p_resoluciones));

  return v_auditoria;
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
  v_pedido_item_id uuid;
  v_item jsonb;
  v_producto public.productos;
  v_combo public.combos;
  v_componente record;
  v_cantidad int;
  v_notas text;
  v_producto_id uuid;
  v_combo_id uuid;
begin
  v_perfil_id := public.perfil_actual_id();

  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'pedido_sin_items' using errcode = '22023';
  end if;

  v_cuenta_id := public.obtener_o_crear_cuenta(p_mesa_id);

  update public.cuentas
  set estado = case when estado in ('pagada_parcial','por_cobrar') then 'abierta' else estado end
  where id = v_cuenta_id;

  insert into public.pedidos (cuenta_id, mesero_id, estado, notas)
  values (v_cuenta_id, v_perfil_id, 'enviado', nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := coalesce((v_item ->> 'cantidad')::int, 0);
    v_notas := nullif(trim(coalesce(v_item ->> 'notas', '')), '');
    v_producto_id := nullif(v_item ->> 'producto_id', '')::uuid;
    v_combo_id := nullif(v_item ->> 'combo_id', '')::uuid;

    if v_cantidad <= 0 then
      raise exception 'cantidad_invalida' using errcode = '22023';
    end if;

    if (v_producto_id is null and v_combo_id is null) or (v_producto_id is not null and v_combo_id is not null) then
      raise exception 'item_pedido_invalido' using errcode = '22023';
    end if;

    if v_producto_id is not null then
      select * into v_producto
      from public.productos
      where id = v_producto_id
        and activo = true;

      if v_producto.id is null then
        raise exception 'producto_no_disponible' using errcode = '22023';
      end if;

      insert into public.pedido_items (pedido_id, producto_id, cantidad, precio_unitario_capturado, notas, estado)
      values (v_pedido_id, v_producto.id, v_cantidad, v_producto.precio_venta, v_notas, 'enviado')
      returning id into v_pedido_item_id;

      insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
      values (v_producto.id, 'venta', -v_cantidad, 'pedido_item', v_pedido_item_id, v_perfil_id);
    else
      select * into v_combo
      from public.combos
      where id = v_combo_id
        and activo = true;

      if v_combo.id is null then
        raise exception 'combo_no_disponible' using errcode = '22023';
      end if;

      if not exists (select 1 from public.combo_items where combo_id = v_combo.id and activo = true) then
        raise exception 'combo_sin_componentes' using errcode = '22023';
      end if;

      insert into public.pedido_items (pedido_id, combo_id, cantidad, precio_unitario_capturado, notas, estado)
      values (v_pedido_id, v_combo.id, v_cantidad, v_combo.precio_venta, v_notas, 'enviado')
      returning id into v_pedido_item_id;

      for v_componente in
        select producto_id, cantidad
        from public.combo_items
        where combo_id = v_combo.id
          and activo = true
      loop
        insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
        values (v_componente.producto_id, 'venta', -(v_componente.cantidad * v_cantidad), 'pedido_item', v_pedido_item_id, v_perfil_id);
      end loop;
    end if;
  end loop;

  perform public.recalcular_total_cuenta(v_cuenta_id);

  return v_pedido_id;
end;
$$;

create or replace function public.revertir_inventario_pedido(p_pedido_id uuid, p_motivo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov record;
begin
  for v_mov in
    select mi.producto_id, mi.referencia_id as pedido_item_id, -sum(mi.cantidad)::int as cantidad_devolver
    from public.movimientos_inventario mi
    join public.pedido_items pi on pi.id = mi.referencia_id
    where pi.pedido_id = p_pedido_id
      and mi.tipo = 'venta'
      and mi.referencia_tipo = 'pedido_item'
      and not exists (
        select 1
        from public.movimientos_inventario d
        where d.tipo = 'devolucion'
          and d.referencia_tipo = 'pedido_item_anulado'
          and d.referencia_id = mi.referencia_id
          and d.producto_id = mi.producto_id
      )
    group by mi.producto_id, mi.referencia_id
  loop
    if v_mov.cantidad_devolver > 0 then
      insert into public.movimientos_inventario (
        producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo_id, usuario_id
      )
      values (
        v_mov.producto_id, 'devolucion', v_mov.cantidad_devolver, 'pedido_item_anulado', v_mov.pedido_item_id, p_motivo_id, public.perfil_actual_id()
      );
    end if;
  end loop;
end;
$$;

create or replace function public.anular_pedido(p_pedido_id uuid, p_motivo_id uuid, p_observacion text default null)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos;
  v_detalle jsonb;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_anula_pedidos' using errcode = '42501';
  end if;

  if not exists (select 1 from public.motivos where id = p_motivo_id and tipo = 'anulacion' and activo = true) then
    raise exception 'motivo_anulacion_invalido' using errcode = '22023';
  end if;

  select to_jsonb(p.*) into v_detalle
  from public.pedidos p
  where p.id = p_pedido_id;

  update public.pedidos
  set estado = 'anulado',
      motivo_anulacion_id = p_motivo_id,
      anulado_por = public.perfil_actual_id(),
      anulado_at = now()
  where id = p_pedido_id
  returning * into v_pedido;

  if v_pedido.id is null then
    raise exception 'pedido_no_encontrado' using errcode = '02000';
  end if;

  update public.pedido_items
  set estado = 'anulado', motivo_anulacion_id = p_motivo_id
  where pedido_id = p_pedido_id;

  perform public.revertir_inventario_pedido(p_pedido_id, p_motivo_id);
  perform public.recalcular_total_cuenta(v_pedido.cuenta_id);

  insert into public.modificaciones_pedido (pedido_id, accion, detalle_antes, detalle_despues, motivo_id, usuario_id)
  values (p_pedido_id, 'anular', coalesce(v_detalle, '{}'::jsonb), jsonb_build_object('observacion', p_observacion, 'estado', 'anulado'), p_motivo_id, public.perfil_actual_id());

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'anular_pedido', 'pedidos', p_pedido_id, jsonb_build_object('motivo_id', p_motivo_id, 'observacion', p_observacion));

  return v_pedido;
end;
$$;

create or replace function public.cuentas_activas_caja()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_lee_cuentas' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(cuenta_json order by (cuenta_json ->> 'created_at')::timestamptz desc)
    from (
      select jsonb_build_object(
        'id', c.id,
        'estado', c.estado,
        'total_cuenta', c.total_cuenta,
        'responsable_pendiente', c.responsable_pendiente,
        'created_at', c.created_at,
        'mesas', case when m.id is null then null else jsonb_build_object('nombre', m.nombre, 'zona', m.zona) end,
        'perfiles', jsonb_build_object('nombre', pa.nombre),
        'pagos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pg.id,
            'monto', pg.monto,
            'medio', pg.medio,
            'propina', pg.propina,
            'timestamp', pg.timestamp
          ) order by pg.timestamp)
          from public.pagos pg
          where pg.cuenta_id = c.id
        ), '[]'::jsonb),
        'pedidos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id,
            'estado', p.estado,
            'enviado_at', p.enviado_at,
            'notas', p.notas,
            'perfiles', jsonb_build_object('nombre', pm.nombre),
            'pedido_items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', pi.id,
                'cantidad', pi.cantidad,
                'precio_unitario_capturado', pi.precio_unitario_capturado,
                'notas', pi.notas,
                'estado', pi.estado,
                'productos', case when pr.id is null then null else jsonb_build_object('nombre', pr.nombre) end,
                'combos', case when co.id is null then null else jsonb_build_object('nombre', co.nombre) end
              ) order by pi.created_at)
              from public.pedido_items pi
              left join public.productos pr on pr.id = pi.producto_id
              left join public.combos co on co.id = pi.combo_id
              where pi.pedido_id = p.id
            ), '[]'::jsonb)
          ) order by p.enviado_at)
          from public.pedidos p
          join public.perfiles pm on pm.id = p.mesero_id
          where p.cuenta_id = c.id
        ), '[]'::jsonb)
      ) as cuenta_json
      from public.cuentas c
      left join public.mesas m on m.id = c.mesa_id
      join public.perfiles pa on pa.id = c.abierta_por
      where c.estado in ('abierta', 'por_cobrar', 'pagada_parcial', 'pendiente')
    ) cuentas
  ), '[]'::jsonb);
end;
$$;

create or replace view public.v_alertas_stock_bajo
with (security_invoker = true)
as
select
  p.id,
  p.nombre,
  c.nombre as categoria,
  p.stock_actual,
  p.stock_minimo,
  p.costo_unitario_actual,
  p.stock_actual * p.costo_unitario_actual as valor_inventario
from public.productos p
left join public.categorias c on c.id = p.categoria_id
where p.activo = true
  and public.es_caja_o_admin()
  and p.stock_actual <= p.stock_minimo;

create or replace view public.v_candidatos_auditoria
with (security_invoker = true)
as
select
  p.id,
  p.nombre,
  c.nombre as categoria,
  p.stock_actual,
  p.costo_unitario_actual,
  p.stock_actual * p.costo_unitario_actual as valor_inventario,
  coalesce(sum(abs(mi.cantidad)) filter (
    where mi.tipo = 'venta'
      and mi.timestamp >= now() - interval '30 days'
  ), 0) as rotacion_30d,
  (p.stock_actual * p.costo_unitario_actual)
    + coalesce(sum(abs(mi.cantidad)) filter (
      where mi.tipo = 'venta'
        and mi.timestamp >= now() - interval '30 days'
    ), 0) * 1000 as puntaje_sugerido
from public.productos p
left join public.categorias c on c.id = p.categoria_id
left join public.movimientos_inventario mi on mi.producto_id = p.id
where p.activo = true
  and public.es_caja_o_admin()
group by p.id, p.nombre, c.nombre, p.stock_actual, p.costo_unitario_actual
order by puntaje_sugerido desc, p.nombre;

alter table public.historial_precios enable row level security;
alter table public.combos enable row level security;
alter table public.combo_items enable row level security;
alter table public.movimientos_inventario enable row level security;
alter table public.proveedores enable row level security;
alter table public.compras enable row level security;
alter table public.compra_items enable row level security;
alter table public.auditorias_inventario enable row level security;
alter table public.auditoria_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'combos' and policyname = 'combos_lectura_autenticados') then
    create policy combos_lectura_autenticados on public.combos for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'combo_items' and policyname = 'combo_items_lectura_autenticados') then
    create policy combo_items_lectura_autenticados on public.combo_items for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'historial_precios' and policyname = 'historial_precios_admin_lee') then
    create policy historial_precios_admin_lee on public.historial_precios for select to authenticated using (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'movimientos_inventario' and policyname = 'movimientos_inventario_caja_admin_lee') then
    create policy movimientos_inventario_caja_admin_lee on public.movimientos_inventario for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedores' and policyname = 'proveedores_caja_admin_lee') then
    create policy proveedores_caja_admin_lee on public.proveedores for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'compras' and policyname = 'compras_caja_admin_lee') then
    create policy compras_caja_admin_lee on public.compras for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'compra_items' and policyname = 'compra_items_caja_admin_lee') then
    create policy compra_items_caja_admin_lee on public.compra_items for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'auditorias_inventario' and policyname = 'auditorias_inventario_caja_admin_lee') then
    create policy auditorias_inventario_caja_admin_lee on public.auditorias_inventario for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'auditoria_items' and policyname = 'auditoria_items_caja_admin_lee') then
    create policy auditoria_items_caja_admin_lee on public.auditoria_items for select to authenticated using (public.es_caja_o_admin());
  end if;
end $$;

grant select on public.historial_precios, public.combos, public.combo_items, public.movimientos_inventario, public.proveedores, public.compras, public.compra_items, public.auditorias_inventario, public.auditoria_items to authenticated;
grant select on public.v_alertas_stock_bajo, public.v_candidatos_auditoria to authenticated;
grant execute on function public.crear_categoria_catalogo(text) to authenticated;
grant execute on function public.guardar_producto_catalogo(uuid, text, uuid, numeric, numeric, text, int, text, int, boolean) to authenticated;
grant execute on function public.crear_combo_catalogo(uuid, text, numeric, jsonb, boolean) to authenticated;
grant execute on function public.guardar_proveedor(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.registrar_compra(uuid, jsonb, date, text) to authenticated;
grant execute on function public.registrar_movimiento_inventario(uuid, public.tipo_movimiento_inventario, int, uuid, text) to authenticated;
grant execute on function public.crear_auditoria_inventario(jsonb, text) to authenticated;
grant execute on function public.registrar_conteo_auditoria(uuid, jsonb) to authenticated;
grant execute on function public.cerrar_auditoria_inventario(uuid, jsonb) to authenticated;
grant execute on function public.revertir_inventario_pedido(uuid, uuid) to authenticated;
grant execute on function public.crear_pedido_rapido(uuid, jsonb, text) to authenticated;
grant execute on function public.anular_pedido(uuid, uuid, text) to authenticated;
grant execute on function public.cuentas_activas_caja() to authenticated;

insert into public.proveedores (nombre, nit, contacto, activo)
values
  ('Distribuidora Andina', '900000001-1', 'compras@andina.example', true),
  ('Licores del Centro', '900000002-2', 'WhatsApp proveedor', true)
on conflict (nombre) do update set nit = excluded.nit, contacto = excluded.contacto, activo = excluded.activo;

do $$
declare
  v_combo_id uuid;
begin
  insert into public.combos (nombre, precio_venta, activo)
  values ('Combo Aguardiente + 4 gaseosas', 145000, true)
  on conflict (nombre) do update set precio_venta = excluded.precio_venta, activo = excluded.activo
  returning id into v_combo_id;

  update public.combo_items set activo = false where combo_id = v_combo_id;
  insert into public.combo_items (combo_id, producto_id, cantidad, activo)
  select v_combo_id, p.id, v.cantidad, true
  from (
    values
      ('LIC-AGU-ANT', 1),
      ('BEB-COCA', 4)
  ) as v(codigo, cantidad)
  join public.productos p on p.codigo_interno = v.codigo;

  insert into public.combos (nombre, precio_venta, activo)
  values ('Combo Ron + 6 cervezas', 175000, true)
  on conflict (nombre) do update set precio_venta = excluded.precio_venta, activo = excluded.activo
  returning id into v_combo_id;

  update public.combo_items set activo = false where combo_id = v_combo_id;
  insert into public.combo_items (combo_id, producto_id, cantidad, activo)
  select v_combo_id, p.id, v.cantidad, true
  from (
    values
      ('LIC-RON-CALDAS', 1),
      ('CER-POKER', 6)
  ) as v(codigo, cantidad)
  join public.productos p on p.codigo_interno = v.codigo;
end $$;

do $$
begin
  alter table public.productos replica identity full;
  alter table public.combos replica identity full;
  alter table public.combo_items replica identity full;
  alter table public.movimientos_inventario replica identity full;
  alter table public.auditorias_inventario replica identity full;

  begin
    alter publication supabase_realtime add table public.productos;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.combos;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.movimientos_inventario;
  exception when duplicate_object then null;
  end;
exception when undefined_object then
  null;
end $$;
