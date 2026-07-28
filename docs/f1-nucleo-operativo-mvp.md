# F1 - Nucleo operativo MVP

## Migracion a ejecutar

Ejecutar en Supabase Studio > SQL Editor:

`supabase/migrations/202607280005_f1_nucleo_operativo_mvp.sql`

Esta migracion crea el nucleo operativo minimo:

- `mesas`
- `categorias`
- `productos`
- `cuentas`
- `pedidos`
- `pedido_items`
- `pagos`
- RPC `crear_pedido_rapido`
- RPC `cambiar_estado_pedido`
- RPC `registrar_pago_cuenta`
- Seed de mesas y productos base

## Verificacion SQL

Despues de ejecutar la migracion:

```sql
select count(*) as mesas from public.mesas;
select count(*) as productos from public.productos;
select proname from pg_proc where proname in ('crear_pedido_rapido', 'cambiar_estado_pedido', 'registrar_pago_cuenta') order by proname;
```

Esperado:

- `mesas = 8`
- `productos >= 10`
- las 3 RPC aparecen

## Prueba funcional

1. Entrar como mesero.
2. Abrir `/mesero`.
3. Seleccionar mesa o dejar `Barra directa`.
4. Sumar productos y enviar pedido.
5. Entrar como caja en otra ventana y abrir `/caja`.
6. Ver el pedido, marcar `Preparar`, luego `Entregar`, luego `Cobrar`.
7. Abrir `/barra` con usuario caja/admin y ver comandas pendientes.

## Alcance real de esta primera F1

Esto es el primer MVP operativo, no el cierre total de F1 del plan maestro. Faltan aun:

- Realtime real con canales Supabase en lugar de polling temporal.
- Cuentas existentes por mesa y division avanzada.
- Anulacion con motivo obligatorio.
- Cola offline PWA del mesero.
- Pagos mixtos, propina editable y cambio.
- Fiados completos.

Esos puntos siguen dentro de F1/F2 y se completan en pasos siguientes.