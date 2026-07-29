# F3 - Catalogo, Inventario y Compras

## Migracion a ejecutar

Ejecutar en Supabase Studio > SQL Editor:

`supabase/migrations/009_f3_catalogo_inventario_compras.sql`

Esta migracion agrega y conecta:

- `historial_precios`
- `combos` y `combo_items`
- `movimientos_inventario` como kardex append-only
- `proveedores`, `compras`, `compra_items`
- `auditorias_inventario`, `auditoria_items`
- `v_alertas_stock_bajo`
- `v_candidatos_auditoria`
- RPCs de catalogo, compras, ajustes, auditoria y venta con descuento de stock

## Cambio operativo importante

Desde F3 el stock se descuenta al crear el pedido. Si caja anula el pedido, el sistema registra una `devolucion` en kardex y restaura el stock. Los combos ya no deben manejarse como productos simples: F3 desactiva productos con codigo `COM-*` y crea combos reales con componentes.

## Verificacion SQL

```sql
select to_regclass('public.movimientos_inventario') as movimientos_inventario;
select to_regclass('public.compras') as compras;
select to_regclass('public.auditorias_inventario') as auditorias_inventario;

select proname
from pg_proc
where proname in (
  'registrar_compra',
  'crear_combo_catalogo',
  'registrar_movimiento_inventario',
  'crear_auditoria_inventario',
  'registrar_conteo_auditoria',
  'cerrar_auditoria_inventario'
)
order by proname;
```

## Prueba funcional

1. Entrar como admin en `/admin`.
2. En `F3 Inventario`, crear una categoria o producto de prueba.
3. Crear un proveedor.
4. Registrar una compra por presentacion: por ejemplo 2 cajas x24. El stock debe subir 48 unidades.
5. Crear un combo con 2 componentes.
6. Entrar como mesero y vender ese combo.
7. Revisar que el stock de cada componente bajo segun la cantidad configurada.
8. Crear auditoria sugerida, digitar conteos y cerrar con un motivo de ajuste seleccionado.
9. Confirmar que la diferencia queda en kardex.

## Consultas utiles

```sql
select nombre, stock_actual, stock_minimo, presentacion_compra, factor_compra
from public.productos
order by nombre;

select p.nombre, mi.tipo, mi.cantidad, mi.stock_resultante, mi.referencia_tipo, mi.timestamp
from public.movimientos_inventario mi
join public.productos p on p.id = mi.producto_id
order by mi.timestamp desc
limit 30;

select c.nombre as combo, p.nombre as producto, ci.cantidad
from public.combo_items ci
join public.combos c on c.id = ci.combo_id
join public.productos p on p.id = ci.producto_id
where ci.activo = true
order by c.nombre, p.nombre;

select * from public.v_alertas_stock_bajo;
select * from public.v_candidatos_auditoria limit 10;
```

## Test RLS local

```bash
supabase test db --local tests/rls/f3.sql
```

## Criterios F3 cubiertos

- Comprar 2 presentaciones x24 suma 48 unidades al stock.
- Vender un combo descuenta cada componente por unidad.
- Ajustes y auditorias exigen motivo y quedan en `movimientos_inventario` con usuario y timestamp.
- Mesero y caja no pueden registrar compras.
- Cambios de precio generan `historial_precios` y `log_auditoria`.
