-- 022_f14_productos_operativos_sin_costo.sql
-- Cierra la lectura directa del costo de productos para roles operativos.

create or replace view public.v_productos_operativos
as
select
  p.id,
  p.nombre,
  p.precio_venta,
  p.codigo_interno,
  p.stock_actual,
  p.stock_minimo,
  p.presentacion_compra,
  p.factor_compra,
  p.activo,
  c.nombre as categoria
from public.productos p
left join public.categorias c on c.id = p.categoria_id
where p.activo = true
  and public.rol_actual() in ('admin'::public.rol_usuario, 'caja'::public.rol_usuario, 'mesero'::public.rol_usuario);

grant select on public.v_productos_operativos to authenticated;

revoke select on public.productos from authenticated;
grant select (
  id,
  nombre,
  categoria_id,
  precio_venta,
  codigo_interno,
  imagen_url,
  stock_actual,
  stock_minimo,
  activo,
  presentacion_compra,
  factor_compra,
  created_at,
  updated_at
) on public.productos to authenticated;