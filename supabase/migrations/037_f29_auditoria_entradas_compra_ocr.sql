-- 037_f29_auditoria_entradas_compra_ocr.sql
-- Sprint 6: vista de auditoria por linea para entradas de inventario creadas desde OCR.

create or replace view public.v_admin_entradas_inventario_ocr
with (security_invoker = true)
as
select
  c.id as captura_id,
  c.compra_id,
  ci.id as compra_item_id,
  mi.id as movimiento_id,
  c.fecha_ingreso,
  coalesce(mi.timestamp, c.confirmado_at, c.aprobado_at, c.created_at) as registrado_at,
  c.confirmado_at,
  c.nombre_archivo,
  c.storage_bucket,
  c.storage_path,
  pr.id as proveedor_id,
  pr.nombre as proveedor,
  p.id as producto_id,
  p.nombre as producto,
  l.orden,
  l.modo,
  l.cantidad_ingresada,
  l.factor_aplicado,
  l.unidades_resultantes,
  l.costo_unitario_catalogo,
  l.precio_venta_catalogo,
  l.subtotal_costo,
  l.stock_actual_snapshot,
  coalesce(l.stock_proyectado, mi.stock_resultante) as stock_resultante,
  subio.nombre as subido_por,
  aprobo.nombre as aprobado_por
from public.capturas_compra c
join public.captura_compra_lineas l on l.captura_id = c.id
join public.productos p on p.id = l.producto_id
left join public.proveedores pr on pr.id = c.proveedor_id
left join public.compra_items ci on ci.id = l.compra_item_id
left join public.movimientos_inventario mi on mi.referencia_tipo = 'compra_item' and mi.referencia_id = ci.id
left join public.perfiles subio on subio.id = c.usuario_id
left join public.perfiles aprobo on aprobo.id = c.aprobado_por
where public.es_admin()
  and c.estado = 'confirmada'::public.estado_captura_compra
  and l.estado = 'confirmada';

grant select on public.v_admin_entradas_inventario_ocr to authenticated;
