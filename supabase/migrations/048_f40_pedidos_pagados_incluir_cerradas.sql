-- F40: pedidos pagados historicos incluye cuentas cerradas tras cierre de caja.

create or replace function public.ultimo_dia_pedidos_pagados()
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fecha date;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_lee_pedidos_pagados' using errcode = '42501';
  end if;

  select max(public.dia_negocio(p.enviado_at))
    into v_fecha
  from public.cuentas c
  join public.pedidos p on p.cuenta_id = c.id
  where c.estado in ('pagada', 'pagada_parcial', 'cerrada')
    and p.estado <> 'anulado'
    and exists (
      select 1
      from public.pedido_items pi
      where pi.pedido_id = p.id
        and pi.estado <> 'anulado'
        and pi.cantidad > 0
    );

  return v_fecha;
end;
$$;

create or replace function public.pedidos_pagados_caja(
  p_fecha date default null,
  p_periodo text default 'dia'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fecha date;
  v_desde date;
  v_hasta date;
  v_periodo text := coalesce(nullif(trim(p_periodo), ''), 'dia');
  v_resultado jsonb;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_lee_pedidos_pagados' using errcode = '42501';
  end if;

  if v_periodo not in ('dia', 'semana', 'mes') then
    raise exception 'periodo_invalido' using errcode = '22023';
  end if;

  v_fecha := coalesce(p_fecha, public.ultimo_dia_pedidos_pagados());

  if v_fecha is null then
    return jsonb_build_object(
      'fecha_base', null,
      'desde', null,
      'hasta', null,
      'periodo', v_periodo,
      'resumen', jsonb_build_object(
        'total_vendido', 0,
        'total_pagado', 0,
        'saldo_pendiente', 0,
        'cuentas_pagadas', 0,
        'cuentas_parciales', 0
      ),
      'pagadas', '[]'::jsonb,
      'parciales', '[]'::jsonb
    );
  end if;

  if v_periodo = 'dia' then
    v_desde := v_fecha;
    v_hasta := v_fecha;
  elsif v_periodo = 'semana' then
    v_desde := v_fecha - (extract(isodow from v_fecha)::int - 1);
    v_hasta := v_desde + 6;
  else
    v_desde := date_trunc('month', v_fecha)::date;
    v_hasta := (date_trunc('month', v_fecha)::date + interval '1 month - 1 day')::date;
  end if;

  with pedidos_rango as (
    select
      c.id as cuenta_id,
      p.id as pedido_id,
      p.enviado_at
    from public.cuentas c
    join public.pedidos p on p.cuenta_id = c.id
    where c.estado in ('pagada', 'pagada_parcial', 'cerrada')
      and p.estado <> 'anulado'
      and public.dia_negocio(p.enviado_at) between v_desde and v_hasta
      and exists (
        select 1
        from public.pedido_items pi
        where pi.pedido_id = p.id
          and pi.estado <> 'anulado'
          and pi.cantidad > 0
      )
    group by c.id, p.id, p.enviado_at
  ),
  cuentas_rango as (
    select
      c.id,
      c.estado,
      case when c.estado = 'pagada_parcial' then 'pagada_parcial' else 'pagada' end as grupo_estado,
      c.total_cuenta,
      c.nickname,
      c.responsable_pendiente,
      c.created_at,
      c.dia_negocio,
      case when m.id is null then null else jsonb_build_object('nombre', m.nombre, 'zona', m.zona) end as mesa,
      coalesce(pagos.total_pagado, 0)::numeric(12,0) as total_pagado,
      coalesce(pedidos.total_vendido, 0)::numeric(12,0) as total_vendido,
      coalesce(pedidos.ultimo_pedido_at, c.created_at) as ultimo_pedido_at
    from public.cuentas c
    join (select distinct cuenta_id from pedidos_rango) cr on cr.cuenta_id = c.id
    left join public.mesas m on m.id = c.mesa_id
    cross join lateral (
      select coalesce(sum(pg.monto), 0)::numeric(12,0) as total_pagado
      from public.pagos pg
      where pg.cuenta_id = c.id
        and not coalesce(pg.anulado, false)
    ) pagos
    cross join lateral (
      select
        coalesce(sum(pi.cantidad * pi.precio_unitario_capturado), 0)::numeric(12,0) as total_vendido,
        max(p.enviado_at) as ultimo_pedido_at
      from pedidos_rango pr
      join public.pedidos p on p.id = pr.pedido_id
      join public.pedido_items pi on pi.pedido_id = p.id
      where pr.cuenta_id = c.id
        and pi.estado <> 'anulado'
        and pi.cantidad > 0
    ) pedidos
  ),
  cuenta_json as (
    select
      cr.estado,
      cr.grupo_estado,
      cr.total_vendido,
      cr.total_pagado,
      greatest(coalesce(cr.total_vendido, 0) - coalesce(cr.total_pagado, 0), 0)::numeric(12,0) as saldo_pendiente,
      jsonb_build_object(
        'id', cr.id,
        'estado', cr.estado,
        'grupo_estado', cr.grupo_estado,
        'dia_negocio', cr.dia_negocio,
        'created_at', cr.created_at,
        'ultimo_pedido_at', cr.ultimo_pedido_at,
        'total_cuenta', cr.total_cuenta,
        'total_vendido', cr.total_vendido,
        'total_pagado', cr.total_pagado,
        'saldo_pendiente', greatest(coalesce(cr.total_vendido, 0) - coalesce(cr.total_pagado, 0), 0),
        'responsable_pendiente', cr.responsable_pendiente,
        'nickname', cr.nickname,
        'mesas', cr.mesa,
        'pedidos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id,
            'estado', p.estado,
            'enviado_at', p.enviado_at,
            'notas', p.notas,
            'mesero', jsonb_build_object('nombre', coalesce(per.nombre, '-')),
            'total', coalesce((
              select sum(pi_total.cantidad * pi_total.precio_unitario_capturado)::numeric(12,0)
              from public.pedido_items pi_total
              where pi_total.pedido_id = p.id
                and pi_total.estado <> 'anulado'
                and pi_total.cantidad > 0
            ), 0),
            'pedido_items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', pi.id,
                'cantidad', pi.cantidad,
                'precio_unitario_capturado', pi.precio_unitario_capturado,
                'estado', pi.estado,
                'productos', case when prd.id is null then null else jsonb_build_object('nombre', prd.nombre) end,
                'combos', case when cmb.id is null then null else jsonb_build_object('nombre', cmb.nombre) end
              ) order by pi.created_at)
              from public.pedido_items pi
              left join public.productos prd on prd.id = pi.producto_id
              left join public.combos cmb on cmb.id = pi.combo_id
              where pi.pedido_id = p.id
                and pi.estado <> 'anulado'
                and pi.cantidad > 0
            ), '[]'::jsonb)
          ) order by p.enviado_at desc)
          from pedidos_rango pr
          join public.pedidos p on p.id = pr.pedido_id
          left join public.perfiles per on per.id = p.mesero_id
          where pr.cuenta_id = cr.id
        ), '[]'::jsonb)
      ) as cuenta
    from cuentas_rango cr
  )
  select jsonb_build_object(
    'fecha_base', v_fecha,
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', v_periodo,
    'resumen', jsonb_build_object(
      'total_vendido', coalesce(sum(total_vendido), 0),
      'total_pagado', coalesce(sum(total_pagado), 0),
      'saldo_pendiente', coalesce(sum(saldo_pendiente), 0),
      'cuentas_pagadas', count(*) filter (where grupo_estado = 'pagada'),
      'cuentas_parciales', count(*) filter (where grupo_estado = 'pagada_parcial')
    ),
    'pagadas', coalesce(jsonb_agg(cuenta order by (cuenta ->> 'ultimo_pedido_at')::timestamptz desc) filter (where grupo_estado = 'pagada'), '[]'::jsonb),
    'parciales', coalesce(jsonb_agg(cuenta order by (cuenta ->> 'ultimo_pedido_at')::timestamptz desc) filter (where grupo_estado = 'pagada_parcial'), '[]'::jsonb)
  )
    into v_resultado
  from cuenta_json;

  return coalesce(v_resultado, jsonb_build_object(
    'fecha_base', v_fecha,
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', v_periodo,
    'resumen', jsonb_build_object(
      'total_vendido', 0,
      'total_pagado', 0,
      'saldo_pendiente', 0,
      'cuentas_pagadas', 0,
      'cuentas_parciales', 0
    ),
    'pagadas', '[]'::jsonb,
    'parciales', '[]'::jsonb
  ));
end;
$$;

create or replace function public.reversar_cuenta_pagada_admin(
  p_cuenta_id uuid,
  p_motivo_id uuid,
  p_observacion text default null
)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.cuentas;
  v_pagos_anulados int := 0;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_reversa_cuentas_pagadas' using errcode = '42501';
  end if;

  if not exists (select 1 from public.motivos where id = p_motivo_id and tipo = 'anulacion' and activo = true) then
    raise exception 'motivo_anulacion_invalido' using errcode = '22023';
  end if;

  select * into v_cuenta
  from public.cuentas
  where id = p_cuenta_id
  for update;

  if v_cuenta.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  if v_cuenta.estado not in ('pagada', 'pagada_parcial', 'cerrada') then
    raise exception 'cuenta_no_pagada' using errcode = '22023';
  end if;

  update public.pagos
  set anulado = true,
      anulado_at = now(),
      anulado_por = public.perfil_actual_id(),
      anulacion_motivo_id = p_motivo_id,
      anulacion_observacion = nullif(trim(coalesce(p_observacion, '')), '')
  where cuenta_id = p_cuenta_id
    and not coalesce(anulado, false);

  get diagnostics v_pagos_anulados = row_count;

  update public.cuentas
  set estado = 'por_cobrar',
      cierre_caja_id = null,
      responsable_pendiente = null,
      updated_at = now()
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'reversar_cuenta_pagada_admin',
    'cuentas',
    p_cuenta_id,
    jsonb_build_object('pagos_anulados', v_pagos_anulados, 'motivo_id', p_motivo_id, 'observacion', p_observacion)
  );

  return v_cuenta;
end;
$$;

create or replace function public.anular_cuenta_pagada_admin(
  p_cuenta_id uuid,
  p_motivo_id uuid,
  p_observacion text default null
)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.cuentas;
  v_pedido record;
  v_pagos_anulados int := 0;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_anula_cuentas_pagadas' using errcode = '42501';
  end if;

  if not exists (select 1 from public.motivos where id = p_motivo_id and tipo = 'anulacion' and activo = true) then
    raise exception 'motivo_anulacion_invalido' using errcode = '22023';
  end if;

  select * into v_cuenta
  from public.cuentas
  where id = p_cuenta_id
  for update;

  if v_cuenta.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  if v_cuenta.estado not in ('pagada', 'pagada_parcial', 'cerrada') then
    raise exception 'cuenta_no_pagada' using errcode = '22023';
  end if;

  for v_pedido in
    select id
    from public.pedidos
    where cuenta_id = p_cuenta_id
      and estado <> 'anulado'
    order by enviado_at
  loop
    perform public.anular_pedido(v_pedido.id, p_motivo_id, p_observacion);
  end loop;

  update public.pagos
  set anulado = true,
      anulado_at = now(),
      anulado_por = public.perfil_actual_id(),
      anulacion_motivo_id = p_motivo_id,
      anulacion_observacion = nullif(trim(coalesce(p_observacion, '')), '')
  where cuenta_id = p_cuenta_id
    and not coalesce(anulado, false);

  get diagnostics v_pagos_anulados = row_count;

  perform public.recalcular_total_cuenta(p_cuenta_id);

  update public.cuentas
  set estado = 'anulada',
      responsable_pendiente = null,
      nickname = null,
      updated_at = now()
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'anular_cuenta_pagada_admin',
    'cuentas',
    p_cuenta_id,
    jsonb_build_object('pagos_anulados', v_pagos_anulados, 'motivo_id', p_motivo_id, 'observacion', p_observacion)
  );

  return v_cuenta;
end;
$$;

grant execute on function public.ultimo_dia_pedidos_pagados() to authenticated;
grant execute on function public.pedidos_pagados_caja(date, text) to authenticated;
grant execute on function public.reversar_cuenta_pagada_admin(uuid, uuid, text) to authenticated;
grant execute on function public.anular_cuenta_pagada_admin(uuid, uuid, text) to authenticated;
