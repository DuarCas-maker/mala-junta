begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.f9_id(p_nombre text) returns uuid language sql as
$$ select current_setting('app.f9.' || p_nombre)::uuid $$;
select set_config('app.f9.mesa', (select id::text from mesas where activa order by nombre limit 1), true);
select set_config('app.f9.producto', (select id::text from productos where activo order by nombre limit 1), true);
select set_config('app.f9.solicitud', gen_random_uuid()::text, true);

select is(public.dia_negocio('2026-10-07 09:59:59-05'::timestamptz), '2026-10-06'::date, 'Antes de las 10 conserva jornada anterior');
select is(public.dia_negocio('2026-10-07 10:00:00-05'::timestamptz), '2026-10-07'::date, 'A las 10 empieza jornada nueva');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok('select public.procesar_corte_jornada()', '42501', 'permission denied for function procesar_corte_jornada', 'Mesero no ejecuta el corte privilegiado');
select throws_ok(format('select public.actualizar_responsable_pendiente(%L, %L)', gen_random_uuid(), 'Carlos'), '42501', 'solo_caja_o_admin_identifica_pendiente', 'Mesero no asigna responsables de deudas');

select set_config('app.f9.pedido', public.crear_pedido_rapido(pg_temp.f9_id('mesa'),
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1)),
  'prueba jornada', 'Carlos', true, null, now(), pg_temp.f9_id('solicitud'))::text, true);
select is(public.crear_pedido_rapido(pg_temp.f9_id('mesa'),
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1)),
  'prueba jornada', 'Carlos', true, null, now(), pg_temp.f9_id('solicitud')), pg_temp.f9_id('pedido'), 'Reintentar solicitud devuelve el pedido sin duplicar');
select set_config('app.f9.cuenta', (select cuenta_id::text from pedidos where id = pg_temp.f9_id('pedido')), true);

select set_config('app.f9.preparacion', public.crear_pedido_rapido(null,
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1)), 'preparacion')::text, true);
select set_config('app.f9.entregado', public.crear_pedido_rapido(null,
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1)), 'entregado')::text, true);

reset role;
update cuentas set dia_negocio = public.dia_negocio(now()) - 1
where id in (select cuenta_id from pedidos where id in (pg_temp.f9_id('pedido'), pg_temp.f9_id('preparacion'), pg_temp.f9_id('entregado')));
update pedidos set enviado_at = (public.dia_negocio(now()) - 1 + time '23:00') at time zone 'America/Bogota',
  estado = case when id = pg_temp.f9_id('preparacion') then 'en_preparacion'::public.estado_pedido
                when id = pg_temp.f9_id('entregado') then 'entregado'::public.estado_pedido else estado end
where id in (pg_temp.f9_id('pedido'), pg_temp.f9_id('preparacion'), pg_temp.f9_id('entregado'));
update pedido_items set estado = p.estado from pedidos p where p.id = pedido_id
  and p.id in (pg_temp.f9_id('preparacion'), pg_temp.f9_id('entregado'));
update cuentas set responsable_pendiente = 'Carlos' where id = pg_temp.f9_id('cuenta');
select set_config('app.f9.total', (select total_cuenta::text from cuentas where id = pg_temp.f9_id('cuenta')), true);
select set_config('app.f9.fecha', (select enviado_at::text from pedidos where id = pg_temp.f9_id('pedido')), true);
select set_config('app.f9.stock', (select stock_actual::text from productos where id = pg_temp.f9_id('producto')), true);

insert into cierres_caja(dia_negocio, abierto_por, base_inicial)
values (public.dia_negocio(now()) - 1, '10000000-0000-0000-0000-000000000002', 0);
select set_config('app.f9.cierre_anterior', (select id::text from cierres_caja where estado = 'abierta'), true);
insert into pagos(cuenta_id, cierre_caja_id, medio, monto, usuario_id)
values (pg_temp.f9_id('cuenta'), pg_temp.f9_id('cierre_anterior'), 'efectivo', 1000, '10000000-0000-0000-0000-000000000002');
update cuentas set estado = 'pagada_parcial' where id = pg_temp.f9_id('cuenta');

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select is(public.procesar_corte_jornada(), 3, 'Corte libera enviados, preparacion y entregados con saldo');
select is(public.procesar_corte_jornada(), 0, 'Corte repetido no duplica operaciones');
reset role;
select ok((select estado = 'pendiente' and mesa_liberada_at is not null and responsable_pendiente = 'Carlos' from cuentas where id = pg_temp.f9_id('cuenta')), 'Pago parcial anterior conserva nombre y libera mesa');
select is((select total_cuenta from cuentas where id = pg_temp.f9_id('cuenta')), current_setting('app.f9.total')::numeric, 'Corte conserva total original');
select is((select enviado_at::text from pedidos where id = pg_temp.f9_id('pedido')), current_setting('app.f9.fecha'), 'Corte conserva fecha original');
select is((select stock_actual::text from productos where id = pg_temp.f9_id('producto')), current_setting('app.f9.stock'), 'Corte no modifica inventario');
select is((select estado::text from pedidos where id = pg_temp.f9_id('preparacion')), 'en_preparacion', 'No inventa entrega del pedido');
select is((select estado::text from cierres_caja where id = pg_temp.f9_id('cierre_anterior')), 'abierta', 'Corte no sustituye conteo de caja');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select ok((select cuenta_id is null from public.mesas_para_pedidos() where id = pg_temp.f9_id('mesa')), 'Selector muestra mesa disponible');
select is(public.crear_pedido_rapido(pg_temp.f9_id('mesa'),
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1)),
  'respuesta perdida', 'Carlos', true, pg_temp.f9_id('cuenta'), now() - interval '1 day', pg_temp.f9_id('solicitud')),
  pg_temp.f9_id('pedido'), 'Respuesta perdida se recupera despues del corte sin nueva venta');
select throws_ok(format('select public.crear_pedido_rapido(%L, %L::jsonb, null, null, true, %L, now())',
  pg_temp.f9_id('mesa'), jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1)), pg_temp.f9_id('cuenta')),
  '22023', 'mesa_cambio_de_cuenta_revisar_pedido', 'Cuenta esperada anterior requiere revision');
select throws_ok(format('select public.crear_pedido_rapido(%L, %L::jsonb, null, null, true, null, now() - interval ''1 day'')',
  pg_temp.f9_id('mesa'), jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1))),
  '22023', 'pedido_jornada_anterior_requiere_revision', 'Pedido guardado de otra jornada no se mezcla automaticamente');
select set_config('app.f9.nuevo_pedido', public.crear_pedido_rapido(pg_temp.f9_id('mesa'),
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1)), 'nuevo cliente', 'Ana', true, null, now())::text, true);
select set_config('app.f9.nueva_cuenta', (select cuenta_id::text from pedidos where id = pg_temp.f9_id('nuevo_pedido')), true);
select isnt(pg_temp.f9_id('nueva_cuenta'), pg_temp.f9_id('cuenta'), 'Nueva ocupacion usa una cuenta independiente');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select ok(exists(select 1 from jsonb_array_elements(public.cuentas_activas_caja()) c
  where (c ->> 'id')::uuid = (select cuenta_id from pedidos where id = pg_temp.f9_id('preparacion'))
    and c ->> 'estado_cobro' = 'Pendiente por identificar'), 'Cuenta sin nombre aparece pendiente por identificar');
select lives_ok('select public.cerrar_caja(1000)', 'Permite cerrar atrasada la caja anterior');
select ok((select mesa_liberada_at is null from cuentas where id = pg_temp.f9_id('nueva_cuenta')), 'Cierre atrasado no libera al nuevo cliente');
select lives_ok('select public.abrir_caja(0, null)', 'Abre una caja nueva para cobrar deudas');
select set_config('app.f9.cierre_actual', (select id::text from cierres_caja where estado = 'abierta'), true);
select lives_ok(format('select public.registrar_pagos_cuenta_dian(%L, ''[{"medio":"efectivo","monto":2000}]''::jsonb)', pg_temp.f9_id('cuenta')), 'Registra abono de deuda anterior');
select is((select estado::text from cuentas where id = pg_temp.f9_id('cuenta')), 'pendiente', 'Abono parcial conserva la deuda en pendientes');
select ok((select cuenta_id = pg_temp.f9_id('nueva_cuenta') from public.mesas_para_pedidos() where id = pg_temp.f9_id('mesa')), 'Abono no recupera la mesa de Ana');
select ok(exists(select 1 from pagos where cuenta_id = pg_temp.f9_id('cuenta') and cierre_caja_id = pg_temp.f9_id('cierre_actual') and es_abono_pendiente), 'Abono corresponde a caja que recibe el dinero');
select throws_ok(format('select public.quitar_pendiente_cuenta_caja(%L)', pg_temp.f9_id('cuenta')), '22023', 'cuenta_liberada_conserva_pendiente', 'No se puede reocupar mesa quitando pendiente');
select lives_ok(format('select public.actualizar_responsable_pendiente(%L, ''Luisa'')',
  (select cuenta_id from pedidos where id = pg_temp.f9_id('preparacion'))), 'Caja identifica al responsable sin caja adicional');
select is((select responsable_pendiente from cuentas where id = (select cuenta_id from pedidos where id = pg_temp.f9_id('preparacion'))), 'Luisa', 'Nombre queda guardado');

select lives_ok(format('select public.registrar_pagos_cuenta_dian(%L, %L::jsonb)', pg_temp.f9_id('cuenta'),
  jsonb_build_array(jsonb_build_object('medio','transferencia','monto',current_setting('app.f9.total')::numeric - 3000))), 'Pago restante cubre la deuda');
select is((select estado::text from cuentas where id = pg_temp.f9_id('cuenta')), 'pagada', 'Deuda cubierta pasa a pagados');
select ok(not exists(select 1 from jsonb_array_elements(public.cuentas_activas_caja()) c where (c ->> 'id')::uuid = pg_temp.f9_id('cuenta')), 'Pagada desaparece de cobros');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select lives_ok(format('select public.reversar_cuenta_pagada_admin(%L, %L, ''prueba'')', pg_temp.f9_id('cuenta'),
  (select id from motivos where tipo = 'anulacion' and activo limit 1)), 'Admin revierte pago anterior con otra cuenta en mesa');
select is((select estado::text from cuentas where id = pg_temp.f9_id('cuenta')), 'pendiente', 'Reversion conserva la mesa liberada y recupera deuda');
select ok((select cuenta_id = pg_temp.f9_id('nueva_cuenta') from public.mesas_para_pedidos() where id = pg_temp.f9_id('mesa')), 'Reversion tampoco ocupa mesa de Ana');

-- Los pagos anulados dejan de contar en caja; el cierre manual libera la jornada actual.
select lives_ok('select public.cerrar_caja(0)', 'Cierre de caja libera cuentas de jornada actual');
select is((select estado::text from cuentas where id = pg_temp.f9_id('nueva_cuenta')), 'pendiente', 'Nuevo cliente sin pagar queda pendiente al cerrar caja');
select ok((select cuenta_id is null from public.mesas_para_pedidos() where id = pg_temp.f9_id('mesa')), 'Mesa queda lista para otra ocupacion de la misma jornada');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select set_config('app.f9.contado', public.crear_pedido_rapido(pg_temp.f9_id('mesa'),
  jsonb_build_array(jsonb_build_object('producto_id', pg_temp.f9_id('producto'), 'cantidad', 1)), 'contado')::text, true);
select set_config('app.f9.cuenta_contado', (select cuenta_id::text from pedidos where id = pg_temp.f9_id('contado')), true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select public.abrir_caja(0);
select throws_ok(format('select public.marcar_cuenta_pendiente_caja(%L, null)', pg_temp.f9_id('cuenta_contado')),
  '22023', 'responsable_pendiente_requerido', 'Marcado manual exige responsable');
select lives_ok(format('select public.registrar_pagos_cuenta_base(%L, %L::jsonb, 0, true, ''Mario'')', pg_temp.f9_id('cuenta_contado'),
  jsonb_build_array(jsonb_build_object('medio','nequi_daviplata','monto',current_setting('app.f9.total')::numeric))), 'Pago completo funciona aunque se marque dejar pendiente');
select is((select estado::text from cuentas where id = pg_temp.f9_id('cuenta_contado')), 'pagada', 'Saldo cero siempre pasa a pagados');
select ok((select cuenta_id is null from public.mesas_para_pedidos() where id = pg_temp.f9_id('mesa')), 'Pago durante jornada libera mesa inmediatamente');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select set_config('app.f9.vacia', public.obtener_o_crear_cuenta(pg_temp.f9_id('mesa'))::text, true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select public.cerrar_caja(0);
select is((select estado::text from cuentas where id = pg_temp.f9_id('vacia')), 'cerrada', 'Cuenta vacia se cierra sin inventar una deuda');

select * from finish();
rollback;
