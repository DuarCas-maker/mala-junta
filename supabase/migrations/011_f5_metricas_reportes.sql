-- F5 - Metricas y reportes admin M-01..M-12.

create or replace view public.v_metricas_lineas_venta
with (security_invoker = true)
as
select
  c.dia_negocio,
  p.enviado_at,
  p.entregado_at,
  extract(hour from p.enviado_at at time zone 'America/Bogota')::int as hora_bogota,
  c.id as cuenta_id,
  p.id as pedido_id,
  pi.id as pedido_item_id,
  p.mesero_id,
  mesero.nombre as mesero_nombre,
  pi.producto_id,
  pi.combo_id,
  coalesce(pr.nombre, co.nombre, 'Item') as item_nombre,
  case when pi.combo_id is not null then 'Combo' else coalesce(cat.nombre, 'Sin categoria') end as categoria,
  pi.cantidad,
  pi.precio_unitario_capturado,
  (pi.cantidad * pi.precio_unitario_capturado)::numeric(12,0) as ingreso,
  case
    when pi.producto_id is not null then (pi.cantidad * coalesce(pr.costo_unitario_actual, 0))::numeric(12,0)
    else coalesce((
      select sum(pi.cantidad * ci.cantidad * coalesce(cp.costo_unitario_actual, 0))::numeric(12,0)
      from public.combo_items ci
      join public.productos cp on cp.id = ci.producto_id
      where ci.combo_id = pi.combo_id
        and ci.activo = true
    ), 0)::numeric(12,0)
  end as costo_estimado,
  ((pi.cantidad * pi.precio_unitario_capturado) - case
    when pi.producto_id is not null then (pi.cantidad * coalesce(pr.costo_unitario_actual, 0))::numeric(12,0)
    else coalesce((
      select sum(pi.cantidad * ci.cantidad * coalesce(cp.costo_unitario_actual, 0))::numeric(12,0)
      from public.combo_items ci
      join public.productos cp on cp.id = ci.producto_id
      where ci.combo_id = pi.combo_id
        and ci.activo = true
    ), 0)::numeric(12,0)
  end)::numeric(12,0) as margen_estimado,
  case when p.entregado_at is null then null else round(extract(epoch from (p.entregado_at - p.enviado_at)) / 60, 2) end as minutos_preparacion
from public.pedido_items pi
join public.pedidos p on p.id = pi.pedido_id
join public.cuentas c on c.id = p.cuenta_id
join public.perfiles mesero on mesero.id = p.mesero_id
left join public.productos pr on pr.id = pi.producto_id
left join public.categorias cat on cat.id = pr.categoria_id
left join public.combos co on co.id = pi.combo_id
where public.es_admin()
  and p.estado <> 'anulado'
  and pi.estado <> 'anulado';

create or replace view public.v_metricas_margen_producto
with (security_invoker = true)
as
select
  item_nombre,
  categoria,
  count(distinct pedido_item_id) as lineas,
  sum(cantidad) as unidades_vendidas,
  sum(ingreso)::numeric(12,0) as ventas,
  sum(costo_estimado)::numeric(12,0) as costo_estimado,
  sum(margen_estimado)::numeric(12,0) as margen_estimado,
  round((sum(margen_estimado) / nullif(sum(ingreso), 0)) * 100, 2) as margen_pct
from public.v_metricas_lineas_venta
group by item_nombre, categoria
order by margen_estimado desc, ventas desc;

create or replace view public.v_metricas_margen_global_dia
with (security_invoker = true)
as
select
  dia_negocio,
  sum(ingreso)::numeric(12,0) as ventas,
  sum(costo_estimado)::numeric(12,0) as costo_estimado,
  sum(margen_estimado)::numeric(12,0) as margen_estimado,
  round((sum(margen_estimado) / nullif(sum(ingreso), 0)) * 100, 2) as margen_pct
from public.v_metricas_lineas_venta
group by dia_negocio
order by dia_negocio desc;

create or replace view public.v_metricas_kardex_detallado
with (security_invoker = true)
as
select
  mi.id,
  mi.timestamp,
  public.dia_negocio(mi.timestamp) as dia_negocio,
  p.id as producto_id,
  p.nombre as producto,
  c.nombre as categoria,
  mi.tipo,
  mi.cantidad,
  mi.stock_resultante,
  mi.referencia_tipo,
  mi.referencia_id,
  m.texto as motivo,
  u.nombre as usuario
from public.movimientos_inventario mi
join public.productos p on p.id = mi.producto_id
left join public.categorias c on c.id = p.categoria_id
left join public.motivos m on m.id = mi.motivo_id
left join public.perfiles u on u.id = mi.usuario_id
where public.es_admin()
order by mi.timestamp desc;

create or replace view public.v_metricas_rotacion_stock
with (security_invoker = true)
as
select
  p.id as producto_id,
  p.nombre as producto,
  c.nombre as categoria,
  p.stock_actual,
  p.stock_minimo,
  p.costo_unitario_actual,
  coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0)::numeric as unidades_vendidas_30d,
  round(coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0)::numeric / 30, 2) as rotacion_diaria_30d,
  case
    when coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0) = 0 then null
    else round(p.stock_actual::numeric / (coalesce(sum(abs(mi.cantidad)) filter (where mi.tipo = 'venta' and mi.timestamp >= now() - interval '30 days'), 0)::numeric / 30), 1)
  end as dias_stock_estimado
from public.productos p
left join public.categorias c on c.id = p.categoria_id
left join public.movimientos_inventario mi on mi.producto_id = p.id
where public.es_admin()
  and p.activo = true
group by p.id, p.nombre, c.nombre, p.stock_actual, p.stock_minimo, p.costo_unitario_actual
order by coalesce(unidades_vendidas_30d, 0) desc, p.nombre;

create or replace view public.v_metricas_diferencias_auditoria
with (security_invoker = true)
as
select
  ai.id as auditoria_item_id,
  a.id as auditoria_id,
  a.dia_negocio,
  a.created_at,
  u.nombre as auditor,
  p.nombre as producto,
  c.nombre as categoria,
  ai.teorico,
  ai.contado,
  ai.diferencia,
  m.texto as motivo,
  ai.movimiento_inventario_id
from public.auditoria_items ai
join public.auditorias_inventario a on a.id = ai.auditoria_id
join public.productos p on p.id = ai.producto_id
left join public.categorias c on c.id = p.categoria_id
left join public.perfiles u on u.id = a.usuario_id
left join public.motivos m on m.id = ai.motivo_id
where public.es_admin()
  and coalesce(ai.diferencia, 0) <> 0
order by a.created_at desc;

create or replace view public.v_metricas_cierres_caja
with (security_invoker = true)
as
select
  cc.id,
  cc.dia_negocio,
  cc.abierto_at,
  cc.cerrado_at,
  abierto.nombre as abierto_por,
  cerrado.nombre as cerrado_por,
  cc.base_inicial,
  cc.efectivo_esperado,
  cc.efectivo_contado,
  cc.diferencia,
  cc.estado,
  cc.justificacion_diferencia
from public.cierres_caja cc
left join public.perfiles abierto on abierto.id = cc.abierto_por
left join public.perfiles cerrado on cerrado.id = cc.cerrado_por
where public.es_admin()
order by cc.abierto_at desc;

create or replace view public.v_metricas_retiros_caja
with (security_invoker = true)
as
select
  r.id,
  c.dia_negocio,
  r.timestamp,
  r.monto,
  m.texto as motivo,
  r.observacion,
  r.numero_factura,
  u.nombre as usuario
from public.retiros_caja r
join public.cierres_caja c on c.id = r.cierre_caja_id
left join public.motivos m on m.id = r.motivo_id
left join public.perfiles u on u.id = r.usuario_id
where public.es_admin()
order by r.timestamp desc;

create or replace view public.v_metricas_propinas
with (security_invoker = true)
as
select
  c.dia_negocio,
  coalesce(responsable.nombre, cajero.nombre, 'Sin responsable') as responsable,
  sum(pg.propina)::numeric(12,0) as propinas,
  count(distinct pg.cuenta_id) as cuentas
from public.pagos pg
join public.cuentas c on c.id = pg.cuenta_id
left join public.perfiles responsable on responsable.id = c.abierta_por
left join public.perfiles cajero on cajero.id = pg.usuario_id
where public.es_admin()
group by c.dia_negocio, coalesce(responsable.nombre, cajero.nombre, 'Sin responsable')
order by c.dia_negocio desc, propinas desc;

create or replace view public.v_metricas_ventas_mesero
with (security_invoker = true)
as
select
  c.dia_negocio,
  mesero.id as mesero_id,
  mesero.nombre as mesero,
  count(distinct c.id) as cuentas,
  count(distinct p.id) as pedidos,
  sum(pi.cantidad * pi.precio_unitario_capturado)::numeric(12,0) as ventas_brutas,
  sum(pi.cantidad * pi.precio_unitario_capturado) filter (where c.estado <> 'pendiente')::numeric(12,0) as ventas_contado_o_pagadas,
  sum(pi.cantidad * pi.precio_unitario_capturado) filter (where c.estado = 'pendiente')::numeric(12,0) as ventas_pendientes
from public.cuentas c
join public.pedidos p on p.cuenta_id = c.id
join public.pedido_items pi on pi.pedido_id = p.id
join public.perfiles mesero on mesero.id = p.mesero_id
where public.es_admin()
  and p.estado <> 'anulado'
  and pi.estado <> 'anulado'
group by c.dia_negocio, mesero.id, mesero.nombre
order by c.dia_negocio desc, ventas_brutas desc;

create or replace view public.v_metricas_tiempos_preparacion
with (security_invoker = true)
as
select
  c.dia_negocio,
  p.id as pedido_id,
  mesero.nombre as mesero,
  p.enviado_at,
  p.entregado_at,
  round(extract(epoch from (p.entregado_at - p.enviado_at)) / 60, 2) as minutos_preparacion,
  count(pi.id) as items
from public.pedidos p
join public.cuentas c on c.id = p.cuenta_id
join public.perfiles mesero on mesero.id = p.mesero_id
left join public.pedido_items pi on pi.pedido_id = p.id and pi.estado <> 'anulado'
where public.es_admin()
  and p.estado = 'entregado'
  and p.entregado_at is not null
group by c.dia_negocio, p.id, mesero.nombre, p.enviado_at, p.entregado_at
order by p.entregado_at desc;

create or replace view public.v_metricas_ventas_franja
with (security_invoker = true)
as
select
  dia_negocio,
  hora_bogota,
  categoria,
  item_nombre,
  sum(cantidad) as unidades,
  sum(ingreso)::numeric(12,0) as ventas
from public.v_metricas_lineas_venta
group by dia_negocio, hora_bogota, categoria, item_nombre
order by dia_negocio desc, hora_bogota, ventas desc;

create or replace function public.metricas_margen_producto_admin(p_desde date default current_date - 30, p_hasta date default current_date)
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
    count(distinct l.pedido_item_id) as lineas,
    sum(l.cantidad)::bigint as unidades_vendidas,
    sum(l.ingreso)::numeric(12,0) as ventas,
    sum(l.costo_estimado)::numeric(12,0) as costo_estimado,
    sum(l.margen_estimado)::numeric(12,0) as margen_estimado,
    round((sum(l.margen_estimado) / nullif(sum(l.ingreso), 0)) * 100, 2) as margen_pct
  from public.v_metricas_lineas_venta l
  where l.dia_negocio between p_desde and p_hasta
    and public.es_admin()
  group by l.item_nombre, l.categoria
  order by margen_estimado desc, ventas desc;
$$;
create or replace function public.resumen_metricas_admin(p_desde date default current_date - 30, p_hasta date default current_date)
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
begin
  if not public.es_admin() then
    raise exception 'solo_admin_lee_metricas' using errcode = '42501';
  end if;

  select coalesce(sum(ingreso), 0), coalesce(sum(costo_estimado), 0), coalesce(sum(margen_estimado), 0)
  into v_ventas, v_costo, v_margen
  from public.v_metricas_lineas_venta
  where dia_negocio between p_desde and p_hasta;

  select coalesce(sum(total), 0) into v_compras
  from public.compras
  where fecha between p_desde and p_hasta;

  select coalesce(sum(propina), 0) into v_propinas
  from public.pagos pg
  join public.cuentas c on c.id = pg.cuenta_id
  where c.dia_negocio between p_desde and p_hasta;

  select coalesce(sum(monto), 0) into v_retiros
  from public.v_metricas_retiros_caja
  where dia_negocio between p_desde and p_hasta;

  select coalesce(sum(diferencia), 0) into v_diferencias
  from public.v_metricas_cierres_caja
  where dia_negocio between p_desde and p_hasta;

  select coalesce(round(avg(minutos_preparacion), 2), 0) into v_tiempo
  from public.v_metricas_tiempos_preparacion
  where dia_negocio between p_desde and p_hasta;

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
    'tiempo_preparacion_promedio_min', v_tiempo
  );
end;
$$;

create or replace function public.csv_escape(p_valor text)
returns text
language sql
immutable
as $$
  select '"' || replace(coalesce(p_valor, ''), '"', '""') || '"';
$$;

create or replace function public.exportar_metricas_csv(p_reporte text, p_desde date default current_date - 30, p_hasta date default current_date)
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
    from public.v_metricas_ventas_mesero
    where dia_negocio between p_desde and p_hasta;
  elsif p_reporte = 'productos' then
    select 'item,categoria,unidades,ventas,costo,margen,margen_pct' || chr(10) || coalesce(string_agg(
      public.csv_escape(item_nombre) || ',' || public.csv_escape(categoria) || ',' || unidades_vendidas || ',' || ventas || ',' || costo_estimado || ',' || margen_estimado || ',' || coalesce(margen_pct, 0),
      chr(10)
    ), '') into v_csv
    from public.metricas_margen_producto_admin(p_desde, p_hasta);
  elsif p_reporte = 'kardex' then
    select 'timestamp,producto,tipo,cantidad,stock_resultante,motivo,usuario' || chr(10) || coalesce(string_agg(
      timestamp || ',' || public.csv_escape(producto) || ',' || tipo || ',' || cantidad || ',' || coalesce(stock_resultante, 0) || ',' || public.csv_escape(motivo) || ',' || public.csv_escape(usuario),
      chr(10)
    ), '') into v_csv
    from public.v_metricas_kardex_detallado
    where dia_negocio between p_desde and p_hasta;
  elsif p_reporte = 'cierres' then
    select 'dia_negocio,cerrado_por,efectivo_esperado,efectivo_contado,diferencia,estado' || chr(10) || coalesce(string_agg(
      dia_negocio || ',' || public.csv_escape(cerrado_por) || ',' || coalesce(efectivo_esperado, 0) || ',' || coalesce(efectivo_contado, 0) || ',' || coalesce(diferencia, 0) || ',' || estado,
      chr(10)
    ), '') into v_csv
    from public.v_metricas_cierres_caja
    where dia_negocio between p_desde and p_hasta;
  else
    raise exception 'reporte_no_soportado' using errcode = '22023';
  end if;

  return v_csv;
end;
$$;

grant select on
  public.v_metricas_lineas_venta,
  public.v_metricas_margen_producto,
  public.v_metricas_margen_global_dia,
  public.v_metricas_kardex_detallado,
  public.v_metricas_rotacion_stock,
  public.v_metricas_diferencias_auditoria,
  public.v_metricas_cierres_caja,
  public.v_metricas_retiros_caja,
  public.v_metricas_propinas,
  public.v_metricas_ventas_mesero,
  public.v_metricas_tiempos_preparacion,
  public.v_metricas_ventas_franja
to authenticated;

grant execute on function public.metricas_margen_producto_admin(date, date) to authenticated;
grant execute on function public.resumen_metricas_admin(date, date) to authenticated;
grant execute on function public.exportar_metricas_csv(text, date, date) to authenticated;
