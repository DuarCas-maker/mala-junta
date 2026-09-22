-- F49: imagenes obligatorias, ajustes atomicos y eliminacion segura de catalogo.
-- Reubica la antigua migracion de imagenes que compartia por error la version 035.

alter table public.combos add column if not exists imagen_url text;

create or replace view public.v_productos_operativos
as
select
  p.id,
  p.nombre,
  p.precio_venta,
  p.codigo_interno,
  p.stock_actual,
  p.stock_minimo,
  p.presentacion_compra,
  p.factor_compra,
  p.activo,
  c.nombre as categoria,
  p.imagen_url
from public.productos p
left join public.categorias c on c.id = p.categoria_id
where p.activo = true
  and public.rol_actual() in ('admin'::public.rol_usuario, 'caja'::public.rol_usuario, 'mesero'::public.rol_usuario);

grant select on public.v_productos_operativos to authenticated;

create or replace view public.v_catalogo_items_stock
as
select
  1 as orden_tipo,
  'producto'::text as tipo_item,
  p.id as item_id,
  p.nombre,
  c.nombre as categoria,
  p.precio_venta,
  (case when public.es_admin() then p.costo_unitario_actual else null end)::numeric(12,0) as costo_estimado,
  p.stock_actual as stock_disponible,
  p.stock_minimo,
  p.codigo_interno,
  p.presentacion_compra,
  p.factor_compra,
  p.activo,
  null::jsonb as componentes,
  p.imagen_url
from public.productos p
left join public.categorias c on c.id = p.categoria_id
union all
select
  2 as orden_tipo,
  'combo'::text as tipo_item,
  co.id as item_id,
  co.nombre,
  'Combo'::text as categoria,
  co.precio_venta,
  (case when public.es_admin() then coalesce(sum(p.costo_unitario_actual * ci.cantidad), 0) else null end)::numeric(12,0) as costo_estimado,
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
        'presentacion_compra', p.presentacion_compra,
        'cantidad', ci.cantidad,
        'stock_actual', p.stock_actual
      ) order by p.nombre
    ) filter (where ci.id is not null and ci.activo = true),
    '[]'::jsonb
  ) as componentes,
  co.imagen_url
from public.combos co
left join public.combo_items ci on ci.combo_id = co.id and ci.activo = true
left join public.productos p on p.id = ci.producto_id
group by co.id, co.nombre, co.precio_venta, co.imagen_url, co.activo;

grant select on public.v_catalogo_items_stock to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalogo-imagenes',
  'catalogo-imagenes',
  true,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists catalogo_imagenes_storage_lectura on storage.objects;
drop policy if exists catalogo_imagenes_storage_admin_inserta on storage.objects;
drop policy if exists catalogo_imagenes_storage_admin_actualiza on storage.objects;
drop policy if exists catalogo_imagenes_storage_admin_elimina on storage.objects;

create policy catalogo_imagenes_storage_lectura
on storage.objects for select to authenticated
using (bucket_id = 'catalogo-imagenes');

create policy catalogo_imagenes_storage_admin_inserta
on storage.objects for insert to authenticated
with check (bucket_id = 'catalogo-imagenes' and public.es_admin());

create policy catalogo_imagenes_storage_admin_actualiza
on storage.objects for update to authenticated
using (bucket_id = 'catalogo-imagenes' and public.es_admin())
with check (bucket_id = 'catalogo-imagenes' and public.es_admin());

create policy catalogo_imagenes_storage_admin_elimina
on storage.objects for delete to authenticated
using (bucket_id = 'catalogo-imagenes' and public.es_admin());

-- Los registros existentes sin imagen pasan a pendiente y dejan de estar disponibles para ventas.
update public.productos
set activo = false
where activo = true
  and nullif(trim(coalesce(imagen_url, '')), '') is null;

update public.combos
set activo = false
where activo = true
  and nullif(trim(coalesce(imagen_url, '')), '') is null;

create or replace function public.validar_imagen_item_activo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.activo = true and nullif(trim(coalesce(new.imagen_url, '')), '') is null then
    raise exception 'imagen_obligatoria_para_activar' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists productos_validar_imagen_activo on public.productos;
create trigger productos_validar_imagen_activo
before insert or update of activo, imagen_url on public.productos
for each row execute function public.validar_imagen_item_activo();

drop trigger if exists combos_validar_imagen_activo on public.combos;
create trigger combos_validar_imagen_activo
before insert or update of activo, imagen_url on public.combos
for each row execute function public.validar_imagen_item_activo();

create or replace function public.completar_imagen_catalogo(
  p_tipo text,
  p_item_id uuid,
  p_imagen_url text,
  p_activar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(trim(coalesce(p_imagen_url, '')), '');
  v_activo boolean;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_gestiona_imagenes_catalogo' using errcode = '42501';
  end if;

  if v_url is null then
    raise exception 'imagen_url_requerida' using errcode = '22023';
  end if;

  if p_tipo = 'producto' then
    update public.productos
    set imagen_url = v_url,
        activo = case when p_activar then true else activo end
    where id = p_item_id
    returning activo into v_activo;
  elsif p_tipo = 'combo' then
    update public.combos
    set imagen_url = v_url,
        activo = case when p_activar then true else activo end
    where id = p_item_id
    returning activo into v_activo;
  else
    raise exception 'tipo_item_invalido' using errcode = '22023';
  end if;

  if not found then
    raise exception 'item_catalogo_no_encontrado' using errcode = '02000';
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'completar_imagen_catalogo',
    case when p_tipo = 'producto' then 'productos' else 'combos' end,
    p_item_id,
    jsonb_build_object('tipo', p_tipo, 'imagen_url', v_url, 'activo', v_activo)
  );

  return jsonb_build_object('tipo', p_tipo, 'item_id', p_item_id, 'imagen_url', v_url, 'activo', v_activo);
end;
$$;

-- Compatibilidad con clientes anteriores: asocia la imagen sin cambiar el estado.
create or replace function public.guardar_imagen_catalogo(
  p_tipo text,
  p_item_id uuid,
  p_imagen_url text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.completar_imagen_catalogo(p_tipo, p_item_id, p_imagen_url, false);
$$;

create or replace function public.registrar_ajuste_stock_admin(
  p_producto_id uuid,
  p_modo text,
  p_valor int,
  p_motivo_id uuid,
  p_observacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto public.productos;
  v_diferencia int;
  v_stock_final int;
  v_movimiento public.movimientos_inventario;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_ajusta_inventario' using errcode = '42501';
  end if;

  select * into v_producto
  from public.productos
  where id = p_producto_id and activo = true
  for update;

  if v_producto.id is null then
    raise exception 'producto_activo_no_encontrado' using errcode = '02000';
  end if;

  if not exists (
    select 1 from public.motivos
    where id = p_motivo_id and tipo = 'ajuste_inventario' and activo = true
  ) then
    raise exception 'motivo_inventario_invalido' using errcode = '22023';
  end if;

  if p_modo = 'diferencia' then
    if coalesce(p_valor, 0) = 0 then
      raise exception 'diferencia_no_puede_ser_cero' using errcode = '22023';
    end if;
    v_diferencia := p_valor;
    v_stock_final := v_producto.stock_actual + v_diferencia;
  elsif p_modo = 'stock_final' then
    if p_valor is null or p_valor < 0 then
      raise exception 'stock_final_invalido' using errcode = '22023';
    end if;
    v_stock_final := p_valor;
    v_diferencia := v_stock_final - v_producto.stock_actual;
    if v_diferencia = 0 then
      raise exception 'stock_final_sin_cambios' using errcode = '22023';
    end if;
  else
    raise exception 'modo_ajuste_invalido' using errcode = '22023';
  end if;

  insert into public.movimientos_inventario (
    producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo_id, usuario_id
  ) values (
    v_producto.id, 'ajuste', v_diferencia, 'ajuste_manual_admin', v_producto.id,
    p_motivo_id, public.perfil_actual_id()
  ) returning * into v_movimiento;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(), 'registrar_ajuste_stock_admin', 'movimientos_inventario', v_movimiento.id,
    jsonb_build_object(
      'producto_id', v_producto.id,
      'modo', p_modo,
      'stock_anterior', v_producto.stock_actual,
      'diferencia', v_diferencia,
      'stock_final', v_stock_final,
      'motivo_id', p_motivo_id,
      'observacion', p_observacion
    )
  );

  return jsonb_build_object(
    'movimiento_id', v_movimiento.id,
    'producto_id', v_producto.id,
    'stock_anterior', v_producto.stock_actual,
    'diferencia', v_diferencia,
    'stock_final', v_stock_final
  );
end;
$$;

create or replace function public.puede_eliminar_item_catalogo(
  p_tipo text,
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_razones text[] := array[]::text[];
  v_nombre text;
  v_stock int := 0;
  v_imagen_url text;
begin
  if not public.es_admin() then
    raise exception 'solo_admin_elimina_catalogo' using errcode = '42501';
  end if;

  if p_tipo = 'producto' then
    select nombre, stock_actual, imagen_url into v_nombre, v_stock, v_imagen_url
    from public.productos where id = p_item_id;
    if v_nombre is null then raise exception 'producto_no_encontrado' using errcode = '02000'; end if;

    if v_stock <> 0 then v_razones := array_append(v_razones, 'El stock debe estar en cero.'); end if;
    if exists (select 1 from public.historial_precios where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Tiene historial de precios.'); end if;
    if exists (select 1 from public.movimientos_inventario where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Tiene movimientos de inventario.'); end if;
    if exists (select 1 from public.compra_items where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en compras.'); end if;
    if exists (select 1 from public.combo_items where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Forma parte de uno o más combos.'); end if;
    if exists (select 1 from public.pedido_items where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en pedidos.'); end if;
    if exists (select 1 from public.documento_lineas where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en documentos fiscales.'); end if;
    if exists (select 1 from public.captura_venta_lineas where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en capturas de venta.'); end if;
    if exists (select 1 from public.captura_compra_lineas where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en capturas de compra.'); end if;
    if exists (select 1 from public.alias_operativos where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Tiene alias operativos asociados.'); end if;
    if exists (select 1 from public.auditoria_items where producto_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en auditorías.'); end if;
  elsif p_tipo = 'combo' then
    select nombre, imagen_url into v_nombre, v_imagen_url
    from public.combos where id = p_item_id;
    if v_nombre is null then raise exception 'combo_no_encontrado' using errcode = '02000'; end if;

    if exists (select 1 from public.pedido_items where combo_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en pedidos.'); end if;
    if exists (select 1 from public.documento_lineas where combo_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en documentos fiscales.'); end if;
    if exists (select 1 from public.captura_venta_lineas where combo_id = p_item_id) then v_razones := array_append(v_razones, 'Fue utilizado en capturas de venta.'); end if;
    if exists (select 1 from public.alias_operativos where combo_id = p_item_id) then v_razones := array_append(v_razones, 'Tiene alias operativos asociados.'); end if;
  else
    raise exception 'tipo_item_invalido' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'puede_eliminar', cardinality(v_razones) = 0,
    'tipo', p_tipo,
    'item_id', p_item_id,
    'nombre', v_nombre,
    'imagen_url', v_imagen_url,
    'razones', to_jsonb(v_razones)
  );
end;
$$;

create or replace function public.eliminar_item_catalogo(
  p_tipo text,
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_validacion jsonb;
  v_nombre text;
  v_imagen_url text;
  v_snapshot jsonb;
begin
  v_validacion := public.puede_eliminar_item_catalogo(p_tipo, p_item_id);
  if not coalesce((v_validacion ->> 'puede_eliminar')::boolean, false) then
    raise exception 'item_no_eliminable: %', array_to_string(array(select jsonb_array_elements_text(v_validacion -> 'razones')), ' ')
      using errcode = '23503';
  end if;

  if p_tipo = 'producto' then
    select nombre, imagen_url, to_jsonb(p.*) into v_nombre, v_imagen_url, v_snapshot
    from public.productos p where id = p_item_id;
    delete from public.productos where id = p_item_id;
  else
    select nombre, imagen_url, to_jsonb(c.*) into v_nombre, v_imagen_url, v_snapshot
    from public.combos c where id = p_item_id;
    delete from public.combo_items where combo_id = p_item_id;
    delete from public.combos where id = p_item_id;
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(), 'eliminar_item_catalogo',
    case when p_tipo = 'producto' then 'productos' else 'combos' end,
    p_item_id,
    jsonb_build_object('tipo', p_tipo, 'nombre', v_nombre, 'snapshot', v_snapshot)
  );

  return jsonb_build_object('eliminado', true, 'tipo', p_tipo, 'item_id', p_item_id, 'nombre', v_nombre, 'imagen_url', v_imagen_url);
end;
$$;

-- Los productos creados desde Caja quedan pendientes de imagen e inactivos.
create or replace function public.crear_producto_desde_caja(
  p_nombre text,
  p_categoria_id uuid default null,
  p_categoria_nombre text default null,
  p_precio_venta numeric default 0,
  p_costo_unitario numeric default 0,
  p_codigo_interno text default null,
  p_stock_minimo int default 0,
  p_presentacion_compra text default 'unidad',
  p_factor_compra int default 1
)
returns public.productos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria_id uuid := p_categoria_id;
  v_producto public.productos;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_crea_producto' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'nombre_producto_invalido' using errcode = '22023'; end if;
  if coalesce(p_precio_venta, -1) < 0 or coalesce(p_costo_unitario, -1) < 0 then raise exception 'valores_producto_invalidos' using errcode = '22023'; end if;
  if coalesce(p_stock_minimo, -1) < 0 or coalesce(p_factor_compra, 0) <= 0 then raise exception 'stock_o_factor_invalido' using errcode = '22023'; end if;

  if v_categoria_id is null and char_length(trim(coalesce(p_categoria_nombre, ''))) >= 2 then
    insert into public.categorias (nombre, activa)
    values (trim(p_categoria_nombre), true)
    on conflict (nombre) do update set activa = true
    returning id into v_categoria_id;
  end if;

  insert into public.productos (
    nombre, categoria_id, precio_venta, costo_unitario_actual, codigo_interno,
    stock_minimo, presentacion_compra, factor_compra, activo, stock_actual, imagen_url
  ) values (
    trim(p_nombre), v_categoria_id, coalesce(p_precio_venta, 0), coalesce(p_costo_unitario, 0), nullif(trim(coalesce(p_codigo_interno, '')), ''),
    coalesce(p_stock_minimo, 0), coalesce(nullif(trim(coalesce(p_presentacion_compra, '')), ''), 'unidad'), p_factor_compra, false, 0, null
  ) returning * into v_producto;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(), 'crear_producto_desde_caja', 'productos', v_producto.id,
    jsonb_build_object('nombre', v_producto.nombre, 'categoria_id', v_categoria_id, 'imagen_pendiente', true)
  );
  return v_producto;
end;
$$;

grant execute on function public.completar_imagen_catalogo(text, uuid, text, boolean) to authenticated;
grant execute on function public.guardar_imagen_catalogo(text, uuid, text) to authenticated;
grant execute on function public.registrar_ajuste_stock_admin(uuid, text, int, uuid, text) to authenticated;
grant execute on function public.puede_eliminar_item_catalogo(text, uuid) to authenticated;
grant execute on function public.eliminar_item_catalogo(text, uuid) to authenticated;
grant execute on function public.crear_producto_desde_caja(text, uuid, text, numeric, numeric, text, int, text, int) to authenticated;

-- Caja puede comprar inventario para productos activos o pendientes de imagen,
-- pero los pendientes siguen excluidos de las vistas de venta.
create or replace function public.datos_compras_gastos_caja()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_lee_compras_gastos' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();

  return jsonb_build_object(
    'requiere_apertura', v_cierre.id is null,
    'cierre', case when v_cierre.id is null then null else to_jsonb(v_cierre) end,
    'categorias_gasto', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre)
      from public.categorias_gasto_caja where activa = true
    ), '[]'::jsonb),
    'categorias_producto', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre)
      from public.categorias where activa = true
    ), '[]'::jsonb),
    'proveedores', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre)
      from public.proveedores where activo = true
    ), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nombre', p.nombre,
        'categoria', c.nombre,
        'precio_venta', p.precio_venta,
        'costo_unitario_actual', p.costo_unitario_actual,
        'stock_actual', p.stock_actual,
        'stock_minimo', p.stock_minimo,
        'presentacion_compra', p.presentacion_compra,
        'factor_compra', p.factor_compra,
        'activo', p.activo,
        'imagen_url', p.imagen_url,
        'imagen_pendiente', nullif(trim(coalesce(p.imagen_url, '')), '') is null
      ) order by p.nombre)
      from public.productos p
      left join public.categorias c on c.id = p.categoria_id
      where p.activo = true or nullif(trim(coalesce(p.imagen_url, '')), '') is null
    ), '[]'::jsonb),
    'gastos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'tipo', g.tipo,
        'medio', g.medio,
        'monto', g.monto,
        'observacion', g.observacion,
        'numero_factura', g.numero_factura,
        'timestamp', g.timestamp,
        'categoria', cg.nombre,
        'proveedor', pr.nombre,
        'compra_id', g.compra_id,
        'usuario', pe.nombre
      ) order by g.timestamp desc)
      from public.gastos_caja g
      left join public.categorias_gasto_caja cg on cg.id = g.categoria_id
      left join public.proveedores pr on pr.id = g.proveedor_id
      left join public.perfiles pe on pe.id = g.usuario_id
      where v_cierre.id is not null and g.cierre_caja_id = v_cierre.id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.datos_compras_gastos_caja() to authenticated;
