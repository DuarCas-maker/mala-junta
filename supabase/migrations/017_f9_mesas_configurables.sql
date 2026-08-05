-- F9 - Configuracion simple del numero de mesas visibles en pedidos.

create or replace function public.configurar_numero_mesas(p_total int)
returns table(id uuid, nombre text, zona text, es_vip boolean, activa boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_i int;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_configurar_mesas' using errcode = '42501';
  end if;

  if p_total is null or p_total < 1 or p_total > 200 then
    raise exception 'numero_mesas_invalido' using errcode = '22023';
  end if;

  update public.mesas
  set activa = false,
      updated_at = now()
  where activa = true;

  for v_i in 1..p_total loop
    insert into public.mesas (nombre, zona, es_vip, capacidad, activa)
    values (format('Mesa %s', v_i), 'Principal', false, 4, true)
    on conflict (nombre) do update
      set zona = 'Principal',
          es_vip = false,
          activa = true,
          updated_at = now();
  end loop;

  insert into public.parametros (clave, valor, descripcion)
  values ('numero_mesas', to_jsonb(p_total), 'Numero de mesas visibles para tomar pedidos')
  on conflict (clave) do update
    set valor = excluded.valor,
        descripcion = excluded.descripcion,
        updated_at = now();

  return query
  select m.id, m.nombre, m.zona, m.es_vip, m.activa
  from public.mesas m
  where m.activa = true
  order by nullif(regexp_replace(m.nombre, '\D', '', 'g'), '')::int nulls last, m.nombre;
end;
$$;

grant execute on function public.configurar_numero_mesas(int) to authenticated;