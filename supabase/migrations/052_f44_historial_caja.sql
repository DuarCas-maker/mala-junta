-- F44: historial de caja por turno para caja/admin con notas editables.

alter table public.cierres_caja
add column if not exists nota_apertura text;

drop function if exists public.abrir_caja(numeric);

create or replace function public.abrir_caja(
  p_base_inicial numeric,
  p_nota_apertura text default null
)
returns public.cierres_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_abre_caja' using errcode = '42501';
  end if;

  if coalesce(p_base_inicial, -1) < 0 then
    raise exception 'base_inicial_invalida' using errcode = '22023';
  end if;

  if exists (select 1 from public.cierres_caja where estado = 'abierta') then
    raise exception 'ya_existe_caja_abierta' using errcode = '23505';
  end if;

  insert into public.cierres_caja (abierto_por, base_inicial, dia_negocio, nota_apertura)
  values (
    public.perfil_actual_id(),
    p_base_inicial,
    public.dia_negocio(now()),
    nullif(trim(coalesce(p_nota_apertura, '')), '')
  )
  returning * into v_cierre;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'abrir_caja',
    'cierres_caja',
    v_cierre.id,
    jsonb_build_object('base_inicial', p_base_inicial, 'nota_apertura', v_cierre.nota_apertura)
  );

  return v_cierre;
end;
$$;

create or replace function public.historial_caja(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_lee_historial_caja' using errcode = '42501';
  end if;

  with cierres_base as (
    select cc.*
    from public.cierres_caja cc
    where cc.estado = 'cerrada'
      and cc.cerrado_at is not null
      and public.dia_negocio(cc.cerrado_at) between p_desde and p_hasta
  ),
  cierres_detalle as (
    select
      cc.id,
      cc.dia_negocio,
      public.dia_negocio(cc.cerrado_at) as dia_cierre,
      cc.abierto_at,
      cc.cerrado_at,
      abierto.nombre as abierto_por,
      cerrado.nombre as cerrado_por,
      aprobado.nombre as aprobado_por,
      cc.base_inicial,
      cc.efectivo_esperado,
      cc.efectivo_contado,
      cc.diferencia,
      cc.estado::text as estado,
      cc.nota_apertura,
      cc.justificacion_diferencia as nota_cierre,
      coalesce(pagos.total_pagado, 0)::numeric(12,0) as total_pagado,
      coalesce(pagos.efectivo_pagos, 0)::numeric(12,0) as efectivo_pagos,
      coalesce(pagos.propinas_total, 0)::numeric(12,0) as propinas_total,
      coalesce(pagos.pagos_por_medio, '{}'::jsonb) as pagos_por_medio,
      coalesce(retiros.retiros_total, 0)::numeric(12,0) as retiros_total,
      coalesce(retiros.retiros, '[]'::jsonb) as retiros,
      coalesce(gastos.gastos_efectivo_total, 0)::numeric(12,0) as gastos_efectivo_total,
      coalesce(gastos.gastos_total, 0)::numeric(12,0) as gastos_total,
      coalesce(gastos.compras_inventario_total, 0)::numeric(12,0) as compras_inventario_total,
      coalesce(gastos.gastos_urgencia_total, 0)::numeric(12,0) as gastos_urgencia_total,
      coalesce(gastos.gastos, '[]'::jsonb) as gastos,
      coalesce(cuentas.cuentas_pagadas, 0)::bigint as cuentas_pagadas,
      coalesce(cuentas.pendientes_cobrados, 0)::bigint as pendientes_cobrados
    from cierres_base cc
    left join public.perfiles abierto on abierto.id = cc.abierto_por
    left join public.perfiles cerrado on cerrado.id = cc.cerrado_por
    left join public.perfiles aprobado on aprobado.id = cc.aprobado_por
    left join lateral (
      select
        coalesce(sum(pg.monto), 0) as total_pagado,
        coalesce(sum(pg.monto) filter (where pg.medio = 'efectivo'), 0) as efectivo_pagos,
        coalesce(sum(pg.propina), 0) as propinas_total,
        coalesce((
          select jsonb_object_agg(medio_total.medio, medio_total.total)
          from (
            select pg_medio.medio::text, coalesce(sum(pg_medio.monto), 0)::numeric(12,0) as total
            from public.pagos pg_medio
            where pg_medio.cierre_caja_id = cc.id
              and not coalesce(pg_medio.anulado, false)
            group by pg_medio.medio
          ) medio_total
        ), '{}'::jsonb) as pagos_por_medio
      from public.pagos pg
      where pg.cierre_caja_id = cc.id
        and not coalesce(pg.anulado, false)
    ) pagos on true
    left join lateral (
      select
        coalesce(sum(r.monto), 0) as retiros_total,
        coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id,
          'monto', r.monto,
          'observacion', r.observacion,
          'numero_factura', r.numero_factura,
          'timestamp', r.timestamp,
          'motivo', m.texto,
          'usuario', u.nombre
        ) order by r.timestamp desc), '[]'::jsonb) as retiros
      from public.retiros_caja r
      left join public.motivos m on m.id = r.motivo_id
      left join public.perfiles u on u.id = r.usuario_id
      where r.cierre_caja_id = cc.id
    ) retiros on true
    left join lateral (
      select
        coalesce(sum(g.monto) filter (where g.medio = 'efectivo'), 0) as gastos_efectivo_total,
        coalesce(sum(g.monto), 0) as gastos_total,
        coalesce(sum(g.monto) filter (where g.tipo = 'compra_inventario'), 0) as compras_inventario_total,
        coalesce(sum(g.monto) filter (where g.tipo = 'urgencia'), 0) as gastos_urgencia_total,
        coalesce(jsonb_agg(jsonb_build_object(
          'id', g.id,
          'tipo', g.tipo,
          'medio', g.medio,
          'monto', g.monto,
          'observacion', g.observacion,
          'numero_factura', g.numero_factura,
          'timestamp', g.timestamp,
          'categoria', cg.nombre,
          'proveedor', pr.nombre,
          'usuario', u.nombre
        ) order by g.timestamp desc), '[]'::jsonb) as gastos
      from public.gastos_caja g
      left join public.categorias_gasto_caja cg on cg.id = g.categoria_id
      left join public.proveedores pr on pr.id = g.proveedor_id
      left join public.perfiles u on u.id = g.usuario_id
      where g.cierre_caja_id = cc.id
    ) gastos on true
    left join lateral (
      select
        count(distinct c.id) filter (where c.cierre_caja_id = cc.id) as cuentas_pagadas,
        count(distinct pg.cuenta_id) filter (where pg.es_abono_pendiente and not coalesce(pg.anulado, false)) as pendientes_cobrados
      from public.pagos pg
      left join public.cuentas c on c.id = pg.cuenta_id
      where pg.cierre_caja_id = cc.id
    ) cuentas on true
  ),
  cierres_json as (
    select
      cd.*,
      jsonb_build_object(
        'id', cd.id,
        'dia_negocio', cd.dia_negocio,
        'dia_cierre', cd.dia_cierre,
        'abierto_at', cd.abierto_at,
        'cerrado_at', cd.cerrado_at,
        'abierto_por', cd.abierto_por,
        'cerrado_por', cd.cerrado_por,
        'aprobado_por', cd.aprobado_por,
        'base_inicial', cd.base_inicial,
        'efectivo_pagos', cd.efectivo_pagos,
        'retiros_total', cd.retiros_total,
        'gastos_efectivo_total', cd.gastos_efectivo_total,
        'gastos_total', cd.gastos_total,
        'compras_inventario_total', cd.compras_inventario_total,
        'gastos_urgencia_total', cd.gastos_urgencia_total,
        'salidas_efectivo_total', cd.retiros_total + cd.gastos_efectivo_total,
        'efectivo_esperado', cd.efectivo_esperado,
        'efectivo_contado', cd.efectivo_contado,
        'diferencia', cd.diferencia,
        'total_pagado', cd.total_pagado,
        'propinas_total', cd.propinas_total,
        'pagos_por_medio', cd.pagos_por_medio,
        'cuentas', jsonb_build_object(
          'pagadas', cd.cuentas_pagadas,
          'pendientes_cobrados', cd.pendientes_cobrados
        ),
        'retiros', cd.retiros,
        'gastos', cd.gastos,
        'nota_apertura', cd.nota_apertura,
        'nota_cierre', cd.nota_cierre,
        'estado', cd.estado
      ) as cierre_json
    from cierres_detalle cd
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'resumen', jsonb_build_object(
      'turnos', coalesce(count(*), 0),
      'total_pagado', coalesce(sum(total_pagado), 0),
      'efectivo_pagos', coalesce(sum(efectivo_pagos), 0),
      'retiros_total', coalesce(sum(retiros_total), 0),
      'gastos_total', coalesce(sum(gastos_total), 0),
      'gastos_efectivo_total', coalesce(sum(gastos_efectivo_total), 0),
      'compras_inventario_total', coalesce(sum(compras_inventario_total), 0),
      'gastos_urgencia_total', coalesce(sum(gastos_urgencia_total), 0),
      'propinas_total', coalesce(sum(propinas_total), 0),
      'diferencias_total', coalesce(sum(diferencia), 0),
      'cuentas_pagadas', coalesce(sum(cuentas_pagadas), 0),
      'pendientes_cobrados', coalesce(sum(pendientes_cobrados), 0)
    ),
    'cierres', coalesce(jsonb_agg(cierre_json order by cerrado_at desc), '[]'::jsonb)
  )
  into v_resultado
  from cierres_json;

  return v_resultado;
end;
$$;

create or replace function public.actualizar_notas_cierre_caja(
  p_cierre_id uuid,
  p_nota_apertura text default null,
  p_justificacion_diferencia text default null
)
returns public.cierres_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_nota_apertura text := nullif(trim(coalesce(p_nota_apertura, '')), '');
  v_nota_cierre text := nullif(trim(coalesce(p_justificacion_diferencia, '')), '');
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_actualiza_notas_cierre' using errcode = '42501';
  end if;

  select * into v_cierre
  from public.cierres_caja
  where id = p_cierre_id
  for update;

  if v_cierre.id is null then
    raise exception 'cierre_caja_no_encontrado' using errcode = '02000';
  end if;

  if v_cierre.estado <> 'cerrada' then
    raise exception 'solo_cierres_cerrados_editan_notas' using errcode = '22023';
  end if;

  if coalesce(v_cierre.diferencia, 0) <> 0 and char_length(trim(coalesce(v_nota_cierre, ''))) < 3 then
    raise exception 'cierre_descuadrado_requiere_justificacion' using errcode = '22023';
  end if;

  update public.cierres_caja
  set nota_apertura = v_nota_apertura,
      justificacion_diferencia = v_nota_cierre,
      updated_at = now()
  where id = p_cierre_id
  returning * into v_cierre;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'actualizar_notas_cierre_caja',
    'cierres_caja',
    p_cierre_id,
    jsonb_build_object('nota_apertura', v_nota_apertura, 'justificacion_diferencia', v_nota_cierre)
  );

  return v_cierre;
end;
$$;

grant execute on function public.abrir_caja(numeric, text) to authenticated;
grant execute on function public.historial_caja(date, date) to authenticated;
grant execute on function public.actualizar_notas_cierre_caja(uuid, text, text) to authenticated;
