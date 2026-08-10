-- 026_f18_aprobacion_capturas_venta.sql
-- Sprint 1: aprobacion explicita por venta antes de confirmar una captura.

alter table public.captura_venta_grupos add column if not exists aprobado boolean not null default false;
alter table public.captura_venta_grupos add column if not exists aprobado_at timestamptz;

create or replace function public.confirmar_captura_venta(p_captura_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil_id uuid;
  v_captura public.capturas_venta;
  v_grupo public.captura_venta_grupos;
  v_items jsonb;
  v_pagos jsonb;
  v_pedido_id uuid;
  v_cuenta_id uuid;
  v_lineas int;
  v_pagos_validos int;
  v_total_pagos numeric(12,0);
  v_confirmadas int := 0;
  v_resultados jsonb := '[]'::jsonb;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_confirma_captura' using errcode = '42501';
  end if;

  v_perfil_id := public.perfil_actual_id();
  if v_perfil_id is null then
    raise exception 'usuario_sin_perfil_activo' using errcode = '42501';
  end if;

  select * into v_captura
  from public.capturas_venta
  where id = p_captura_id
  for update;

  if v_captura.id is null then
    raise exception 'captura_no_encontrada' using errcode = '02000';
  end if;

  if v_captura.estado = 'confirmada' then
    raise exception 'captura_ya_confirmada' using errcode = '22023';
  end if;

  if v_captura.estado not in ('procesada','requiere_revision') then
    raise exception 'captura_no_lista_para_confirmar' using errcode = '22023';
  end if;

  if not exists (select 1 from public.captura_venta_grupos where captura_id = p_captura_id) then
    raise exception 'captura_sin_ventas' using errcode = '22023';
  end if;

  for v_grupo in
    select *
    from public.captura_venta_grupos
    where captura_id = p_captura_id
    order by orden
    for update
  loop
    if v_grupo.pedido_id is not null then
      raise exception 'venta_de_captura_ya_confirmada' using errcode = '22023';
    end if;

    if v_grupo.requiere_revision then
      raise exception 'venta_requiere_revision' using errcode = '22023';
    end if;

    if not v_grupo.aprobado then
      raise exception 'venta_no_aprobada' using errcode = '22023';
    end if;

    select count(*) into v_lineas
    from public.captura_venta_lineas l
    left join public.productos p on p.id = l.producto_id and p.activo = true
    left join public.combos c on c.id = l.combo_id and c.activo = true
    where l.grupo_id = v_grupo.id
      and l.requiere_revision = false
      and l.cantidad > 0
      and (
        (l.tipo_item = 'producto' and l.producto_id is not null and p.id is not null and l.combo_id is null)
        or (l.tipo_item = 'combo' and l.combo_id is not null and c.id is not null and l.producto_id is null)
      );

    if v_lineas = 0 then
      raise exception 'venta_sin_items_validos' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.captura_venta_lineas l
      left join public.productos p on p.id = l.producto_id and p.activo = true
      left join public.combos c on c.id = l.combo_id and c.activo = true
      where l.grupo_id = v_grupo.id
        and (
          l.requiere_revision
          or l.cantidad <= 0
          or not (
            (l.tipo_item = 'producto' and l.producto_id is not null and p.id is not null and l.combo_id is null)
            or (l.tipo_item = 'combo' and l.combo_id is not null and c.id is not null and l.producto_id is null)
          )
        )
    ) then
      raise exception 'venta_tiene_items_pendientes' using errcode = '22023';
    end if;

    select count(*), coalesce(sum(monto), 0)
      into v_pagos_validos, v_total_pagos
    from public.captura_venta_pagos
    where grupo_id = v_grupo.id
      and requiere_revision = false
      and medio_normalizado is not null
      and monto > 0;

    if v_pagos_validos = 0 then
      raise exception 'venta_sin_pagos_validos' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.captura_venta_pagos
      where grupo_id = v_grupo.id
        and (requiere_revision or medio_normalizado is null or monto <= 0)
    ) then
      raise exception 'venta_tiene_pagos_pendientes' using errcode = '22023';
    end if;

    if v_total_pagos <> v_grupo.total_leido then
      raise exception 'pagos_no_coinciden_con_total_leido' using errcode = '22023';
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'producto_id', l.producto_id,
        'combo_id', l.combo_id,
        'cantidad', l.cantidad,
        'notas', concat_ws(' | ', 'Captura foto', nullif(l.texto_original, ''), nullif(l.item_nombre_detectado, ''))
      )
      order by l.orden
    )
      into v_items
    from public.captura_venta_lineas l
    where l.grupo_id = v_grupo.id;

    select jsonb_agg(
      jsonb_build_object(
        'medio', p.medio_normalizado,
        'monto', p.monto
      )
      order by p.orden
    )
      into v_pagos
    from public.captura_venta_pagos p
    where p.grupo_id = v_grupo.id;

    v_pedido_id := public.crear_pedido_rapido(
      null,
      v_items,
      concat('Captura ', p_captura_id::text, ' / venta ', v_grupo.orden::text)
    );

    select cuenta_id into v_cuenta_id
    from public.pedidos
    where id = v_pedido_id;

    perform public.registrar_pagos_cuenta(v_cuenta_id, v_pagos, 0, false, null);

    update public.captura_venta_grupos
    set cuenta_id = v_cuenta_id,
        pedido_id = v_pedido_id,
        confirmado_at = now(),
        confirmado_por = v_perfil_id
    where id = v_grupo.id;

    v_confirmadas := v_confirmadas + 1;
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'grupo_id', v_grupo.id,
      'orden', v_grupo.orden,
      'cuenta_id', v_cuenta_id,
      'pedido_id', v_pedido_id,
      'total_leido', v_grupo.total_leido,
      'total_esperado', v_grupo.total_esperado,
      'diferencia', v_grupo.diferencia
    ));
  end loop;

  update public.capturas_venta
  set estado = 'confirmada',
      confirmado_at = now(),
      confirmado_por = v_perfil_id
  where id = p_captura_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    v_perfil_id,
    'confirmar_captura_venta',
    'capturas_venta',
    p_captura_id,
    jsonb_build_object('ventas_confirmadas', v_confirmadas, 'ventas', v_resultados)
  );

  return jsonb_build_object(
    'captura_id', p_captura_id,
    'ventas_confirmadas', v_confirmadas,
    'ventas', v_resultados
  );
end;
$$;

grant execute on function public.confirmar_captura_venta(uuid) to authenticated;