-- 020_f12_admin_edicion_inline_catalogo.sql
-- Edicion inline completa desde admin para productos y combos sin abrir formularios largos.

create or replace function public.guardar_producto_inline_admin(
  p_producto_id uuid,
  p_nombre text,
  p_precio_venta numeric,
  p_costo_unitario numeric,
  p_stock_actual int,
  p_stock_minimo int
)
returns public.productos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto public.productos;
  v_producto_actualizado public.productos;
  v_diferencia int;
  v_motivo_id uuid;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_actualiza_producto_inline' using errcode = '42501';
  end if;

  if p_producto_id is null then
    raise exception 'producto_requerido' using errcode = '22023';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_producto_invalido' using errcode = '22023';
  end if;

  if coalesce(p_precio_venta, -1) < 0 or coalesce(p_costo_unitario, -1) < 0 then
    raise exception 'valores_producto_invalidos' using errcode = '22023';
  end if;

  if coalesce(p_stock_actual, -1) < 0 or coalesce(p_stock_minimo, -1) < 0 then
    raise exception 'stock_invalido' using errcode = '22023';
  end if;

  select * into v_producto
  from public.productos
  where id = p_producto_id
  for update;

  if v_producto.id is null then
    raise exception 'producto_no_encontrado' using errcode = '02000';
  end if;

  update public.productos
  set nombre = trim(p_nombre),
      precio_venta = p_precio_venta,
      costo_unitario_actual = p_costo_unitario,
      stock_minimo = p_stock_minimo
  where id = p_producto_id;

  v_diferencia := p_stock_actual - v_producto.stock_actual;

  if v_diferencia <> 0 then
    insert into public.motivos (tipo, texto, activo)
    values ('ajuste_inventario', 'Ajuste directo desde catalogo', true)
    on conflict (tipo, texto) do update set activo = true
    returning id into v_motivo_id;

    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo_id, usuario_id
    )
    values (
      p_producto_id, 'ajuste', v_diferencia, 'producto_inline_admin', p_producto_id, v_motivo_id, public.perfil_actual_id()
    );
  end if;

  select * into v_producto_actualizado
  from public.productos
  where id = p_producto_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'guardar_producto_inline_admin',
    'productos',
    p_producto_id,
    jsonb_build_object(
      'nombre_anterior', v_producto.nombre,
      'nombre_nuevo', v_producto_actualizado.nombre,
      'precio_venta_anterior', v_producto.precio_venta,
      'precio_venta_nuevo', v_producto_actualizado.precio_venta,
      'costo_anterior', v_producto.costo_unitario_actual,
      'costo_nuevo', v_producto_actualizado.costo_unitario_actual,
      'stock_anterior', v_producto.stock_actual,
      'stock_nuevo', v_producto_actualizado.stock_actual,
      'stock_minimo_anterior', v_producto.stock_minimo,
      'stock_minimo_nuevo', v_producto_actualizado.stock_minimo,
      'diferencia_stock', v_diferencia
    )
  );

  return v_producto_actualizado;
end;
$$;

create or replace function public.guardar_combo_inline_admin(
  p_combo_id uuid,
  p_nombre text,
  p_precio_venta numeric
)
returns public.combos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_combo public.combos;
  v_combo_actualizado public.combos;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_actualiza_combo_inline' using errcode = '42501';
  end if;

  if p_combo_id is null then
    raise exception 'combo_requerido' using errcode = '22023';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_combo_invalido' using errcode = '22023';
  end if;

  if coalesce(p_precio_venta, -1) < 0 then
    raise exception 'precio_combo_invalido' using errcode = '22023';
  end if;

  select * into v_combo
  from public.combos
  where id = p_combo_id
  for update;

  if v_combo.id is null then
    raise exception 'combo_no_encontrado' using errcode = '02000';
  end if;

  update public.combos
  set nombre = trim(p_nombre),
      precio_venta = p_precio_venta
  where id = p_combo_id
  returning * into v_combo_actualizado;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'guardar_combo_inline_admin',
    'combos',
    p_combo_id,
    jsonb_build_object(
      'nombre_anterior', v_combo.nombre,
      'nombre_nuevo', v_combo_actualizado.nombre,
      'precio_venta_anterior', v_combo.precio_venta,
      'precio_venta_nuevo', v_combo_actualizado.precio_venta
    )
  );

  return v_combo_actualizado;
end;
$$;

grant execute on function public.guardar_producto_inline_admin(uuid, text, numeric, numeric, int, int) to authenticated;
grant execute on function public.guardar_combo_inline_admin(uuid, text, numeric) to authenticated;