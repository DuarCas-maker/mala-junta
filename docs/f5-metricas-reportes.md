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

## Conexion del navegador al VPS

El 19 de octubre de 2026 se comprobo que Supabase responde por HTTPS,
pero el preflight CORS de Kong no permite `Content-Profile`. El SDK lo
envia en las RPC POST, por lo que el navegador muestra `TypeError: Failed
to fetch` antes de consultar la base de datos. `Accept-Profile` si esta permitido.

Las consultas de los 15 bloques y la exportacion SQL se centralizan en
`lib/metricas-consultas.ts` y usan `rpc(..., { get: true })`. Estas funciones
son `STABLE` y solo leen datos. Se conservan la sesion del usuario, las
validaciones de administrador, el esquema `public`, las fechas, los filtros
y los limites. No requiere migraciones ni credenciales nuevas.

Prueba de regresion con el SDK instalado y los encabezados CORS del VPS:

```bash
npm run test:metricas
```

La prueba reproduce primero el fallo con POST y verifica luego los 15 bloques,
la exportacion y los errores de permisos con GET. Contra la API real se
comprobo el preflight y la respuesta de las 16 consultas con la clave publica:
ninguna fallo por red; resumen y exportacion rechazaron correctamente la
peticion sin sesion de administrador. La validacion visual con datos requiere
iniciar sesion como admin despues de desplegar esta version.

La conexion general se corrigio posteriormente en el mismo dia: el cliente
del navegador envia PostgREST por `/api/supabase/rest/...`, que conserva el
token del usuario, el esquema y el metodo original al contactar el VPS.
Esto tambien permite las RPC POST que sincronizan jornada o escriben datos.
Ver `docs/supabase-vps-conexion.md` y `npm run test:conexion`.

## Montos, cuentas y detalle del intervalo

Las tarjetas y el detalle de ventas por jornada muestran los montos junto con
la cantidad de cuentas. El conteo del intervalo usa `metricas_estado_cuentas_admin`,
no la suma de conteos diarios, para evitar contar dos veces una cuenta con ventas
en varias jornadas. Pendientes y Abiertas tienen su propia tarjeta; Parcial conserva
el monto abonado y el faltante en el mismo recuadro. Los conteos de Anulado siguen
expresados como pedidos, tal como en el reporte original.

El detalle por categoria/item muestra las ultimas 15 jornadas con registros
dentro del rango general y del filtro de categoria/item, omitiendo los dias
sin registros. Se ordenan cronologicamente con la mas reciente a la derecha.
Debajo, Reparticion por jornada laboral muestra todas las jornadas con registros
del intervalo: una barra vertical por jornada apila costo y ganancia, y una
linea indica las ventas totales de cada dia. Las etiquetas compactas del costo
y la ganancia se centran en sus segmentos y las ventas se muestran arriba.
Las tarjetas inferiores conservan los totales de todo el intervalo. Las graficas
se ajustan al ancho disponible, sin ancho minimo fijo ni crecimiento horizontal
por cantidad de jornadas. Las etiquetas se distribuyen segun el espacio y los
valores completos se conservan en el tooltip. El menu lateral de Admin tiene
un boton superior para colapsar y expandir, conservando el modulo y sus filtros.
La revision visual con 80 jornadas verifica que el ancho de la pagina coincide
con el viewport con el menu abierto y cerrado, tambien en pantalla estrecha.

Las lineas se cargan en paginas de 500, con orden estable por jornada e ID de
item, en lugar de cortar la respuesta a 2000 filas. Los totales y las opciones
de categoria/item usan todas las paginas. Si una pagina falla, se informa el
error y no se entrega un total parcial como resultado completo.

```bash
npm run test:metricas
```

Las pruebas cubren rangos largos, cambios de categoria/item, las ultimas 15
jornadas activas aunque sean antiguas, la omision de dias vacios, la conservacion
de totales completos, conteos por estado y margenes negativos. La revision visual local usa datos
simulados; no requiere modificar datos de produccion.

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
