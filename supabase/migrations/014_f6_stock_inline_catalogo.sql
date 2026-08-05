-- F6 - Edicion inline de stock desde catalogo.

create or replace function public.guardar_stock_producto_inline(
  p_producto_id uuid,
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
    raise exception 'solo_admin_actualiza_stock' using errcode = '42501';
  end if;

  if p_producto_id is null then
    raise exception 'producto_requerido' using errcode = '22023';
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

  insert into public.motivos (tipo, texto, activo)
  values ('ajuste_inventario', 'Ajuste directo desde catalogo', true)
  on conflict (tipo, texto) do update set activo = true
  returning id into v_motivo_id;

  v_diferencia := p_stock_actual - v_producto.stock_actual;

  update public.productos
  set stock_minimo = p_stock_minimo
  where id = p_producto_id;

  if v_diferencia <> 0 then
    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo_id, usuario_id
    )
    values (
      p_producto_id, 'ajuste', v_diferencia, 'stock_inline_catalogo', p_producto_id, v_motivo_id, public.perfil_actual_id()
    );
  end if;

  select * into v_producto_actualizado
  from public.productos
  where id = p_producto_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'guardar_stock_producto_inline',
    'productos',
    p_producto_id,
    jsonb_build_object(
      'stock_anterior', v_producto.stock_actual,
      'stock_nuevo', v_producto_actualizado.stock_actual,
      'stock_minimo_anterior', v_producto.stock_minimo,
      'stock_minimo_nuevo', v_producto_actualizado.stock_minimo,
      'diferencia', v_diferencia
    )
  );

  return v_producto_actualizado;
end;
$$;

grant execute on function public.guardar_stock_producto_inline(uuid, int, int) to authenticated;
