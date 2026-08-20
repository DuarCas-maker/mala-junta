-- F33: configurar mesas numeradas sin afectar mesas VIP o zonas especiales.

create or replace function public.configurar_numero_mesas(p_total int)
returns table(id uuid, nombre text, zona text, es_vip boolean, activa boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_i int;
  v_nombre text;
  v_mesa_id uuid;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_configurar_mesas' using errcode = '42501';
  end if;

  if p_total is null or p_total < 1 or p_total > 200 then
    raise exception 'numero_mesas_invalido' using errcode = '22023';
  end if;

  with mesas_duplicadas as (
    select
      m.id,
      row_number() over (partition by m.nombre order by m.created_at desc, m.id desc) as posicion
    from public.mesas m
    where m.nombre ~* '^Mesa\s+\d+$'
  )
  update public.mesas m
  set activa = false,
      updated_at = now()
  from mesas_duplicadas d
  where m.id = d.id
    and d.posicion > 1;

  update public.mesas m
  set activa = false,
      updated_at = now()
  where m.nombre ~* '^Mesa\s+\d+$'
    and nullif(regexp_replace(m.nombre, '\D', '', 'g'), '')::int > p_total;

  for v_i in 1..p_total loop
    v_nombre := format('Mesa %s', v_i);

    select m.id into v_mesa_id
    from public.mesas m
    where m.nombre = v_nombre
    order by m.created_at desc, m.id desc
    limit 1;

    if v_mesa_id is null then
      insert into public.mesas (nombre, zona, es_vip, capacidad, activa)
      values (v_nombre, 'Principal', false, 4, true);
    else
      update public.mesas
      set zona = 'Principal',
          es_vip = false,
          activa = true,
          updated_at = now()
      where public.mesas.id = v_mesa_id;
    end if;
  end loop;

  insert into public.parametros (clave, valor, descripcion)
  values ('numero_mesas', to_jsonb(p_total), 'Numero de mesas numeradas visibles para tomar pedidos')
  on conflict (clave) do update
    set valor = excluded.valor,
        descripcion = excluded.descripcion,
        updated_at = now();

  return query
  select m.id, m.nombre, m.zona, m.es_vip, m.activa
  from public.mesas m
  where m.activa = true
  order by
    case when m.nombre ~* '^Mesa\s+\d+$' then 0 else 1 end,
    nullif(regexp_replace(m.nombre, '\D', '', 'g'), '')::int nulls last,
    m.nombre;
end;
$$;

grant execute on function public.configurar_numero_mesas(int) to authenticated;
