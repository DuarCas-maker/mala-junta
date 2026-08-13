-- 035_f27_aprobar_capturas_compra_ocr.sql
-- Sprint 4: aprobacion atomica de solicitudes OCR de compra e integracion con inventario.

create or replace function public.aprobar_captura_compra_admin(p_captura_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captura public.capturas_compra;
  v_linea public.captura_compra_lineas;
  v_producto public.productos;
  v_compra public.compras;
  v_compra_item public.compra_items;
  v_movimiento public.movimientos_inventario;
  v_perfil_id uuid;
  v_modo public.modo_compra_item;
  v_cantidad int;
  v_factor int;
  v_unidades int;
  v_costo numeric(12,0);
  v_precio numeric(12,0);
  v_subtotal numeric(12,0);
  v_total numeric(12,0) := 0;
  v_items int := 0;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_aprueba_compras_ocr' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();

  select *
  into v_captura
  from public.capturas_compra
  where id = p_captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_compra_no_encontrada' using errcode = '02000';
  end if;

  if v_captura.compra_id is not null
    or v_captura.estado = 'confirmada'::public.estado_captura_compra
    or v_captura.confirmado_at is not null then
    raise exception 'captura_compra_ya_confirmada' using errcode = '23505';
  end if;

  if v_captura.estado = any (array['eliminada','rechazada','error']::public.estado_captura_compra[]) then
    raise exception 'captura_compra_no_aprobable' using errcode = '22023';
  end if;

  if v_captura.proveedor_id is null or not exists (
    select 1 from public.proveedores where id = v_captura.proveedor_id and activo = true
  ) then
    raise exception 'proveedor_obligatorio_invalido' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.captura_compra_lineas
    where captura_id = v_captura.id
      and estado <> 'eliminada'
  ) then
    raise exception 'captura_compra_sin_items' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.captura_compra_lineas l
    left join public.productos p on p.id = l.producto_id and p.activo = true
    where l.captura_id = v_captura.id
      and l.estado <> 'eliminada'
      and (
        l.producto_id is null
        or p.id is null
        or l.requiere_revision
        or not l.precio_catalogo_confirmado
        or l.cantidad_ingresada <= 0
        or l.factor_aplicado <= 0
        or l.unidades_resultantes <= 0
        or coalesce(p.costo_unitario_actual, 0) <= 0
        or coalesce(p.precio_venta, 0) <= 0
      )
  ) then
    raise exception 'captura_compra_con_lineas_pendientes' using errcode = '22023';
  end if;

  insert into public.compras (proveedor_id, fecha, usuario_id, observacion)
  values (
    v_captura.proveedor_id,
    v_captura.fecha_ingreso,
    v_perfil_id,
    nullif(trim(concat_ws(' ', v_captura.observacion, '(OCR compra ' || v_captura.id || ')')), '')
  )
  returning * into v_compra;

  for v_linea in
    select *
    from public.captura_compra_lineas
    where captura_id = v_captura.id
      and estado <> 'eliminada'
    order by orden, created_at
    for update
  loop
    select *
    into v_producto
    from public.productos
    where id = v_linea.producto_id
      and activo = true;

    if v_producto.id is null then
      raise exception 'producto_compra_invalido' using errcode = '22023';
    end if;

    v_modo := coalesce(v_linea.modo, 'unidades'::public.modo_compra_item);
    v_cantidad := coalesce(v_linea.cantidad_ingresada, 0);
    v_factor := case
      when v_modo = 'presentacion'::public.modo_compra_item then coalesce(nullif(v_producto.factor_compra, 0), 1)
      else 1
    end;
    v_unidades := v_cantidad * v_factor;
    v_costo := coalesce(v_producto.costo_unitario_actual, 0);
    v_precio := coalesce(v_producto.precio_venta, 0);
    v_subtotal := v_unidades * v_costo;

    if v_cantidad <= 0 or v_factor <= 0 or v_unidades <= 0 or v_costo <= 0 or v_precio <= 0 then
      raise exception 'item_compra_invalido' using errcode = '22023';
    end if;

    insert into public.compra_items (
      compra_id, producto_id, modo, cantidad_ingresada, factor_aplicado,
      unidades_resultantes, costo_unitario, subtotal
    )
    values (
      v_compra.id, v_producto.id, v_modo, v_cantidad, v_factor,
      v_unidades, v_costo, v_subtotal
    )
    returning * into v_compra_item;

    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id
    )
    values (
      v_producto.id, 'compra', v_unidades, 'compra_item', v_compra_item.id, v_perfil_id
    )
    returning * into v_movimiento;

    update public.captura_compra_lineas
    set
      compra_item_id = v_compra_item.id,
      factor_aplicado = v_factor,
      unidades_resultantes = v_unidades,
      costo_unitario_catalogo = v_costo,
      precio_venta_catalogo = v_precio,
      subtotal_costo = v_subtotal,
      stock_actual_snapshot = v_movimiento.stock_resultante - v_unidades,
      stock_proyectado = v_movimiento.stock_resultante,
      requiere_revision = false,
      precio_catalogo_confirmado = true,
      estado = 'confirmada',
      observacion = null
    where id = v_linea.id;

    v_total := v_total + v_subtotal;
    v_items := v_items + 1;
  end loop;

  update public.compras
  set total = v_total
  where id = v_compra.id
  returning * into v_compra;

  update public.capturas_compra
  set
    estado = 'confirmada',
    compra_id = v_compra.id,
    aprobado_at = coalesce(aprobado_at, now()),
    aprobado_por = coalesce(aprobado_por, v_perfil_id),
    confirmado_at = now(),
    confirmado_por = v_perfil_id,
    error_procesamiento = null
  where id = v_captura.id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_perfil_id,
    'aprobar_captura_compra_ocr',
    'capturas_compra',
    v_captura.id,
    jsonb_build_object(
      'compra_id', v_compra.id,
      'proveedor_id', v_captura.proveedor_id,
      'fecha_ingreso', v_captura.fecha_ingreso,
      'items_confirmados', v_items,
      'total', v_total
    )
  );

  return jsonb_build_object(
    'captura_id', v_captura.id,
    'compra_id', v_compra.id,
    'items_confirmados', v_items,
    'total', v_total
  );
end;
$$;

grant execute on function public.aprobar_captura_compra_admin(uuid) to authenticated;
