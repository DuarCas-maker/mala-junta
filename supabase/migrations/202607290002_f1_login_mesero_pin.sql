-- F1 ajuste login mesero - resolver email Auth desde usuario + PIN plano.
-- Permite que la pantalla Mesero PIN valide contra public.perfiles.pin y no dependa
-- de que el email Auth siga exactamente el patron usuario@mesero.malajunta.local.

create or replace function public.email_login_mesero(p_usuario_login text, p_pin text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  if nullif(trim(coalesce(p_usuario_login, '')), '') is null then
    raise exception 'usuario_mesero_requerido' using errcode = '22023';
  end if;

  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'pin_debe_tener_4_digitos' using errcode = '22023';
  end if;

  select u.email into v_email
  from public.perfiles p
  join auth.users u on u.id = p.auth_user_id
  where p.usuario_login = lower(trim(p_usuario_login))::citext
    and p.rol = 'mesero'
    and p.activo = true
    and p.pin = p_pin
  limit 1;

  if v_email is null then
    raise exception 'mesero_o_pin_invalido_o_sin_auth' using errcode = '42501';
  end if;

  return v_email;
end;
$$;


-- Supabase Auth siempre guarda su password interna con hash. Esta sincronizacion
-- toma el PIN plano de public.perfiles y lo deja como password Auth del mesero.
update auth.users u
set encrypted_password = crypt(p.pin, gen_salt('bf')),
    email_confirmed_at = coalesce(u.email_confirmed_at, now()),
    updated_at = now()
from public.perfiles p
where p.auth_user_id = u.id
  and p.rol = 'mesero'
  and p.activo = true
  and p.pin ~ '^[0-9]{4}$';
grant execute on function public.email_login_mesero(text, text) to anon, authenticated;
