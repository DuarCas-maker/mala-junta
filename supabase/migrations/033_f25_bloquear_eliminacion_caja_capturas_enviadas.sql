-- 033_f25_bloquear_eliminacion_caja_capturas_enviadas.sql
-- Sprint 8: caja solo puede eliminar capturas/ventas antes de enviarlas a aprobacion.
-- Una vez enviadas, aprobadas o confirmadas, la eliminacion/reversion queda solo para admin.
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
  v_captura public.capturas_venta;
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

  select * into v_captura
  from public.capturas_venta
  where id = v_grupo.captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_no_encontrada' using errcode = '02000';
  end if;

  if not public.es_admin()
     and (
       v_captura.enviado_aprobacion_at is not null
       or v_captura.aprobado_at is not null
       or v_captura.confirmado_at is not null
       or v_grupo.pedido_id is not null
       or v_captura.estado in ('pendiente_aprobacion','aprobada_parcial','confirmada','eliminada','rechazada')
     ) then
    raise exception 'solo_admin_elimina_capturas_enviadas' using errcode = '42501';
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

create or replace function public.eliminar_venta_captura(p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grupo public.captura_venta_grupos;
  v_captura public.capturas_venta;
  v_motivo_id uuid;
  v_resultado jsonb;
  v_quedan int;
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

  select * into v_captura
  from public.capturas_venta
  where id = v_grupo.captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_no_encontrada' using errcode = '02000';
  end if;

  if not public.es_admin()
     and (
       v_captura.enviado_aprobacion_at is not null
       or v_captura.aprobado_at is not null
       or v_captura.confirmado_at is not null
       or v_grupo.pedido_id is not null
       or v_captura.estado in ('pendiente_aprobacion','aprobada_parcial','confirmada','eliminada','rechazada')
     ) then
    raise exception 'solo_admin_elimina_capturas_enviadas' using errcode = '42501';
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
  where captura_id = v_grupo.captura_id;

  if v_quedan = 0 then
    delete from storage.objects
    where bucket_id = coalesce(v_captura.storage_bucket, 'capturas-ventas')
      and name = v_captura.storage_path;

    delete from public.capturas_venta
    where id = v_grupo.captura_id;

    return v_resultado || jsonb_build_object('captura_eliminada', true);
  end if;

  perform public.recalcular_estado_captura_venta(v_grupo.captura_id);
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

  if not public.es_admin()
     and (
       v_captura.enviado_aprobacion_at is not null
       or v_captura.aprobado_at is not null
       or v_captura.confirmado_at is not null
       or v_captura.estado in ('pendiente_aprobacion','aprobada_parcial','confirmada','eliminada','rechazada')
       or exists (
         select 1
         from public.captura_venta_grupos
         where captura_id = p_captura_id
           and pedido_id is not null
       )
     ) then
    raise exception 'solo_admin_elimina_capturas_enviadas' using errcode = '42501';
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

grant execute on function public.reversar_y_eliminar_grupo_captura(uuid, uuid, text) to authenticated;
grant execute on function public.eliminar_venta_captura(uuid) to authenticated;
grant execute on function public.eliminar_captura_venta(uuid) to authenticated;