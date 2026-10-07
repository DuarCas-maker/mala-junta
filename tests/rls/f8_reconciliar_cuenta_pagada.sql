begin;

create extension if not exists pgtap with schema extensions;
select plan(8);
select set_config('app.f8_test_tag', gen_random_uuid()::text, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);

select lives_ok(
  $$ select public.crear_pedido_rapido(
    (select id from public.mesas where activa = true order by nombre limit 1),
    jsonb_build_array(jsonb_build_object(
      'producto_id', (select id from public.productos where activo = true order by nombre limit 1),
      'cantidad', 1
    )),
    current_setting('app.f8_test_tag')
  ) $$,
  'Mesero crea la cuenta que se reconciliara'
);

select throws_ok(
  $$ select public.cerrar_cuenta_pagada(
    (select cuenta_id from public.pedidos where notas = current_setting('app.f8_test_tag') limit 1)
  ) $$,
  '42501',
  'solo_caja_o_admin_cierra_cuentas_pagadas',
  'Mesero no puede cerrar una cuenta cubierta'
);

reset role;

insert into public.pagos (cuenta_id, medio, monto, usuario_id)
select
  p.cuenta_id,
  'efectivo'::public.medio_pago,
  c.total_cuenta + 36100,
  '10000000-0000-0000-0000-000000000002'::uuid
from public.pedidos p
join public.cuentas c on c.id = p.cuenta_id
where p.notas = current_setting('app.f8_test_tag');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

select lives_ok(
  $$ select public.cerrar_cuenta_pagada(
    (select cuenta_id from public.pedidos where notas = current_setting('app.f8_test_tag') limit 1)
  ) $$,
  'Caja reconcilia la cuenta sin crear otro pago'
);

select is(
  (select c.estado::text from public.cuentas c join public.pedidos p on p.cuenta_id = c.id where p.notas = current_setting('app.f8_test_tag') limit 1),
  'pagada',
  'La cuenta queda pagada'
);

select is(
  (select sum(pg.monto)::numeric from public.pagos pg join public.pedidos p on p.cuenta_id = pg.cuenta_id where p.notas = current_setting('app.f8_test_tag') and not pg.anulado),
  (select (c.total_cuenta + 36100)::numeric from public.cuentas c join public.pedidos p on p.cuenta_id = c.id where p.notas = current_setting('app.f8_test_tag') limit 1),
  'La reconciliacion conserva intacto el pago existente'
);

select is(
  (select count(*)::int from public.pedido_items pi join public.pedidos p on p.id = pi.pedido_id where p.notas = current_setting('app.f8_test_tag') and pi.estado <> 'anulado'),
  1,
  'La reconciliacion conserva los items del pedido'
);

select ok(
  not exists (
    select 1
    from public.cuentas c
    join public.pedidos p on p.cuenta_id = c.id
    where p.notas = current_setting('app.f8_test_tag')
      and c.estado in ('abierta', 'por_cobrar', 'pagada_parcial')
  ),
  'La mesa deja de tener una cuenta activa'
);

-- La auditoria solo es visible para admin; caja no tiene permiso de lectura.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select ok(
  exists (
    select 1
    from public.log_auditoria la
    join public.pedidos p on p.cuenta_id = la.entidad_id
    where p.notas = current_setting('app.f8_test_tag')
      and la.accion = 'cerrar_cuenta_pagada'
  ),
  'El cierre queda registrado en auditoria'
);

select * from finish();
rollback;
