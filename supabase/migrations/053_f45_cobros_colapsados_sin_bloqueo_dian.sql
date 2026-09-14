-- 053_f45_cobros_colapsados_sin_bloqueo_dian.sql
-- Sprint 3: cobros con detalle de presentacion y comprobante interno sin bloqueo por regla 5 UVT.

create or replace function public.clasificar_documento(p_subtotal numeric, p_fecha date default current_date)
returns public.tipo_documento_dian
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- El comprobante de caja se mantiene como interno no fiscal.
  -- No se fuerza factura_venta ni datos de adquiriente por superar 5 UVT.
  return 'pos';
end;
$$;

create or replace function public.validar_adquiriente_factura(p_tipo public.tipo_documento_dian, p_adquiriente jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_adquiriente jsonb;
begin
  if p_adquiriente is null or jsonb_typeof(p_adquiriente) <> 'object' then
    return null;
  end if;

  v_adquiriente := jsonb_build_object(
    'razon_social', nullif(trim(coalesce(p_adquiriente ->> 'razon_social', '')), ''),
    'tipo_id', coalesce(nullif(trim(coalesce(p_adquiriente ->> 'tipo_id', '')), ''), 'CC'),
    'numero_id', nullif(trim(coalesce(p_adquiriente ->> 'numero_id', '')), ''),
    'correo', nullif(trim(coalesce(p_adquiriente ->> 'correo', '')), ''),
    'telefono', nullif(trim(coalesce(p_adquiriente ->> 'telefono', '')), '')
  );

  -- Se conserva el snapshot cuando el cajero lo diligencia, pero ya no bloquea el pago.
  return v_adquiriente;
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

grant execute on function public.clasificar_documento(numeric, date) to authenticated;
grant execute on function public.validar_adquiriente_factura(public.tipo_documento_dian, jsonb) to authenticated;
grant execute on function public.cuentas_activas_caja() to authenticated;
