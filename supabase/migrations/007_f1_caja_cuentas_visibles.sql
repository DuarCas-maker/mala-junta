-- F1 ajuste - lectura robusta de cuentas activas para caja.

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
    select jsonb_agg(cuenta_json order by (cuenta_json ->> 'created_at')::timestamptz desc)
    from (
      select jsonb_build_object(
        'id', c.id,
        'estado', c.estado,
        'total_cuenta', c.total_cuenta,
        'responsable_pendiente', c.responsable_pendiente,
        'created_at', c.created_at,
        'mesas', case when m.id is null then null else jsonb_build_object('nombre', m.nombre, 'zona', m.zona) end,
        'perfiles', jsonb_build_object('nombre', pa.nombre),
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
        ), '[]'::jsonb),
        'pedidos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id,
            'estado', p.estado,
            'enviado_at', p.enviado_at,
            'notas', p.notas,
            'perfiles', jsonb_build_object('nombre', pm.nombre),
            'pedido_items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', pi.id,
                'cantidad', pi.cantidad,
                'precio_unitario_capturado', pi.precio_unitario_capturado,
                'notas', pi.notas,
                'estado', pi.estado,
                'productos', jsonb_build_object('nombre', pr.nombre)
              ) order by pi.created_at)
              from public.pedido_items pi
              join public.productos pr on pr.id = pi.producto_id
              where pi.pedido_id = p.id
            ), '[]'::jsonb)
          ) order by p.enviado_at)
          from public.pedidos p
          join public.perfiles pm on pm.id = p.mesero_id
          where p.cuenta_id = c.id
        ), '[]'::jsonb)
      ) as cuenta_json
      from public.cuentas c
      left join public.mesas m on m.id = c.mesa_id
      join public.perfiles pa on pa.id = c.abierta_por
      where c.estado in ('abierta', 'por_cobrar', 'pagada_parcial', 'pendiente')
    ) cuentas
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.cuentas_activas_caja() to authenticated;
