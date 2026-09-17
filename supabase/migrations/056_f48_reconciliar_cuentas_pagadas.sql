-- F48: cerrar cuentas activas cuyo total ya esta cubierto por pagos existentes.
-- La operacion no crea pagos ni modifica pedidos o inventario.

create or replace function public.cerrar_cuenta_pagada(p_cuenta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.cuentas;
  v_total numeric(12,0);
  v_total_pagado numeric(12,0);
  v_estado_anterior public.estado_cuenta;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_cierra_cuentas_pagadas' using errcode = '42501';
  end if;

  select * into v_cuenta
  from public.cuentas
  where id = p_cuenta_id
  for update;

  if v_cuenta.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  select coalesce(sum(pg.monto), 0)::numeric(12,0)
    into v_total_pagado
  from public.pagos pg
  where pg.cuenta_id = p_cuenta_id
    and not coalesce(pg.anulado, false);

  if v_cuenta.estado in ('pagada', 'cerrada') then
    return jsonb_build_object(
      'cuenta_id', v_cuenta.id,
      'estado', v_cuenta.estado,
      'total', v_cuenta.total_cuenta,
      'total_pagado', v_total_pagado,
      'excedente', greatest(v_total_pagado - coalesce(v_cuenta.total_cuenta, 0), 0),
      'actualizada', false
    );
  end if;

  if v_cuenta.estado = 'anulada' then
    raise exception 'cuenta_no_editable' using errcode = '22023';
  end if;

  v_estado_anterior := v_cuenta.estado;
  v_total := public.recalcular_total_cuenta(p_cuenta_id);

  if coalesce(v_total, 0) <= 0 then
    raise exception 'cuenta_sin_total' using errcode = '22023';
  end if;

  if v_total_pagado < v_total then
    raise exception 'saldo_pendiente' using
      errcode = '22023',
      detail = jsonb_build_object(
        'total', v_total,
        'total_pagado', v_total_pagado,
        'saldo', v_total - v_total_pagado
      )::text;
  end if;

  update public.cuentas
  set estado = 'pagada',
      responsable_pendiente = null,
      updated_at = now()
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'cerrar_cuenta_pagada',
    'cuentas',
    p_cuenta_id,
    jsonb_build_object(
      'estado_anterior', v_estado_anterior,
      'estado_nuevo', v_cuenta.estado,
      'total', v_total,
      'total_pagado', v_total_pagado,
      'excedente', greatest(v_total_pagado - v_total, 0)
    )
  );

  return jsonb_build_object(
    'cuenta_id', v_cuenta.id,
    'estado', v_cuenta.estado,
    'total', v_total,
    'total_pagado', v_total_pagado,
    'excedente', greatest(v_total_pagado - v_total, 0),
    'actualizada', true
  );
end;
$$;

revoke all on function public.cerrar_cuenta_pagada(uuid) from public, anon;
grant execute on function public.cerrar_cuenta_pagada(uuid) to authenticated;
