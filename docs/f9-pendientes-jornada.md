# Pendientes y liberacion de mesas por jornada

## Comportamiento

- La jornada es de 10:00 a 09:59 del dia siguiente, en America/Bogota.
- Pagar completamente libera la mesa inmediatamente, como antes.
- Un cierre de caja exitoso libera las cuentas de su jornada. Un cierre atrasado no libera las cuentas de una jornada posterior.
- A las 10:00, las cuentas sin liberar de jornadas anteriores pasan a Pendientes, incluidos pedidos enviados, en preparacion o entregados.
- Los pedidos anulados y los pagos anulados no cuentan en el saldo.
- La cuenta conserva su mesa historica, pedidos, jornada, responsable y abonos. Los nuevos consumos usan otra cuenta.
- Una cuenta sin responsable se muestra como "Pendiente por identificar" y permite guardar el nombre desde Cobros > Pendientes.
- Un abono, cambio de estado o reversion de pago nunca recupera una mesa liberada.
- La liberacion horaria no cierra financieramente la caja: siguen siendo necesarios el conteo y las validaciones actuales.

## Activacion

1. Aplicar `supabase/migrations/058_f50_pendientes_y_liberacion_por_jornada.sql` sobre las migraciones existentes hasta 057. La migracion es transaccional y tambien convierte las cuentas antiguas con saldo; preserva sus pedidos y pagos.
2. Desplegar el frontend y el Dockerfile actualizado. El contenedor arranca Next.js y `scripts/corte-jornada.mjs` mediante `scripts/iniciar-servidor.mjs`.
3. Configurar `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` como variables del servidor en tiempo de ejecucion. La llave privilegiada nunca se envia al navegador. El trabajador acepta HTTPS o HTTP de localhost para pruebas.
4. Confirmar en logs que no aparecen errores `[jornada]`. El trabajador ejecuta el corte al arrancar y cada minuto, alineado con el reloj. Recupera jornadas omitidas tras un reinicio y solo registra actividad cuando libera cuentas o encuentra un error.

`npm start` tambien inicia el trabajador y carga `.env.local` si existe. En desarrollo puede ejecutarse aparte con `npm run jornada:worker`. No iniciar el trabajador de desarrollo contra una base real antes de aplicar y revisar la migracion.

Si `pg_cron` ya esta habilitado, la migracion registra el job `mala-junta-corte-jornada` cada minuto. En ese caso el corte funciona incluso con el servidor web detenido. No instala la extension automaticamente en un VPS que no la soporte. Referencia: [Supabase Cron](https://supabase.com/docs/guides/cron).

Ambos programadores pueden coexistir: usan la misma operacion transaccional y no duplican cambios. Como respaldo, las consultas de mesas/cuentas y la creacion de pedidos recuperan cualquier corte pendiente. Ese respaldo no reemplaza al trabajador o a `pg_cron` cuando no hay usuarios conectados.

Para comprobar el job desde SQL Editor cuando `pg_cron` este habilitado:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'mala-junta-corte-jornada';
```

## Cambios de base

- `cuentas.mesa_liberada_at`: marca permanente de liberacion; no se borra al modificar cobros.
- `cuentas.motivo_liberacion`: pago, pendiente manual, cierre de caja, corte horario o migracion.
- `pedidos.solicitud_id`: evita duplicar un envio cuya respuesta se perdio.
- `finalizar_cuentas_jornada`: operacion interna de corte con bloqueo transaccional compartido con pedidos y pagos.
- `procesar_corte_jornada`: RPC exclusiva de `service_role`, sin parametros de fecha elegibles por clientes.
- `sincronizar_jornada_operativa`: respaldo autenticado para recuperar cortes vencidos; devuelve la jornada actual.
- `actualizar_responsable_pendiente`: caja/admin identifican una deuda sin reocupar mesa ni exigir nueva caja.
- Las funciones existentes de pedidos, selector de mesas, cobros y cierre usan la nueva regla. La restriccion unica de mesa solo considera ocupaciones vigentes.
- Las deudas liberadas no admiten "Quitar pendiente": se identifican, abonan, pagan o anulan mediante las operaciones existentes.

## Pedidos guardados por falta de conexion

Cada envio conserva su solicitud, la cuenta esperada y el momento de creacion. El servidor recupera primero los pedidos ya recibidos; si no existe el envio, comprueba jornada y cuenta antes de agregarlo.

Si cambio la jornada u ocupacion, el pedido permanece guardado y exige revision. "Revisar pedido" carga sus productos en el formulario y exige elegir mesa o venta directa. El envio revisado pertenece a la jornada actual y conserva la fecha anterior en notas; la cola solo se limpia al confirmar el envio. Los pedidos de versiones anteriores, sin cuenta esperada, tambien requieren revision.

## Verificacion

```bash
npm run test:jornada
npm run test:db:jornada
npm run typecheck
npm run lint
npm run build
```

`test:db:jornada` ejecuta las 58 migraciones reales en PostgreSQL WASM aislado con pgTAP y un fixture minimo de los esquemas Auth/Storage. Comprueba la migracion de una deuda historica mal cerrada, la reconciliacion de cuentas pagadas y los flujos de jornada. No lee ni modifica la base de produccion.

Con Supabase local y Docker disponibles tambien puede ejecutarse `npm run test:sql:f9` contra el entorno completo. La suite SQL revierte sus datos al terminar.

Casos cubiertos: limite de las 10:00, cambio de mes/anio, estados operativos, abonos, responsables faltantes, fecha y stock conservados, reintentos, corte repetido, nuevas ocupaciones, cierres atrasados, reversiones, pagos completos y cuentas vacias. La ejecucion real de cron, la supervision del contenedor y la concurrencia entre conexiones deben comprobarse en el servidor durante la activacion.
