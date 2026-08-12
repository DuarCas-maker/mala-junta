-- 031_f23_flujo_admin_aprobacion_capturas.sql
-- Sprint 2: base de datos para flujo caja -> aprobacion admin -> descuento real.

alter type public.estado_captura_venta add value if not exists 'pendiente_aprobacion';
alter type public.estado_captura_venta add value if not exists 'aprobada_parcial';
alter type public.estado_captura_venta add value if not exists 'eliminada';

alter table public.capturas_venta add column if not exists fecha_venta date not null default public.dia_negocio(now());
alter table public.capturas_venta add column if not exists enviado_aprobacion_at timestamptz;
alter table public.capturas_venta add column if not exists enviado_aprobacion_por uuid references public.perfiles(id) on delete restrict;
alter table public.capturas_venta add column if not exists aprobado_at timestamptz;
alter table public.capturas_venta add column if not exists aprobado_por uuid references public.perfiles(id) on delete restrict;
alter table public.capturas_venta add column if not exists eliminado_at timestamptz;
alter table public.capturas_venta add column if not exists eliminado_por uuid references public.perfiles(id) on delete restrict;
alter table public.capturas_venta add column if not exists eliminacion_observacion text;

alter table public.captura_venta_grupos add column if not exists estado text not null default 'borrador';
alter table public.captura_venta_grupos add column if not exists enviado_aprobacion_at timestamptz;
alter table public.captura_venta_grupos add column if not exists aprobado_por uuid references public.perfiles(id) on delete restrict;
alter table public.captura_venta_grupos add column if not exists eliminado_at timestamptz;
alter table public.captura_venta_grupos add column if not exists eliminado_por uuid references public.perfiles(id) on delete restrict;
alter table public.captura_venta_grupos add column if not exists eliminacion_observacion text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'captura_venta_grupos_estado_valido') then
    alter table public.captura_venta_grupos add constraint captura_venta_grupos_estado_valido check (
      estado in ('borrador','requiere_revision','pendiente_aprobacion','aprobada','confirmada','eliminada')
    );
  end if;
end $$;

alter table public.captura_venta_lineas add column if not exists precio_unitario_aprobado numeric(12,0);
alter table public.captura_venta_lineas add column if not exists costo_unitario_historico numeric(12,0);
alter table public.captura_venta_lineas add column if not exists origen_precio text;

alter table public.pedido_items add column if not exists costo_unitario_historico numeric(12,0) not null default 0 check (costo_unitario_historico >= 0);
alter table public.pedido_items add column if not exists precio_catalogo_historico numeric(12,0) not null default 0 check (precio_catalogo_historico >= 0);
alter table public.pedido_items add column if not exists origen_precio text not null default 'catalogo';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedido_items_origen_precio_valido') then
    alter table public.pedido_items add constraint pedido_items_origen_precio_valido check (
      origen_precio in ('catalogo','captura','manual','ajuste_admin')
    );
  end if;
end $$;

create index if not exists capturas_venta_estado_fecha_idx on public.capturas_venta(estado, fecha_venta desc, created_at desc);
create index if not exists captura_venta_grupos_estado_idx on public.captura_venta_grupos(captura_id, estado, orden);

update public.capturas_venta
set fecha_venta = dia_negocio
where fecha_venta is null;

update public.captura_venta_grupos
set estado = case
    when eliminado_at is not null then 'eliminada'
    when pedido_id is not null then 'confirmada'
    when coalesce(aprobado, false) then 'aprobada'
    when requiere_revision then 'requiere_revision'
    else 'borrador'
  end
where estado = 'borrador';

update public.pedido_items pi
set precio_catalogo_historico = case
      when pi.producto_id is not null then coalesce((select p.precio_venta from public.productos p where p.id = pi.producto_id), pi.precio_unitario_capturado, 0)
      when pi.combo_id is not null then coalesce((select c.precio_venta from public.combos c where c.id = pi.combo_id), pi.precio_unitario_capturado, 0)
      else coalesce(pi.precio_unitario_capturado, 0)
    end,
    costo_unitario_historico = case
      when pi.producto_id is not null then coalesce((select p.costo_unitario_actual from public.productos p where p.id = pi.producto_id), 0)
      when pi.combo_id is not null then coalesce((
        select sum(ci.cantidad * pr.costo_unitario_actual)::numeric(12,0)
        from public.combo_items ci
        join public.productos pr on pr.id = ci.producto_id
        where ci.combo_id = pi.combo_id
          and ci.activo = true
      ), 0)
      else 0
    end
where pi.costo_unitario_historico = 0
   or pi.precio_catalogo_historico = 0;

create or replace function public.enviar_captura_aprobacion(
  p_captura_id uuid,
  p_fecha_venta date
)
returns public.capturas_venta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
  v_captura public.capturas_venta;
  v_total int;
  v_pendientes int;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_envia_captura' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();
  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  if p_fecha_venta is null then
    raise exception 'fecha_venta_requerida' using errcode = '22023';
  end if;

  select * into v_captura
  from public.capturas_venta
  where id = p_captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_no_encontrada' using errcode = '02000';
  end if;

  if v_captura.estado in ('confirmada','eliminada','rechazada') then
    raise exception 'captura_no_editable' using errcode = '22023';
  end if;

  select count(*),
         count(*) filter (where pedido_id is null and (requiere_revision or not coalesce(aprobado, false)))
    into v_total, v_pendientes
  from public.captura_venta_grupos
  where captura_id = p_captura_id
    and eliminado_at is null;

  if v_total = 0 then
    raise exception 'captura_sin_ventas' using errcode = '22023';
  end if;

  if v_pendientes > 0 then
    raise exception 'captura_tiene_ventas_pendientes_revision' using errcode = '22023';
  end if;

  update public.captura_venta_grupos
  set estado = 'pendiente_aprobacion',
      enviado_aprobacion_at = now()
  where captura_id = p_captura_id
    and pedido_id is null
    and eliminado_at is null;

  update public.capturas_venta
  set estado = 'pendiente_aprobacion',
      fecha_venta = p_fecha_venta,
      dia_negocio = p_fecha_venta,
      enviado_aprobacion_at = now(),
      enviado_aprobacion_por = v_perfil_id
  where id = p_captura_id
  returning * into v_captura;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_perfil_id,
    'enviar_captura_aprobacion',
    'capturas_venta',
    p_captura_id,
    jsonb_build_object('fecha_venta', p_fecha_venta)
  );

  return v_captura;
end;
$$;

create or replace function public.recalcular_estado_captura_venta(p_captura_id uuid)
returns public.capturas_venta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captura public.capturas_venta;
  v_total int;
  v_confirmadas int;
  v_pendientes int;
  v_enviada boolean;
begin
  select enviado_aprobacion_at is not null
    into v_enviada
  from public.capturas_venta
  where id = p_captura_id;

  select count(*),
         count(*) filter (where pedido_id is not null),
         count(*) filter (where requiere_revision or not coalesce(aprobado, false))
    into v_total, v_confirmadas, v_pendientes
  from public.captura_venta_grupos
  where captura_id = p_captura_id
    and eliminado_at is null;

  update public.capturas_venta
  set estado = case
      when v_total = 0 then 'rechazada'::public.estado_captura_venta
      when v_confirmadas = v_total then 'confirmada'::public.estado_captura_venta
      when v_confirmadas > 0 then 'aprobada_parcial'::public.estado_captura_venta
      when coalesce(v_enviada, false) then 'pendiente_aprobacion'::public.estado_captura_venta
      when v_pendientes > 0 then 'requiere_revision'::public.estado_captura_venta
      else 'procesada'::public.estado_captura_venta
    end,
    aprobado_at = case when v_total > 0 and v_confirmadas = v_total then coalesce(aprobado_at, now()) else aprobado_at end
  where id = p_captura_id
  returning * into v_captura;

  return v_captura;
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
  v_precio_unitario numeric(12,0);
  v_precio_catalogo numeric(12,0);
  v_costo_unitario numeric(12,0);
  v_origen_precio text;
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
    v_origen_precio := case
      when nullif(v_item ->> 'origen_precio', '') in ('captura','manual','ajuste_admin') then nullif(v_item ->> 'origen_precio', '')
      else 'catalogo'
    end;

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

      v_precio_catalogo := v_producto.precio_venta;
      v_precio_unitario := coalesce(nullif(v_item ->> 'precio_unitario_capturado', '')::numeric, v_producto.precio_venta);
      v_costo_unitario := coalesce(nullif(v_item ->> 'costo_unitario_historico', '')::numeric, v_producto.costo_unitario_actual, 0);

      insert into public.pedido_items (
        pedido_id, producto_id, cantidad, precio_unitario_capturado, notas, estado,
        costo_unitario_historico, precio_catalogo_historico, origen_precio
      )
      values (
        v_pedido_id, v_producto.id, v_cantidad, greatest(v_precio_unitario, 0), v_notas, 'enviado',
        greatest(v_costo_unitario, 0), greatest(v_precio_catalogo, 0), v_origen_precio
      )
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

      select coalesce(sum(ci.cantidad * p.costo_unitario_actual), 0)::numeric(12,0)
        into v_costo_unitario
      from public.combo_items ci
      join public.productos p on p.id = ci.producto_id
      where ci.combo_id = v_combo.id
        and ci.activo = true;

      v_precio_catalogo := v_combo.precio_venta;
      v_precio_unitario := coalesce(nullif(v_item ->> 'precio_unitario_capturado', '')::numeric, v_combo.precio_venta);
      v_costo_unitario := coalesce(nullif(v_item ->> 'costo_unitario_historico', '')::numeric, v_costo_unitario, 0);

      insert into public.pedido_items (
        pedido_id, combo_id, cantidad, precio_unitario_capturado, notas, estado,
        costo_unitario_historico, precio_catalogo_historico, origen_precio
      )
      values (
        v_pedido_id, v_combo.id, v_cantidad, greatest(v_precio_unitario, 0), v_notas, 'enviado',
        greatest(v_costo_unitario, 0), greatest(v_precio_catalogo, 0), v_origen_precio
      )
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

create or replace function public.confirmar_grupo_captura_venta(p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
  v_captura public.capturas_venta;
  v_grupo public.captura_venta_grupos;
  v_items jsonb;
  v_pagos jsonb;
  v_pedido_id uuid;
  v_cuenta_id uuid;
  v_lineas int;
  v_pagos_validos int;
  v_total_pagos numeric(12,0);
begin
  if not public.es_admin() then
    raise exception 'solo_admin_aprueba_captura' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();
  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  select * into v_grupo
  from public.captura_venta_grupos
  where id = p_grupo_id
  for update;

  if v_grupo.id is null then
    raise exception 'venta_captura_no_encontrada' using errcode = '02000';
  end if;

  select * into v_captura
  from public.capturas_venta
  where id = v_grupo.captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_no_encontrada' using errcode = '02000';
  end if;

  if v_grupo.pedido_id is not null then
    raise exception 'venta_de_captura_ya_confirmada' using errcode = '22023';
  end if;

  if v_grupo.eliminado_at is not null then
    raise exception 'venta_captura_eliminada' using errcode = '22023';
  end if;

  if v_grupo.requiere_revision then
    raise exception 'venta_requiere_revision' using errcode = '22023';
  end if;

  select count(*) into v_lineas
  from public.captura_venta_lineas l
  left join public.productos p on p.id = l.producto_id and p.activo = true
  left join public.combos c on c.id = l.combo_id and c.activo = true
  where l.grupo_id = v_grupo.id
    and l.requiere_revision = false
    and l.cantidad > 0
    and (
      (l.tipo_item = 'producto' and l.producto_id is not null and p.id is not null and l.combo_id is null)
      or (l.tipo_item = 'combo' and l.combo_id is not null and c.id is not null and l.producto_id is null)
    );

  if v_lineas = 0 then
    raise exception 'venta_sin_items_validos' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.captura_venta_lineas l
    left join public.productos p on p.id = l.producto_id and p.activo = true
    left join public.combos c on c.id = l.combo_id and c.activo = true
    where l.grupo_id = v_grupo.id
      and (
        l.requiere_revision
        or l.cantidad <= 0
        or not (
          (l.tipo_item = 'producto' and l.producto_id is not null and p.id is not null and l.combo_id is null)
          or (l.tipo_item = 'combo' and l.combo_id is not null and c.id is not null and l.producto_id is null)
        )
      )
  ) then
    raise exception 'venta_tiene_items_pendientes' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(monto), 0)
    into v_pagos_validos, v_total_pagos
  from public.captura_venta_pagos
  where grupo_id = v_grupo.id
    and requiere_revision = false
    and medio_normalizado is not null
    and monto > 0;

  if v_pagos_validos = 0 then
    raise exception 'venta_sin_pagos_validos' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.captura_venta_pagos
    where grupo_id = v_grupo.id
      and (requiere_revision or medio_normalizado is null or monto <= 0)
  ) then
    raise exception 'venta_tiene_pagos_pendientes' using errcode = '22023';
  end if;

  if v_total_pagos <> v_grupo.total_leido then
    raise exception 'pagos_no_coinciden_con_total_leido' using errcode = '22023';
  end if;

  update public.captura_venta_lineas l
  set precio_unitario_aprobado = case
        when l.cantidad > 0 and l.subtotal > 0 then round(l.subtotal / l.cantidad)
        when l.valor_unitario > 0 then l.valor_unitario
        else l.precio_catalogo
      end,
      costo_unitario_historico = case
        when l.producto_id is not null then coalesce((select p.costo_unitario_actual from public.productos p where p.id = l.producto_id), 0)
        else coalesce((
          select sum(ci.cantidad * pr.costo_unitario_actual)::numeric(12,0)
          from public.combo_items ci
          join public.productos pr on pr.id = ci.producto_id
          where ci.combo_id = l.combo_id
            and ci.activo = true
        ), 0)
      end,
      origen_precio = case
        when l.subtotal > 0 or l.valor_unitario > 0 then 'captura'
        else 'catalogo'
      end
  where l.grupo_id = v_grupo.id;

  select jsonb_agg(
    jsonb_build_object(
      'producto_id', l.producto_id,
      'combo_id', l.combo_id,
      'cantidad', l.cantidad,
      'precio_unitario_capturado', coalesce(l.precio_unitario_aprobado, l.precio_catalogo, 0),
      'costo_unitario_historico', coalesce(l.costo_unitario_historico, 0),
      'origen_precio', coalesce(l.origen_precio, 'catalogo'),
      'notas', concat_ws(' | ', 'Captura foto', nullif(l.texto_original, ''), nullif(l.item_nombre_detectado, ''))
    )
    order by l.orden
  )
    into v_items
  from public.captura_venta_lineas l
  where l.grupo_id = v_grupo.id;

  select jsonb_agg(
    jsonb_build_object(
      'medio', p.medio_normalizado,
      'monto', p.monto
    )
    order by p.orden
  )
    into v_pagos
  from public.captura_venta_pagos p
  where p.grupo_id = v_grupo.id;

  v_pedido_id := public.crear_pedido_rapido(
    null,
    v_items,
    concat('Captura ', v_grupo.captura_id::text, ' / venta ', v_grupo.orden::text)
  );

  select cuenta_id into v_cuenta_id
  from public.pedidos
  where id = v_pedido_id;

  update public.cuentas
  set dia_negocio = v_captura.fecha_venta
  where id = v_cuenta_id;

  perform public.registrar_pagos_cuenta(v_cuenta_id, v_pagos, 0, false, null);

  update public.captura_venta_grupos
  set cuenta_id = v_cuenta_id,
      pedido_id = v_pedido_id,
      aprobado = true,
      aprobado_at = coalesce(aprobado_at, now()),
      aprobado_por = coalesce(aprobado_por, v_perfil_id),
      confirmado_at = now(),
      confirmado_por = v_perfil_id,
      estado = 'confirmada'
  where id = v_grupo.id;

  perform public.recalcular_estado_captura_venta(v_grupo.captura_id);

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_perfil_id,
    'confirmar_grupo_captura_venta',
    'captura_venta_grupos',
    v_grupo.id,
    jsonb_build_object('captura_id', v_grupo.captura_id, 'pedido_id', v_pedido_id, 'cuenta_id', v_cuenta_id, 'fecha_venta', v_captura.fecha_venta)
  );

  return jsonb_build_object(
    'grupo_id', v_grupo.id,
    'orden', v_grupo.orden,
    'captura_id', v_grupo.captura_id,
    'cuenta_id', v_cuenta_id,
    'pedido_id', v_pedido_id,
    'total_leido', v_grupo.total_leido,
    'total_esperado', v_grupo.total_esperado,
    'diferencia', v_grupo.diferencia
  );
end;
$$;

create or replace function public.confirmar_captura_venta(p_captura_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
  v_captura public.capturas_venta;
  v_grupo record;
  v_confirmadas int := 0;
  v_resultados jsonb := '[]'::jsonb;
  v_resultado jsonb;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_confirma_captura' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();
  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  select * into v_captura
  from public.capturas_venta
  where id = p_captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_no_encontrada' using errcode = '02000';
  end if;

  if v_captura.estado = 'confirmada' then
    raise exception 'captura_ya_confirmada' using errcode = '22023';
  end if;

  if v_captura.estado not in ('pendiente_aprobacion','procesada','requiere_revision','aprobada_parcial') then
    raise exception 'captura_no_lista_para_confirmar' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.captura_venta_grupos
    where captura_id = p_captura_id
      and eliminado_at is null
  ) then
    raise exception 'captura_sin_ventas' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.captura_venta_grupos
    where captura_id = p_captura_id
      and eliminado_at is null
      and pedido_id is null
      and (requiere_revision or not coalesce(aprobado, false))
  ) then
    raise exception 'captura_tiene_ventas_no_aprobadas' using errcode = '22023';
  end if;

  for v_grupo in
    select id
    from public.captura_venta_grupos
    where captura_id = p_captura_id
      and eliminado_at is null
      and pedido_id is null
    order by orden
  loop
    v_resultado := public.confirmar_grupo_captura_venta(v_grupo.id);
    v_resultados := v_resultados || jsonb_build_array(v_resultado);
    v_confirmadas := v_confirmadas + 1;
  end loop;

  perform public.recalcular_estado_captura_venta(p_captura_id);

  update public.capturas_venta
  set aprobado_at = coalesce(aprobado_at, now()),
      aprobado_por = coalesce(aprobado_por, v_perfil_id),
      confirmado_at = case when estado = 'confirmada' then coalesce(confirmado_at, now()) else confirmado_at end,
      confirmado_por = case when estado = 'confirmada' then coalesce(confirmado_por, v_perfil_id) else confirmado_por end
  where id = p_captura_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_perfil_id,
    'confirmar_captura_venta',
    'capturas_venta',
    p_captura_id,
    jsonb_build_object('ventas_confirmadas', v_confirmadas, 'ventas', v_resultados)
  );

  return jsonb_build_object(
    'captura_id', p_captura_id,
    'ventas_confirmadas', v_confirmadas,
    'ventas', v_resultados
  );
end;
$$;

create or replace function public.aprobar_venta_captura_admin(p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_aprueba_captura' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();

  update public.captura_venta_grupos
  set aprobado = true,
      aprobado_at = now(),
      aprobado_por = v_perfil_id,
      requiere_revision = false,
      estado = 'aprobada'
  where id = p_grupo_id
    and pedido_id is null
    and eliminado_at is null;

  if not found then
    raise exception 'venta_captura_no_aprobable' using errcode = '22023';
  end if;

  return public.confirmar_grupo_captura_venta(p_grupo_id);
end;
$$;

create or replace function public.aprobar_captura_venta_admin(p_captura_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_aprueba_captura' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();

  update public.captura_venta_grupos
  set aprobado = true,
      aprobado_at = now(),
      aprobado_por = v_perfil_id,
      requiere_revision = false,
      estado = 'aprobada'
  where captura_id = p_captura_id
    and pedido_id is null
    and eliminado_at is null
    and not requiere_revision;

  return public.confirmar_captura_venta(p_captura_id);
end;
$$;

create or replace view public.v_admin_capturas_venta_aprobacion
with (security_invoker = true)
as
select
  c.id,
  c.estado,
  c.fecha_venta,
  c.dia_negocio,
  c.created_at,
  c.enviado_aprobacion_at,
  c.aprobado_at,
  c.confirmado_at,
  c.eliminado_at,
  c.storage_bucket,
  c.storage_path,
  c.nombre_archivo,
  c.modelo_ia,
  c.advertencias,
  subio.nombre as subido_por,
  envio.nombre as enviado_por,
  aprobo.nombre as aprobado_por,
  count(g.id)::int as ventas_total,
  count(g.id) filter (where g.pedido_id is not null)::int as ventas_confirmadas,
  count(g.id) filter (where g.pedido_id is null and g.eliminado_at is null and (g.requiere_revision or not coalesce(g.aprobado, false)))::int as ventas_pendientes,
  count(g.id) filter (where g.eliminado_at is not null or g.estado = 'eliminada')::int as ventas_eliminadas,
  coalesce(sum(g.total_leido) filter (where g.eliminado_at is null), 0)::numeric(12,0) as total_leido,
  coalesce(sum(g.total_esperado) filter (where g.eliminado_at is null), 0)::numeric(12,0) as total_esperado,
  coalesce(sum(g.diferencia) filter (where g.eliminado_at is null), 0)::numeric(12,0) as diferencia
from public.capturas_venta c
left join public.perfiles subio on subio.id = c.usuario_id
left join public.perfiles envio on envio.id = c.enviado_aprobacion_por
left join public.perfiles aprobo on aprobo.id = c.aprobado_por
left join public.captura_venta_grupos g on g.captura_id = c.id
where public.es_admin()
group by c.id, subio.nombre, envio.nombre, aprobo.nombre;

grant execute on function public.enviar_captura_aprobacion(uuid, date) to authenticated;
grant execute on function public.recalcular_estado_captura_venta(uuid) to authenticated;
grant execute on function public.confirmar_grupo_captura_venta(uuid) to authenticated;
grant execute on function public.confirmar_captura_venta(uuid) to authenticated;
grant execute on function public.aprobar_venta_captura_admin(uuid) to authenticated;
grant execute on function public.aprobar_captura_venta_admin(uuid) to authenticated;
grant select on public.v_admin_capturas_venta_aprobacion to authenticated;
