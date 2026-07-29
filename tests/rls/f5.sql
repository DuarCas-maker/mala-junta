begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);

select throws_ok(
  $$ select public.resumen_metricas_admin(current_date - 30, current_date) $$,
  '42501',
  'solo_admin_lee_metricas',
  'Mesero no lee resumen de metricas admin'
);

create temp table f5_pedido as
select public.crear_pedido_rapido(
  null,
  jsonb_build_array(jsonb_build_object('producto_id', (select id from public.productos where codigo_interno = 'BEB-AGUA'), 'cantidad', 1)),
  'Pedido F5 metricas'
) as pedido_id;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.exportar_metricas_csv('productos', current_date - 30, current_date) $$,
  '42501',
  'solo_admin_exporta_metricas',
  'Caja no exporta metricas de rentabilidad'
);

select lives_ok(
  $$ select public.cambiar_estado_pedido((select pedido_id from f5_pedido), 'en_preparacion') $$,
  'Caja marca pedido en preparacion'
);
select lives_ok(
  $$ select public.cambiar_estado_pedido((select pedido_id from f5_pedido), 'entregado') $$,
  'Caja marca pedido entregado'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select isnt(public.resumen_metricas_admin(current_date - 30, current_date), null, 'Admin lee resumen de metricas');

select ok(
  exists (
    select 1
    from public.v_metricas_lineas_venta
    where pedido_id = (select pedido_id from f5_pedido)
  ),
  'Pedido aparece en lineas de venta metricas'
);

select is(
  (select margen_estimado from public.v_metricas_lineas_venta where pedido_id = (select pedido_id from f5_pedido) limit 1),
  (select ingreso - costo_estimado from public.v_metricas_lineas_venta where pedido_id = (select pedido_id from f5_pedido) limit 1),
  'Margen por linea es ventas menos costo'
);

select ok(
  (select minutos_preparacion from public.v_metricas_tiempos_preparacion where pedido_id = (select pedido_id from f5_pedido) limit 1) >= 0,
  'Tiempo de preparacion se calcula de enviado a entregado'
);

select like(
  public.exportar_metricas_csv('productos', current_date - 30, current_date),
  'item,categoria,unidades,ventas,costo,margen,margen_pct%',
  'Export CSV incluye encabezado de productos'
);

select * from finish();
rollback;
