# F1 - Nucleo operativo MVP

## Migraciones a ejecutar

Ejecutar en Supabase Studio > SQL Editor, en este orden:

1. `supabase/migrations/202607280005_f1_nucleo_operativo_mvp.sql`
2. `supabase/migrations/202607280006_f1_completar_operacion.sql`
3. `supabase/migrations/202607290001_f1_pin_plano_perfiles.sql`
4. `supabase/migrations/202607290002_f1_login_mesero_pin.sql`

La segunda migracion completa F1 con:

- Cuentas reutilizables por mesa abierta.
- Subcuentas base por cuenta.
- Anulaciones con motivo obligatorio y registro en `modificaciones_pedido`.
- Pagos mixtos por efectivo, datafono, Nequi/Daviplata y transferencia.
- Propina editable y cuentas pendientes con responsable.
- Realtime para `cuentas`, `pedidos`, `pedido_items` y `pagos`.
- Cola local de pedidos pendientes en la pantalla de mesero.

La tercera migracion ajusta `public.perfiles`: elimina `pin_hash` y deja `pin` plano por solicitud operativa temporal. Supabase Auth sigue manejando su propia contrasena interna.

La cuarta migracion agrega `email_login_mesero(usuario, pin)`, usada por el login para resolver el email de Supabase Auth desde `public.perfiles`.

## Verificacion SQL

Despues de ejecutar ambas migraciones:

```sql
select count(*) as mesas from public.mesas;
select count(*) as productos from public.productos;
select to_regclass('public.sub_cuentas') as sub_cuentas;
select to_regclass('public.modificaciones_pedido') as modificaciones_pedido;
select proname
from pg_proc
where proname in (
  'crear_pedido_rapido',
  'cambiar_estado_pedido',
  'registrar_pago_cuenta',
  'registrar_pagos_cuenta',
  'obtener_o_crear_cuenta',
  'anular_pedido',
  'email_login_mesero'
)
order by proname;
select count(*) as motivos_anulacion
from public.motivos
where tipo = 'anulacion' and activo = true;
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'perfiles'
  and column_name in ('pin', 'pin_hash')
order by column_name;
```

Esperado:

- `mesas = 8`
- `productos >= 10`
- `sub_cuentas` y `modificaciones_pedido` existen.
- aparecen las 7 RPC.
- `motivos_anulacion >= 1`
- en columnas de `perfiles` aparece `pin` y no aparece `pin_hash`

## Prueba funcional local

1. Iniciar la app con `npm.cmd run dev` y abrir `http://localhost:3000`.
2. Entrar como mesero y abrir `/mesero`.
3. Seleccionar mesa o `Barra directa`, sumar productos y enviar pedido.
4. Entrar como caja/admin en otra ventana y abrir `/caja`.
5. Ver la cuenta activa, marcar un pedido como `Preparar` y luego `Entregar`.
6. Registrar un cobro con uno o varios medios de pago; opcionalmente agregar propina.
7. Crear otro pedido y anularlo desde caja seleccionando un motivo.
8. Abrir `/barra` y confirmar que las comandas aparecen y desaparecen al entregarlas.
9. Para probar cola local, desconectar internet o bloquear Supabase, enviar un pedido desde `/mesero` y luego reintentar cuando vuelva la conexion.

## Test RLS

En entorno local Supabase, despues de resetear/aplicar migraciones y seed:

```bash
supabase test db --local tests/rls/f1.sql
```

Este test valida que:

- Mesero puede crear pedidos por RPC.
- Mesero no puede cambiar estados ni registrar pagos.
- Caja puede cambiar estados, registrar pagos y anular con motivo.
- Caja/admin no pueden borrar fisicamente cuentas o pedidos.
- Mesero no puede leer pagos.

## Estado de F1

F1 queda funcional para MVP operativo: mesero toma pedidos, barra prepara comandas, caja controla cuentas, cobros y anulaciones. Las siguientes fases siguen separadas: inventario real y kardex (F2), cierre de caja (F3), DIAN-ready sin transmision (F4), reportes/auditoria ampliada (F5). F6 sigue prohibida sin autorizacion explicita.
