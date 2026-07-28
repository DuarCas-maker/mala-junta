-- F1 ajuste solicitado - PIN plano en perfiles.
-- Nota: pin_hash no se puede revertir a PIN real. Para meseros existentes sin PIN claro
-- se asigna '0000' temporalmente y debe actualizarse manualmente si aplica.

alter table public.perfiles drop constraint if exists mesero_pin_requerido;
alter table public.perfiles drop constraint if exists pin_solo_mesero;
alter table public.perfiles drop constraint if exists pin_formato_4_digitos;
alter table public.perfiles add column if not exists pin text;

update public.perfiles
set pin = case usuario_login::text
  when 'mesero1' then '1111'
  when 'mesero2' then '2222'
  when 'mesero3' then '3333'
  else coalesce(pin, '0000')
end
where rol = 'mesero';

update public.perfiles
set pin = null
where rol <> 'mesero';

alter table public.perfiles
  add constraint mesero_pin_requerido check (rol <> 'mesero' or pin is not null),
  add constraint pin_formato_4_digitos check (pin is null or pin ~ '^[0-9]{4}$'),
  add constraint pin_solo_mesero check (rol = 'mesero' or pin is null);

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

  insert into public.perfiles (auth_user_id, nombre, usuario_login, rol, pin, activo)
  values (p_auth_user_id, trim(p_nombre), v_usuario_login, 'mesero', p_pin, true)
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

alter table public.perfiles drop column if exists pin_hash;

grant execute on function public.crear_mesero(text, text, text, uuid) to authenticated;
