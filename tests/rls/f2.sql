begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok(
  $$ select public.abrir_caja(50000) $$,
  '42501',
  'solo_caja_o_admin_abre_caja',
  'Mesero no puede abrir caja'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$ select public.abrir_caja(50000) $$,
  'Caja puede abrir caja con base'
);
select throws_ok(
  $$ select public.abrir_caja(10000) $$,
  '23505',
  'ya_existe_caja_abierta',
  'No se permite doble caja abierta'
);
select lives_ok(
  $$ select public.registrar_retiro_caja(10000, (select id from public.motivos where tipo = 'retiro_caja' order by texto limit 1), 'Prueba retiro', null) $$,
  'Caja puede registrar retiro con motivo'
);
select isnt((select public.resumen_caja_actual() ->> 'requiere_apertura'), 'true', 'Resumen detecta caja abierta');
select throws_ok(
  $$ select public.cerrar_caja(1, 'Faltante prueba') $$,
  '42501',
  'cierre_descuadrado_requiere_admin',
  'Caja no puede cerrar descuadrado'
);
select lives_ok(
  $$ select public.cerrar_caja(40000, null) $$,
  'Caja puede cerrar exacto'
);
select throws_ok(
  $$ select public.registrar_retiro_caja(1000, null, 'Sin caja', null) $$,
  '22023',
  'caja_no_abierta',
  'No se registran retiros sin caja abierta'
);

select * from finish();
rollback;
