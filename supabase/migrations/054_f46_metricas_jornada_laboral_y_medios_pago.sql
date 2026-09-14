-- 054_f46_metricas_jornada_laboral_y_medios_pago.sql
-- Sprint 5: metricas por jornada laboral 10:00 a 09:59, medios de pago y consumo por hora/dia.

insert into public.parametros (clave, valor, descripcion)
values ('hora_corte_dia_negocio', '"10:00"', 'Hora global de corte de jornada laboral. Jornada: 10:00 a 09:59 del dia siguiente.')
on conflict (clave) do update
set valor = excluded.valor,
    descripcion = excluded.descripcion,
    updated_at = now();

create or replace function public.metricas_lineas_venta_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  dia_negocio date,
  estado_cuenta text,
  pedido_estado text,
  cuenta_id uuid,
  pedido_id uuid,
  pedido_item_id uuid,
  mesero text,
  item_nombre text,
  categoria text,
  cantidad numeric,
  ingreso numeric,
  costo_estimado numeric,
  margen_estimado numeric,
  minutos_preparacion numeric,
  anulado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.dia_negocio(p.enviado_at) as dia_negocio,
    c.estado::text as estado_cuenta,
    p.estado::text as pedido_estado,
    c.id as cuenta_id,
    p.id as pedido_id,
    pi.id as pedido_item_id,
    mesero.nombre as mesero,
    coalesce(pr.nombre, co.nombre, 'Item') as item_nombre,
    case when pi.combo_id is not null then 'Combo' else coalesce(cat.nombre, 'Sin categoria') end as categoria,
    pi.cantidad::numeric as cantidad,
    (pi.cantidad * pi.precio_unitario_capturado)::numeric(12,0) as ingreso,
    (pi.cantidad * coalesce(nullif(pi.costo_unitario_historico, 0), case
      when pi.producto_id is not null then coalesce(pr.costo_unitario_actual, 0)
      else coalesce((
        select sum(ci.cantidad * coalesce(cp.costo_unitario_actual, 0))::numeric(12,0)
        from public.combo_items ci
        join public.productos cp on cp.id = ci.producto_id
        where ci.combo_id = pi.combo_id
          and ci.activo = true
      ), 0)::numeric(12,0)
    end, 0))::numeric(12,0) as costo_estimado,
    ((pi.cantidad * pi.precio_unitario_capturado) - (pi.cantidad * coalesce(nullif(pi.costo_unitario_historico, 0), case
      when pi.producto_id is not null then coalesce(pr.costo_unitario_actual, 0)
      else coalesce((
        select sum(ci.cantidad * coalesce(cp.costo_unitario_actual, 0))::numeric(12,0)
        from public.combo_items ci
        join public.productos cp on cp.id = ci.producto_id
        where ci.combo_id = pi.combo_id
          and ci.activo = true
      ), 0)::numeric(12,0)
    end, 0)))::numeric(12,0) as margen_estimado,
    case
      when p.entregado_at is null then null
      else round(extract(epoch from (p.entregado_at - p.enviado_at)) / 60, 2)
    end as minutos_preparacion,
    (p.estado = 'anulado'::public.estado_pedido or pi.estado = 'anulado'::public.estado_pedido or c.estado = 'anulada'::public.estado_cuenta) as anulado
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.pedido_id
  join public.cuentas c on c.id = p.cuenta_id
  join public.perfiles mesero on mesero.id = p.mesero_id
  left join public.productos pr on pr.id = pi.producto_id
  left join public.categorias cat on cat.id = pr.categoria_id
  left join public.combos co on co.id = pi.combo_id
  where public.es_admin()
    and public.dia_negocio(p.enviado_at) between p_desde and p_hasta;
$$;

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
  with pagos_jornada as (
    select
      public.dia_negocio(pg.timestamp) as jornada_laboral,
      pg.medio::text as medio,
      coalesce(sum(pg.monto), 0)::numeric(12,0) as monto
    from public.pagos pg
    where public.es_admin()
      and not coalesce(pg.anulado, false)
      and public.dia_negocio(pg.timestamp) between p_desde and p_hasta
    group by public.dia_negocio(pg.timestamp), pg.medio
  )
  select
    d.jornada::date as jornada_laboral,
    coalesce(sum(monto) filter (where medio = 'efectivo'), 0)::numeric(12,0) as efectivo,
    coalesce(sum(monto) filter (where medio = 'datafono'), 0)::numeric(12,0) as datafono,
    coalesce(sum(monto) filter (where medio = 'nequi_daviplata'), 0)::numeric(12,0) as nequi_daviplata,
    coalesce(sum(monto) filter (where medio = 'transferencia'), 0)::numeric(12,0) as transferencia,
    coalesce(sum(monto), 0)::numeric(12,0) as total
  from generate_series(p_desde, p_hasta, interval '1 day') as d(jornada)
  left join pagos_jornada p on p.jornada_laboral = d.jornada::date
  group by d.jornada
  order by d.jornada;
$$;

create or replace function public.metricas_consumo_horas_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  hora integer,
  etiqueta text,
  cantidad numeric,
  valor_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with horas as (
    select generate_series(0, 23) as hora
  ),
  ventas as (
    select
      extract(hour from (p.enviado_at at time zone 'America/Bogota'))::int as hora,
      coalesce(sum(pi.cantidad), 0)::numeric as cantidad,
      coalesce(sum(pi.cantidad * pi.precio_unitario_capturado), 0)::numeric(12,0) as valor_total
    from public.pedido_items pi
    join public.pedidos p on p.id = pi.pedido_id
    join public.cuentas c on c.id = p.cuenta_id
    where public.es_admin()
      and public.dia_negocio(p.enviado_at) between p_desde and p_hasta
      and p.estado <> 'anulado'
      and pi.estado <> 'anulado'
      and c.estado <> 'anulada'
    group by extract(hour from (p.enviado_at at time zone 'America/Bogota'))::int
  )
  select
    h.hora,
    lpad(h.hora::text, 2, '0') || ':00' as etiqueta,
    coalesce(v.cantidad, 0)::numeric as cantidad,
    coalesce(v.valor_total, 0)::numeric(12,0) as valor_total
  from horas h
  left join ventas v on v.hora = h.hora
  order by h.hora;
$$;

create or replace function public.metricas_consumo_dias_jornada_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  dia_semana integer,
  etiqueta text,
  cantidad numeric,
  valor_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with dias as (
    select *
    from (values
      (1, 'Lunes'),
      (2, 'Martes'),
      (3, 'Miercoles'),
      (4, 'Jueves'),
      (5, 'Viernes'),
      (6, 'Sabado'),
      (7, 'Domingo')
    ) as d(dia_semana, etiqueta)
  ),
  ventas as (
    select
      extract(isodow from public.dia_negocio(p.enviado_at))::int as dia_semana,
      coalesce(sum(pi.cantidad), 0)::numeric as cantidad,
      coalesce(sum(pi.cantidad * pi.precio_unitario_capturado), 0)::numeric(12,0) as valor_total
    from public.pedido_items pi
    join public.pedidos p on p.id = pi.pedido_id
    join public.cuentas c on c.id = p.cuenta_id
    where public.es_admin()
      and public.dia_negocio(p.enviado_at) between p_desde and p_hasta
      and p.estado <> 'anulado'
      and pi.estado <> 'anulado'
      and c.estado <> 'anulada'
    group by extract(isodow from public.dia_negocio(p.enviado_at))::int
  )
  select
    d.dia_semana,
    d.etiqueta,
    coalesce(v.cantidad, 0)::numeric as cantidad,
    coalesce(v.valor_total, 0)::numeric(12,0) as valor_total
  from dias d
  left join ventas v on v.dia_semana = d.dia_semana
  order by d.dia_semana;
$$;

grant execute on function public.metricas_lineas_venta_admin(date, date) to authenticated;
grant execute on function public.metricas_ingresos_medios_pago_admin(date, date) to authenticated;
grant execute on function public.metricas_consumo_horas_admin(date, date) to authenticated;
grant execute on function public.metricas_consumo_dias_jornada_admin(date, date) to authenticated;
