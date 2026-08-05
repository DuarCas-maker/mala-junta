begin;

create extension if not exists pgtap with schema extensions;
select plan(13);
select set_config('app.f1_test_tag', gen_random_uuid()::text, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select is(public.rol_actual()::text, 'mesero', 'Mesero autenticado resuelve su rol');

select lives_ok(
  $$ select public.crear_pedido_rapido(
    (select id from public.mesas where activa = true order by nombre limit 1),
    jsonb_build_array(jsonb_build_object('producto_id', (select id from public.productos where activo = true order by nombre limit 1), 'cantidad', 1)),
    current_setting('app.f1_test_tag') || ':pago'
  ) $$,
  'Mesero puede crear pedido por RPC'
);

select lives_ok(
  $$ select public.crear_pedido_rapido(
    null,
    jsonb_build_array(jsonb_build_object('producto_id', (select id from public.productos where activo = true order by nombre limit 1), 'cantidad', 1)),
    current_setting('app.f1_test_tag') || ':anulacion'
  ) $$,
  'Mesero puede crear pedido directo por RPC'
);

select throws_ok(
  $$ select public.cambiar_estado_pedido(
    (select id from public.pedidos where notas = current_setting('app.f1_test_tag') || ':pago' order by enviado_at desc limit 1),
    'entregado'::public.estado_pedido
  ) $$,
  '42501',
  'solo_caja_o_admin_cambia_pedidos',
  'Mesero no puede cambiar estado de pedidos'
);

select throws_ok(
  $$ select public.registrar_pagos_cuenta(
    (select cuenta_id from public.pedidos where notas = current_setting('app.f1_test_tag') || ':pago' order by enviado_at desc limit 1),
    '[]'::jsonb,
    0,
    false,
    null
  ) $$,
  '42501',
  'solo_caja_o_admin_registra_pagos',
  'Mesero no puede registrar pagos'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(public.rol_actual()::text, 'caja', 'Caja autenticada resuelve su rol');

select lives_ok(
  $$ select public.cambiar_estado_pedido(
    (select id from public.pedidos where notas = current_setting('app.f1_test_tag') || ':pago' order by enviado_at desc limit 1),
    'entregado'::public.estado_pedido
  ) $$,
  'Caja puede cambiar estado de pedido'
);

select lives_ok(
  $$ select public.registrar_pagos_cuenta(
    (select cuenta_id from public.pedidos where notas = current_setting('app.f1_test_tag') || ':pago' order by enviado_at desc limit 1),
    jsonb_build_array(jsonb_build_object(
      'medio', 'efectivo',
      'monto', (select total_cuenta from public.cuentas where id = (select cuenta_id from public.pedidos where notas = current_setting('app.f1_test_tag') || ':pago' order by enviado_at desc limit 1))
    )),
    0,
    false,
    null
  ) $$,
  'Caja puede registrar pago mixto/base por RPC'
);

select lives_ok(
  $$ select public.anular_pedido(
    (select id from public.pedidos where notas = current_setting('app.f1_test_tag') || ':anulacion' order by enviado_at desc limit 1),
    (select id from public.motivos where tipo = 'anulacion' and activo = true order by texto limit 1),
    'Prueba RLS F1'
  ) $$,
  'Caja puede anular con motivo'
);

select throws_ok(
  $$ delete from public.pedidos where notas = current_setting('app.f1_test_tag') || ':pago' $$,
  '42501',
  null,
  'Caja no puede borrar pedidos fisicamente'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select is((select count(*)::int from public.pagos), 0, 'Mesero no puede leer pagos');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(public.rol_actual()::text, 'admin', 'Admin autenticado resuelve su rol');
select throws_ok(
  $$ delete from public.cuentas where id = (select cuenta_id from public.pedidos where notas = current_setting('app.f1_test_tag') || ':pago' order by enviado_at desc limit 1) $$,
  '42501',
  null,
  'Admin tampoco borra cuentas fisicamente'
);

select * from finish();
rollback;
