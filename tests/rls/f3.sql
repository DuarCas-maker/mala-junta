begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

create temp table f3_ctx as
select
  (select id from public.productos where codigo_interno = 'CER-POKER') as poker_id,
  (select id from public.productos where codigo_interno = 'LIC-RON-CALDAS') as ron_id,
  (select id from public.productos where codigo_interno = 'BEB-AGUA') as agua_id,
  (select id from public.proveedores order by nombre limit 1) as proveedor_id,
  (select id from public.motivos where tipo = 'ajuste_inventario' order by texto limit 1) as motivo_id,
  (select stock_actual from public.productos where codigo_interno = 'CER-POKER') as poker_stock,
  (select stock_actual from public.productos where codigo_interno = 'LIC-RON-CALDAS') as ron_stock,
  (select stock_actual from public.productos where codigo_interno = 'BEB-AGUA') as agua_stock,
  (select id from public.combos where nombre = 'Combo Ron + 6 cervezas') as combo_id;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok(
  $$ select public.registrar_compra(null, '[]'::jsonb, current_date, null) $$,
  '42501',
  'solo_admin_registra_compras',
  'Mesero no registra compras'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.registrar_compra(null, '[]'::jsonb, current_date, null) $$,
  '42501',
  'solo_admin_registra_compras',
  'Caja no registra compras'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select public.registrar_compra(
    (select proveedor_id from f3_ctx),
    jsonb_build_array(jsonb_build_object(
      'producto_id', (select poker_id from f3_ctx),
      'modo', 'presentacion',
      'cantidad_ingresada', 2,
      'factor_aplicado', 24,
      'costo_unitario', 4300
    )),
    current_date,
    'Compra test F3'
  ) $$,
  'Admin registra compra por presentacion'
);

select is(
  (select stock_actual from public.productos where id = (select poker_id from f3_ctx)),
  (select poker_stock + 48 from f3_ctx),
  'Comprar 2 cajas x24 suma 48 unidades'
);

create temp table f3_combo_stock as
select
  (select stock_actual from public.productos where id = (select poker_id from f3_ctx)) as poker_stock,
  (select stock_actual from public.productos where id = (select ron_id from f3_ctx)) as ron_stock;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select lives_ok(
  $$ select public.crear_pedido_rapido(
    null,
    jsonb_build_array(jsonb_build_object('combo_id', (select combo_id from f3_ctx), 'cantidad', 1)),
    'Pedido combo test F3'
  ) $$,
  'Mesero vende combo'
);

select is(
  (select stock_actual from public.productos where id = (select poker_id from f3_ctx)),
  (select poker_stock - 6 from f3_combo_stock),
  'Combo descuenta 6 cervezas componente'
);

select is(
  (select stock_actual from public.productos where id = (select ron_id from f3_ctx)),
  (select ron_stock - 1 from f3_combo_stock),
  'Combo descuenta 1 botella componente'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
create temp table f3_auditoria as
select (public.crear_auditoria_inventario(jsonb_build_array((select agua_id::text from f3_ctx)), 'Auditoria test F3')).id as auditoria_id;

select isnt((select auditoria_id from f3_auditoria), null, 'Admin crea auditoria corta');

select lives_ok(
  $$ select public.registrar_conteo_auditoria(
    (select auditoria_id from f3_auditoria),
    jsonb_build_array(jsonb_build_object('producto_id', (select agua_id from f3_ctx), 'contado', (select agua_stock - 1 from f3_ctx)))
  ) $$,
  'Admin registra conteo fisico'
);

select throws_ok(
  $$ select public.cerrar_auditoria_inventario((select auditoria_id from f3_auditoria), '[]'::jsonb) $$,
  '22023',
  'diferencia_requiere_resolucion',
  'Auditoria con diferencia exige resolucion'
);

select lives_ok(
  $$ select public.cerrar_auditoria_inventario(
    (select auditoria_id from f3_auditoria),
    jsonb_build_array(jsonb_build_object('producto_id', (select agua_id from f3_ctx), 'tipo', 'ajuste', 'motivo_id', (select motivo_id from f3_ctx)))
  ) $$,
  'Auditoria cierra con motivo y ajuste'
);

select is(
  (select stock_actual from public.productos where id = (select agua_id from f3_ctx)),
  (select agua_stock - 1 from f3_ctx),
  'Auditoria ajusta stock teorico al conteo'
);

select ok(
  exists (
    select 1
    from public.movimientos_inventario
    where producto_id = (select agua_id from f3_ctx)
      and referencia_tipo = 'auditoria_item'
      and motivo_id = (select motivo_id from f3_ctx)
  ),
  'Diferencia de auditoria queda en kardex con motivo'
);

select * from finish();
rollback;
