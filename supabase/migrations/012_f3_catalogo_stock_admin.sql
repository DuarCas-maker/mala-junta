-- 012_f3_catalogo_stock_admin.sql
-- Refuerzos de catalogo/stock admin: proveedores completos, compras con proveedor obligatorio y vista mixta de items.

alter table public.proveedores add column if not exists telefono text;
alter table public.proveedores add column if not exists correo text;
alter table public.proveedores add column if not exists direccion text;
alter table public.proveedores add column if not exists observacion text;

create or replace view public.v_catalogo_items_stock
with (security_invoker = true)
as
select
  1 as orden_tipo,
  'producto'::text as tipo_item,
  p.id as item_id,
  p.nombre,
  c.nombre as categoria,
  p.precio_venta,
  p.costo_unitario_actual as costo_estimado,
  p.stock_actual as stock_disponible,
  p.stock_minimo,
  p.codigo_interno,
  p.presentacion_compra,
  p.factor_compra,
  p.activo,
  null::jsonb as componentes
from public.productos p
left join public.categorias c on c.id = p.categoria_id
where public.es_admin()
union all
select
  2 as orden_tipo,
  'combo'::text as tipo_item,
  co.id as item_id,
  co.nombre,
  'Combo'::text as categoria,
  co.precio_venta,
  coalesce(sum(p.costo_unitario_actual * ci.cantidad), 0)::numeric(12,0) as costo_estimado,
  coalesce(min(floor(p.stock_actual::numeric / nullif(ci.cantidad, 0))), 0)::int as stock_disponible,
  null::int as stock_minimo,
  null::text as codigo_interno,
  null::text as presentacion_compra,
  null::int as factor_compra,
  co.activo,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'producto_id', p.id,
        'producto', p.nombre,
        'cantidad', ci.cantidad,
        'stock_actual', p.stock_actual
      ) order by p.nombre
    ) filter (where ci.id is not null and ci.activo = true),
    '[]'::jsonb
  ) as componentes
from public.combos co
left join public.combo_items ci on ci.combo_id = co.id and ci.activo = true
left join public.productos p on p.id = ci.producto_id
where public.es_admin()
group by co.id, co.nombre, co.precio_venta, co.activo;

drop function if exists public.guardar_proveedor_detalle(uuid, text, text, text, text, text, text, text, boolean);

create function public.guardar_proveedor_detalle(
  p_proveedor_id uuid default null,
  p_nombre text default null,
  p_nit text default null,
  p_contacto text default null,
  p_telefono text default null,
  p_correo text default null,
  p_direccion text default null,
  p_observacion text default null,
  p_activo boolean default true
)
returns public.proveedores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proveedor public.proveedores;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_gestiona_proveedores' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_proveedor_invalido' using errcode = '22023';
  end if;

  if p_proveedor_id is null then
    insert into public.proveedores (nombre, nit, contacto, telefono, correo, direccion, observacion, activo)
    values (
      trim(p_nombre),
      nullif(trim(coalesce(p_nit, '')), ''),
      nullif(trim(coalesce(p_contacto, '')), ''),
      nullif(trim(coalesce(p_telefono, '')), ''),
      nullif(trim(coalesce(p_correo, '')), ''),
      nullif(trim(coalesce(p_direccion, '')), ''),
      nullif(trim(coalesce(p_observacion, '')), ''),
      coalesce(p_activo, true)
    )
    on conflict (nombre) do update set
      nit = excluded.nit,
      contacto = excluded.contacto,
      telefono = excluded.telefono,
      correo = excluded.correo,
      direccion = excluded.direccion,
      observacion = excluded.observacion,
      activo = excluded.activo
    returning * into v_proveedor;
  else
    update public.proveedores
    set nombre = trim(p_nombre),
        nit = nullif(trim(coalesce(p_nit, '')), ''),
        contacto = nullif(trim(coalesce(p_contacto, '')), ''),
        telefono = nullif(trim(coalesce(p_telefono, '')), ''),
        correo = nullif(trim(coalesce(p_correo, '')), ''),
        direccion = nullif(trim(coalesce(p_direccion, '')), ''),
        observacion = nullif(trim(coalesce(p_observacion, '')), ''),
        activo = coalesce(p_activo, true)
    where id = p_proveedor_id
    returning * into v_proveedor;
  end if;

  if v_proveedor.id is null then
    raise exception 'proveedor_no_encontrado' using errcode = '02000';
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'guardar_proveedor_detalle',
    'proveedores',
    v_proveedor.id,
    jsonb_build_object('nombre', v_proveedor.nombre, 'activo', v_proveedor.activo)
  );

  return v_proveedor;
end;
$$;

create or replace function public.registrar_compra(
  p_proveedor_id uuid,
  p_items jsonb,
  p_fecha date default current_date,
  p_observacion text default null
)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra public.compras;
  v_compra_item public.compra_items;
  v_item jsonb;
  v_producto public.productos;
  v_modo public.modo_compra_item;
  v_cantidad int;
  v_factor int;
  v_unidades int;
  v_costo numeric(12,0);
  v_total numeric(12,0) := 0;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_registra_compras' using errcode = '42501';
  end if;

  if p_proveedor_id is null or not exists (select 1 from public.proveedores where id = p_proveedor_id and activo = true) then
    raise exception 'proveedor_obligatorio_invalido' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'compra_sin_items' using errcode = '22023';
  end if;

  insert into public.compras (proveedor_id, fecha, usuario_id, observacion)
  values (p_proveedor_id, coalesce(p_fecha, current_date), public.perfil_actual_id(), nullif(trim(coalesce(p_observacion, '')), ''))
  returning * into v_compra;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_producto
    from public.productos
    where id = (v_item ->> 'producto_id')::uuid
      and activo = true;

    if v_producto.id is null then
      raise exception 'producto_compra_invalido' using errcode = '22023';
    end if;

    v_modo := coalesce(v_item ->> 'modo', 'unidades')::public.modo_compra_item;
    v_cantidad := coalesce((v_item ->> 'cantidad_ingresada')::int, 0);
    v_factor := case when v_modo = 'presentacion' then coalesce(nullif(v_item ->> 'factor_aplicado', '')::int, v_producto.factor_compra) else 1 end;
    v_unidades := v_cantidad * v_factor;
    v_costo := coalesce((v_item ->> 'costo_unitario')::numeric, v_producto.costo_unitario_actual);

    if v_cantidad <= 0 or v_factor <= 0 or v_unidades <= 0 or v_costo < 0 then
      raise exception 'item_compra_invalido' using errcode = '22023';
    end if;

    insert into public.compra_items (
      compra_id, producto_id, modo, cantidad_ingresada, factor_aplicado,
      unidades_resultantes, costo_unitario, subtotal
    )
    values (
      v_compra.id, v_producto.id, v_modo, v_cantidad, v_factor,
      v_unidades, v_costo, v_unidades * v_costo
    )
    returning * into v_compra_item;

    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id
    )
    values (
      v_producto.id, 'compra', v_unidades, 'compra_item', v_compra_item.id, public.perfil_actual_id()
    );

    update public.productos
    set costo_unitario_actual = v_costo
    where id = v_producto.id;

    v_total := v_total + (v_unidades * v_costo);
  end loop;

  update public.compras
  set total = v_total
  where id = v_compra.id
  returning * into v_compra;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_compra', 'compras', v_compra.id, jsonb_build_object('total', v_total, 'proveedor_id', p_proveedor_id));

  return v_compra;
end;
$$;

grant select on public.v_catalogo_items_stock to authenticated;
grant execute on function public.guardar_proveedor_detalle(uuid, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.registrar_compra(uuid, jsonb, date, text) to authenticated;
