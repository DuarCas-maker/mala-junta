-- 035_f27_catalogo_imagenes_pos.sql
-- Imagenes de catalogo para el POS visual de mesero/caja/admin.

alter table public.combos add column if not exists imagen_url text;

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

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalogo_imagenes_storage_lectura') then
    create policy catalogo_imagenes_storage_lectura on storage.objects for select to authenticated using (bucket_id = 'catalogo-imagenes');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalogo_imagenes_storage_admin_inserta') then
    create policy catalogo_imagenes_storage_admin_inserta on storage.objects for insert to authenticated with check (bucket_id = 'catalogo-imagenes' and public.es_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalogo_imagenes_storage_admin_actualiza') then
    create policy catalogo_imagenes_storage_admin_actualiza on storage.objects for update to authenticated using (bucket_id = 'catalogo-imagenes' and public.es_admin()) with check (bucket_id = 'catalogo-imagenes' and public.es_admin());
  end if;
end $$;

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

create or replace function public.guardar_imagen_catalogo(
  p_tipo text,
  p_item_id uuid,
  p_imagen_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(trim(coalesce(p_imagen_url, '')), '');
begin
  if not public.es_admin() then
    raise exception 'solo_admin_gestiona_imagenes_catalogo' using errcode = '42501';
  end if;

  if p_tipo = 'producto' then
    update public.productos
    set imagen_url = v_url
    where id = p_item_id;
  elsif p_tipo = 'combo' then
    update public.combos
    set imagen_url = v_url
    where id = p_item_id;
  else
    raise exception 'tipo_item_invalido' using errcode = '22023';
  end if;

  if not found then
    raise exception 'item_catalogo_no_encontrado' using errcode = '02000';
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'guardar_imagen_catalogo',
    case when p_tipo = 'producto' then 'productos' else 'combos' end,
    p_item_id,
    jsonb_build_object('tipo', p_tipo, 'imagen_url', v_url)
  );

  return jsonb_build_object('tipo', p_tipo, 'item_id', p_item_id, 'imagen_url', v_url);
end;
$$;

grant execute on function public.guardar_imagen_catalogo(text, uuid, text) to authenticated;
