-- F41: ranking de productos estrella para metricas admin.

create or replace function public.metricas_productos_estrella_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  item_nombre text,
  categoria text,
  unidades_vendidas bigint,
  venta_bruta numeric,
  costo_estimado numeric,
  ganancia_bruta numeric,
  margen_pct numeric,
  participacion_ganancia_pct numeric,
  score_estrella numeric,
  ranking_ganancia bigint,
  ranking_unidades bigint,
  cuadrante text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      p.item_nombre,
      p.categoria,
      p.unidades_vendidas,
      p.ventas as venta_bruta,
      p.costo_estimado,
      p.margen_estimado as ganancia_bruta,
      p.margen_pct
    from public.metricas_margen_producto_admin(p_desde, p_hasta) p
    where p.unidades_vendidas > 0
      and p.ventas > 0
  ),
  limites as (
    select
      coalesce(max(unidades_vendidas), 0)::numeric as max_unidades,
      coalesce(max(greatest(ganancia_bruta, 0)), 0)::numeric as max_ganancia,
      coalesce(max(greatest(coalesce(margen_pct, 0), 0)), 0)::numeric as max_margen,
      coalesce(sum(greatest(ganancia_bruta, 0)), 0)::numeric as total_ganancia,
      coalesce(avg(unidades_vendidas), 0)::numeric as promedio_unidades,
      coalesce(avg(ganancia_bruta), 0)::numeric as promedio_ganancia
    from base
  ),
  puntajes as (
    select
      b.*,
      case when l.total_ganancia = 0 then 0 else round((greatest(b.ganancia_bruta, 0) / l.total_ganancia) * 100, 2) end as participacion_ganancia_pct,
      round((
        (case when l.max_ganancia = 0 then 0 else greatest(b.ganancia_bruta, 0) / l.max_ganancia end * 50) +
        (case when l.max_unidades = 0 then 0 else b.unidades_vendidas::numeric / l.max_unidades end * 40) +
        (case when l.max_margen = 0 then 0 else greatest(coalesce(b.margen_pct, 0), 0) / l.max_margen end * 10)
      ), 2) as score_estrella,
      rank() over (order by b.ganancia_bruta desc, b.venta_bruta desc, b.item_nombre) as ranking_ganancia,
      rank() over (order by b.unidades_vendidas desc, b.venta_bruta desc, b.item_nombre) as ranking_unidades,
      case
        when b.unidades_vendidas::numeric >= l.promedio_unidades and b.ganancia_bruta >= l.promedio_ganancia then 'estrella'
        when b.unidades_vendidas::numeric >= l.promedio_unidades and b.ganancia_bruta < l.promedio_ganancia then 'volumen_bajo_margen'
        when b.unidades_vendidas::numeric < l.promedio_unidades and b.ganancia_bruta >= l.promedio_ganancia then 'premium_oportunidad'
        else 'baja_prioridad'
      end as cuadrante
    from base b
    cross join limites l
  )
  select
    p.item_nombre,
    p.categoria,
    p.unidades_vendidas,
    p.venta_bruta,
    p.costo_estimado,
    p.ganancia_bruta,
    p.margen_pct,
    p.participacion_ganancia_pct,
    p.score_estrella,
    p.ranking_ganancia,
    p.ranking_unidades,
    p.cuadrante
  from puntajes p
  order by p.score_estrella desc, p.ganancia_bruta desc, p.unidades_vendidas desc, p.item_nombre;
$$;

grant execute on function public.metricas_productos_estrella_admin(date, date) to authenticated;
