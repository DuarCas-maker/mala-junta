-- 023_f15_limpiar_pedidos_prueba.sql
-- Limpia pedidos/cuentas/cobros/capturas de prueba y conserva catalogo, combos, proveedores, compras y stock actual.
-- Importante: borrar movimientos historicos de venta no recalcula ni modifica productos.stock_actual.

begin;

-- Capturas IA de prueba: al borrar la captura, sus grupos, lineas y pagos salen por ON DELETE CASCADE.
delete from public.capturas_venta;

-- Documentos y comprobantes asociados a cuentas/pedidos de prueba.
delete from public.envios_comprobante;
delete from public.documento_lineas;
delete from public.documentos;

-- Historial operativo ligado a pedidos/cuentas.
delete from public.modificaciones_pedido;
delete from public.pagos;
delete from public.sub_cuentas;

-- Historial de inventario generado por ventas de pedidos de prueba.
-- No toca compras, ajustes manuales, auditorias ni stock actual del producto.
delete from public.movimientos_inventario
where tipo = 'venta'
  and referencia_tipo = 'pedido_item';

-- Pedidos y cuentas.
delete from public.pedido_items;
delete from public.pedidos;
delete from public.cuentas;

-- Caja de prueba. Se conserva configuracion, usuarios, mesas, catalogo e inventario.
delete from public.retiros_caja;
delete from public.cierres_caja;

-- Reinicia consecutivos internos de comprobantes porque los documentos anteriores eran de prueba.
update public.consecutivos_documento
set siguiente = 1,
    updated_at = now()
where tipo in ('pos', 'factura_venta', 'nota_credito', 'nota_debito');

commit;