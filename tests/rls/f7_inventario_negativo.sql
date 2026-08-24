begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

create temp table f7_ctx as
select
  (select id from public.productos where codigo_interno = 'CER-POKER') as poker_id,
  (select id from public.productos where codigo_interno = 'LIC-RON-CALDAS') as ron_id,
  (select id from public.productos where codigo_interno = 'BEB-AGUA') as agua_id,
  (select id from public.proveedores order by nombre limit 1) as proveedor_id,
  (select id from public.motivos where tipo = 'ajuste_inventario' order by texto limit 1) as motivo_id,
  (select id from public.combos where nombre = 'Combo Ron + 6 cervezas') as combo_id;

update public.productos
set stock_actual = 0
where id in (
  (select poker_id from f7_ctx),
  (select ron_id from f7_ctx),
  (select agua_id from f7_ctx)
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);

select lives_ok(
  $$ select public.crear_pedido_rapido(
    null,
    jsonb_build_array(jsonb_build_object('producto_id', (select poker_id from f7_ctx), 'cantidad', 3)),
    'Pedido producto sin stock F7'
  ) $$,
  'Mesero vende producto sin stock'
);

select is(
  (select stock_actual from public.productos where id = (select poker_id from f7_ctx)),
  -3,
  'Producto queda en deficit -3'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ select public.registrar_compra(
    (select proveedor_id from f7_ctx),
    jsonb_build_array(jsonb_build_object(
      'producto_id', (select poker_id from f7_ctx),
      'modo', 'presentacion',
      'cantidad_ingresada', 1
    )),
    current_date,
    'Compra que cubre deficit F7'
  ) $$,
  'Compra desde deficit se registra'
);

select is(
  (select stock_actual from public.productos where id = (select poker_id from f7_ctx)),
  21,
  'Compra de 24 desde -3 deja 21'
);

update public.productos
set stock_actual = 0
where id in ((select poker_id from f7_ctx), (select ron_id from f7_ctx));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);

select lives_ok(
  $$ select public.crear_pedido_rapido(
    null,
    jsonb_build_array(jsonb_build_object('combo_id', (select combo_id from f7_ctx), 'cantidad', 1)),
    'Pedido combo sin stock F7'
  ) $$,
  'Mesero vende combo sin stock de componentes'
);

select is(
  (select stock_actual from public.productos where id = (select poker_id from f7_ctx)),
  -6,
  'Combo descuenta componente cerveza hasta -6'
);

select is(
  (select stock_actual from public.productos where id = (select ron_id from f7_ctx)),
  -1,
  'Combo descuenta componente licor hasta -1'
);

select ok(
  exists (
    select 1
    from public.v_catalogo_items_stock
    where tipo_item = 'combo'
      and item_id = (select combo_id from f7_ctx)
      and stock_disponible = -1
  ),
  'Stock derivado del combo refleja deficit'
);

update public.productos
set stock_actual = -3
where id = (select agua_id from f7_ctx);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

create temp table f7_auditoria as
select (public.crear_auditoria_inventario(jsonb_build_array((select agua_id::text from f7_ctx)), 'Auditoria desde deficit F7')).id as auditoria_id;

select lives_ok(
  $$ select public.registrar_conteo_auditoria(
    (select auditoria_id from f7_auditoria),
    jsonb_build_array(jsonb_build_object('producto_id', (select agua_id from f7_ctx), 'contado', 24))
  ) $$,
  'Admin registra conteo real desde deficit'
);

select lives_ok(
  $$ select public.cerrar_auditoria_inventario(
    (select auditoria_id from f7_auditoria),
    jsonb_build_array(jsonb_build_object('producto_id', (select agua_id from f7_ctx), 'tipo', 'ajuste', 'motivo_id', (select motivo_id from f7_ctx)))
  ) $$,
  'Auditoria cierra con ajuste positivo desde deficit'
);

select is(
  (select stock_actual from public.productos where id = (select agua_id from f7_ctx)),
  24,
  'Conteo fisico prevalece y deja stock final 24'
);

select * from finish();
rollback;
