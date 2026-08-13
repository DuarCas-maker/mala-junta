begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

create temp table f6_ctx as
select
  (select id from public.productos where codigo_interno = 'CER-POKER') as producto_id,
  (select stock_actual from public.productos where codigo_interno = 'CER-POKER') as stock_inicial,
  (select costo_unitario_actual from public.productos where codigo_interno = 'CER-POKER') as costo_catalogo,
  (select precio_venta from public.productos where codigo_interno = 'CER-POKER') as precio_catalogo,
  (select id from public.proveedores order by nombre limit 1) as proveedor_id,
  (select id from public.perfiles where auth_user_id = '00000000-0000-0000-0000-000000000001') as admin_perfil_id;

select isnt((select producto_id from f6_ctx), null, 'Seed tiene producto base para compras OCR');
select isnt((select proveedor_id from f6_ctx), null, 'Seed tiene proveedor base para compras OCR');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

create temp table f6_captura as
with creada as (
  insert into public.capturas_compra (
    usuario_id,
    proveedor_id,
    storage_path,
    nombre_archivo,
    estado,
    fecha_ingreso,
    observacion
  )
  select
    admin_perfil_id,
    proveedor_id,
    'tests/f6/factura-compra.jpg',
    'factura-compra.jpg',
    'procesada',
    current_date,
    'Compra OCR test F6'
  from f6_ctx
  returning id
)
select id from creada;

insert into public.captura_compra_lineas (
  captura_id,
  orden,
  texto_original,
  producto_nombre_detectado,
  producto_id,
  modo,
  cantidad_ingresada,
  factor_aplicado,
  unidades_resultantes,
  costo_unitario_catalogo,
  precio_venta_catalogo,
  subtotal_costo,
  stock_actual_snapshot,
  stock_proyectado,
  confianza_ia,
  puntaje_match,
  requiere_revision,
  precio_catalogo_confirmado,
  estado
)
select
  f6_captura.id,
  1,
  'Poker x 3',
  'Poker',
  f6_ctx.producto_id,
  'unidades',
  3,
  1,
  3,
  f6_ctx.costo_catalogo,
  f6_ctx.precio_catalogo,
  f6_ctx.costo_catalogo * 3,
  f6_ctx.stock_inicial,
  f6_ctx.stock_inicial + 3,
  0.9800,
  1.0000,
  false,
  true,
  'lista'
from f6_captura, f6_ctx;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.aprobar_captura_compra_admin((select id from f6_captura)) $$,
  '42501',
  'solo_admin_aprueba_compras_ocr',
  'Caja no aprueba compras OCR'
);

select throws_ok(
  $$ select public.rechazar_captura_compra_admin((select id from f6_captura), 'rechazo caja') $$,
  '42501',
  'solo_admin_rechaza_compras_ocr',
  'Caja no rechaza compras OCR'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select public.aprobar_captura_compra_admin((select id from f6_captura)) $$,
  'Admin aprueba compra OCR'
);

select is(
  (select estado::text from public.capturas_compra where id = (select id from f6_captura)),
  'confirmada',
  'La captura queda confirmada'
);

select isnt(
  (select compra_id from public.capturas_compra where id = (select id from f6_captura)),
  null,
  'La captura queda enlazada a una compra'
);

select is(
  (select stock_actual from public.productos where id = (select producto_id from f6_ctx)),
  (select stock_inicial + 3 from f6_ctx),
  'La aprobacion aumenta stock'
);

select ok(
  exists (
    select 1
    from public.movimientos_inventario mi
    join public.captura_compra_lineas l on l.compra_item_id = mi.referencia_id
    where l.captura_id = (select id from f6_captura)
      and mi.tipo = 'compra'
      and mi.referencia_tipo = 'compra_item'
      and mi.cantidad = 3
  ),
  'La aprobacion crea movimiento de inventario'
);

select ok(
  exists (
    select 1
    from public.v_admin_entradas_inventario_ocr
    where captura_id = (select id from f6_captura)
      and unidades_resultantes = 3
      and stock_resultante = (select stock_inicial + 3 from f6_ctx)
  ),
  'La vista de auditoria muestra la entrada OCR'
);

select ok(
  exists (
    select 1
    from public.log_auditoria
    where accion = 'aprobar_captura_compra_ocr'
      and entidad_id = (select id from f6_captura)
  ),
  'La aprobacion queda en log de auditoria'
);

select throws_ok(
  $$ select public.aprobar_captura_compra_admin((select id from f6_captura)) $$,
  '23505',
  'captura_compra_ya_confirmada',
  'No permite aprobar dos veces'
);

select throws_ok(
  $$ select public.rechazar_captura_compra_admin((select id from f6_captura), 'rechazo tardio') $$,
  '22023',
  'captura_compra_confirmada_no_rechazable',
  'No permite rechazar una compra confirmada'
);

select * from finish();
rollback;
