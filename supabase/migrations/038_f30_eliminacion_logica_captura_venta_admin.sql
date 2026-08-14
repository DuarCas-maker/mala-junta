-- 038_f30_eliminacion_logica_captura_venta_admin.sql
-- Hace visible y auditable la eliminacion completa de capturas desde admin.

create or replace function public.eliminar_captura_venta(p_captura_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captura public.capturas_venta;
  v_motivo_id uuid;
  v_perfil_id uuid;
  v_grupo public.captura_venta_grupos;
  v_pagos_anulados int := 0;
  v_resultados jsonb := '[]'::jsonb;
  v_total int := 0;
  v_reversadas int := 0;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_elimina_capturas' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();

  select *
  into v_captura
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
    select *
    from public.captura_venta_grupos
    where captura_id = p_captura_id
    order by orden
    for update
  loop
    if v_grupo.eliminado_at is not null or v_grupo.estado = 'eliminada' then
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
        'grupo_id', v_grupo.id,
        'orden', v_grupo.orden,
        'ya_eliminada', true
      ));
      continue;
    end if;

    v_pagos_anulados := 0;

    if v_grupo.pedido_id is not null then
      perform public.anular_pedido(
        v_grupo.pedido_id,
        v_motivo_id,
        'Captura de imagen eliminada completa desde solicitudes admin'
      );
      v_reversadas := v_reversadas + 1;

      if v_grupo.cuenta_id is not null then
        v_pagos_anulados := public.anular_pagos_cuenta_captura(
          v_grupo.cuenta_id,
          v_motivo_id,
          'Captura de imagen eliminada completa desde solicitudes admin'
        );
        perform public.recalcular_estado_cuenta_por_pagos(v_grupo.cuenta_id);
      end if;
    end if;

    update public.captura_venta_grupos
    set
      estado = 'eliminada',
      eliminado_at = now(),
      eliminado_por = v_perfil_id,
      eliminacion_observacion = 'Captura de imagen eliminada completa desde solicitudes admin',
      requiere_revision = false,
      aprobado = false,
      aprobado_at = null,
      aprobado_por = null
    where id = v_grupo.id;

    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'grupo_id', v_grupo.id,
      'orden', v_grupo.orden,
      'pedido_id', v_grupo.pedido_id,
      'cuenta_id', v_grupo.cuenta_id,
      'estaba_confirmada', v_grupo.pedido_id is not null,
      'pagos_anulados', v_pagos_anulados
    ));
    v_total := v_total + 1;
  end loop;

  update public.capturas_venta
  set
    estado = 'eliminada',
    eliminado_at = now(),
    eliminado_por = v_perfil_id
  where id = p_captura_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_perfil_id,
    'eliminar_captura_venta',
    'capturas_venta',
    p_captura_id,
    jsonb_build_object(
      'eliminacion_logica', true,
      'ventas_eliminadas', v_total,
      'ventas_reversadas', v_reversadas,
      'ventas', v_resultados
    )
  );

  return jsonb_build_object(
    'captura_id', p_captura_id,
    'captura_eliminada', true,
    'eliminacion_logica', true,
    'ventas_eliminadas', v_total,
    'ventas_reversadas', v_reversadas,
    'ventas', v_resultados
  );
end;
$$;

create or replace view public.v_admin_capturas_venta_aprobacion
with (security_invoker = true)
as
select
  c.id,
  c.estado,
  c.fecha_venta,
  c.dia_negocio,
  c.created_at,
  c.enviado_aprobacion_at,
  c.aprobado_at,
  c.confirmado_at,
  c.eliminado_at,
  c.storage_bucket,
  c.storage_path,
  c.nombre_archivo,
  c.modelo_ia,
  c.advertencias,
  subio.nombre as subido_por,
  envio.nombre as enviado_por,
  aprobo.nombre as aprobado_por,
  count(g.id) filter (where g.eliminado_at is null and coalesce(g.estado, '') <> 'eliminada')::int as ventas_total,
  count(g.id) filter (where g.pedido_id is not null and g.eliminado_at is null and coalesce(g.estado, '') <> 'eliminada')::int as ventas_confirmadas,
  count(g.id) filter (where g.pedido_id is null and g.eliminado_at is null and coalesce(g.estado, '') <> 'eliminada' and (g.requiere_revision or not coalesce(g.aprobado, false)))::int as ventas_pendientes,
  count(g.id) filter (where g.eliminado_at is not null or g.estado = 'eliminada')::int as ventas_eliminadas,
  coalesce(sum(g.total_leido) filter (where g.eliminado_at is null and coalesce(g.estado, '') <> 'eliminada'), 0)::numeric(12,0) as total_leido,
  coalesce(sum(g.total_esperado) filter (where g.eliminado_at is null and coalesce(g.estado, '') <> 'eliminada'), 0)::numeric(12,0) as total_esperado,
  coalesce(sum(g.diferencia) filter (where g.eliminado_at is null and coalesce(g.estado, '') <> 'eliminada'), 0)::numeric(12,0) as diferencia
from public.capturas_venta c
left join public.perfiles subio on subio.id = c.usuario_id
left join public.perfiles envio on envio.id = c.enviado_aprobacion_por
left join public.perfiles aprobo on aprobo.id = c.aprobado_por
left join public.captura_venta_grupos g on g.captura_id = c.id
where public.es_admin()
group by c.id, subio.nombre, envio.nombre, aprobo.nombre;

grant execute on function public.eliminar_captura_venta(uuid) to authenticated;
grant select on public.v_admin_capturas_venta_aprobacion to authenticated;
