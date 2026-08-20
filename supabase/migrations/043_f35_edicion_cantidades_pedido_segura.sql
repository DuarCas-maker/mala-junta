-- F35: edicion de cantidades de pedido con ajuste directo por delta.

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

grant execute on function public.editar_pedido_item_caja(uuid, int) to authenticated;
