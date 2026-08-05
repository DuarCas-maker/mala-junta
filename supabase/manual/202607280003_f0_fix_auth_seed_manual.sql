-- F0 fix: repara usuarios Auth seed para login local/dev.
-- Ejecutar en Supabase Studio > SQL Editor.

create extension if not exists pgcrypto;

-- 1) Asegura/actualiza usuarios Auth con contrasenas conocidas.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@malajunta.local', crypt('Admin1234!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"nombre":"Administrador"}'::jsonb, false),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'caja@malajunta.local', crypt('Caja1234!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"nombre":"Caja"}'::jsonb, false),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mesero1@mesero.malajunta.local', crypt('1111', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"nombre":"Mesero 1"}'::jsonb, false),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mesero2@mesero.malajunta.local', crypt('2222', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"nombre":"Mesero 2"}'::jsonb, false),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mesero3@mesero.malajunta.local', crypt('3333', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"nombre":"Mesero 3"}'::jsonb, false)
on conflict (id) do update set
  aud = excluded.aud,
  role = excluded.role,
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = now(),
  updated_at = now(),
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  is_super_admin = false;

-- 2) Asegura identidades email. La columna id en GoTrue puede variar de tipo entre versiones;
-- usamos texto casteado dinamicamente para que funcione en self-hosted reciente.
do $$
declare
  v_id_type text;
begin
  select udt_name into v_id_type
  from information_schema.columns
  where table_schema = 'auth'
    and table_name = 'identities'
    and column_name = 'id';

  if v_id_type = 'uuid' then
    execute $sql$
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      values
        ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@malajunta.local"}'::jsonb, 'email', 'admin@malajunta.local', now(), now(), now()),
        ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, '{"sub":"00000000-0000-0000-0000-000000000002","email":"caja@malajunta.local"}'::jsonb, 'email', 'caja@malajunta.local', now(), now(), now()),
        ('00000000-0000-0000-0000-000000000111'::uuid, '00000000-0000-0000-0000-000000000011'::uuid, '{"sub":"00000000-0000-0000-0000-000000000011","email":"mesero1@mesero.malajunta.local"}'::jsonb, 'email', 'mesero1@mesero.malajunta.local', now(), now(), now()),
        ('00000000-0000-0000-0000-000000000112'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, '{"sub":"00000000-0000-0000-0000-000000000012","email":"mesero2@mesero.malajunta.local"}'::jsonb, 'email', 'mesero2@mesero.malajunta.local', now(), now(), now()),
        ('00000000-0000-0000-0000-000000000113'::uuid, '00000000-0000-0000-0000-000000000013'::uuid, '{"sub":"00000000-0000-0000-0000-000000000013","email":"mesero3@mesero.malajunta.local"}'::jsonb, 'email', 'mesero3@mesero.malajunta.local', now(), now(), now())
      on conflict (provider, provider_id) do update set
        user_id = excluded.user_id,
        identity_data = excluded.identity_data,
        updated_at = now()
    $sql$;
  else
    execute $sql$
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      values
        ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001'::uuid, '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@malajunta.local"}'::jsonb, 'email', 'admin@malajunta.local', now(), now(), now()),
        ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000002'::uuid, '{"sub":"00000000-0000-0000-0000-000000000002","email":"caja@malajunta.local"}'::jsonb, 'email', 'caja@malajunta.local', now(), now(), now()),
        ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000011'::uuid, '{"sub":"00000000-0000-0000-0000-000000000011","email":"mesero1@mesero.malajunta.local"}'::jsonb, 'email', 'mesero1@mesero.malajunta.local', now(), now(), now()),
        ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000012'::uuid, '{"sub":"00000000-0000-0000-0000-000000000012","email":"mesero2@mesero.malajunta.local"}'::jsonb, 'email', 'mesero2@mesero.malajunta.local', now(), now(), now()),
        ('00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-000000000013'::uuid, '{"sub":"00000000-0000-0000-0000-000000000013","email":"mesero3@mesero.malajunta.local"}'::jsonb, 'email', 'mesero3@mesero.malajunta.local', now(), now(), now())
      on conflict (provider, provider_id) do update set
        user_id = excluded.user_id,
        identity_data = excluded.identity_data,
        updated_at = now()
    $sql$;
  end if;
end $$;

-- 3) Verificacion segura: no muestra hashes ni secretos.
select
  u.email,
  u.email_confirmed_at is not null as email_confirmado,
  u.encrypted_password is not null as tiene_password,
  p.rol,
  p.activo
from auth.users u
left join public.perfiles p on p.auth_user_id = u.id
where u.email in (
  'admin@malajunta.local',
  'caja@malajunta.local',
  'mesero1@mesero.malajunta.local',
  'mesero2@mesero.malajunta.local',
  'mesero3@mesero.malajunta.local'
)
order by u.email;
