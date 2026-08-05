begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select is(public.rol_actual()::text, 'mesero', 'Mesero autenticado resuelve su rol');
select throws_ok(
  $$ select public.crear_mesero('Mesero Prohibido', '4444') $$,
  '42501',
  'solo_admin_puede_crear_meseros',
  'Mesero no puede crear usuarios'
);
select throws_ok(
  $$ update public.parametros set valor = '11'::jsonb where clave = 'propina_sugerida_pct' $$,
  '42501',
  null,
  'Mesero no puede modificar parametros'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(public.rol_actual()::text, 'caja', 'Caja autenticada resuelve su rol');
select throws_ok(
  $$ select public.desactivar_usuario('10000000-0000-0000-0000-000000000011') $$,
  '42501',
  'solo_admin_puede_desactivar_usuarios',
  'Caja no puede desactivar usuarios'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(public.rol_actual()::text, 'admin', 'Admin autenticado resuelve su rol');
select lives_ok(
  $$ select public.crear_mesero('Mesero Test F0', '4444', 'meserotestf0', null) $$,
  'Admin puede crear mesero por RPC'
);
select lives_ok(
  $$ select public.desactivar_usuario(id) from public.perfiles where usuario_login = 'meserotestf0' $$,
  'Admin puede desactivar mesero por RPC'
);

select throws_ok(
  $$ delete from public.motivos where texto = 'Producto agotado' $$,
  '42501',
  null,
  'Admin tampoco borra motivos fisicamente'
);
select * from finish();
rollback;
