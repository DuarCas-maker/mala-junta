-- F1 ajuste - cuentas pasan a por_cobrar al entregar todos los pedidos activos.

create or replace function public.marcar_cuenta_por_cobrar_si_lista(p_cuenta_id uuid)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.cuentas;
begin
  if p_cuenta_id is null then
    raise exception 'cuenta_requerida' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.pedidos
    where cuenta_id = p_cuenta_id
      and estado <> 'anulado'
  ) and not exists (
    select 1
    from public.pedidos
    where cuenta_id = p_cuenta_id
      and estado not in ('entregado', 'anulado')
  ) then
    update public.cuentas
    set estado = case
      when estado in ('abierta', 'pagada_parcial') then 'por_cobrar'
      else estado
    end
    where id = p_cuenta_id
    returning * into v_cuenta;
  else
    update public.cuentas
    set estado = case
      when estado = 'por_cobrar' then 'abierta'
      else estado
    end
    where id = p_cuenta_id
    returning * into v_cuenta;
  end if;

  return v_cuenta;
end;
$$;

create or replace function public.cambiar_estado_pedido(p_pedido_id uuid, p_estado public.estado_pedido)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_cambia_pedidos' using errcode = '42501';
  end if;

  if p_estado = 'anulado' then
    raise exception 'use_anular_pedido_con_motivo' using errcode = '22023';
  end if;

  if p_estado not in ('enviado','en_preparacion','entregado') then
    raise exception 'estado_pedido_invalido' using errcode = '22023';
  end if;

  update public.pedidos
  set estado = p_estado,
      en_preparacion_at = case when p_estado = 'en_preparacion' and en_preparacion_at is null then now() else en_preparacion_at end,
      entregado_at = case when p_estado = 'entregado' and entregado_at is null then now() else entregado_at end
  where id = p_pedido_id
  returning * into v_pedido;

  if v_pedido.id is null then
    raise exception 'pedido_no_encontrado' using errcode = '02000';
  end if;

  update public.pedido_items
  set estado = p_estado
  where pedido_id = p_pedido_id;

  perform public.recalcular_total_cuenta(v_pedido.cuenta_id);
  perform public.marcar_cuenta_por_cobrar_si_lista(v_pedido.cuenta_id);

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'cambiar_estado_pedido', 'pedidos', p_pedido_id, jsonb_build_object('estado', p_estado, 'cuenta_id', v_pedido.cuenta_id));

  return v_pedido;
end;
$$;

-- Normaliza cuentas ya entregadas antes de instalar esta regla.
with cuentas_listas as (
  select c.id
  from public.cuentas c
  where c.estado in ('abierta', 'pagada_parcial')
    and exists (
      select 1 from public.pedidos p
      where p.cuenta_id = c.id and p.estado <> 'anulado'
    )
    and not exists (
      select 1 from public.pedidos p
      where p.cuenta_id = c.id and p.estado not in ('entregado', 'anulado')
    )
)
update public.cuentas c
set estado = 'por_cobrar'
from cuentas_listas cl
where c.id = cl.id;

grant execute on function public.marcar_cuenta_por_cobrar_si_lista(uuid) to authenticated;
grant execute on function public.cambiar_estado_pedido(uuid, public.estado_pedido) to authenticated;
