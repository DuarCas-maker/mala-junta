-- F42: inventario con deficit por ventas y entradas masivas auditables.

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

  if v_stock_nuevo < 0 and new.cantidad < 0 and new.tipo <> 'venta'::public.tipo_movimiento_inventario then
    raise exception 'stock_insuficiente' using errcode = '22023';
  end if;

  update public.productos
  set stock_actual = v_stock_nuevo
  where id = new.producto_id;

  new.stock_resultante := v_stock_nuevo;
  return new;
end;
$$;

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

  if coalesce(p_stock_minimo, -1) < 0 then
    raise exception 'stock_minimo_invalido' using errcode = '22023';
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
  where id = p_producto_id
  returning * into v_producto_actualizado;

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
      'stock_actual_preservado', v_producto_actualizado.stock_actual,
      'stock_minimo_anterior', v_producto.stock_minimo,
      'stock_minimo_nuevo', v_producto_actualizado.stock_minimo,
      'stock_solicitado_ignorado', p_stock_actual
    )
  );

  return v_producto_actualizado;
end;
$$;

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
begin
  if not public.es_admin() then
    raise exception 'solo_admin_actualiza_stock' using errcode = '42501';
  end if;

  if p_producto_id is null then
    raise exception 'producto_requerido' using errcode = '22023';
  end if;

  if coalesce(p_stock_minimo, -1) < 0 then
    raise exception 'stock_minimo_invalido' using errcode = '22023';
  end if;

  select * into v_producto
  from public.productos
  where id = p_producto_id
  for update;

  if v_producto.id is null then
    raise exception 'producto_no_encontrado' using errcode = '02000';
  end if;

  update public.productos
  set stock_minimo = p_stock_minimo
  where id = p_producto_id
  returning * into v_producto_actualizado;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'guardar_stock_producto_inline',
    'productos',
    p_producto_id,
    jsonb_build_object(
      'stock_actual_preservado', v_producto_actualizado.stock_actual,
      'stock_solicitado_ignorado', p_stock_actual,
      'stock_minimo_anterior', v_producto.stock_minimo,
      'stock_minimo_nuevo', v_producto_actualizado.stock_minimo
    )
  );

  return v_producto_actualizado;
end;
$$;

create or replace view public.v_admin_resumen_valor_inventario
with (security_invoker = true)
as
select
  count(*)::int as productos_activos,
  coalesce(sum(greatest(p.stock_actual, 0)), 0)::int as unidades_stock,
  coalesce(sum(greatest(p.stock_actual, 0) * p.costo_unitario_actual), 0)::numeric(12,0) as valor_costo,
  coalesce(sum(greatest(p.stock_actual, 0) * p.precio_venta), 0)::numeric(12,0) as valor_venta,
  coalesce(sum(greatest(p.stock_actual, 0) * (p.precio_venta - p.costo_unitario_actual)), 0)::numeric(12,0) as margen_potencial,
  count(*) filter (where coalesce(p.costo_unitario_actual, 0) <= 0)::int as productos_sin_costo,
  count(*) filter (where p.stock_actual < 0)::int as productos_deficit,
  coalesce(sum(abs(least(p.stock_actual, 0))), 0)::int as unidades_deficit,
  coalesce(sum(abs(least(p.stock_actual, 0)) * p.costo_unitario_actual), 0)::numeric(12,0) as valor_deficit_reposicion
from public.productos p
where public.es_admin()
  and p.activo = true;

create or replace view public.v_admin_deficit_inventario
with (security_invoker = true)
as
select
  p.id,
  p.nombre,
  c.nombre as categoria,
  p.stock_actual,
  abs(p.stock_actual)::int as unidades_pendientes,
  p.stock_minimo,
  p.costo_unitario_actual,
  (abs(p.stock_actual) * p.costo_unitario_actual)::numeric(12,0) as valor_reposicion,
  p.presentacion_compra,
  p.factor_compra
from public.productos p
left join public.categorias c on c.id = p.categoria_id
where public.es_admin()
  and p.activo = true
  and p.stock_actual < 0
order by abs(p.stock_actual) desc, p.nombre;

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
  greatest(p.stock_actual, 0) * p.costo_unitario_actual as valor_inventario
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
  greatest(p.stock_actual, 0) * p.costo_unitario_actual as valor_inventario,
  coalesce(sum(abs(mi.cantidad)) filter (
    where mi.tipo = 'venta'
      and mi.timestamp >= now() - interval '30 days'
  ), 0) as rotacion_30d,
  (greatest(p.stock_actual, 0) * p.costo_unitario_actual)
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

create or replace function public.metricas_rotacion_stock_admin()
returns table(
  producto text,
  categoria text,
  stock_actual integer,
  stock_minimo integer,
  unidades_vendidas_30d numeric,
  dias_stock_estimado numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.nombre as producto,
    c.nombre as categoria,
    p.stock_actual,
    p.stock_minimo,
    coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0)::numeric as unidades_vendidas_30d,
    case
      when coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0) = 0 then null
      else round(greatest(p.stock_actual, 0)::numeric / (coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0)::numeric / 30), 1)
    end as dias_stock_estimado
  from public.productos p
  left join public.categorias c on c.id = p.categoria_id
  left join public.movimientos_inventario mi on mi.producto_id = p.id
  where public.es_admin()
    and p.activo = true
  group by p.id, p.nombre, c.nombre, p.stock_actual, p.stock_minimo
  order by unidades_vendidas_30d desc, p.nombre
  limit 12;
$$;

grant select on public.v_admin_resumen_valor_inventario to authenticated;
grant select on public.v_admin_deficit_inventario to authenticated;
grant select on public.v_alertas_stock_bajo to authenticated;
grant select on public.v_candidatos_auditoria to authenticated;
grant execute on function public.guardar_producto_inline_admin(uuid, text, numeric, numeric, int, int) to authenticated;
grant execute on function public.guardar_stock_producto_inline(uuid, int, int) to authenticated;
grant execute on function public.metricas_rotacion_stock_admin() to authenticated;
