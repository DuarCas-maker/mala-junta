-- 032_f24_metricas_ventas_ganancias_historicas.sql
-- Sprint 5: metricas admin con precio real capturado y costo historico aprobado.

create or replace view public.v_metricas_lineas_venta
with (security_invoker = true)
as
select
  base.dia_negocio,
  base.enviado_at,
  base.entregado_at,
  base.hora_bogota,
  base.cuenta_id,
  base.pedido_id,
  base.pedido_item_id,
  base.mesero_id,
  base.mesero_nombre,
  base.producto_id,
  base.combo_id,
  base.item_nombre,
  base.categoria,
  base.cantidad,
  base.precio_unitario_capturado,
  (base.cantidad * base.precio_unitario_capturado)::numeric(12,0) as ingreso,
  (base.cantidad * base.costo_unitario_usado)::numeric(12,0) as costo_estimado,
  ((base.cantidad * base.precio_unitario_capturado) - (base.cantidad * base.costo_unitario_usado))::numeric(12,0) as margen_estimado,
  case when base.entregado_at is null then null else round(extract(epoch from (base.entregado_at - base.enviado_at)) / 60, 2) end as minutos_preparacion,
  base.costo_unitario_usado,
  base.precio_catalogo_usado,
  base.origen_precio
from (
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
    coalesce(nullif(pi.costo_unitario_historico, 0), case
      when pi.producto_id is not null then coalesce(pr.costo_unitario_actual, 0)
      else coalesce((
        select sum(ci.cantidad * coalesce(cp.costo_unitario_actual, 0))::numeric(12,0)
        from public.combo_items ci
        join public.productos cp on cp.id = ci.producto_id
        where ci.combo_id = pi.combo_id
          and ci.activo = true
      ), 0)::numeric(12,0)
    end)::numeric(12,0) as costo_unitario_usado,
    coalesce(nullif(pi.precio_catalogo_historico, 0), case
      when pi.producto_id is not null then coalesce(pr.precio_venta, pi.precio_unitario_capturado, 0)
      else coalesce(co.precio_venta, pi.precio_unitario_capturado, 0)
    end)::numeric(12,0) as precio_catalogo_usado,
    coalesce(nullif(pi.origen_precio, ''), 'catalogo') as origen_precio
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.pedido_id
  join public.cuentas c on c.id = p.cuenta_id
  join public.perfiles mesero on mesero.id = p.mesero_id
  left join public.productos pr on pr.id = pi.producto_id
  left join public.categorias cat on cat.id = pr.categoria_id
  left join public.combos co on co.id = pi.combo_id
  where public.es_admin()
    and p.estado <> 'anulado'
    and pi.estado <> 'anulado'
) base;

create or replace view public.v_metricas_margen_item_dia
with (security_invoker = true)
as
select
  dia_negocio,
  item_nombre,
  categoria,
  count(distinct pedido_item_id) as lineas,
  sum(cantidad)::bigint as unidades_vendidas,
  sum(ingreso)::numeric(12,0) as ventas,
  sum(costo_estimado)::numeric(12,0) as costo_estimado,
  sum(margen_estimado)::numeric(12,0) as margen_estimado,
  round((sum(margen_estimado) / nullif(sum(ingreso), 0)) * 100, 2) as margen_pct
from public.v_metricas_lineas_venta
where public.es_admin()
group by dia_negocio, item_nombre, categoria;

create or replace view public.v_metricas_margen_categoria_dia
with (security_invoker = true)
as
select
  dia_negocio,
  categoria,
  count(distinct pedido_item_id) as lineas,
  sum(cantidad)::bigint as unidades_vendidas,
  sum(ingreso)::numeric(12,0) as ventas,
  sum(costo_estimado)::numeric(12,0) as costo_estimado,
  sum(margen_estimado)::numeric(12,0) as margen_estimado,
  round((sum(margen_estimado) / nullif(sum(ingreso), 0)) * 100, 2) as margen_pct
from public.v_metricas_lineas_venta
where public.es_admin()
group by dia_negocio, categoria;

grant select on
  public.v_metricas_lineas_venta,
  public.v_metricas_margen_item_dia,
  public.v_metricas_margen_categoria_dia
to authenticated;