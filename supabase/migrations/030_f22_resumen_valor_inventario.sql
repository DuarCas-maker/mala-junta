-- 030_f22_resumen_valor_inventario.sql
-- Sprint 5: total general de inventario activo para admin.

create or replace view public.v_admin_resumen_valor_inventario
with (security_invoker = true)
as
select
  count(*)::int as productos_activos,
  coalesce(sum(p.stock_actual), 0)::int as unidades_stock,
  coalesce(sum(p.stock_actual * p.costo_unitario_actual), 0)::numeric(12,0) as valor_costo,
  coalesce(sum(p.stock_actual * p.precio_venta), 0)::numeric(12,0) as valor_venta,
  coalesce(sum(p.stock_actual * (p.precio_venta - p.costo_unitario_actual)), 0)::numeric(12,0) as margen_potencial,
  count(*) filter (where coalesce(p.costo_unitario_actual, 0) <= 0)::int as productos_sin_costo
from public.productos p
where public.es_admin()
  and p.activo = true;

grant select on public.v_admin_resumen_valor_inventario to authenticated;