-- F1 complemento - cuentas reutilizables, anulaciones con motivo, pagos mixtos y realtime.

create table if not exists public.sub_cuentas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete restrict,
  etiqueta text not null default 'Cliente 1',
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.modificaciones_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_item_id uuid references public.pedido_items(id) on delete restrict,
  pedido_id uuid references public.pedidos(id) on delete restrict,
  accion text not null check (accion in ('modificar','anular')),
  detalle_antes jsonb not null default '{}'::jsonb,
  detalle_despues jsonb not null default '{}'::jsonb,
  motivo_id uuid not null references public.motivos(id) on delete restrict,
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  timestamp timestamptz not null default now(),
  check (pedido_item_id is not null or pedido_id is not null)
);

alter table public.pedidos add column if not exists motivo_anulacion_id uuid references public.motivos(id) on delete restrict;
alter table public.pedidos add column if not exists anulado_por uuid references public.perfiles(id) on delete restrict;
alter table public.pedidos add column if not exists anulado_at timestamptz;
alter table public.pedido_items add column if not exists motivo_anulacion_id uuid references public.motivos(id) on delete restrict;
alter table public.pagos add column if not exists es_abono_pendiente boolean not null default false;
-- En desarrollo pueden existir duplicados por pruebas previas. No se borra nada:
-- se conserva abierta la cuenta mas reciente por mesa y se cierran las anteriores.
with cuentas_duplicadas as (
  select
    id,
    row_number() over (partition by mesa_id order by created_at desc, id desc) as posicion
  from public.cuentas
  where mesa_id is not null
    and estado in ('abierta','por_cobrar','pagada_parcial')
)
update public.cuentas
set estado = 'cerrada'
where id in (select id from cuentas_duplicadas where posicion > 1);

create unique index if not exists cuentas_una_abierta_por_mesa_idx
on public.cuentas (mesa_id)
where mesa_id is not null and estado in ('abierta','por_cobrar','pagada_parcial');

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sub_cuentas_set_updated_at') then
    create trigger sub_cuentas_set_updated_at before update on public.sub_cuentas for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.obtener_o_crear_cuenta(p_mesa_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
  v_cuenta_id uuid;
begin
  v_perfil_id := public.perfil_actual_id();

  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  if p_mesa_id is not null and not exists (select 1 from public.mesas where id = p_mesa_id and activa = true) then
    raise exception 'mesa_no_disponible' using errcode = '22023';
  end if;

  if p_mesa_id is not null then
    select id into v_cuenta_id
    from public.cuentas
    where mesa_id = p_mesa_id
      and estado in ('abierta','por_cobrar','pagada_parcial')
    order by created_at desc
    limit 1;
  end if;

  if v_cuenta_id is null then
    insert into public.cuentas (mesa_id, abierta_por, estado, dia_negocio)
    values (p_mesa_id, v_perfil_id, 'abierta', public.dia_negocio(now()))
    returning id into v_cuenta_id;

    insert into public.sub_cuentas (cuenta_id, etiqueta)
    values (v_cuenta_id, 'Cliente 1');
  end if;

  return v_cuenta_id;
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

  if p_estado = 'anulado' then
    raise exception 'use_anular_pedido_con_motivo' using errcode = '22023';
  end if;

  if p_estado not in ('enviado','en_preparacion','entregado') then
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

  perform public.recalcular_total_cuenta(v_pedido.cuenta_id);

  insert into public.modificaciones_pedido (pedido_id, accion, detalle_antes, detalle_despues, motivo_id, usuario_id)
  values (p_pedido_id, 'anular', coalesce(v_detalle, '{}'::jsonb), jsonb_build_object('observacion', p_observacion, 'estado', 'anulado'), p_motivo_id, public.perfil_actual_id());

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'anular_pedido', 'pedidos', p_pedido_id, jsonb_build_object('motivo_id', p_motivo_id, 'observacion', p_observacion));

  return v_pedido;
end;
$$;

create or replace function public.registrar_pagos_cuenta(
  p_cuenta_id uuid,
  p_pagos jsonb,
  p_propina numeric default 0,
  p_dejar_pendiente boolean default false,
  p_responsable_pendiente text default null
)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_medio public.medio_pago;
  v_monto numeric(12,0);
  v_total numeric(12,0);
  v_pagado numeric(12,0);
  v_cuenta public.cuentas;
  v_propina_restante numeric(12,0) := greatest(coalesce(p_propina, 0), 0);
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_pagos' using errcode = '42501';
  end if;

  if jsonb_typeof(p_pagos) <> 'array' then
    raise exception 'pagos_invalidos' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_pagos)
  loop
    v_medio := (v_item ->> 'medio')::public.medio_pago;
    v_monto := coalesce((v_item ->> 'monto')::numeric, 0);

    if v_monto <= 0 then
      continue;
    end if;

    insert into public.pagos (cuenta_id, medio, monto, propina, es_abono_pendiente, usuario_id)
    values (p_cuenta_id, v_medio, v_monto, v_propina_restante, false, public.perfil_actual_id());

    v_propina_restante := 0;
  end loop;

  select total_cuenta into v_total from public.cuentas where id = p_cuenta_id;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos where cuenta_id = p_cuenta_id;

  update public.cuentas
  set estado = case
      when p_dejar_pendiente then 'pendiente'
      when v_pagado >= v_total then 'pagada'
      when v_pagado > 0 then 'pagada_parcial'
      else estado
    end,
    responsable_pendiente = case when p_dejar_pendiente then nullif(trim(coalesce(p_responsable_pendiente, '')), '') else responsable_pendiente end
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_pagos_cuenta', 'cuentas', p_cuenta_id, jsonb_build_object('pagado', v_pagado, 'total', v_total, 'pendiente', p_dejar_pendiente));

  return v_cuenta;
end;
$$;

-- Compatibilidad: la RPC antigua delega en pagos mixtos.
create or replace function public.registrar_pago_cuenta(p_cuenta_id uuid, p_medio public.medio_pago, p_monto numeric, p_propina numeric default 0)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago public.pagos;
begin
  perform public.registrar_pagos_cuenta(
    p_cuenta_id,
    jsonb_build_array(jsonb_build_object('medio', p_medio, 'monto', p_monto)),
    p_propina,
    false,
    null
  );

  select * into v_pago
  from public.pagos
  where cuenta_id = p_cuenta_id
  order by timestamp desc
  limit 1;

  return v_pago;
end;
$$;

alter table public.sub_cuentas enable row level security;
alter table public.modificaciones_pedido enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sub_cuentas' and policyname = 'sub_cuentas_lectura_por_rol') then
    create policy sub_cuentas_lectura_por_rol on public.sub_cuentas for select to authenticated using (
      exists (select 1 from public.cuentas c where c.id = cuenta_id and (public.es_caja_o_admin() or c.abierta_por = public.perfil_actual_id()))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'modificaciones_pedido' and policyname = 'modificaciones_pedido_admin_caja_lee') then
    create policy modificaciones_pedido_admin_caja_lee on public.modificaciones_pedido for select to authenticated using (public.es_caja_o_admin());
  end if;
end $$;

grant select on public.sub_cuentas, public.modificaciones_pedido to authenticated;
grant execute on function public.obtener_o_crear_cuenta(uuid) to authenticated;
grant execute on function public.anular_pedido(uuid, uuid, text) to authenticated;
grant execute on function public.registrar_pagos_cuenta(uuid, jsonb, numeric, boolean, text) to authenticated;

-- Realtime para el MVP operativo. Ignora duplicados si ya estan publicados.
do $$
begin
  alter table public.cuentas replica identity full;
  alter table public.pedidos replica identity full;
  alter table public.pedido_items replica identity full;
  alter table public.pagos replica identity full;

  begin
    alter publication supabase_realtime add table public.cuentas;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.pedidos;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.pedido_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.pagos;
  exception when duplicate_object then null;
  end;
exception when undefined_object then
  null;
end $$;

