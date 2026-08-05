-- Sprint 2 - Caja con gestion completa de catalogo, compras, combos y stock.
-- Abre a caja las mismas operaciones de catalogo que ya tenia admin.

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
where public.es_caja_o_admin()
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
where public.es_caja_o_admin()
group by co.id, co.nombre, co.precio_venta, co.activo;

create or replace function public.crear_categoria_catalogo(p_nombre text)
returns public.categorias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria public.categorias;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_gestiona_catalogo' using errcode = '42501';
  end if;

  insert into public.categorias (nombre, activa)
  values (trim(p_nombre), true)
  on conflict (nombre) do update set activa = true
  returning * into v_categoria;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'guardar_categoria', 'categorias', v_categoria.id, jsonb_build_object('nombre', v_categoria.nombre));

  return v_categoria;
end;
$$;

create or replace function public.guardar_producto_catalogo(
  p_producto_id uuid default null,
  p_nombre text default null,
  p_categoria_id uuid default null,
  p_precio_venta numeric default 0,
  p_costo_unitario numeric default 0,
  p_codigo_interno text default null,
  p_stock_minimo int default 0,
  p_presentacion_compra text default 'unidad',
  p_factor_compra int default 1,
  p_activo boolean default true
)
returns public.productos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto public.productos;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_gestiona_catalogo' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_producto_invalido' using errcode = '22023';
  end if;

  if coalesce(p_precio_venta, -1) < 0 or coalesce(p_costo_unitario, -1) < 0 then
    raise exception 'valores_producto_invalidos' using errcode = '22023';
  end if;

  if coalesce(p_factor_compra, 0) <= 0 then
    raise exception 'factor_compra_invalido' using errcode = '22023';
  end if;

  if p_producto_id is null then
    insert into public.productos (
      nombre, categoria_id, precio_venta, costo_unitario_actual, codigo_interno,
      stock_minimo, presentacion_compra, factor_compra, activo
    )
    values (
      trim(p_nombre), p_categoria_id, p_precio_venta, p_costo_unitario, nullif(trim(coalesce(p_codigo_interno, '')), ''),
      greatest(coalesce(p_stock_minimo, 0), 0), nullif(trim(coalesce(p_presentacion_compra, '')), ''), p_factor_compra, coalesce(p_activo, true)
    )
    returning * into v_producto;
  else
    update public.productos
    set nombre = trim(p_nombre),
        categoria_id = p_categoria_id,
        precio_venta = p_precio_venta,
        costo_unitario_actual = p_costo_unitario,
        codigo_interno = nullif(trim(coalesce(p_codigo_interno, '')), ''),
        stock_minimo = greatest(coalesce(p_stock_minimo, 0), 0),
        presentacion_compra = nullif(trim(coalesce(p_presentacion_compra, '')), ''),
        factor_compra = p_factor_compra,
        activo = coalesce(p_activo, true)
    where id = p_producto_id
    returning * into v_producto;
  end if;

  if v_producto.id is null then
    raise exception 'producto_no_encontrado' using errcode = '02000';
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'guardar_producto', 'productos', v_producto.id, jsonb_build_object('nombre', v_producto.nombre));

  return v_producto;
end;
$$;

create or replace function public.crear_combo_catalogo(
  p_combo_id uuid default null,
  p_nombre text default null,
  p_precio_venta numeric default 0,
  p_items jsonb default '[]'::jsonb,
  p_activo boolean default true
)
returns public.combos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_combo public.combos;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad int;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_gestiona_combos' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_combo_invalido' using errcode = '22023';
  end if;

  if coalesce(p_precio_venta, -1) < 0 then
    raise exception 'precio_combo_invalido' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'combo_sin_componentes' using errcode = '22023';
  end if;

  if p_combo_id is null then
    insert into public.combos (nombre, precio_venta, activo)
    values (trim(p_nombre), p_precio_venta, coalesce(p_activo, true))
    on conflict (nombre) do update
      set precio_venta = excluded.precio_venta,
          activo = excluded.activo
    returning * into v_combo;
  else
    update public.combos
    set nombre = trim(p_nombre),
        precio_venta = p_precio_venta,
        activo = coalesce(p_activo, true)
    where id = p_combo_id
    returning * into v_combo;
  end if;

  update public.combo_items
  set activo = false
  where combo_id = v_combo.id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := (v_item ->> 'producto_id')::uuid;
    v_cantidad := coalesce((v_item ->> 'cantidad')::int, 0);

    if v_cantidad <= 0 or not exists (select 1 from public.productos where id = v_producto_id and activo = true) then
      raise exception 'componente_combo_invalido' using errcode = '22023';
    end if;

    insert into public.combo_items (combo_id, producto_id, cantidad, activo)
    values (v_combo.id, v_producto_id, v_cantidad, true);
  end loop;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'guardar_combo', 'combos', v_combo.id, jsonb_build_object('nombre', v_combo.nombre));

  return v_combo;
end;
$$;

create or replace function public.registrar_movimiento_inventario(
  p_producto_id uuid,
  p_tipo public.tipo_movimiento_inventario,
  p_cantidad int,
  p_motivo_id uuid,
  p_observacion text default null
)
returns public.movimientos_inventario
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movimiento public.movimientos_inventario;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_ajusta_inventario' using errcode = '42501';
  end if;

  if p_tipo not in ('ajuste','merma','consumo_interno','devolucion') then
    raise exception 'tipo_movimiento_manual_invalido' using errcode = '22023';
  end if;

  if p_tipo in ('ajuste','merma','consumo_interno') and not exists (
    select 1 from public.motivos where id = p_motivo_id and tipo = 'ajuste_inventario' and activo = true
  ) then
    raise exception 'motivo_inventario_invalido' using errcode = '22023';
  end if;

  insert into public.movimientos_inventario (
    producto_id, tipo, cantidad, referencia_tipo, motivo_id, usuario_id
  )
  values (
    p_producto_id, p_tipo, p_cantidad, 'ajuste_manual', p_motivo_id, public.perfil_actual_id()
  )
  returning * into v_movimiento;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'registrar_movimiento_inventario',
    'movimientos_inventario',
    v_movimiento.id,
    jsonb_build_object('tipo', p_tipo, 'cantidad', p_cantidad, 'motivo_id', p_motivo_id, 'observacion', p_observacion)
  );

  return v_movimiento;
end;
$$;

create or replace function public.guardar_proveedor_detalle(
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
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_gestiona_proveedores' using errcode = '42501';
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
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_compras' using errcode = '42501';
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

create or replace function public.guardar_stock_producto_inline(
  p_producto_id uuid,
  p_stock_actual int,
  p_stock_minimo int
)
returns public.productos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto public.productos;
  v_producto_actualizado public.productos;
  v_diferencia int;
  v_motivo_id uuid;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_actualiza_stock' using errcode = '42501';
  end if;

  if p_producto_id is null then
    raise exception 'producto_requerido' using errcode = '22023';
  end if;

  if coalesce(p_stock_actual, -1) < 0 or coalesce(p_stock_minimo, -1) < 0 then
    raise exception 'stock_invalido' using errcode = '22023';
  end if;

  select * into v_producto
  from public.productos
  where id = p_producto_id
  for update;

  if v_producto.id is null then
    raise exception 'producto_no_encontrado' using errcode = '02000';
  end if;

  insert into public.motivos (tipo, texto, activo)
  values ('ajuste_inventario', 'Ajuste directo desde catalogo', true)
  on conflict (tipo, texto) do update set activo = true
  returning id into v_motivo_id;

  v_diferencia := p_stock_actual - v_producto.stock_actual;

  update public.productos
  set stock_minimo = p_stock_minimo
  where id = p_producto_id;

  if v_diferencia <> 0 then
    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo_id, usuario_id
    )
    values (
      p_producto_id, 'ajuste', v_diferencia, 'stock_inline_catalogo', p_producto_id, v_motivo_id, public.perfil_actual_id()
    );
  end if;

  select * into v_producto_actualizado
  from public.productos
  where id = p_producto_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'guardar_stock_producto_inline',
    'productos',
    p_producto_id,
    jsonb_build_object(
      'stock_anterior', v_producto.stock_actual,
      'stock_nuevo', v_producto_actualizado.stock_actual,
      'stock_minimo_anterior', v_producto.stock_minimo,
      'stock_minimo_nuevo', v_producto_actualizado.stock_minimo,
      'diferencia', v_diferencia
    )
  );

  return v_producto_actualizado;
end;
$$;

grant select on public.v_catalogo_items_stock to authenticated;
grant execute on function public.crear_categoria_catalogo(text) to authenticated;
grant execute on function public.guardar_producto_catalogo(uuid, text, uuid, numeric, numeric, text, int, text, int, boolean) to authenticated;
grant execute on function public.crear_combo_catalogo(uuid, text, numeric, jsonb, boolean) to authenticated;
grant execute on function public.registrar_movimiento_inventario(uuid, public.tipo_movimiento_inventario, int, uuid, text) to authenticated;
grant execute on function public.guardar_proveedor_detalle(uuid, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.registrar_compra(uuid, jsonb, date, text) to authenticated;
grant execute on function public.guardar_stock_producto_inline(uuid, int, int) to authenticated;