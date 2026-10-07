begin;

-- F50: una deuda conserva su mesa historica, pero no ocupa la mesa despues de salir.
-- Ejecutar antes de desplegar el frontend y el trabajador de corte de jornada.

insert into public.parametros (clave, valor, descripcion)
values ('hora_corte_dia_negocio', '"10:00"', 'Corte de jornada a las 10:00 en America/Bogota.')
on conflict (clave) do update set valor = excluded.valor, descripcion = excluded.descripcion;

alter table public.cuentas
  add column if not exists mesa_liberada_at timestamptz,
  add column if not exists motivo_liberacion text;

alter table public.pedidos add column if not exists solicitud_id uuid;
create unique index if not exists pedidos_solicitud_id_idx on public.pedidos(solicitud_id)
where solicitud_id is not null;

-- La liberacion es permanente. Cambiar el estado de cobro nunca recupera la mesa.
create or replace function public.conservar_liberacion_cuenta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagado numeric;
begin
  if tg_op = 'UPDATE' and old.mesa_liberada_at is not null then
    new.mesa_liberada_at := old.mesa_liberada_at;
    new.motivo_liberacion := old.motivo_liberacion;
  end if;

  if new.mesa_liberada_at is null and new.estado in ('pendiente', 'pagada', 'cerrada', 'anulada') then
    new.mesa_liberada_at := now();
    new.motivo_liberacion := case new.estado
      when 'pendiente' then 'pendiente'
      when 'anulada' then 'anulacion'
      when 'cerrada' then 'cierre_cuenta'
      else 'pago'
    end;
  end if;

  if new.mesa_liberada_at is not null and new.estado <> 'anulada' then
    select coalesce(sum(monto), 0) into v_pagado
    from public.pagos where cuenta_id = new.id and not coalesce(anulado, false);
    if new.total_cuenta > v_pagado then
      new.estado := 'pendiente';
      -- Las RPC antiguas pueden intentar borrar el nombre al cambiar el estado.
      if tg_op = 'UPDATE' then
        new.responsable_pendiente := coalesce(nullif(trim(new.responsable_pendiente), ''), old.responsable_pendiente);
      end if;
    elsif new.total_cuenta > 0 and new.estado <> 'cerrada' then
      new.estado := 'pagada';
      if tg_op = 'UPDATE' then
        new.responsable_pendiente := coalesce(new.responsable_pendiente, old.responsable_pendiente);
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.conservar_liberacion_cuenta() from public, anon, authenticated;
drop trigger if exists cuentas_conservar_liberacion on public.cuentas;
create trigger cuentas_conservar_liberacion before insert or update on public.cuentas
for each row execute function public.conservar_liberacion_cuenta();

drop index if exists public.cuentas_una_abierta_por_mesa_idx;
create unique index cuentas_una_abierta_por_mesa_idx on public.cuentas(mesa_id)
where mesa_id is not null and mesa_liberada_at is null
  and estado in ('abierta', 'por_cobrar', 'pagada_parcial');
create index if not exists cuentas_jornada_sin_liberar_idx on public.cuentas(dia_negocio)
where mesa_liberada_at is null;

-- Solo llamable por funciones internas o el trabajador con service_role.
-- El mismo bloqueo serializa pedidos nuevos, pagos y ambos tipos de corte.
create or replace function public.finalizar_cuentas_jornada(
  p_hasta date,
  p_motivo text,
  p_cierre_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.cuentas;
  v_total numeric;
  v_pagado numeric;
  v_cantidad integer := 0;
begin
  perform pg_advisory_xact_lock(505058);
  for v_cuenta in
    select * from public.cuentas
    where mesa_liberada_at is null and estado <> 'anulada' and dia_negocio <= p_hasta
    order by id for update
  loop
    select coalesce(sum(pi.cantidad * pi.precio_unitario_capturado), 0) into v_total
    from public.pedidos p join public.pedido_items pi on pi.pedido_id = p.id
    where p.cuenta_id = v_cuenta.id and p.estado <> 'anulado' and pi.estado <> 'anulado';
    select coalesce(sum(monto), 0) into v_pagado
    from public.pagos where cuenta_id = v_cuenta.id and not coalesce(anulado, false);

    update public.cuentas
    set total_cuenta = v_total,
        estado = case when v_total > v_pagado then 'pendiente'::public.estado_cuenta
                      when v_total > 0 then 'pagada'::public.estado_cuenta
                      else 'cerrada'::public.estado_cuenta end,
        mesa_liberada_at = now(), motivo_liberacion = p_motivo
    where id = v_cuenta.id;

    insert into public.log_auditoria(usuario_id, accion, entidad, entidad_id, detalle)
    values (public.perfil_actual_id(), 'liberar_cuenta_jornada', 'cuentas', v_cuenta.id,
      jsonb_build_object('motivo', p_motivo, 'mesa_id', v_cuenta.mesa_id,
        'dia_negocio', v_cuenta.dia_negocio, 'estado_anterior', v_cuenta.estado,
        'total', v_total, 'pagado', v_pagado, 'saldo', greatest(v_total - v_pagado, 0),
        'pendiente_por_identificar', nullif(trim(v_cuenta.responsable_pendiente), '') is null,
        'cierre_caja_id', p_cierre_id));
    v_cantidad := v_cantidad + 1;
  end loop;
  return v_cantidad;
end;
$$;
revoke all on function public.finalizar_cuentas_jornada(date, text, uuid) from public, anon, authenticated;

create or replace function public.procesar_corte_jornada()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.finalizar_cuentas_jornada(public.dia_negocio(now()) - 1, 'corte_jornada');
$$;
revoke all on function public.procesar_corte_jornada() from public, anon, authenticated;
grant execute on function public.procesar_corte_jornada() to service_role;

-- Respaldo al consultar o enviar pedidos: recupera cortes omitidos durante caidas.
create or replace function public.sincronizar_jornada_operativa()
returns date
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.perfil_actual_id() is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;
  perform public.procesar_corte_jornada();
  return public.dia_negocio(now());
end;
$$;
revoke all on function public.sincronizar_jornada_operativa() from public, anon;
grant execute on function public.sincronizar_jornada_operativa() to authenticated;

create or replace function public.obtener_o_crear_cuenta(p_mesa_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid := public.perfil_actual_id();
  v_cuenta_id uuid;
begin
  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(505058);
  perform public.procesar_corte_jornada();
  if p_mesa_id is not null then
    perform 1 from public.mesas where id = p_mesa_id and activa for update;
    if not found then
      raise exception 'mesa_no_disponible' using errcode = '22023';
    end if;
    select id into v_cuenta_id from public.cuentas
    where mesa_id = p_mesa_id and mesa_liberada_at is null
      and estado in ('abierta', 'por_cobrar', 'pagada_parcial')
      and dia_negocio = public.dia_negocio(now())
    order by created_at desc limit 1 for update;
  end if;
  if v_cuenta_id is null then
    insert into public.cuentas(mesa_id, abierta_por, estado, dia_negocio)
    values (p_mesa_id, v_perfil_id, 'abierta', public.dia_negocio(now())) returning id into v_cuenta_id;
    insert into public.sub_cuentas(cuenta_id, etiqueta) values (v_cuenta_id, 'Cliente 1');
  end if;
  return v_cuenta_id;
end;
$$;

create or replace function public.actualizar_responsable_pendiente(p_cuenta_id uuid, p_responsable text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_identifica_pendiente' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_responsable, ''))) < 2 then
    raise exception 'responsable_pendiente_requerido' using errcode = '22023';
  end if;
  update public.cuentas c set responsable_pendiente = trim(p_responsable)
  where id = p_cuenta_id and mesa_liberada_at is not null and estado <> 'anulada'
    and total_cuenta > (select coalesce(sum(monto), 0) from public.pagos
                       where cuenta_id = c.id and not coalesce(anulado, false));
  if not found then
    raise exception 'cuenta_pendiente_no_encontrada' using errcode = '02000';
  end if;
  insert into public.log_auditoria(usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'identificar_pendiente', 'cuentas', p_cuenta_id,
    jsonb_build_object('responsable', trim(p_responsable)));
end;
$$;
revoke all on function public.actualizar_responsable_pendiente(uuid, text) from public, anon;
grant execute on function public.actualizar_responsable_pendiente(uuid, text) to authenticated;

-- Ya no es posible volver a ocupar mesa al quitar la etiqueta de una deuda.
create or replace function public.quitar_pendiente_cuenta_caja(p_cuenta_id uuid)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_quita_pendiente' using errcode = '42501';
  end if;
  raise exception 'cuenta_liberada_conserva_pendiente' using errcode = '22023';
end;
$$;

create or replace function public.mesas_para_pedidos()
returns table(
  id uuid,
  nombre text,
  zona text,
  es_vip boolean,
  cuenta_id uuid,
  cuenta_estado public.estado_cuenta,
  nickname text,
  ultimo_pedido_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.perfil_actual_id() is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  perform public.sincronizar_jornada_operativa();

  return query
  select
    m.id,
    m.nombre,
    m.zona,
    m.es_vip,
    c.id as cuenta_id,
    c.estado as cuenta_estado,
    c.nickname,
    stats.ultimo_pedido_at
  from public.mesas m
  left join lateral (
    select c.*
    from public.cuentas c
    where c.mesa_id = m.id
      and c.mesa_liberada_at is null
      and c.dia_negocio = public.dia_negocio(now())
      and c.estado in ('abierta','por_cobrar','pagada_parcial')
    order by c.created_at desc, c.id desc
    limit 1
  ) c on true
  left join lateral (
    select max(p.enviado_at) as ultimo_pedido_at
    from public.pedidos p
    where p.cuenta_id = c.id
      and p.estado <> 'anulado'
  ) stats on true
  where m.activa = true
  order by
    case when c.id is not null then 0 else 1 end,
    case when m.nombre ~* '^Mesa\s+\d+$' then 0 else 1 end,
    nullif(regexp_replace(m.nombre, '\D', '', 'g'), '')::int nulls last,
    m.nombre;
end;
$$;

create or replace function public.cuentas_activas_caja()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_lee_cuentas' using errcode = '42501';
  end if;

  perform public.sincronizar_jornada_operativa();

  return coalesce((
    select jsonb_agg(
      cuenta_json
      order by prioridad_cobro asc, pedido_estado_prioridad asc, coalesce(ultimo_pedido_at, created_at) desc, created_at desc
    )
    from (
      select
        c.created_at,
        stats.ultimo_pedido_at,
        stats.pedido_estado_prioridad,
        case
          when c.estado = 'pendiente' then 0
          when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 1
          when stats.tiene_en_preparacion then 2
          when stats.tiene_enviado then 3
          when c.estado = 'pagada_parcial' then 4
          when c.estado = 'abierta' then 6
          else 9
        end as prioridad_cobro,
        jsonb_build_object(
          'id', c.id,
          'estado', c.estado,
          'estado_cobro', case
            when c.estado = 'pendiente' and nullif(trim(c.responsable_pendiente), '') is null then 'Pendiente por identificar'
            when c.estado = 'pendiente' then 'Pendiente'
            when c.estado = 'pagada_parcial' then 'Pago parcial'
            when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 'Por cobrar'
            when stats.tiene_en_preparacion then 'En preparacion'
            when stats.tiene_enviado then 'Enviado'
            else 'Abierta'
          end,
          'prioridad_cobro', case
            when c.estado = 'pendiente' then 0
            when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 1
            when stats.tiene_en_preparacion then 2
            when stats.tiene_enviado then 3
            when c.estado = 'pagada_parcial' then 4
            when c.estado = 'abierta' then 6
            else 9
          end,
          'pedido_estado_prioridad', stats.pedido_estado_prioridad,
          'ultimo_pedido_at', stats.ultimo_pedido_at,
          'dia_negocio', c.dia_negocio,
          'dia_jornada_actual', public.dia_negocio(now()),
          'mesa_liberada_at', c.mesa_liberada_at,
          'motivo_liberacion', c.motivo_liberacion,
          'pendiente_por_identificar', c.mesa_liberada_at is not null and nullif(trim(c.responsable_pendiente), '') is null,
          'numero_cuenta', c.id::text,
          'es_pendiente_anterior', c.estado = 'pendiente' and c.dia_negocio < public.dia_negocio(now()),
          'total_cuenta', c.total_cuenta,
          'total_pagado', stats.total_pagado,
          'saldo', greatest(coalesce(c.total_cuenta, 0) - stats.total_pagado, 0),
          'responsable_pendiente', c.responsable_pendiente,
          'nickname', c.nickname,
          'created_at', c.created_at,
          'mesas', case when m.id is null then null else jsonb_build_object('nombre', m.nombre, 'zona', m.zona) end,
          'perfiles', jsonb_build_object('nombre', coalesce(pa.nombre, '-')),
          'documentos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', d.id,
              'tipo', d.tipo,
              'numero', d.numero,
              'total', d.total,
              'estado_dian', d.estado_dian,
              'etiqueta_no_fiscal', d.etiqueta_no_fiscal
            ) order by d.generated_at desc)
            from public.documentos d
            where d.cuenta_id = c.id
          ), '[]'::jsonb),
          'pagos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', pg.id,
              'monto', pg.monto,
              'medio', pg.medio,
              'propina', pg.propina,
              'es_abono_pendiente', pg.es_abono_pendiente,
              'timestamp', pg.timestamp
            ) order by pg.timestamp)
            from public.pagos pg
            where pg.cuenta_id = c.id
              and not coalesce(pg.anulado, false)
          ), '[]'::jsonb),
          'pedidos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', p.id,
              'estado', p.estado,
              'enviado_at', p.enviado_at,
              'notas', p.notas,
              'perfiles', jsonb_build_object('nombre', coalesce(pm.nombre, '-')),
              'pedido_items', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', pi.id,
                  'cantidad', pi.cantidad,
                  'precio_unitario_capturado', pi.precio_unitario_capturado,
                  'notas', pi.notas,
                  'estado', pi.estado,
                  'productos', case when pr.id is null then null else jsonb_build_object(
                    'nombre', pr.nombre,
                    'presentacion_compra', pr.presentacion_compra
                  ) end,
                  'combos', case when cmb.id is null then null else jsonb_build_object(
                    'nombre', cmb.nombre,
                    'combo_items', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'cantidad', ci.cantidad,
                        'activo', ci.activo,
                        'productos', case when cp.id is null then null else jsonb_build_object(
                          'nombre', cp.nombre,
                          'presentacion_compra', cp.presentacion_compra
                        ) end
                      ) order by cp.nombre)
                      from public.combo_items ci
                      left join public.productos cp on cp.id = ci.producto_id
                      where ci.combo_id = cmb.id
                        and ci.activo = true
                    ), '[]'::jsonb)
                  ) end
                ) order by pi.created_at)
                from public.pedido_items pi
                left join public.productos pr on pr.id = pi.producto_id
                left join public.combos cmb on cmb.id = pi.combo_id
                where pi.pedido_id = p.id
                  and pi.estado <> 'anulado'
              ), '[]'::jsonb)
            ) order by p.enviado_at)
            from public.pedidos p
            left join public.perfiles pm on pm.id = p.mesero_id
            where p.cuenta_id = c.id
              and p.estado <> 'anulado'
          ), '[]'::jsonb)
        ) as cuenta_json
      from public.cuentas c
      left join public.mesas m on m.id = c.mesa_id
      left join public.perfiles pa on pa.id = c.abierta_por
      cross join lateral (
        select
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado <> 'anulado') as tiene_pedidos,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado = 'enviado') as tiene_enviado,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado = 'en_preparacion') as tiene_en_preparacion,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado not in ('entregado', 'anulado')) as tiene_pedidos_no_entregados,
          coalesce((
            select min(case p.estado when 'entregado' then 1 when 'en_preparacion' then 2 when 'enviado' then 3 else 9 end)
            from public.pedidos p
            where p.cuenta_id = c.id and p.estado <> 'anulado'
          ), 9) as pedido_estado_prioridad,
          (select max(p.enviado_at) from public.pedidos p where p.cuenta_id = c.id and p.estado <> 'anulado') as ultimo_pedido_at,
          coalesce((
            select sum(pg.monto)
            from public.pagos pg
            where pg.cuenta_id = c.id
              and not coalesce(pg.anulado, false)
          ), 0)::numeric(12,0) as total_pagado
      ) stats
      where c.estado not in ('pagada', 'cerrada', 'anulada')
        and (
          c.estado in ('abierta', 'por_cobrar', 'pagada_parcial', 'pendiente')
          or stats.tiene_pedidos
          or coalesce(c.total_cuenta, 0) > stats.total_pagado
        )
    ) cuentas
  ), '[]'::jsonb);
end;
$$;

drop function if exists public.crear_pedido_rapido(uuid, jsonb, text, text);

create or replace function public.crear_pedido_rapido(
  p_mesa_id uuid,
  p_items jsonb,
  p_notas text default null,
  p_nickname text default null,
  p_validar_cuenta boolean default false,
  p_cuenta_esperada_id uuid default null,
  p_creado_at timestamptz default null,
  p_solicitud_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
  v_cuenta_id uuid;
  v_cuenta_actual uuid;
  v_pedido_id uuid;
  v_pedido_item_id uuid;
  v_item jsonb;
  v_producto public.productos;
  v_combo public.combos;
  v_componente record;
  v_cantidad int;
  v_notas text;
  v_producto_id uuid;
  v_combo_id uuid;
  v_precio_unitario numeric(12,0);
  v_precio_catalogo numeric(12,0);
  v_costo_unitario numeric(12,0);
  v_origen_precio text;
begin
  v_perfil_id := public.perfil_actual_id();

  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(505058);
  if p_solicitud_id is not null then
    select id into v_pedido_id from public.pedidos
    where solicitud_id = p_solicitud_id and mesero_id = v_perfil_id;
    if v_pedido_id is not null then
      return v_pedido_id;
    end if;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'pedido_sin_items' using errcode = '22023';
  end if;

  perform public.procesar_corte_jornada();
  if p_creado_at is not null and public.dia_negocio(p_creado_at) <> public.dia_negocio(now()) then
    raise exception 'pedido_jornada_anterior_requiere_revision' using errcode = '22023';
  end if;
  if p_validar_cuenta and p_mesa_id is not null then
    select id into v_cuenta_actual from public.cuentas
    where mesa_id = p_mesa_id and mesa_liberada_at is null
      and estado in ('abierta','por_cobrar','pagada_parcial')
      and dia_negocio = public.dia_negocio(now());
    if v_cuenta_actual is distinct from p_cuenta_esperada_id then
      raise exception 'mesa_cambio_de_cuenta_revisar_pedido' using errcode = '22023';
    end if;
  end if;
  v_cuenta_id := public.obtener_o_crear_cuenta(p_mesa_id);

  update public.cuentas
  set estado = case when estado in ('pagada_parcial','por_cobrar') then 'abierta' else estado end,
      nickname = coalesce(nullif(trim(coalesce(nickname, '')), ''), nullif(trim(coalesce(p_nickname, '')), '')),
      updated_at = now()
  where id = v_cuenta_id;

  insert into public.pedidos (cuenta_id, mesero_id, estado, notas, solicitud_id)
  values (v_cuenta_id, v_perfil_id, 'enviado', nullif(trim(coalesce(p_notas, '')), ''), p_solicitud_id)
  returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := coalesce((v_item ->> 'cantidad')::int, 0);
    v_notas := nullif(trim(coalesce(v_item ->> 'notas', '')), '');
    v_producto_id := nullif(v_item ->> 'producto_id', '')::uuid;
    v_combo_id := nullif(v_item ->> 'combo_id', '')::uuid;
    v_origen_precio := case
      when nullif(v_item ->> 'origen_precio', '') in ('captura','manual','ajuste_admin') then nullif(v_item ->> 'origen_precio', '')
      else 'catalogo'
    end;

    if v_cantidad <= 0 then
      raise exception 'cantidad_invalida' using errcode = '22023';
    end if;

    if (v_producto_id is null and v_combo_id is null) or (v_producto_id is not null and v_combo_id is not null) then
      raise exception 'item_pedido_invalido' using errcode = '22023';
    end if;

    if v_producto_id is not null then
      select * into v_producto
      from public.productos
      where id = v_producto_id
        and activo = true;

      if v_producto.id is null then
        raise exception 'producto_no_disponible' using errcode = '22023';
      end if;

      v_precio_catalogo := v_producto.precio_venta;
      v_precio_unitario := coalesce(nullif(v_item ->> 'precio_unitario_capturado', '')::numeric, v_producto.precio_venta);
      v_costo_unitario := coalesce(nullif(v_item ->> 'costo_unitario_historico', '')::numeric, v_producto.costo_unitario_actual, 0);

      insert into public.pedido_items (
        pedido_id, producto_id, cantidad, precio_unitario_capturado, notas, estado,
        costo_unitario_historico, precio_catalogo_historico, origen_precio
      )
      values (
        v_pedido_id, v_producto.id, v_cantidad, greatest(v_precio_unitario, 0), v_notas, 'enviado',
        greatest(v_costo_unitario, 0), greatest(v_precio_catalogo, 0), v_origen_precio
      )
      returning id into v_pedido_item_id;

      insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
      values (v_producto.id, 'venta', -v_cantidad, 'pedido_item', v_pedido_item_id, v_perfil_id);
    else
      select * into v_combo
      from public.combos
      where id = v_combo_id
        and activo = true;

      if v_combo.id is null then
        raise exception 'combo_no_disponible' using errcode = '22023';
      end if;

      if not exists (select 1 from public.combo_items where combo_id = v_combo.id and activo = true) then
        raise exception 'combo_sin_componentes' using errcode = '22023';
      end if;

      select coalesce(sum(ci.cantidad * p.costo_unitario_actual), 0)::numeric(12,0)
        into v_costo_unitario
      from public.combo_items ci
      join public.productos p on p.id = ci.producto_id
      where ci.combo_id = v_combo.id
        and ci.activo = true;

      v_precio_catalogo := v_combo.precio_venta;
      v_precio_unitario := coalesce(nullif(v_item ->> 'precio_unitario_capturado', '')::numeric, v_combo.precio_venta);
      v_costo_unitario := coalesce(nullif(v_item ->> 'costo_unitario_historico', '')::numeric, v_costo_unitario, 0);

      insert into public.pedido_items (
        pedido_id, combo_id, cantidad, precio_unitario_capturado, notas, estado,
        costo_unitario_historico, precio_catalogo_historico, origen_precio
      )
      values (
        v_pedido_id, v_combo.id, v_cantidad, greatest(v_precio_unitario, 0), v_notas, 'enviado',
        greatest(v_costo_unitario, 0), greatest(v_precio_catalogo, 0), v_origen_precio
      )
      returning id into v_pedido_item_id;

      for v_componente in
        select producto_id, cantidad
        from public.combo_items
        where combo_id = v_combo.id
          and activo = true
      loop
        insert into public.movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
        values (v_componente.producto_id, 'venta', -(v_componente.cantidad * v_cantidad), 'pedido_item', v_pedido_item_id, v_perfil_id);
      end loop;
    end if;
  end loop;

  perform public.recalcular_total_cuenta(v_cuenta_id);

  return v_pedido_id;
end;
$$;

create or replace function public.registrar_pagos_cuenta_base(
  p_cuenta_id uuid,
  p_pagos jsonb,
  p_propina numeric default 0,
  p_dejar_pendiente boolean default false,
  p_responsable_pendiente text default null
)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_medio public.medio_pago;
  v_monto numeric(12,0);
  v_total numeric(12,0);
  v_pagado numeric(12,0);
  v_cuenta_antes public.cuentas;
  v_cuenta public.cuentas;
  v_cierre public.cierres_caja;
  v_propina_restante numeric(12,0) := greatest(coalesce(p_propina, 0), 0);
  v_es_abono_pendiente boolean := false;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_pagos' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(505058);
  perform public.procesar_corte_jornada();
  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  select * into v_cuenta_antes
  from public.cuentas
  where id = p_cuenta_id
  for update;

  if v_cuenta_antes.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  v_es_abono_pendiente := v_cuenta_antes.mesa_liberada_at is not null or v_cuenta_antes.estado = 'pendiente';

  if v_cuenta_antes.estado in ('pagada','cerrada','anulada') then
    raise exception 'cuenta_no_editable' using errcode = '22023';
  end if;
  if p_dejar_pendiente and not v_es_abono_pendiente and char_length(trim(coalesce(p_responsable_pendiente, ''))) < 2 then
    raise exception 'responsable_pendiente_requerido' using errcode = '22023';
  end if;

  if jsonb_typeof(p_pagos) <> 'array' then
    raise exception 'pagos_invalidos' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_pagos)
  loop
    v_medio := (v_item ->> 'medio')::public.medio_pago;
    v_monto := coalesce((v_item ->> 'monto')::numeric, 0);

    if v_monto <= 0 then
      continue;
    end if;

    insert into public.pagos (cuenta_id, cierre_caja_id, medio, monto, propina, es_abono_pendiente, usuario_id)
    values (p_cuenta_id, v_cierre.id, v_medio, v_monto, v_propina_restante, v_es_abono_pendiente, public.perfil_actual_id());

    v_propina_restante := 0;
  end loop;

  select total_cuenta into v_total from public.cuentas where id = p_cuenta_id;
  select coalesce(sum(monto), 0) into v_pagado
  from public.pagos
  where cuenta_id = p_cuenta_id
    and not coalesce(anulado, false);

  update public.cuentas
  set estado = case
      when v_pagado >= v_total then 'pagada'
      when p_dejar_pendiente or v_es_abono_pendiente then 'pendiente'
      when v_pagado > 0 then 'pagada_parcial'
      else estado
    end,
    responsable_pendiente = case
      when p_dejar_pendiente then coalesce(nullif(trim(coalesce(p_responsable_pendiente, '')), ''), responsable_pendiente)
      when v_pagado >= v_total then null
      else responsable_pendiente
    end
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_pagos_cuenta', 'cuentas', p_cuenta_id, jsonb_build_object('pagado', v_pagado, 'total', v_total, 'pendiente', p_dejar_pendiente, 'abono_pendiente', v_es_abono_pendiente, 'cierre_caja_id', v_cierre.id));

  return v_cuenta;
end;
$$;

create or replace function public.cerrar_caja(p_efectivo_contado numeric, p_justificacion text default null)
returns public.cierres_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_efectivo_pagos numeric(12,0) := 0;
  v_retiros numeric(12,0) := 0;
  v_gastos_efectivo numeric(12,0) := 0;
  v_esperado numeric(12,0) := 0;
  v_diferencia numeric(12,0) := 0;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_cierra_caja' using errcode = '42501';
  end if;

  if coalesce(p_efectivo_contado, -1) < 0 then
    raise exception 'efectivo_contado_invalido' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(505058);
  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  select coalesce(sum(monto), 0)
  into v_efectivo_pagos
  from public.pagos
  where cierre_caja_id = v_cierre.id
    and medio = 'efectivo'
    and not coalesce(anulado, false);

  select coalesce(sum(monto), 0)
  into v_retiros
  from public.retiros_caja
  where cierre_caja_id = v_cierre.id;

  select coalesce(sum(monto), 0)
  into v_gastos_efectivo
  from public.gastos_caja
  where cierre_caja_id = v_cierre.id
    and medio = 'efectivo';

  v_esperado := v_cierre.base_inicial + v_efectivo_pagos - v_retiros - v_gastos_efectivo;
  v_diferencia := p_efectivo_contado - v_esperado;

  if v_diferencia <> 0 and not public.es_admin() then
    raise exception 'cierre_descuadrado_requiere_admin' using errcode = '42501';
  end if;

  if v_diferencia <> 0 and char_length(trim(coalesce(p_justificacion, ''))) < 3 then
    raise exception 'cierre_descuadrado_requiere_justificacion' using errcode = '22023';
  end if;

  update public.cierres_caja
  set estado = 'cerrada',
      cerrado_por = public.perfil_actual_id(),
      cerrado_at = now(),
      efectivo_esperado = v_esperado,
      efectivo_contado = p_efectivo_contado,
      diferencia = v_diferencia,
      aprobado_por = case when v_diferencia <> 0 then public.perfil_actual_id() else null end,
      justificacion_diferencia = nullif(trim(coalesce(p_justificacion, '')), '')
  where id = v_cierre.id
  returning * into v_cierre;

  perform public.finalizar_cuentas_jornada(least(v_cierre.dia_negocio, public.dia_negocio(now())), 'cierre_caja', v_cierre.id);

  update public.cuentas
  set estado = 'cerrada', cierre_caja_id = v_cierre.id
  where estado = 'pagada'
    and exists (select 1 from public.pagos p where p.cuenta_id = cuentas.id and p.cierre_caja_id = v_cierre.id and not coalesce(p.anulado, false));

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'cerrar_caja',
    'cierres_caja',
    v_cierre.id,
    jsonb_build_object('efectivo_contado', p_efectivo_contado, 'efectivo_esperado', v_esperado, 'diferencia', v_diferencia, 'gastos_efectivo', v_gastos_efectivo)
  );

  return v_cierre;
end;
$$;

revoke all on function public.crear_pedido_rapido(uuid, jsonb, text, text, boolean, uuid, timestamptz, uuid) from public, anon;

grant execute on function public.crear_pedido_rapido(uuid, jsonb, text, text, boolean, uuid, timestamptz, uuid) to authenticated;

grant execute on function public.mesas_para_pedidos() to authenticated;

grant execute on function public.cuentas_activas_caja() to authenticated;

-- Migracion de cuentas anteriores, incluidos saldos historicos mal cerrados.
select public.finalizar_cuentas_jornada(public.dia_negocio(now()) - 1, 'migracion');

-- Cuentas que ya habian dejado de ocupar mesa. No inventar fechas historicas.
update public.cuentas c
set mesa_liberada_at = now(), motivo_liberacion = 'migracion'
where mesa_liberada_at is null
  and (estado in ('pendiente', 'anulada') or (
    estado in ('pagada', 'cerrada') and total_cuenta <= (
      select coalesce(sum(monto), 0) from public.pagos
      where cuenta_id = c.id and not coalesce(anulado, false)
    )
  ));



-- Si pg_cron ya esta habilitado, la base realiza el corte aun sin frontend/servidor web.
-- En VPS sin pg_cron se usa el trabajador incluido en el contenedor de la app.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mala-junta-corte-jornada', '* * * * *', 'select public.procesar_corte_jornada();');
  else
    raise notice 'pg_cron no habilitado: ejecutar scripts/corte-jornada.mjs en el servidor.';
  end if;
end;
$$;

commit;
