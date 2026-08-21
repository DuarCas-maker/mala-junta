-- F37: permitir liberar mesas sin items aunque conserven pagos registrados.

create or replace function public.cerrar_cuenta_si_vacia(p_cuenta_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.cuentas;
  v_total numeric(12,0);
  v_total_pagado numeric(12,0);
  v_tiene_items boolean;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_libera_mesas' using errcode = '42501';
  end if;

  select * into v_cuenta
  from public.cuentas
  where id = p_cuenta_id
  for update;

  if v_cuenta.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  if v_cuenta.estado in ('pagada','cerrada','anulada') then
    return false;
  end if;

  v_total := public.recalcular_total_cuenta(p_cuenta_id);

  select exists (
    select 1
    from public.pedidos p
    join public.pedido_items pi on pi.pedido_id = p.id
    where p.cuenta_id = p_cuenta_id
      and p.estado <> 'anulado'
      and pi.estado <> 'anulado'
      and pi.cantidad > 0
  ) into v_tiene_items;

  if v_tiene_items or coalesce(v_total, 0) > 0 then
    return false;
  end if;

  select coalesce(sum(pg.monto), 0)::numeric(12,0)
    into v_total_pagado
  from public.pagos pg
  where pg.cuenta_id = p_cuenta_id
    and not coalesce(pg.anulado, false);

  update public.pedidos
  set estado = 'anulado',
      updated_at = now()
  where cuenta_id = p_cuenta_id
    and estado <> 'anulado'
    and not exists (
      select 1
      from public.pedido_items pi
      where pi.pedido_id = pedidos.id
        and pi.estado <> 'anulado'
        and pi.cantidad > 0
    );

  update public.cuentas
  set estado = 'cerrada',
      nickname = null,
      responsable_pendiente = null,
      updated_at = now()
  where id = p_cuenta_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'cerrar_cuenta_si_vacia',
    'cuentas',
    p_cuenta_id,
    jsonb_build_object('mesa_id', v_cuenta.mesa_id, 'total', v_total, 'total_pagado', v_total_pagado)
  );

  return true;
end;
$$;

grant execute on function public.cerrar_cuenta_si_vacia(uuid) to authenticated;
