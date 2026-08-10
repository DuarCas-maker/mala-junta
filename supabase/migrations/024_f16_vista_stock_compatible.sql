-- 024_f16_vista_stock_compatible.sql
-- Hace la vista de stock mas tolerante para evitar inventario vacio por checks de rol en el SELECT.
-- Los costos siguen protegidos: solo admin recibe costo_estimado; los demas ven null.

create or replace view public.v_catalogo_items_stock
as
select
  1 as orden_tipo,
  'producto'::text as tipo_item,
  p.id as item_id,
  p.nombre,
  c.nombre as categoria,
  p.precio_venta,
  (case when public.es_admin() then p.costo_unitario_actual else null end)::numeric(12,0) as costo_estimado,
  p.stock_actual as stock_disponible,
  p.stock_minimo,
  p.codigo_interno,
  p.presentacion_compra,
  p.factor_compra,
  p.activo,
  null::jsonb as componentes
from public.productos p
left join public.categorias c on c.id = p.categoria_id
union all
select
  2 as orden_tipo,
  'combo'::text as tipo_item,
  co.id as item_id,
  co.nombre,
  'Combo'::text as categoria,
  co.precio_venta,
  (case when public.es_admin() then coalesce(sum(p.costo_unitario_actual * ci.cantidad), 0) else null end)::numeric(12,0) as costo_estimado,
  coalesce(min(floor(p.stock_actual::numeric / nullif(ci.cantidad, 0))), 0)::int as stock_disponible,
  null::int as stock_minimo,
  null::text as codigo_interno,
  null::text as presentacion_compra,
  null::int as factor_compra,
  co.activo,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'producto_id', p.id,
        'producto', p.nombre,
        'cantidad', ci.cantidad,
        'stock_actual', p.stock_actual
      ) order by p.nombre
    ) filter (where ci.id is not null and ci.activo = true),
    '[]'::jsonb
  ) as componentes
from public.combos co
left join public.combo_items ci on ci.combo_id = co.id and ci.activo = true
left join public.productos p on p.id = ci.producto_id
group by co.id, co.nombre, co.precio_venta, co.activo;

grant select on public.v_catalogo_items_stock to authenticated;