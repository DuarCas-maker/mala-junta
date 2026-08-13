-- 036_f28_historial_rechazo_capturas_compra.sql
-- Sprint 5: rechazo auditado de solicitudes OCR de compra sin afectar inventario.

create or replace function public.rechazar_captura_compra_admin(
  p_captura_id uuid,
  p_observacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captura public.capturas_compra;
  v_perfil_id uuid;
  v_lineas int := 0;
  v_observacion text;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_rechaza_compras_ocr' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();
  v_observacion := nullif(trim(coalesce(p_observacion, '')), '');

  select *
  into v_captura
  from public.capturas_compra
  where id = p_captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_compra_no_encontrada' using errcode = '02000';
  end if;

  if v_captura.compra_id is not null
    or v_captura.estado = 'confirmada'::public.estado_captura_compra
    or v_captura.confirmado_at is not null then
    raise exception 'captura_compra_confirmada_no_rechazable' using errcode = '22023';
  end if;

  if v_captura.estado = any (array['rechazada','eliminada']::public.estado_captura_compra[]) then
    return jsonb_build_object(
      'captura_id', v_captura.id,
      'estado', v_captura.estado,
      'ya_rechazada', true
    );
  end if;

  update public.captura_compra_lineas
  set
    estado = 'eliminada',
    requiere_revision = false,
    observacion = coalesce(v_observacion, observacion)
  where captura_id = v_captura.id
    and estado <> 'eliminada';

  get diagnostics v_lineas = row_count;

  update public.capturas_compra
  set
    estado = 'rechazada',
    eliminado_at = now(),
    eliminado_por = v_perfil_id,
    observacion = coalesce(v_observacion, observacion),
    error_procesamiento = null
  where id = v_captura.id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_perfil_id,
    'rechazar_captura_compra_ocr',
    'capturas_compra',
    v_captura.id,
    jsonb_build_object(
      'lineas_rechazadas', v_lineas,
      'proveedor_id', v_captura.proveedor_id,
      'fecha_ingreso', v_captura.fecha_ingreso,
      'observacion', v_observacion
    )
  );

  return jsonb_build_object(
    'captura_id', v_captura.id,
    'estado', 'rechazada',
    'lineas_rechazadas', v_lineas
  );
end;
$$;

grant execute on function public.rechazar_captura_compra_admin(uuid, text) to authenticated;
