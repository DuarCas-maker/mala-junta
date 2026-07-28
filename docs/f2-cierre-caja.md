# F2 - Cierre de Caja

## Migracion a ejecutar

Ejecutar en Supabase Studio > SQL Editor:

`supabase/migrations/008_f2_cierre_caja.sql`

Esta migracion agrega:

- `cierres_caja`
- `retiros_caja`
- `pagos.cierre_caja_id`
- `cuentas.cierre_caja_id`
- RPC `abrir_caja(base_inicial)`
- RPC `registrar_retiro_caja(...)`
- RPC `resumen_caja_actual()`
- RPC `cerrar_caja(efectivo_contado, justificacion)`
- bloqueo de pagos si no hay caja abierta

## Verificacion SQL

```sql
select to_regclass('public.cierres_caja') as cierres_caja;
select to_regclass('public.retiros_caja') as retiros_caja;
select proname
from pg_proc
where proname in (
  'abrir_caja',
  'registrar_retiro_caja',
  'resumen_caja_actual',
  'cerrar_caja',
  'cierre_caja_abierto_actual'
)
order by proname;
```

## Prueba funcional

1. Entrar como caja/admin y abrir `/caja`.
2. Si no hay caja abierta, registrar `Base inicial`.
3. Crear/cobrar una cuenta. Si intentas cobrar sin caja abierta, debe fallar.
4. Registrar un retiro con monto, motivo u observacion.
5. Revisar resumen: base, pagos por medio, retiros, propinas y cuentas.
6. Cerrar con `Efectivo contado` exacto: debe cerrar.
7. Abrir otra caja y cerrar con diferencia usando usuario caja: debe fallar con `cierre_descuadrado_requiere_admin`.
8. Entrar como admin y cerrar descuadrado con justificacion: debe permitirlo.
9. Al cerrar, volver a abrir exige nueva base.

## Donde quedan los datos

- Aperturas/cierres: `public.cierres_caja`.
- Retiros: `public.retiros_caja`.
- Pagos del turno: `public.pagos` filtrando por `cierre_caja_id`.
- Cuentas pagadas del ciclo cerrado: `public.cuentas.cierre_caja_id`.

## Test RLS local

```bash
supabase test db --local tests/rls/f2.sql
```
