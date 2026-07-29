# F4 - Facturacion DIAN-ready sin transmision

## Migracion a ejecutar

Ejecutar en Supabase Studio > SQL Editor:

`supabase/migrations/010_f4_facturacion_dian_ready.sql`

Esta migracion agrega:

- `consecutivos_documento`
- `documentos`
- `documento_lineas`
- `envios_comprobante`
- `uvt_vigente(fecha)`
- `clasificar_documento(subtotal, fecha)`
- `generar_documento_cuenta(cuenta_id, adquiriente)`
- `registrar_pagos_cuenta_dian(...)`
- stubs de comprobante y DIAN aislados en `supabase/functions/`

## Alcance

F4 solo crea estructura DIAN-ready y comprobantes internos. No genera CUFE/CUDE real, no firma XML, no transmite a DIAN y no rotula ningun documento como fiscal.

## Flujo funcional

1. Caja cobra una cuenta desde `/caja`.
2. Si la venta supera 5 UVT, Postgres exige `razon_social` y `numero_id` del adquiriente.
3. Al quedar pagada, se genera un registro en `public.documentos`.
4. Si se diligencia destino, se crea `public.envios_comprobante` con estado `simulado`.
5. El documento queda con `estado_dian = 'no_transmitido'` y etiqueta de comprobante interno no fiscal.

## Verificacion SQL

```sql
select public.uvt_vigente('2026-07-29'::date);
select public.clasificar_documento(100000, current_date) as documento_pos;
select public.clasificar_documento(300000, current_date) as factura_venta;

select to_regclass('public.documentos') as documentos;
select to_regclass('public.envios_comprobante') as envios_comprobante;
```

## Consultas utiles

```sql
select tipo, numero, cuenta_id, subtotal, propina, total, estado_dian, etiqueta_no_fiscal
from public.documentos
order by generated_at desc
limit 20;

select d.numero, e.canal, e.destino, e.estado, e.timestamp
from public.envios_comprobante e
join public.documentos d on d.id = e.documento_id
order by e.timestamp desc
limit 20;

select documento_id, descripcion, cantidad, valor_unitario, subtotal, tipo_impuesto, tarifa_pct, impuesto
from public.documento_lineas
order by created_at desc
limit 50;
```

## Criterios F4

- Venta menor o igual a 5 UVT se clasifica como `pos`.
- Venta mayor a 5 UVT se clasifica como `factura_venta`.
- `factura_venta` exige adquiriente con nombre/razon social y cedula/NIT.
- Comprobante opcional queda registrado como solicitud simulada.
- `estado_dian` queda siempre `no_transmitido`.
- Stubs `firmar`, `transmitir` y `validar` quedan bloqueados hasta F6.

## Test RLS local

```bash
supabase test db --local tests/rls/f4.sql
```
