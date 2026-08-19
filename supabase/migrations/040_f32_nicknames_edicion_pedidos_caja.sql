-- F32: nicknames de cuenta y edicion de cantidades desde caja.

alter table public.cuentas
  add column if not exists nickname text;

alter table public.modificaciones_pedido
  alter column motivo_id drop not null;

drop function if exists public.crear_pedido_rapido(uuid, jsonb, text);

create or replace function public.crear_pedido_rapido(
  p_mesa_id uuid,
  p_items jsonb,
  p_notas text default null,
  p_nickname text default null
)
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
  set estado = case when estado in ('pagada_parcial','por_cobrar') then 'abierta' else estado end,
      nickname = coalesce(nullif(trim(coalesce(nickname, '')), ''), nullif(trim(coalesce(p_nickname, '')), '')),
      updated_at = now()
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
    select mi.producto_id, mi.referencia_id as pedido_item_id, greatest(-sum(mi.cantidad), 0)::int as cantidad_devolver
    from public.movimientos_inventario mi
    join public.pedido_items pi on pi.id = mi.referencia_id
    where pi.pedido_id = p_pedido_id
      and mi.tipo in ('venta','devolucion')
      and mi.referencia_tipo in ('pedido_item','pedido_item_anulado')
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
  v_mov record;
  v_movimientos int := 0;
  v_unidades_ajuste int;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_edita_pedidos' using errcode = '42501';
  end if;

  if p_cantidad is null or p_cantidad < 0 or p_cantidad > 200 then
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
    for v_mov in
      select mi.producto_id, greatest((-sum(mi.cantidad)::numeric / nullif(v_item.cantidad, 0))::int, 0) as unidades_por_item
      from public.movimientos_inventario mi
      where mi.referencia_id = v_item.id
        and mi.referencia_tipo in ('pedido_item','pedido_item_anulado')
        and mi.tipo in ('venta','devolucion')
      group by mi.producto_id
    loop
      v_movimientos := v_movimientos + 1;
      v_unidades_ajuste := v_mov.unidades_por_item * abs(v_delta);
      if v_unidades_ajuste > 0 then
        insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
        values (
          v_mov.producto_id,
          case when v_delta > 0 then 'venta'::public.tipo_movimiento_inventario else 'devolucion'::public.tipo_movimiento_inventario end,
          case when v_delta > 0 then -v_unidades_ajuste else v_unidades_ajuste end,
          'pedido_item',
          v_item.id,
          public.perfil_actual_id()
        );
      end if;
    end loop;

    if v_movimientos = 0 then
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
        for v_mov in
          select producto_id, cantidad
          from public.combo_items
          where combo_id = v_item.combo_id
            and activo = true
        loop
          v_unidades_ajuste := v_mov.cantidad * abs(v_delta);
          if v_unidades_ajuste > 0 then
            insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
            values (
              v_mov.producto_id,
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
    jsonb_build_object('cantidad', p_cantidad, 'estado', v_item_actualizado.estado),
    null,
    public.perfil_actual_id()
  );

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'editar_pedido_item_caja',
    'pedido_items',
    v_item.id,
    jsonb_build_object('pedido_id', v_item.pedido_id, 'cantidad_anterior', v_item.cantidad, 'cantidad_nueva', p_cantidad)
  );

  return v_item_actualizado;
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
  where pedido_id = p_pedido_id
    and estado <> 'anulado';

  perform public.recalcular_total_cuenta(v_pedido.cuenta_id);
  perform public.marcar_cuenta_por_cobrar_si_lista(v_pedido.cuenta_id);

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'cambiar_estado_pedido',
    'pedidos',
    p_pedido_id,
    jsonb_build_object('estado', p_estado, 'cuenta_id', v_pedido.cuenta_id)
  );

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
    select jsonb_agg(
      cuenta_json
      order by prioridad_cobro asc, pedido_estado_prioridad asc, coalesce(ultimo_pedido_at, created_at) desc, created_at desc
    )
    from (
      select
        c.created_at,
        stats.ultimo_pedido_at,
        stats.pedido_estado_prioridad,
        case
          when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 1
          when stats.tiene_en_preparacion then 2
          when stats.tiene_enviado then 3
          when c.estado = 'pagada_parcial' then 4
          when c.estado = 'pendiente' then 5
          when c.estado = 'abierta' then 6
          else 9
        end as prioridad_cobro,
        jsonb_build_object(
          'id', c.id,
          'estado', c.estado,
          'estado_cobro', case
            when c.estado = 'pendiente' then 'Pendiente'
            when c.estado = 'pagada_parcial' then 'Pago parcial'
            when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 'Por cobrar'
            when stats.tiene_en_preparacion then 'En preparacion'
            when stats.tiene_enviado then 'Enviado'
            else 'Abierta'
          end,
          'prioridad_cobro', case
            when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 1
            when stats.tiene_en_preparacion then 2
            when stats.tiene_enviado then 3
            when c.estado = 'pagada_parcial' then 4
            when c.estado = 'pendiente' then 5
            when c.estado = 'abierta' then 6
            else 9
          end,
          'pedido_estado_prioridad', stats.pedido_estado_prioridad,
          'ultimo_pedido_at', stats.ultimo_pedido_at,
          'total_cuenta', c.total_cuenta,
          'total_pagado', stats.total_pagado,
          'saldo', greatest(coalesce(c.total_cuenta, 0) - stats.total_pagado, 0),
          'responsable_pendiente', c.responsable_pendiente,
          'nickname', c.nickname,
          'created_at', c.created_at,
          'mesas', case when m.id is null then null else jsonb_build_object('nombre', m.nombre, 'zona', m.zona) end,
          'perfiles', jsonb_build_object('nombre', coalesce(pa.nombre, '-')),
          'documentos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', d.id,
              'tipo', d.tipo,
              'numero', d.numero,
              'total', d.total,
              'estado_dian', d.estado_dian,
              'etiqueta_no_fiscal', d.etiqueta_no_fiscal
            ) order by d.generated_at desc)
            from public.documentos d
            where d.cuenta_id = c.id
          ), '[]'::jsonb),
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
              and not coalesce(pg.anulado, false)
          ), '[]'::jsonb),
          'pedidos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', p.id,
              'estado', p.estado,
              'enviado_at', p.enviado_at,
              'notas', p.notas,
              'perfiles', jsonb_build_object('nombre', coalesce(pm.nombre, '-')),
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
                  and pi.estado <> 'anulado'
              ), '[]'::jsonb)
            ) order by p.enviado_at)
            from public.pedidos p
            left join public.perfiles pm on pm.id = p.mesero_id
            where p.cuenta_id = c.id
              and p.estado <> 'anulado'
          ), '[]'::jsonb)
        ) as cuenta_json
      from public.cuentas c
      left join public.mesas m on m.id = c.mesa_id
      left join public.perfiles pa on pa.id = c.abierta_por
      cross join lateral (
        select
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado <> 'anulado') as tiene_pedidos,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado = 'enviado') as tiene_enviado,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado = 'en_preparacion') as tiene_en_preparacion,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado not in ('entregado', 'anulado')) as tiene_pedidos_no_entregados,
          coalesce((
            select min(case p.estado when 'entregado' then 1 when 'en_preparacion' then 2 when 'enviado' then 3 else 9 end)
            from public.pedidos p
            where p.cuenta_id = c.id and p.estado <> 'anulado'
          ), 9) as pedido_estado_prioridad,
          (select max(p.enviado_at) from public.pedidos p where p.cuenta_id = c.id and p.estado <> 'anulado') as ultimo_pedido_at,
          coalesce((
            select sum(pg.monto)
            from public.pagos pg
            where pg.cuenta_id = c.id
              and not coalesce(pg.anulado, false)
          ), 0)::numeric(12,0) as total_pagado
      ) stats
      where c.estado not in ('pagada', 'cerrada', 'anulada')
        and (
          c.estado in ('abierta', 'por_cobrar', 'pagada_parcial', 'pendiente')
          or stats.tiene_pedidos
          or coalesce(c.total_cuenta, 0) > stats.total_pagado
        )
    ) cuentas
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.crear_pedido_rapido(uuid, jsonb, text, text) to authenticated;
grant execute on function public.revertir_inventario_pedido(uuid, uuid) to authenticated;
grant execute on function public.editar_pedido_item_caja(uuid, int) to authenticated;
grant execute on function public.cambiar_estado_pedido(uuid, public.estado_pedido) to authenticated;
grant execute on function public.cuentas_activas_caja() to authenticated;
