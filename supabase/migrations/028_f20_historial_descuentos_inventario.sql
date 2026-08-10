-- 028_f20_historial_descuentos_inventario.sql
-- Sprint 3: historial admin de descuentos/salidas de inventario por item.

create or replace view public.v_admin_historial_descuentos_item
with (security_invoker = true)
as
select
  mi.id,
  mi.timestamp,
  public.dia_negocio(mi.timestamp) as dia_negocio,
  mi.producto_id,
  p.nombre as producto,
  c.nombre as categoria,
  p.activo as producto_activo,
  mi.tipo,
  mi.cantidad,
  abs(mi.cantidad) as unidades_descontadas,
  mi.stock_resultante,
  mi.referencia_tipo,
  mi.referencia_id,
  m.texto as motivo,
  u.nombre as usuario,
  ped.id as pedido_id,
  ped.estado as pedido_estado,
  pi.id as pedido_item_id,
  pi.estado as pedido_item_estado,
  cu.id as cuenta_id,
  case
    when mesa.id is null then 'Pedido directo'
    else concat(mesa.nombre, ' - ', mesa.zona)
  end as cuenta_origen,
  cv.id as captura_id,
  cv.estado as captura_estado,
  cvg.orden as captura_venta_orden,
  case
    when pi.combo_id is not null then 'combo'
    when pi.producto_id is not null then 'producto'
    else null
  end as item_vendido_tipo,
  coalesce(combo.nombre, producto_item.nombre) as item_vendido_nombre,
  pi.cantidad as item_vendido_cantidad,
  pi.precio_unitario_capturado,
  case
    when cv.id is not null then concat('Captura foto / venta ', cvg.orden::text)
    when ped.id is not null then 'Pedido manual'
    when mi.referencia_tipo = 'auditoria_item' then 'Auditoria de inventario'
    when mi.referencia_tipo in ('producto_inline_admin', 'stock_inline_catalogo') then 'Edicion directa de stock'
    when mi.referencia_tipo = 'ajuste_manual' then 'Ajuste manual'
    else coalesce(mi.referencia_tipo, 'Movimiento manual')
  end as origen,
  case
    when pi.combo_id is not null then concat('Combo: ', combo.nombre, ' x', pi.cantidad::text)
    when pi.producto_id is not null then concat('Producto: ', producto_item.nombre, ' x', pi.cantidad::text)
    when m.texto is not null then m.texto
    else coalesce(mi.referencia_tipo, 'Sin referencia')
  end as detalle_referencia
from public.movimientos_inventario mi
join public.productos p on p.id = mi.producto_id
left join public.categorias c on c.id = p.categoria_id
left join public.motivos m on m.id = mi.motivo_id
left join public.perfiles u on u.id = mi.usuario_id
left join public.pedido_items pi on pi.id = mi.referencia_id and mi.referencia_tipo = 'pedido_item'
left join public.productos producto_item on producto_item.id = pi.producto_id
left join public.combos combo on combo.id = pi.combo_id
left join public.pedidos ped on ped.id = pi.pedido_id
left join public.cuentas cu on cu.id = ped.cuenta_id
left join public.mesas mesa on mesa.id = cu.mesa_id
left join public.captura_venta_grupos cvg on cvg.pedido_id = ped.id
left join public.capturas_venta cv on cv.id = cvg.captura_id
where public.es_admin()
  and (
    mi.cantidad < 0
    or mi.tipo in ('venta', 'merma', 'consumo_interno')
  )
order by mi.timestamp desc;

grant select on public.v_admin_historial_descuentos_item to authenticated;