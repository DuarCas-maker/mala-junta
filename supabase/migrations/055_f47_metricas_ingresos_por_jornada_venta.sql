-- F47: alinear ingresos por medio de pago con la jornada laboral de venta.
-- Antes se agrupaban por timestamp del pago; ahora se asignan a la jornada
-- de las lineas vendidas de la cuenta para coincidir con Ventas por jornada laboral.

create or replace function public.metricas_ingresos_medios_pago_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  jornada_laboral date,
  efectivo numeric,
  datafono numeric,
  nequi_daviplata numeric,
  transferencia numeric,
  total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with ventas_cuenta_jornada as (
    select
      l.cuenta_id,
      l.dia_negocio as jornada_laboral,
      coalesce(sum(l.ingreso), 0)::numeric as venta_jornada
    from public.metricas_lineas_venta_admin(p_desde, p_hasta) l
    where public.es_admin()
      and not l.anulado
    group by l.cuenta_id, l.dia_negocio
  ),
  ventas_cuenta_total as (
    select
      cuenta_id,
      coalesce(sum(venta_jornada), 0)::numeric as venta_total
    from ventas_cuenta_jornada
    group by cuenta_id
  ),
  pagos_cuenta as (
    select
      pg.cuenta_id,
      pg.medio::text as medio,
      coalesce(sum(pg.monto), 0)::numeric as monto
    from public.pagos pg
    join ventas_cuenta_total vt on vt.cuenta_id = pg.cuenta_id
    where public.es_admin()
      and not coalesce(pg.anulado, false)
    group by pg.cuenta_id, pg.medio
  ),
  pagos_jornada as (
    select
      vcj.jornada_laboral,
      pc.medio,
      coalesce(sum(
        pc.monto * case
          when vt.venta_total > 0 then vcj.venta_jornada / vt.venta_total
          else 1
        end
      ), 0)::numeric(12,0) as monto
    from ventas_cuenta_jornada vcj
    join ventas_cuenta_total vt on vt.cuenta_id = vcj.cuenta_id
    join pagos_cuenta pc on pc.cuenta_id = vcj.cuenta_id
    group by vcj.jornada_laboral, pc.medio
  )
  select
    d.jornada::date as jornada_laboral,
    coalesce(sum(p.monto) filter (where p.medio = 'efectivo'), 0)::numeric(12,0) as efectivo,
    coalesce(sum(p.monto) filter (where p.medio = 'datafono'), 0)::numeric(12,0) as datafono,
    coalesce(sum(p.monto) filter (where p.medio = 'nequi_daviplata'), 0)::numeric(12,0) as nequi_daviplata,
    coalesce(sum(p.monto) filter (where p.medio = 'transferencia'), 0)::numeric(12,0) as transferencia,
    coalesce(sum(p.monto), 0)::numeric(12,0) as total
  from generate_series(p_desde, p_hasta, interval '1 day') as d(jornada)
  left join pagos_jornada p on p.jornada_laboral = d.jornada::date
  group by d.jornada
  order by d.jornada;
$$;

grant execute on function public.metricas_ingresos_medios_pago_admin(date, date) to authenticated;
