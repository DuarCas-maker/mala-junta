-- 029_f21_compra_costo_catalogo.sql
-- Sprint 4: compras usan costo configurado en catalogo y bloquean productos sin costo.

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

  if p_proveedor_id is null or not exists (select 1 from public.proveedores where id = p_proveedor_id and activo = true) then
    raise exception 'proveedor_obligatorio_invalido' using errcode = '22023';
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
    v_factor := case when v_modo = 'presentacion' then v_producto.factor_compra else 1 end;
    v_unidades := v_cantidad * v_factor;
    v_costo := coalesce(v_producto.costo_unitario_actual, 0);

    if v_costo <= 0 then
      raise exception 'producto_sin_costo_configurado' using errcode = '22023';
    end if;

    if v_cantidad <= 0 or v_factor <= 0 or v_unidades <= 0 then
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

    v_total := v_total + (v_unidades * v_costo);
  end loop;

  update public.compras
  set total = v_total
  where id = v_compra.id
  returning * into v_compra;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'registrar_compra',
    'compras',
    v_compra.id,
    jsonb_build_object('total', v_total, 'proveedor_id', p_proveedor_id, 'costo_origen', 'catalogo')
  );

  return v_compra;
end;
$$;

grant execute on function public.registrar_compra(uuid, jsonb, date, text) to authenticated;