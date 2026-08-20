-- F36: pedidos idempotentes en UI, anulacion por item y liberacion de mesas vacias.

create or replace function public.cerrar_cuenta_si_vacia(p_cuenta_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.cuentas;
  v_total numeric(12,0);
  v_tiene_items boolean;
  v_tiene_pagos boolean;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_libera_mesas' using errcode = '42501';
  end if;

  select * into v_cuenta
  from public.cuentas
  where id = p_cuenta_id
  for update;

  if v_cuenta.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  if v_cuenta.estado in ('pagada','cerrada','anulada') then
    return false;
  end if;

  v_total := public.recalcular_total_cuenta(p_cuenta_id);

  select exists (
    select 1
    from public.pedidos p
    join public.pedido_items pi on pi.pedido_id = p.id
    where p.cuenta_id = p_cuenta_id
      and p.estado <> 'anulado'
      and pi.estado <> 'anulado'
      and pi.cantidad > 0
  ) into v_tiene_items;

  select exists (
    select 1
    from public.pagos pg
    where pg.cuenta_id = p_cuenta_id
      and not coalesce(pg.anulado, false)
      and pg.monto > 0
  ) into v_tiene_pagos;

  if v_tiene_items or v_tiene_pagos or coalesce(v_total, 0) > 0 then
    return false;
  end if;

  update public.pedidos
  set estado = 'anulado',
      updated_at = now()
  where cuenta_id = p_cuenta_id
    and estado <> 'anulado'
    and not exists (
      select 1
      from public.pedido_items pi
      where pi.pedido_id = pedidos.id
        and pi.estado <> 'anulado'
        and pi.cantidad > 0
    );

  update public.cuentas
  set estado = 'cerrada',
      nickname = null,
      responsable_pendiente = null,
      updated_at = now()
  where id = p_cuenta_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'cerrar_cuenta_si_vacia',
    'cuentas',
    p_cuenta_id,
    jsonb_build_object('mesa_id', v_cuenta.mesa_id, 'total', v_total)
  );

  return true;
end;
$$;

create or replace function public.anular_pedido_item_caja(
  p_pedido_item_id uuid,
  p_motivo_id uuid,
  p_observacion text default null
)
returns public.pedido_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.pedido_items;
  v_item_actualizado public.pedido_items;
  v_pedido public.pedidos;
  v_cuenta public.cuentas;
  v_detalle jsonb;
  v_mov record;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_anula_items' using errcode = '42501';
  end if;

  if not exists (select 1 from public.motivos where id = p_motivo_id and tipo = 'anulacion' and activo = true) then
    raise exception 'motivo_anulacion_invalido' using errcode = '22023';
  end if;

  select * into v_item
  from public.pedido_items
  where id = p_pedido_item_id
  for update;

  if v_item.id is null then
    raise exception 'pedido_item_no_encontrado' using errcode = '02000';
  end if;

  if v_item.estado = 'anulado' then
    raise exception 'pedido_item_ya_anulado' using errcode = '22023';
  end if;

  select * into v_pedido
  from public.pedidos
  where id = v_item.pedido_id
  for update;

  if v_pedido.id is null or v_pedido.estado = 'anulado' then
    raise exception 'pedido_no_editable' using errcode = '22023';
  end if;

  select * into v_cuenta
  from public.cuentas
  where id = v_pedido.cuenta_id
  for update;

  if v_cuenta.id is null or v_cuenta.estado in ('pagada','cerrada','anulada') then
    raise exception 'cuenta_no_editable' using errcode = '22023';
  end if;

  v_detalle := to_jsonb(v_item);

  for v_mov in
    select mi.producto_id, greatest(-sum(mi.cantidad), 0)::int as cantidad_devolver
    from public.movimientos_inventario mi
    where mi.referencia_id = v_item.id
      and mi.referencia_tipo in ('pedido_item','pedido_item_anulado')
      and mi.tipo in ('venta','devolucion')
    group by mi.producto_id
  loop
    if v_mov.cantidad_devolver > 0 then
      insert into public.movimientos_inventario (
        producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo_id, usuario_id
      )
      values (
        v_mov.producto_id,
        'devolucion',
        v_mov.cantidad_devolver,
        'pedido_item_anulado',
        v_item.id,
        p_motivo_id,
        public.perfil_actual_id()
      );
    end if;
  end loop;

  update public.pedido_items
  set estado = 'anulado',
      motivo_anulacion_id = p_motivo_id,
      updated_at = now()
  where id = v_item.id
  returning * into v_item_actualizado;

  if not exists (
    select 1
    from public.pedido_items pi
    where pi.pedido_id = v_item.pedido_id
      and pi.estado <> 'anulado'
      and pi.cantidad > 0
  ) then
    update public.pedidos
    set estado = 'anulado',
        motivo_anulacion_id = p_motivo_id,
        anulado_por = public.perfil_actual_id(),
        anulado_at = now(),
        updated_at = now()
    where id = v_item.pedido_id;
  end if;

  perform public.recalcular_total_cuenta(v_pedido.cuenta_id);
  perform public.cerrar_cuenta_si_vacia(v_pedido.cuenta_id);

  insert into public.modificaciones_pedido (pedido_item_id, pedido_id, accion, detalle_antes, detalle_despues, motivo_id, usuario_id)
  values (
    v_item.id,
    v_item.pedido_id,
    'anular',
    coalesce(v_detalle, '{}'::jsonb),
    jsonb_build_object('observacion', p_observacion, 'estado', 'anulado'),
    p_motivo_id,
    public.perfil_actual_id()
  );

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'anular_pedido_item_caja',
    'pedido_items',
    v_item.id,
    jsonb_build_object('pedido_id', v_item.pedido_id, 'cuenta_id', v_pedido.cuenta_id, 'motivo_id', p_motivo_id, 'observacion', p_observacion)
  );

  return v_item_actualizado;
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

  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'pedido_no_encontrado' using errcode = '02000';
  end if;

  if v_pedido.estado = 'anulado' then
    return v_pedido;
  end if;

  v_detalle := to_jsonb(v_pedido);

  perform public.revertir_inventario_pedido(p_pedido_id, p_motivo_id);

  update public.pedidos
  set estado = 'anulado',
      motivo_anulacion_id = p_motivo_id,
      anulado_por = public.perfil_actual_id(),
      anulado_at = now(),
      updated_at = now()
  where id = p_pedido_id
  returning * into v_pedido;

  update public.pedido_items
  set estado = 'anulado',
      motivo_anulacion_id = p_motivo_id,
      updated_at = now()
  where pedido_id = p_pedido_id
    and estado <> 'anulado';

  perform public.recalcular_total_cuenta(v_pedido.cuenta_id);
  perform public.cerrar_cuenta_si_vacia(v_pedido.cuenta_id);

  insert into public.modificaciones_pedido (pedido_id, accion, detalle_antes, detalle_despues, motivo_id, usuario_id)
  values (
    p_pedido_id,
    'anular',
    coalesce(v_detalle, '{}'::jsonb),
    jsonb_build_object('observacion', p_observacion, 'estado', 'anulado'),
    p_motivo_id,
    public.perfil_actual_id()
  );

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'anular_pedido',
    'pedidos',
    p_pedido_id,
    jsonb_build_object('motivo_id', p_motivo_id, 'observacion', p_observacion)
  );

  return v_pedido;
end;
$$;

create or replace function public.editar_pedido_item_caja(p_pedido_item_id uuid, p_cantidad int)
returns public.pedido_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.pedido_items;
  v_item_actualizado public.pedido_items;
  v_pedido public.pedidos;
  v_cuenta public.cuentas;
  v_delta int;
  v_componente record;
  v_unidades_ajuste int;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_edita_pedidos' using errcode = '42501';
  end if;

  if p_cantidad is null or p_cantidad < 0 or p_cantidad > 999 then
    raise exception 'cantidad_invalida' using errcode = '22023';
  end if;

  select * into v_item
  from public.pedido_items
  where id = p_pedido_item_id
  for update;

  if v_item.id is null then
    raise exception 'pedido_item_no_encontrado' using errcode = '02000';
  end if;

  if v_item.estado = 'anulado' then
    raise exception 'pedido_item_ya_anulado' using errcode = '22023';
  end if;

  select * into v_pedido
  from public.pedidos
  where id = v_item.pedido_id
  for update;

  if v_pedido.id is null or v_pedido.estado = 'anulado' then
    raise exception 'pedido_no_editable' using errcode = '22023';
  end if;

  select * into v_cuenta
  from public.cuentas
  where id = v_pedido.cuenta_id
  for update;

  if v_cuenta.id is null or v_cuenta.estado in ('pagada','cerrada','anulada') then
    raise exception 'cuenta_no_editable' using errcode = '22023';
  end if;

  v_delta := p_cantidad - v_item.cantidad;

  if v_delta <> 0 then
    if v_item.producto_id is not null then
      insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
      values (
        v_item.producto_id,
        case when v_delta > 0 then 'venta'::public.tipo_movimiento_inventario else 'devolucion'::public.tipo_movimiento_inventario end,
        case when v_delta > 0 then -abs(v_delta) else abs(v_delta) end,
        'pedido_item',
        v_item.id,
        public.perfil_actual_id()
      );
    elsif v_item.combo_id is not null then
      for v_componente in
        select producto_id, cantidad
        from public.combo_items
        where combo_id = v_item.combo_id
          and activo = true
      loop
        v_unidades_ajuste := v_componente.cantidad * abs(v_delta);

        if v_unidades_ajuste > 0 then
          insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
          values (
            v_componente.producto_id,
            case when v_delta > 0 then 'venta'::public.tipo_movimiento_inventario else 'devolucion'::public.tipo_movimiento_inventario end,
            case when v_delta > 0 then -v_unidades_ajuste else v_unidades_ajuste end,
            'pedido_item',
            v_item.id,
            public.perfil_actual_id()
          );
        end if;
      end loop;
    end if;
  end if;

  if p_cantidad = 0 then
    update public.pedido_items
    set estado = 'anulado',
        updated_at = now()
    where id = v_item.id
    returning * into v_item_actualizado;
  else
    update public.pedido_items
    set cantidad = p_cantidad,
        updated_at = now()
    where id = v_item.id
    returning * into v_item_actualizado;
  end if;

  if not exists (
    select 1
    from public.pedido_items pi
    where pi.pedido_id = v_item.pedido_id
      and pi.estado <> 'anulado'
      and pi.cantidad > 0
  ) then
    update public.pedidos
    set estado = 'anulado',
        anulado_por = public.perfil_actual_id(),
        anulado_at = now(),
        updated_at = now()
    where id = v_item.pedido_id;
  end if;

  perform public.recalcular_total_cuenta(v_pedido.cuenta_id);
  perform public.marcar_cuenta_por_cobrar_si_lista(v_pedido.cuenta_id);
  perform public.cerrar_cuenta_si_vacia(v_pedido.cuenta_id);

  insert into public.modificaciones_pedido (pedido_item_id, pedido_id, accion, detalle_antes, detalle_despues, motivo_id, usuario_id)
  values (
    v_item.id,
    v_item.pedido_id,
    'modificar',
    to_jsonb(v_item),
    to_jsonb(v_item_actualizado),
    null,
    public.perfil_actual_id()
  );

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'editar_pedido_item_caja',
    'pedido_items',
    v_item.id,
    jsonb_build_object('pedido_id', v_item.pedido_id, 'cuenta_id', v_pedido.cuenta_id, 'cantidad_anterior', v_item.cantidad, 'cantidad_nueva', p_cantidad)
  );

  return v_item_actualizado;
end;
$$;

update public.pedidos p
set estado = 'anulado',
    updated_at = now()
where p.estado <> 'anulado'
  and not exists (
    select 1
    from public.pedido_items pi
    where pi.pedido_id = p.id
      and pi.estado <> 'anulado'
      and pi.cantidad > 0
  );

update public.cuentas c
set estado = 'cerrada',
    nickname = null,
    responsable_pendiente = null,
    updated_at = now()
where c.estado in ('abierta','por_cobrar','pagada_parcial')
  and coalesce(c.total_cuenta, 0) = 0
  and not exists (
    select 1
    from public.pagos pg
    where pg.cuenta_id = c.id
      and not coalesce(pg.anulado, false)
      and pg.monto > 0
  )
  and not exists (
    select 1
    from public.pedidos p
    join public.pedido_items pi on pi.pedido_id = p.id
    where p.cuenta_id = c.id
      and p.estado <> 'anulado'
      and pi.estado <> 'anulado'
      and pi.cantidad > 0
  );

grant execute on function public.cerrar_cuenta_si_vacia(uuid) to authenticated;
grant execute on function public.anular_pedido_item_caja(uuid, uuid, text) to authenticated;
grant execute on function public.anular_pedido(uuid, uuid, text) to authenticated;
grant execute on function public.editar_pedido_item_caja(uuid, int) to authenticated;
