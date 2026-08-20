-- F34: selector de pedidos con mesas abiertas y nickname de cuenta.

create or replace function public.mesas_para_pedidos()
returns table(
  id uuid,
  nombre text,
  zona text,
  es_vip boolean,
  cuenta_id uuid,
  cuenta_estado public.estado_cuenta,
  nickname text,
  ultimo_pedido_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.perfil_actual_id() is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  return query
  select
    m.id,
    m.nombre,
    m.zona,
    m.es_vip,
    c.id as cuenta_id,
    c.estado as cuenta_estado,
    c.nickname,
    stats.ultimo_pedido_at
  from public.mesas m
  left join lateral (
    select c.*
    from public.cuentas c
    where c.mesa_id = m.id
      and c.estado in ('abierta','por_cobrar','pagada_parcial')
    order by c.created_at desc, c.id desc
    limit 1
  ) c on true
  left join lateral (
    select max(p.enviado_at) as ultimo_pedido_at
    from public.pedidos p
    where p.cuenta_id = c.id
      and p.estado <> 'anulado'
  ) stats on true
  where m.activa = true
  order by
    case when c.id is not null then 0 else 1 end,
    case when m.nombre ~* '^Mesa\s+\d+$' then 0 else 1 end,
    nullif(regexp_replace(m.nombre, '\D', '', 'g'), '')::int nulls last,
    m.nombre;
end;
$$;

grant execute on function public.mesas_para_pedidos() to authenticated;
