create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.rol_usuario as enum ('admin', 'caja', 'mesero');
create type public.tipo_motivo as enum ('modificacion', 'anulacion', 'ajuste_inventario', 'retiro_caja');

create table public.perfiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  nombre text not null check (char_length(trim(nombre)) >= 2),
  usuario_login citext unique,
  rol public.rol_usuario not null,
  pin_hash text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mesero_pin_requerido check (rol <> 'mesero' or pin_hash is not null),
  constraint mesero_usuario_requerido check (rol <> 'mesero' or usuario_login is not null),
  constraint pin_solo_mesero check (rol = 'mesero' or pin_hash is null)
);

create table public.parametros (
  clave text primary key,
  valor jsonb not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.motivos (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_motivo not null,
  texto text not null check (char_length(trim(texto)) >= 3),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tipo, texto)
);

create table public.log_auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.perfiles(id) on delete restrict,
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  detalle jsonb not null default '{}'::jsonb,
  timestamp timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger perfiles_set_updated_at
before update on public.perfiles
for each row execute function public.set_updated_at();

create trigger parametros_set_updated_at
before update on public.parametros
for each row execute function public.set_updated_at();

create trigger motivos_set_updated_at
before update on public.motivos
for each row execute function public.set_updated_at();

create or replace function public.perfil_actual_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.perfiles p
  where p.auth_user_id = auth.uid()
    and p.activo = true
  limit 1;
$$;

create or replace function public.rol_actual()
returns public.rol_usuario
language sql
stable
security definer
set search_path = public
as $$
  select p.rol
  from public.perfiles p
  where p.auth_user_id = auth.uid()
    and p.activo = true
  limit 1;
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.rol_actual() = 'admin'::public.rol_usuario, false);
$$;

create or replace function public.es_caja_o_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.rol_actual() in ('admin'::public.rol_usuario, 'caja'::public.rol_usuario), false);
$$;

create or replace function public.dia_negocio(p_timestamp timestamptz default now())
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_corte time := '06:00'::time;
  v_local timestamp;
begin
  select (valor #>> '{}')::time
    into v_corte
  from public.parametros
  where clave = 'hora_corte_dia_negocio';

  v_corte := coalesce(v_corte, '06:00'::time);

  v_local := p_timestamp at time zone 'America/Bogota';

  if v_local::time < v_corte then
    return (v_local::date - 1);
  end if;

  return v_local::date;
end;
$$;

create or replace function public.crear_mesero(
  p_nombre text,
  p_pin text,
  p_usuario_login text default null,
  p_auth_user_id uuid default null
)
returns public.perfiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil public.perfiles;
  v_usuario_login citext;
  v_admin_id uuid;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_puede_crear_meseros' using errcode = '42501';
  end if;

  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'pin_debe_tener_4_digitos' using errcode = '22023';
  end if;

  v_usuario_login := coalesce(nullif(trim(p_usuario_login), ''), lower(regexp_replace(trim(p_nombre), '\s+', '', 'g')));
  v_admin_id := public.perfil_actual_id();

  insert into public.perfiles (auth_user_id, nombre, usuario_login, rol, pin_hash, activo)
  values (p_auth_user_id, trim(p_nombre), v_usuario_login, 'mesero', crypt(p_pin, gen_salt('bf')), true)
  returning * into v_perfil;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_admin_id,
    'crear_mesero',
    'perfiles',
    v_perfil.id,
    jsonb_build_object('nombre', v_perfil.nombre, 'usuario_login', v_perfil.usuario_login)
  );

  return v_perfil;
end;
$$;

create or replace function public.desactivar_usuario(p_perfil_id uuid)
returns public.perfiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil public.perfiles;
  v_admin_id uuid;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_puede_desactivar_usuarios' using errcode = '42501';
  end if;

  v_admin_id := public.perfil_actual_id();

  update public.perfiles
  set activo = false
  where id = p_perfil_id
  returning * into v_perfil;

  if v_perfil.id is null then
    raise exception 'usuario_no_encontrado' using errcode = '02000';
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_admin_id,
    'desactivar_usuario',
    'perfiles',
    v_perfil.id,
    jsonb_build_object('nombre', v_perfil.nombre, 'rol', v_perfil.rol)
  );

  return v_perfil;
end;
$$;

alter table public.perfiles enable row level security;
alter table public.parametros enable row level security;
alter table public.motivos enable row level security;
alter table public.log_auditoria enable row level security;

create policy perfiles_select_autenticados
on public.perfiles for select
to authenticated
using (auth_user_id = auth.uid() or public.es_caja_o_admin());

create policy parametros_select_autenticados
on public.parametros for select
to authenticated
using (true);

create policy parametros_admin_inserta
on public.parametros for insert
to authenticated
with check (public.es_admin());

create policy parametros_admin_actualiza
on public.parametros for update
to authenticated
using (public.es_admin())
with check (public.es_admin());

create policy motivos_select_autenticados
on public.motivos for select
to authenticated
using (true);

create policy motivos_admin_inserta
on public.motivos for insert
to authenticated
with check (public.es_admin());

create policy motivos_admin_actualiza
on public.motivos for update
to authenticated
using (public.es_admin())
with check (public.es_admin());

create policy log_auditoria_admin_lee
on public.log_auditoria for select
to authenticated
using (public.es_admin());

create policy log_auditoria_insert_sistema
on public.log_auditoria for insert
to authenticated
with check (usuario_id = public.perfil_actual_id() or public.es_admin());

create policy log_auditoria_no_update
on public.log_auditoria for update
to authenticated
using (false)
with check (false);

create policy log_auditoria_no_delete
on public.log_auditoria for delete
to authenticated
using (false);

grant usage on schema public to anon, authenticated;
grant select on public.perfiles, public.parametros, public.motivos to authenticated;
grant select, insert on public.log_auditoria to authenticated;
grant insert, update on public.parametros, public.motivos to authenticated;
grant execute on function public.perfil_actual_id() to authenticated;
grant execute on function public.rol_actual() to authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.es_caja_o_admin() to authenticated;
grant execute on function public.dia_negocio(timestamptz) to authenticated, anon;
grant execute on function public.crear_mesero(text, text, text, uuid) to authenticated;
grant execute on function public.desactivar_usuario(uuid) to authenticated;
