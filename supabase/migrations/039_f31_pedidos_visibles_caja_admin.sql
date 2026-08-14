-- F31: los pedidos deben ser visibles y gestionables por cualquier perfil de caja o admin.

alter table public.cuentas enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

drop policy if exists cuentas_lectura_por_rol on public.cuentas;
create policy cuentas_lectura_por_rol
on public.cuentas
for select
to authenticated
using (public.es_caja_o_admin() or abierta_por = public.perfil_actual_id());

drop policy if exists pedidos_lectura_por_rol on public.pedidos;
create policy pedidos_lectura_por_rol
on public.pedidos
for select
to authenticated
using (public.es_caja_o_admin() or mesero_id = public.perfil_actual_id());

drop policy if exists pedido_items_lectura_por_rol on public.pedido_items;
create policy pedido_items_lectura_por_rol
on public.pedido_items
for select
to authenticated
using (
  exists (
    select 1
    from public.pedidos p
    where p.id = pedido_id
      and (public.es_caja_o_admin() or p.mesero_id = public.perfil_actual_id())
  )
);

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
  values (
    public.perfil_actual_id(),
    'cambiar_estado_pedido',
    'pedidos',
    p_pedido_id,
    jsonb_build_object('estado', p_estado, 'cuenta_id', v_pedido.cuenta_id)
  );

  return v_pedido;
end;
$$;

grant select on public.cuentas, public.pedidos, public.pedido_items to authenticated;
grant execute on function public.cambiar_estado_pedido(uuid, public.estado_pedido) to authenticated;
