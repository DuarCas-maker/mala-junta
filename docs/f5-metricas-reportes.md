# F5 - Metricas y reportes

## Migracion a ejecutar

Ejecutar en Supabase Studio > SQL Editor:

`supabase/migrations/011_f5_metricas_reportes.sql`

Esta fase agrega vistas SQL y RPCs para el panel administrativo M-01 a M-12.

## Vistas principales

- `v_metricas_lineas_venta`: base de ventas, costos, margen y tiempos.
- `v_metricas_margen_producto`: margen por producto/combo.
- `v_metricas_margen_global_dia`: margen global por dia de negocio.
- `v_metricas_kardex_detallado`: kardex con usuario, motivo y stock resultante.
- `v_metricas_rotacion_stock`: rotacion 30 dias y dias de stock.
- `v_metricas_diferencias_auditoria`: diferencias historicas por auditoria.
- `v_metricas_cierres_caja`: faltantes/sobrantes por cierre.
- `v_metricas_retiros_caja`: retiros justificados por periodo.
- `v_metricas_propinas`: propinas por dia y responsable.
- `v_metricas_ventas_mesero`: ventas por mesero, contado vs pendiente.
- `v_metricas_tiempos_preparacion`: enviado a entregado.
- `v_metricas_ventas_franja`: ventas por dia, hora, categoria y producto.

Todas las vistas usan `security_invoker` y filtran `public.es_admin()`: caja y mesero no deben ver rentabilidad.

## RPCs

```sql
select public.resumen_metricas_admin(current_date - 30, current_date);
select public.exportar_metricas_csv('productos', current_date - 30, current_date);
select public.exportar_metricas_csv('ventas_mesero', current_date - 30, current_date);
select public.exportar_metricas_csv('kardex', current_date - 30, current_date);
select public.exportar_metricas_csv('cierres', current_date - 30, current_date);
```

## Prueba funcional

1. Entrar como admin a `/admin`.
2. Abrir `F5 Metricas`.
3. Cambiar rango de fechas y presionar `Actualizar`.
4. Revisar tarjetas: ventas, costo, margen, compras, propinas y tiempo promedio.
5. Revisar tablas: margen, ventas por mesero, cierres, rotacion y tiempos.
6. Descargar CSV y Excel desde los botones de cada tabla.

## Validacion SQL rapida

```sql
select * from public.v_metricas_margen_producto limit 10;
select * from public.v_metricas_rotacion_stock limit 10;
select * from public.v_metricas_tiempos_preparacion limit 10;
```

## Test RLS local

```bash
supabase test db --local tests/rls/f5.sql
```

## Criterios F5 cubiertos

- M-01/M-03: margen por producto y combo con costo unitario actual.
- M-02: resumen global cruza ventas, costo estimado y compras.
- M-04: kardex detallado exportable.
- M-05: rotacion y dias de stock.
- M-06: diferencias de auditoria acumuladas.
- M-07/M-08/M-09: cierres, retiros y propinas.
- M-10: ventas por mesero contado vs pendiente.
- M-11: tiempos de preparacion enviado a entregado.
- M-12: ventas por dia, categoria, producto y franja horaria.
- RF-40: exportacion CSV y Excel-compatible desde UI.
