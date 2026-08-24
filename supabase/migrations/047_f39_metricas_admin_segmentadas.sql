-- F38: metricas admin segmentadas, seguras y tolerantes a permisos de costos.

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
    coalesce(cv.fecha_venta, (p.enviado_at at time zone 'America/Bogota')::date) as dia_negocio,
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
  left join lateral (
    select g.captura_id
    from public.captura_venta_grupos g
    where g.pedido_id = p.id
    order by g.confirmado_at desc nulls last, g.created_at desc
    limit 1
  ) cg on true
  left join public.capturas_venta cv on cv.id = cg.captura_id
  where public.es_admin()
    and coalesce(cv.fecha_venta, (p.enviado_at at time zone 'America/Bogota')::date) between p_desde and p_hasta;
$$;

create or replace function public.metricas_estado_cuentas_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  segmento text,
  estado_cuenta text,
  cuentas bigint,
  pedidos bigint,
  venta_bruta numeric,
  pagado numeric,
  faltante numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with ventas_cuenta as (
    select
      l.cuenta_id,
      l.estado_cuenta,
      count(distinct l.pedido_id) as pedidos,
      sum(l.ingreso)::numeric(12,0) as venta_bruta
    from public.metricas_lineas_venta_admin(p_desde, p_hasta) l
    where not l.anulado
    group by l.cuenta_id, l.estado_cuenta
  ),
  pagos_cuenta as (
    select
      pg.cuenta_id,
      coalesce(sum(pg.monto) filter (where not coalesce(pg.anulado, false)), 0)::numeric(12,0) as pagado
    from public.pagos pg
    group by pg.cuenta_id
  ),
  base as (
    select
      case
        when v.estado_cuenta in ('pagada','cerrada') then 'cobradas'
        when v.estado_cuenta = 'abierta' then 'abiertas'
        when v.estado_cuenta = 'por_cobrar' then 'por_cobrar'
        when v.estado_cuenta = 'pagada_parcial' then 'pagada_parcial'
        when v.estado_cuenta = 'pendiente' then 'pendiente'
        else v.estado_cuenta
      end as segmento,
      v.estado_cuenta,
      v.cuenta_id,
      v.pedidos,
      v.venta_bruta,
      coalesce(p.pagado, 0)::numeric(12,0) as pagado
    from ventas_cuenta v
    left join pagos_cuenta p on p.cuenta_id = v.cuenta_id
  )
  select
    b.segmento,
    b.estado_cuenta,
    count(distinct b.cuenta_id)::bigint as cuentas,
    sum(b.pedidos)::bigint as pedidos,
    coalesce(sum(b.venta_bruta), 0)::numeric(12,0) as venta_bruta,
    coalesce(sum(case when b.segmento in ('cobradas','pagada_parcial') then b.pagado else 0 end), 0)::numeric(12,0) as pagado,
    coalesce(sum(case when b.segmento = 'pagada_parcial' then greatest(b.venta_bruta - b.pagado, 0) else 0 end), 0)::numeric(12,0) as faltante
  from base b
  group by b.segmento, b.estado_cuenta
  order by case b.segmento
    when 'cobradas' then 1
    when 'pagada_parcial' then 2
    when 'por_cobrar' then 3
    when 'pendiente' then 4
    when 'abiertas' then 5
    else 9
  end, b.estado_cuenta;
$$;

create or replace function public.metricas_estado_dia_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  dia_negocio date,
  segmento text,
  estado_cuenta text,
  cuentas bigint,
  pedidos bigint,
  venta_bruta numeric,
  pagado numeric,
  faltante numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with ventas_cuenta_dia as (
    select
      l.dia_negocio,
      l.cuenta_id,
      l.estado_cuenta,
      count(distinct l.pedido_id) as pedidos,
      sum(l.ingreso)::numeric(12,0) as venta_bruta
    from public.metricas_lineas_venta_admin(p_desde, p_hasta) l
    where not l.anulado
    group by l.dia_negocio, l.cuenta_id, l.estado_cuenta
  ),
  pagos_cuenta as (
    select
      pg.cuenta_id,
      coalesce(sum(pg.monto) filter (where not coalesce(pg.anulado, false)), 0)::numeric(12,0) as pagado
    from public.pagos pg
    group by pg.cuenta_id
  ),
  base as (
    select
      v.dia_negocio,
      case
        when v.estado_cuenta in ('pagada','cerrada') then 'cobradas'
        when v.estado_cuenta = 'abierta' then 'abiertas'
        when v.estado_cuenta = 'por_cobrar' then 'por_cobrar'
        when v.estado_cuenta = 'pagada_parcial' then 'pagada_parcial'
        when v.estado_cuenta = 'pendiente' then 'pendiente'
        else v.estado_cuenta
      end as segmento,
      v.estado_cuenta,
      v.cuenta_id,
      v.pedidos,
      v.venta_bruta,
      coalesce(p.pagado, 0)::numeric(12,0) as pagado
    from ventas_cuenta_dia v
    left join pagos_cuenta p on p.cuenta_id = v.cuenta_id
  )
  select
    b.dia_negocio,
    b.segmento,
    b.estado_cuenta,
    count(distinct b.cuenta_id)::bigint as cuentas,
    sum(b.pedidos)::bigint as pedidos,
    coalesce(sum(b.venta_bruta), 0)::numeric(12,0) as venta_bruta,
    coalesce(sum(case when b.segmento in ('cobradas','pagada_parcial') then b.pagado else 0 end), 0)::numeric(12,0) as pagado,
    coalesce(sum(case when b.segmento = 'pagada_parcial' then greatest(b.venta_bruta - b.pagado, 0) else 0 end), 0)::numeric(12,0) as faltante
  from base b
  group by b.dia_negocio, b.segmento, b.estado_cuenta
  order by b.dia_negocio, b.segmento, b.estado_cuenta;
$$;

create or replace function public.metricas_anulados_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  dia_negocio date,
  pedidos_anulados bigint,
  cuentas_anuladas bigint,
  monto_anulado numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.dia_negocio,
    count(distinct l.pedido_id) filter (where l.pedido_estado = 'anulado')::bigint as pedidos_anulados,
    count(distinct l.cuenta_id) filter (where l.estado_cuenta = 'anulada')::bigint as cuentas_anuladas,
    coalesce(sum(l.ingreso), 0)::numeric(12,0) as monto_anulado
  from public.metricas_lineas_venta_admin(p_desde, p_hasta) l
  where l.anulado
  group by l.dia_negocio
  order by l.dia_negocio;
$$;

create or replace function public.metricas_margen_producto_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  item_nombre text,
  categoria text,
  lineas bigint,
  unidades_vendidas bigint,
  ventas numeric,
  costo_estimado numeric,
  margen_estimado numeric,
  margen_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.item_nombre,
    l.categoria,
    count(distinct l.pedido_item_id)::bigint as lineas,
    sum(l.cantidad)::bigint as unidades_vendidas,
    sum(l.ingreso)::numeric(12,0) as ventas,
    sum(l.costo_estimado)::numeric(12,0) as costo_estimado,
    sum(l.margen_estimado)::numeric(12,0) as margen_estimado,
    round((sum(l.margen_estimado) / nullif(sum(l.ingreso), 0)) * 100, 2) as margen_pct
  from public.metricas_lineas_venta_admin(p_desde, p_hasta) l
  where not l.anulado
  group by l.item_nombre, l.categoria
  order by margen_estimado desc, ventas desc;
$$;

create or replace function public.metricas_margen_global_dia_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  dia_negocio date,
  ventas numeric,
  costo_estimado numeric,
  margen_estimado numeric,
  margen_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.dia_negocio,
    sum(l.ingreso)::numeric(12,0) as ventas,
    sum(l.costo_estimado)::numeric(12,0) as costo_estimado,
    sum(l.margen_estimado)::numeric(12,0) as margen_estimado,
    round((sum(l.margen_estimado) / nullif(sum(l.ingreso), 0)) * 100, 2) as margen_pct
  from public.metricas_lineas_venta_admin(p_desde, p_hasta) l
  where not l.anulado
  group by l.dia_negocio
  order by l.dia_negocio;
$$;

create or replace function public.metricas_ventas_mesero_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  dia_negocio date,
  mesero text,
  cuentas bigint,
  pedidos bigint,
  ventas_brutas numeric,
  ventas_pendientes numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.dia_negocio,
    l.mesero,
    count(distinct l.cuenta_id)::bigint as cuentas,
    count(distinct l.pedido_id)::bigint as pedidos,
    coalesce(sum(l.ingreso), 0)::numeric(12,0) as ventas_brutas,
    coalesce(sum(l.ingreso) filter (where l.estado_cuenta in ('abierta','por_cobrar','pagada_parcial','pendiente')), 0)::numeric(12,0) as ventas_pendientes
  from public.metricas_lineas_venta_admin(p_desde, p_hasta) l
  where not l.anulado
  group by l.dia_negocio, l.mesero
  order by l.dia_negocio desc, ventas_brutas desc;
$$;

create or replace function public.metricas_tiempos_preparacion_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  dia_negocio date,
  mesero text,
  minutos_preparacion numeric,
  items bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.dia_negocio,
    l.mesero,
    round(avg(l.minutos_preparacion), 2) as minutos_preparacion,
    count(l.pedido_item_id)::bigint as items
  from public.metricas_lineas_venta_admin(p_desde, p_hasta) l
  where not l.anulado
    and l.pedido_estado = 'entregado'
    and l.minutos_preparacion is not null
  group by l.dia_negocio, l.mesero
  order by l.dia_negocio desc, minutos_preparacion desc;
$$;

create or replace function public.metricas_cierres_caja_admin(
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns table(
  dia_negocio date,
  cerrado_por text,
  efectivo_esperado numeric,
  efectivo_contado numeric,
  diferencia numeric,
  estado text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cc.dia_negocio,
    cerrado.nombre as cerrado_por,
    cc.efectivo_esperado,
    cc.efectivo_contado,
    cc.diferencia,
    cc.estado::text
  from public.cierres_caja cc
  left join public.perfiles cerrado on cerrado.id = cc.cerrado_por
  where public.es_admin()
    and cc.dia_negocio between p_desde and p_hasta
  order by cc.abierto_at desc
  limit 40;
$$;

create or replace function public.metricas_rotacion_stock_admin()
returns table(
  producto text,
  categoria text,
  stock_actual integer,
  stock_minimo integer,
  unidades_vendidas_30d numeric,
  dias_stock_estimado numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.nombre as producto,
    c.nombre as categoria,
    p.stock_actual,
    p.stock_minimo,
    coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0)::numeric as unidades_vendidas_30d,
    case
      when coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0) = 0 then null
      else round(p.stock_actual::numeric / (coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0)::numeric / 30), 1)
    end as dias_stock_estimado
  from public.productos p
  left join public.categorias c on c.id = p.categoria_id
  left join public.movimientos_inventario mi on mi.producto_id = p.id
  where public.es_admin()
    and p.activo = true
  group by p.id, p.nombre, c.nombre, p.stock_actual, p.stock_minimo
  order by unidades_vendidas_30d desc, p.nombre
  limit 12;
$$;

create or replace function public.resumen_metricas_admin(
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
  v_ventas numeric(12,0) := 0;
  v_costo numeric(12,0) := 0;
  v_margen numeric(12,0) := 0;
  v_compras numeric(12,0) := 0;
  v_propinas numeric(12,0) := 0;
  v_retiros numeric(12,0) := 0;
  v_diferencias numeric(12,0) := 0;
  v_tiempo numeric := 0;
  v_cobradas numeric(12,0) := 0;
  v_pagadas numeric(12,0) := 0;
  v_cerradas numeric(12,0) := 0;
  v_abiertas numeric(12,0) := 0;
  v_por_cobrar numeric(12,0) := 0;
  v_pendientes numeric(12,0) := 0;
  v_parcial_pagado numeric(12,0) := 0;
  v_parcial_faltante numeric(12,0) := 0;
  v_anulado numeric(12,0) := 0;
  v_pedidos_anulados bigint := 0;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_lee_metricas' using errcode = '42501';
  end if;

  select coalesce(sum(ingreso), 0), coalesce(sum(costo_estimado), 0), coalesce(sum(margen_estimado), 0)
    into v_ventas, v_costo, v_margen
  from public.metricas_lineas_venta_admin(p_desde, p_hasta)
  where not anulado;

  select coalesce(sum(total), 0) into v_compras
  from public.compras
  where fecha between p_desde and p_hasta;

  select coalesce(sum(pg.propina), 0) into v_propinas
  from public.pagos pg
  join public.cuentas c on c.id = pg.cuenta_id
  where c.dia_negocio between p_desde and p_hasta
    and not coalesce(pg.anulado, false);

  select coalesce(sum(monto), 0) into v_retiros
  from public.v_metricas_retiros_caja
  where dia_negocio between p_desde and p_hasta;

  select coalesce(sum(diferencia), 0) into v_diferencias
  from public.metricas_cierres_caja_admin(p_desde, p_hasta);

  select coalesce(round(avg(minutos_preparacion), 2), 0) into v_tiempo
  from public.metricas_tiempos_preparacion_admin(p_desde, p_hasta);

  select
    coalesce(sum(pagado) filter (where segmento = 'cobradas'), 0),
    coalesce(sum(pagado) filter (where estado_cuenta = 'pagada'), 0),
    coalesce(sum(pagado) filter (where estado_cuenta = 'cerrada'), 0),
    coalesce(sum(venta_bruta) filter (where segmento = 'abiertas'), 0),
    coalesce(sum(venta_bruta) filter (where segmento = 'por_cobrar'), 0),
    coalesce(sum(venta_bruta) filter (where segmento = 'pendiente'), 0),
    coalesce(sum(pagado) filter (where segmento = 'pagada_parcial'), 0),
    coalesce(sum(faltante) filter (where segmento = 'pagada_parcial'), 0)
  into v_cobradas, v_pagadas, v_cerradas, v_abiertas, v_por_cobrar, v_pendientes, v_parcial_pagado, v_parcial_faltante
  from public.metricas_estado_cuentas_admin(p_desde, p_hasta);

  select coalesce(sum(monto_anulado), 0), coalesce(sum(pedidos_anulados), 0)
    into v_anulado, v_pedidos_anulados
  from public.metricas_anulados_admin(p_desde, p_hasta);

  return jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'ventas', v_ventas,
    'costo_estimado', v_costo,
    'margen_estimado', v_margen,
    'margen_pct', round((v_margen / nullif(v_ventas, 0)) * 100, 2),
    'compras', v_compras,
    'ganancia_vs_compras', v_ventas - v_compras,
    'propinas', v_propinas,
    'retiros', v_retiros,
    'diferencias_caja', v_diferencias,
    'tiempo_preparacion_promedio_min', v_tiempo,
    'cobradas', v_cobradas,
    'cobradas_pagadas', v_pagadas,
    'cobradas_cerradas', v_cerradas,
    'abiertas', v_abiertas,
    'por_cobrar', v_por_cobrar,
    'pendientes', v_pendientes,
    'parcial_pagado', v_parcial_pagado,
    'parcial_faltante', v_parcial_faltante,
    'anulado', v_anulado,
    'pedidos_anulados', v_pedidos_anulados
  );
end;
$$;

create or replace function public.exportar_metricas_csv(
  p_reporte text,
  p_desde date default current_date - 30,
  p_hasta date default current_date
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_csv text;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_exporta_metricas' using errcode = '42501';
  end if;

  if p_reporte = 'ventas_mesero' then
    select 'dia_negocio,mesero,cuentas,pedidos,ventas_brutas,ventas_pendientes' || chr(10) || coalesce(string_agg(
      dia_negocio || ',' || public.csv_escape(mesero) || ',' || cuentas || ',' || pedidos || ',' || coalesce(ventas_brutas, 0) || ',' || coalesce(ventas_pendientes, 0),
      chr(10)
    ), '') into v_csv
    from public.metricas_ventas_mesero_admin(p_desde, p_hasta);
  elsif p_reporte = 'productos' then
    select 'item,categoria,unidades,ventas,costo,margen,margen_pct' || chr(10) || coalesce(string_agg(
      public.csv_escape(item_nombre) || ',' || public.csv_escape(categoria) || ',' || unidades_vendidas || ',' || ventas || ',' || costo_estimado || ',' || margen_estimado || ',' || coalesce(margen_pct, 0),
      chr(10)
    ), '') into v_csv
    from public.metricas_margen_producto_admin(p_desde, p_hasta);
  elsif p_reporte = 'cierres' then
    select 'dia_negocio,cerrado_por,efectivo_esperado,efectivo_contado,diferencia,estado' || chr(10) || coalesce(string_agg(
      dia_negocio || ',' || public.csv_escape(cerrado_por) || ',' || coalesce(efectivo_esperado, 0) || ',' || coalesce(efectivo_contado, 0) || ',' || coalesce(diferencia, 0) || ',' || estado,
      chr(10)
    ), '') into v_csv
    from public.metricas_cierres_caja_admin(p_desde, p_hasta);
  else
    raise exception 'reporte_no_soportado' using errcode = '22023';
  end if;

  return v_csv;
end;
$$;

grant execute on function public.metricas_lineas_venta_admin(date, date) to authenticated;
grant execute on function public.metricas_estado_cuentas_admin(date, date) to authenticated;
grant execute on function public.metricas_estado_dia_admin(date, date) to authenticated;
grant execute on function public.metricas_anulados_admin(date, date) to authenticated;
grant execute on function public.metricas_margen_producto_admin(date, date) to authenticated;
grant execute on function public.metricas_margen_global_dia_admin(date, date) to authenticated;
grant execute on function public.metricas_ventas_mesero_admin(date, date) to authenticated;
grant execute on function public.metricas_tiempos_preparacion_admin(date, date) to authenticated;
grant execute on function public.metricas_cierres_caja_admin(date, date) to authenticated;
grant execute on function public.metricas_rotacion_stock_admin() to authenticated;
grant execute on function public.resumen_metricas_admin(date, date) to authenticated;
grant execute on function public.exportar_metricas_csv(text, date, date) to authenticated;
