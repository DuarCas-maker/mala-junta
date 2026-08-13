-- 034_f26_capturas_compra_ocr_base.sql
-- Base para solicitudes de compra por OCR: foto, fecha de ingreso, revision y trazabilidad admin.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_captura_compra') then
    create type public.estado_captura_compra as enum (
      'subida',
      'procesando',
      'requiere_revision',
      'procesada',
      'pendiente_aprobacion',
      'confirmada',
      'rechazada',
      'eliminada',
      'error'
    );
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'capturas-compras',
  'capturas-compras',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.capturas_compra (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  proveedor_id uuid references public.proveedores(id) on delete restrict,
  compra_id uuid references public.compras(id) on delete restrict,
  storage_bucket text not null default 'capturas-compras',
  storage_path text not null,
  nombre_archivo text,
  mime_type text,
  tamano_bytes int,
  estado public.estado_captura_compra not null default 'subida',
  fecha_ingreso date not null default public.dia_negocio(now()),
  modelo_ia text,
  texto_extraido text,
  resultado_ia jsonb not null default '{}'::jsonb,
  advertencias jsonb not null default '[]'::jsonb,
  error_procesamiento text,
  enviado_aprobacion_at timestamptz,
  enviado_aprobacion_por uuid references public.perfiles(id) on delete restrict,
  aprobado_at timestamptz,
  aprobado_por uuid references public.perfiles(id) on delete restrict,
  confirmado_at timestamptz,
  confirmado_por uuid references public.perfiles(id) on delete restrict,
  eliminado_at timestamptz,
  eliminado_por uuid references public.perfiles(id) on delete restrict,
  observacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.captura_compra_lineas (
  id uuid primary key default gen_random_uuid(),
  captura_id uuid not null references public.capturas_compra(id) on delete cascade,
  compra_item_id uuid references public.compra_items(id) on delete restrict,
  orden int not null default 1,
  texto_original text,
  producto_nombre_detectado text,
  producto_id uuid references public.productos(id) on delete restrict,
  modo public.modo_compra_item not null default 'unidades',
  cantidad_ingresada int not null default 1 check (cantidad_ingresada > 0),
  factor_aplicado int not null default 1 check (factor_aplicado > 0),
  unidades_resultantes int not null default 1 check (unidades_resultantes > 0),
  costo_unitario_catalogo numeric(12,0) not null default 0 check (costo_unitario_catalogo >= 0),
  precio_venta_catalogo numeric(12,0) not null default 0 check (precio_venta_catalogo >= 0),
  subtotal_costo numeric(12,0) not null default 0 check (subtotal_costo >= 0),
  stock_actual_snapshot int,
  stock_proyectado int,
  confianza_ia numeric(5,4) not null default 0 check (confianza_ia >= 0 and confianza_ia <= 1),
  puntaje_match numeric(5,4) not null default 0 check (puntaje_match >= 0 and puntaje_match <= 1),
  requiere_revision boolean not null default true,
  precio_catalogo_confirmado boolean not null default false,
  crear_producto_sugerido boolean not null default false,
  producto_nuevo_payload jsonb not null default '{}'::jsonb,
  estado text not null default 'borrador',
  observacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'captura_compra_lineas_estado_valido') then
    alter table public.captura_compra_lineas add constraint captura_compra_lineas_estado_valido check (
      estado in ('borrador','requiere_revision','lista','confirmada','eliminada')
    );
  end if;
end $$;

create index if not exists capturas_compra_created_at_idx on public.capturas_compra(created_at desc);
create index if not exists capturas_compra_estado_fecha_idx on public.capturas_compra(estado, fecha_ingreso desc);
create index if not exists capturas_compra_proveedor_idx on public.capturas_compra(proveedor_id, fecha_ingreso desc);
create index if not exists captura_compra_lineas_captura_idx on public.captura_compra_lineas(captura_id, orden);
create index if not exists captura_compra_lineas_producto_idx on public.captura_compra_lineas(producto_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'capturas_compra_set_updated_at') then
    create trigger capturas_compra_set_updated_at before update on public.capturas_compra for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'captura_compra_lineas_set_updated_at') then
    create trigger captura_compra_lineas_set_updated_at before update on public.captura_compra_lineas for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.capturas_compra enable row level security;
alter table public.captura_compra_lineas enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capturas_compra' and policyname = 'capturas_compra_admin_lee') then
    create policy capturas_compra_admin_lee on public.capturas_compra for select to authenticated using (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capturas_compra' and policyname = 'capturas_compra_admin_inserta') then
    create policy capturas_compra_admin_inserta on public.capturas_compra for insert to authenticated with check (public.es_admin() and usuario_id = public.perfil_actual_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capturas_compra' and policyname = 'capturas_compra_admin_actualiza') then
    create policy capturas_compra_admin_actualiza on public.capturas_compra for update to authenticated using (public.es_admin()) with check (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capturas_compra' and policyname = 'capturas_compra_admin_elimina') then
    create policy capturas_compra_admin_elimina on public.capturas_compra for delete to authenticated using (public.es_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_compra_lineas' and policyname = 'captura_compra_lineas_admin_lee') then
    create policy captura_compra_lineas_admin_lee on public.captura_compra_lineas for select to authenticated using (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_compra_lineas' and policyname = 'captura_compra_lineas_admin_inserta') then
    create policy captura_compra_lineas_admin_inserta on public.captura_compra_lineas for insert to authenticated with check (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_compra_lineas' and policyname = 'captura_compra_lineas_admin_actualiza') then
    create policy captura_compra_lineas_admin_actualiza on public.captura_compra_lineas for update to authenticated using (public.es_admin()) with check (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_compra_lineas' and policyname = 'captura_compra_lineas_admin_elimina') then
    create policy captura_compra_lineas_admin_elimina on public.captura_compra_lineas for delete to authenticated using (public.es_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capturas_compras_storage_admin_lee') then
    create policy capturas_compras_storage_admin_lee on storage.objects for select to authenticated using (bucket_id = 'capturas-compras' and public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capturas_compras_storage_admin_inserta') then
    create policy capturas_compras_storage_admin_inserta on storage.objects for insert to authenticated with check (bucket_id = 'capturas-compras' and public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capturas_compras_storage_admin_actualiza') then
    create policy capturas_compras_storage_admin_actualiza on storage.objects for update to authenticated using (bucket_id = 'capturas-compras' and public.es_admin()) with check (bucket_id = 'capturas-compras' and public.es_admin());
  end if;
end $$;

create or replace view public.v_admin_capturas_compra_aprobacion
with (security_invoker = true)
as
select
  c.id,
  c.estado,
  c.fecha_ingreso,
  c.created_at,
  c.enviado_aprobacion_at,
  c.aprobado_at,
  c.confirmado_at,
  c.eliminado_at,
  c.storage_bucket,
  c.storage_path,
  c.nombre_archivo,
  c.modelo_ia,
  c.advertencias,
  c.proveedor_id,
  pr.nombre as proveedor,
  subio.nombre as subido_por,
  aprobo.nombre as aprobado_por,
  c.compra_id,
  count(l.id)::int as items_total,
  count(l.id) filter (where l.estado = 'confirmada')::int as items_confirmados,
  count(l.id) filter (where l.estado <> 'eliminada' and (l.requiere_revision or not l.precio_catalogo_confirmado))::int as items_pendientes,
  count(l.id) filter (where l.estado = 'eliminada')::int as items_eliminados,
  coalesce(sum(l.unidades_resultantes) filter (where l.estado <> 'eliminada'), 0)::int as unidades_total,
  coalesce(sum(l.subtotal_costo) filter (where l.estado <> 'eliminada'), 0)::numeric(12,0) as costo_total
from public.capturas_compra c
left join public.proveedores pr on pr.id = c.proveedor_id
left join public.perfiles subio on subio.id = c.usuario_id
left join public.perfiles aprobo on aprobo.id = c.aprobado_por
left join public.captura_compra_lineas l on l.captura_id = c.id
where public.es_admin()
group by c.id, pr.nombre, subio.nombre, aprobo.nombre;

grant select, insert, update, delete on public.capturas_compra, public.captura_compra_lineas to authenticated;
grant select on public.v_admin_capturas_compra_aprobacion to authenticated;
