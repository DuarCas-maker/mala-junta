-- 027_f19_eliminar_capturas_venta.sql
-- Sprint 2: elimina ventas/capturas, anula pedidos/pagos y devuelve inventario con devolucion.

alter table public.pagos add column if not exists anulado boolean not null default false;
alter table public.pagos add column if not exists anulado_at timestamptz;
alter table public.pagos add column if not exists anulado_por uuid references public.perfiles(id) on delete restrict;
alter table public.pagos add column if not exists anulacion_motivo_id uuid references public.motivos(id) on delete restrict;
alter table public.pagos add column if not exists anulacion_observacion text;

create index if not exists pagos_activos_cuenta_idx on public.pagos(cuenta_id, timestamp) where anulado = false;

create or replace function public.recalcular_estado_cuenta_por_pagos(p_cuenta_id uuid)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(12,0);
  v_pagado numeric(12,0);
  v_tiene_pedidos boolean;
  v_cuenta public.cuentas;
begin
  perform public.recalcular_total_cuenta(p_cuenta_id);

  select total_cuenta into v_total
  from public.cuentas
  where id = p_cuenta_id;

  if v_total is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  select coalesce(sum(monto), 0)
    into v_pagado
  from public.pagos
  where cuenta_id = p_cuenta_id
    and not coalesce(anulado, false);

  select exists (
    select 1 from public.pedidos
    where cuenta_id = p_cuenta_id
      and estado <> 'anulado'
  ) into v_tiene_pedidos;

  update public.cuentas
  set estado = case
      when not v_tiene_pedidos and v_pagado = 0 then 'anulada'::public.estado_cuenta
      when v_pagado >= v_total and v_total > 0 then 'pagada'::public.estado_cuenta
      when v_pagado > 0 then 'pagada_parcial'::public.estado_cuenta
      when v_tiene_pedidos then 'abierta'::public.estado_cuenta
      else estado
    end
  where id = p_cuenta_id
  returning * into v_cuenta;

  return v_cuenta;
end;
$$;

create or replace function public.anular_pagos_cuenta_captura(
  p_cuenta_id uuid,
  p_motivo_id uuid,
  p_observacion text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anulados int := 0;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_anula_pagos' using errcode = '42501';
  end if;

  update public.pagos
  set anulado = true,
      anulado_at = now(),
      anulado_por = public.perfil_actual_id(),
      anulacion_motivo_id = p_motivo_id,
      anulacion_observacion = nullif(trim(coalesce(p_observacion, '')), '')
  where cuenta_id = p_cuenta_id
    and not coalesce(anulado, false);

  get diagnostics v_anulados = row_count;

  perform public.recalcular_estado_cuenta_por_pagos(p_cuenta_id);

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'anular_pagos_cuenta_captura',
    'cuentas',
    p_cuenta_id,
    jsonb_build_object('pagos_anulados', v_anulados, 'motivo_id', p_motivo_id, 'observacion', p_observacion)
  );

  return v_anulados;
end;
$$;

create or replace function public.reversar_y_eliminar_grupo_captura(
  p_grupo_id uuid,
  p_motivo_id uuid,
  p_observacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grupo public.captura_venta_grupos;
  v_pagos_anulados int := 0;
  v_resultado jsonb;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_elimina_capturas' using errcode = '42501';
  end if;

  select * into v_grupo
  from public.captura_venta_grupos
  where id = p_grupo_id
  for update;

  if v_grupo.id is null then
    raise exception 'venta_captura_no_encontrada' using errcode = '02000';
  end if;

  v_resultado := jsonb_build_object(
    'grupo_id', v_grupo.id,
    'captura_id', v_grupo.captura_id,
    'orden', v_grupo.orden,
    'pedido_id', v_grupo.pedido_id,
    'cuenta_id', v_grupo.cuenta_id,
    'estaba_confirmada', v_grupo.pedido_id is not null
  );

  if v_grupo.pedido_id is not null then
    perform public.anular_pedido(v_grupo.pedido_id, p_motivo_id, p_observacion);

    if v_grupo.cuenta_id is not null then
      v_pagos_anulados := public.anular_pagos_cuenta_captura(v_grupo.cuenta_id, p_motivo_id, p_observacion);
      perform public.recalcular_estado_cuenta_por_pagos(v_grupo.cuenta_id);
    end if;
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'eliminar_venta_captura',
    'captura_venta_grupos',
    v_grupo.id,
    v_resultado || jsonb_build_object('pagos_anulados', v_pagos_anulados, 'observacion', p_observacion)
  );

  delete from public.captura_venta_grupos
  where id = v_grupo.id;

  return v_resultado || jsonb_build_object('pagos_anulados', v_pagos_anulados);
end;
$$;

create or replace function public.recalcular_estado_captura_venta(p_captura_id uuid)
returns public.capturas_venta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captura public.capturas_venta;
  v_total int;
  v_confirmadas int;
  v_pendientes int;
begin
  select count(*),
         count(*) filter (where pedido_id is not null),
         count(*) filter (where requiere_revision or not coalesce(aprobado, false))
    into v_total, v_confirmadas, v_pendientes
  from public.captura_venta_grupos
  where captura_id = p_captura_id;

  update public.capturas_venta
  set estado = case
      when v_total = 0 then 'rechazada'::public.estado_captura_venta
      when v_confirmadas = v_total then 'confirmada'::public.estado_captura_venta
      when v_pendientes > 0 then 'requiere_revision'::public.estado_captura_venta
      else 'procesada'::public.estado_captura_venta
    end
  where id = p_captura_id
  returning * into v_captura;

  return v_captura;
end;
$$;

create or replace function public.eliminar_venta_captura(p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captura_id uuid;
  v_captura public.capturas_venta;
  v_motivo_id uuid;
  v_resultado jsonb;
  v_quedan int;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_elimina_capturas' using errcode = '42501';
  end if;

  select captura_id into v_captura_id
  from public.captura_venta_grupos
  where id = p_grupo_id;

  if v_captura_id is null then
    raise exception 'venta_captura_no_encontrada' using errcode = '02000';
  end if;

  insert into public.motivos (tipo, texto, activo)
  values ('anulacion', 'Eliminacion de venta desde captura de imagen', true)
  on conflict (tipo, texto) do update set activo = true
  returning id into v_motivo_id;

  v_resultado := public.reversar_y_eliminar_grupo_captura(
    p_grupo_id,
    v_motivo_id,
    'Venta eliminada desde historial de captura de imagen'
  );

  select count(*) into v_quedan
  from public.captura_venta_grupos
  where captura_id = v_captura_id;

  if v_quedan = 0 then
    select * into v_captura
    from public.capturas_venta
    where id = v_captura_id;

    if v_captura.id is not null then
      delete from storage.objects
      where bucket_id = coalesce(v_captura.storage_bucket, 'capturas-ventas')
        and name = v_captura.storage_path;

      delete from public.capturas_venta
      where id = v_captura_id;
    end if;

    return v_resultado || jsonb_build_object('captura_eliminada', true);
  end if;

  perform public.recalcular_estado_captura_venta(v_captura_id);
  return v_resultado || jsonb_build_object('captura_eliminada', false);
end;
$$;

create or replace function public.eliminar_captura_venta(p_captura_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captura public.capturas_venta;
  v_motivo_id uuid;
  v_grupo record;
  v_resultados jsonb := '[]'::jsonb;
  v_resultado jsonb;
  v_total int := 0;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_elimina_capturas' using errcode = '42501';
  end if;

  select * into v_captura
  from public.capturas_venta
  where id = p_captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_no_encontrada' using errcode = '02000';
  end if;

  insert into public.motivos (tipo, texto, activo)
  values ('anulacion', 'Eliminacion de captura de imagen', true)
  on conflict (tipo, texto) do update set activo = true
  returning id into v_motivo_id;

  for v_grupo in
    select id
    from public.captura_venta_grupos
    where captura_id = p_captura_id
    order by orden
    for update
  loop
    v_resultado := public.reversar_y_eliminar_grupo_captura(
      v_grupo.id,
      v_motivo_id,
      'Captura de imagen eliminada completa desde historial'
    );
    v_resultados := v_resultados || jsonb_build_array(v_resultado);
    v_total := v_total + 1;
  end loop;

  delete from storage.objects
  where bucket_id = coalesce(v_captura.storage_bucket, 'capturas-ventas')
    and name = v_captura.storage_path;

  delete from public.capturas_venta
  where id = p_captura_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'eliminar_captura_venta',
    'capturas_venta',
    p_captura_id,
    jsonb_build_object('ventas_eliminadas', v_total, 'ventas', v_resultados)
  );

  return jsonb_build_object(
    'captura_id', p_captura_id,
    'captura_eliminada', true,
    'ventas_eliminadas', v_total,
    'ventas', v_resultados
  );
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
  v_cuenta public.cuentas;
  v_cierre public.cierres_caja;
  v_propina_restante numeric(12,0) := greatest(coalesce(p_propina, 0), 0);
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_pagos' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
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
    values (p_cuenta_id, v_cierre.id, v_medio, v_monto, v_propina_restante, false, public.perfil_actual_id());

    v_propina_restante := 0;
  end loop;

  select total_cuenta into v_total from public.cuentas where id = p_cuenta_id;
  select coalesce(sum(monto), 0) into v_pagado
  from public.pagos
  where cuenta_id = p_cuenta_id
    and not coalesce(anulado, false);

  update public.cuentas
  set estado = case
      when p_dejar_pendiente then 'pendiente'
      when v_pagado >= v_total then 'pagada'
      when v_pagado > 0 then 'pagada_parcial'
      else estado
    end,
    responsable_pendiente = case when p_dejar_pendiente then nullif(trim(coalesce(p_responsable_pendiente, '')), '') else responsable_pendiente end
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_pagos_cuenta', 'cuentas', p_cuenta_id, jsonb_build_object('pagado', v_pagado, 'total', v_total, 'pendiente', p_dejar_pendiente, 'cierre_caja_id', v_cierre.id));

  return v_cuenta;
end;
$$;

create or replace function public.medios_pago_cuenta_json(p_cuenta_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'medio', medio,
    'monto', monto,
    'propina', propina
  ) order by medio), '[]'::jsonb)
  from (
    select medio::text, sum(monto) as monto, sum(propina) as propina
    from public.pagos
    where cuenta_id = p_cuenta_id
      and not coalesce(anulado, false)
    group by medio
  ) pagos;
$$;

create or replace function public.resumen_caja_actual()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_efectivo_pagos numeric(12,0) := 0;
  v_retiros numeric(12,0) := 0;
  v_propinas numeric(12,0) := 0;
  v_efectivo_esperado numeric(12,0) := 0;
  v_pagos_medio jsonb := '{}'::jsonb;
  v_retiros_json jsonb := '[]'::jsonb;
  v_cuentas jsonb := '{}'::jsonb;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_lee_resumen_caja' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();

  if v_cierre.id is null then
    return jsonb_build_object('cierre_abierto', null, 'requiere_apertura', true);
  end if;

  select coalesce(sum(monto), 0), coalesce(sum(propina), 0)
  into v_efectivo_pagos, v_propinas
  from public.pagos
  where cierre_caja_id = v_cierre.id
    and medio = 'efectivo'
    and not coalesce(anulado, false);

  select coalesce(sum(propina), 0)
  into v_propinas
  from public.pagos
  where cierre_caja_id = v_cierre.id
    and not coalesce(anulado, false);

  select coalesce(sum(monto), 0)
  into v_retiros
  from public.retiros_caja
  where cierre_caja_id = v_cierre.id;

  v_efectivo_esperado := v_cierre.base_inicial + v_efectivo_pagos - v_retiros;

  select coalesce(jsonb_object_agg(medio, total), '{}'::jsonb)
  into v_pagos_medio
  from (
    select medio::text, coalesce(sum(monto), 0) as total
    from public.pagos
    where cierre_caja_id = v_cierre.id
      and not coalesce(anulado, false)
    group by medio
  ) pagos_por_medio;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'monto', r.monto,
    'observacion', r.observacion,
    'numero_factura', r.numero_factura,
    'timestamp', r.timestamp,
    'motivo', m.texto
  ) order by r.timestamp desc), '[]'::jsonb)
  into v_retiros_json
  from public.retiros_caja r
  left join public.motivos m on m.id = r.motivo_id
  where r.cierre_caja_id = v_cierre.id;

  select jsonb_build_object(
    'abiertas', count(*) filter (where estado in ('abierta','por_cobrar','pagada_parcial')),
    'pendientes', count(*) filter (where estado = 'pendiente'),
    'pagadas_turno', count(*) filter (where estado = 'pagada' and id in (select cuenta_id from public.pagos where cierre_caja_id = v_cierre.id and not coalesce(anulado, false)))
  )
  into v_cuentas
  from public.cuentas;

  return jsonb_build_object(
    'cierre_abierto', to_jsonb(v_cierre),
    'requiere_apertura', false,
    'efectivo_pagos', v_efectivo_pagos,
    'retiros_total', v_retiros,
    'efectivo_esperado', v_efectivo_esperado,
    'pagos_por_medio', v_pagos_medio,
    'propinas_total', v_propinas,
    'retiros', v_retiros_json,
    'cuentas', v_cuentas
  );
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
  v_esperado numeric(12,0) := 0;
  v_diferencia numeric(12,0) := 0;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_cierra_caja' using errcode = '42501';
  end if;

  if coalesce(p_efectivo_contado, -1) < 0 then
    raise exception 'efectivo_contado_invalido' using errcode = '22023';
  end if;

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

  v_esperado := v_cierre.base_inicial + v_efectivo_pagos - v_retiros;
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

  update public.cuentas
  set estado = 'cerrada', cierre_caja_id = v_cierre.id
  where estado = 'pagada'
    and exists (select 1 from public.pagos p where p.cuenta_id = cuentas.id and p.cierre_caja_id = v_cierre.id and not coalesce(p.anulado, false));

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'cerrar_caja', 'cierres_caja', v_cierre.id, jsonb_build_object('efectivo_contado', p_efectivo_contado, 'efectivo_esperado', v_esperado, 'diferencia', v_diferencia));

  return v_cierre;
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
          when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 1
          when stats.tiene_en_preparacion then 2
          when stats.tiene_enviado then 3
          when c.estado = 'pagada_parcial' then 4
          when c.estado = 'pendiente' then 5
          when c.estado = 'abierta' then 6
          else 9
        end as prioridad_cobro,
        jsonb_build_object(
          'id', c.id,
          'estado', c.estado,
          'estado_cobro', case
            when c.estado = 'pendiente' then 'Pendiente'
            when c.estado = 'pagada_parcial' then 'Pago parcial'
            when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 'Por cobrar'
            when stats.tiene_en_preparacion then 'En preparacion'
            when stats.tiene_enviado then 'Enviado'
            else 'Abierta'
          end,
          'prioridad_cobro', case
            when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 1
            when stats.tiene_en_preparacion then 2
            when stats.tiene_enviado then 3
            when c.estado = 'pagada_parcial' then 4
            when c.estado = 'pendiente' then 5
            when c.estado = 'abierta' then 6
            else 9
          end,
          'pedido_estado_prioridad', stats.pedido_estado_prioridad,
          'ultimo_pedido_at', stats.ultimo_pedido_at,
          'total_cuenta', c.total_cuenta,
          'total_pagado', stats.total_pagado,
          'saldo', greatest(coalesce(c.total_cuenta, 0) - stats.total_pagado, 0),
          'responsable_pendiente', c.responsable_pendiente,
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
                  'productos', case when pr.id is null then null else jsonb_build_object('nombre', pr.nombre) end,
                  'combos', case when co.id is null then null else jsonb_build_object('nombre', co.nombre) end
                ) order by pi.created_at)
                from public.pedido_items pi
                left join public.productos pr on pr.id = pi.producto_id
                left join public.combos co on co.id = pi.combo_id
                where pi.pedido_id = p.id
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

grant execute on function public.cuentas_activas_caja() to authenticated;
grant execute on function public.recalcular_estado_cuenta_por_pagos(uuid) to authenticated;
grant execute on function public.anular_pagos_cuenta_captura(uuid, uuid, text) to authenticated;
grant execute on function public.eliminar_venta_captura(uuid) to authenticated;
grant execute on function public.eliminar_captura_venta(uuid) to authenticated;
