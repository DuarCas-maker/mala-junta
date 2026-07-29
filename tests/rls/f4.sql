begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select is(public.clasificar_documento(100000, current_date)::text, 'pos', 'Venta baja clasifica como POS');
select is(public.clasificar_documento(300000, current_date)::text, 'factura_venta', 'Venta mayor a 5 UVT clasifica como factura venta');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok(
  $$ select public.generar_documento_cuenta(gen_random_uuid(), null) $$,
  '42501',
  'solo_caja_o_admin_genera_documentos',
  'Mesero no genera documentos'
);

create temp table f4_pedido as
select public.crear_pedido_rapido(
  null,
  jsonb_build_array(
    jsonb_build_object('producto_id', (select id from public.productos where codigo_interno = 'LIC-WH-OLDPARR'), 'cantidad', 1),
    jsonb_build_object('producto_id', (select id from public.productos where codigo_interno = 'BEB-AGUA'), 'cantidad', 1)
  ),
  'Pedido F4 mayor a 5 UVT'
) as pedido_id;

create temp table f4_cuenta as
select p.cuenta_id, c.total_cuenta
from public.pedidos p
join public.cuentas c on c.id = p.cuenta_id
where p.id = (select pedido_id from f4_pedido);

select ok((select total_cuenta from f4_cuenta) > 5 * public.uvt_vigente(current_date), 'Cuenta de prueba supera 5 UVT');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select lives_ok($$ select public.abrir_caja(50000) $$, 'Caja abre turno para cobro F4');

select throws_ok(
  $$ select public.registrar_pagos_cuenta_dian(
    (select cuenta_id from f4_cuenta),
    jsonb_build_array(jsonb_build_object('medio', 'efectivo', 'monto', (select total_cuenta from f4_cuenta))),
    0,
    false,
    null,
    null,
    null
  ) $$,
  '22023',
  'factura_venta_requiere_adquiriente',
  'Venta mayor a 5 UVT exige adquiriente antes de cobrar'
);

select lives_ok(
  $$ select public.registrar_pagos_cuenta_dian(
    (select cuenta_id from f4_cuenta),
    jsonb_build_array(jsonb_build_object('medio', 'efectivo', 'monto', (select total_cuenta from f4_cuenta))),
    0,
    false,
    null,
    jsonb_build_object('razon_social', 'Cliente F4', 'tipo_id', 'CC', 'numero_id', '123456789', 'correo', 'cliente@example.com'),
    jsonb_build_object('canal', 'correo', 'destino', 'cliente@example.com')
  ) $$,
  'Venta mayor a 5 UVT cobra con adquiriente'
);

select is(
  (select tipo::text from public.documentos where cuenta_id = (select cuenta_id from f4_cuenta) order by generated_at desc limit 1),
  'factura_venta',
  'Documento generado como factura_venta'
);

select is(
  (select estado_dian::text from public.documentos where cuenta_id = (select cuenta_id from f4_cuenta) order by generated_at desc limit 1),
  'no_transmitido',
  'Documento queda no transmitido'
);

select is(
  (select estado::text from public.envios_comprobante order by timestamp desc limit 1),
  'simulado',
  'Envio de comprobante queda simulado'
);

select * from finish();
rollback;
