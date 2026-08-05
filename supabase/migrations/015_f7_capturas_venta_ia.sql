-- 015_f7_capturas_venta_ia.sql
-- Fase 1A: captura de foto, extraccion asistida por IA y revision manual sin registrar venta.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_captura_venta') then
    create type public.estado_captura_venta as enum ('subida','procesando','requiere_revision','procesada','confirmada','rechazada','error');
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'capturas-ventas',
  'capturas-ventas',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.capturas_venta (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  storage_bucket text not null default 'capturas-ventas',
  storage_path text not null,
  nombre_archivo text,
  mime_type text,
  tamano_bytes int,
  estado public.estado_captura_venta not null default 'subida',
  dia_negocio date not null default public.dia_negocio(now()),
  modelo_ia text,
  texto_extraido text,
  resultado_ia jsonb not null default '{}'::jsonb,
  advertencias jsonb not null default '[]'::jsonb,
  error_procesamiento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.captura_venta_lineas (
  id uuid primary key default gen_random_uuid(),
  captura_id uuid not null references public.capturas_venta(id) on delete cascade,
  orden int not null default 1,
  texto_original text,
  item_nombre_detectado text,
  tipo_item text not null default 'desconocido' check (tipo_item in ('producto','combo','desconocido')),
  producto_id uuid references public.productos(id) on delete restrict,
  combo_id uuid references public.combos(id) on delete restrict,
  cantidad int not null default 1 check (cantidad > 0),
  valor_unitario numeric(12,0) not null default 0 check (valor_unitario >= 0),
  subtotal numeric(12,0) not null default 0 check (subtotal >= 0),
  confianza_ia numeric(5,4) not null default 0 check (confianza_ia >= 0 and confianza_ia <= 1),
  puntaje_match numeric(5,4) not null default 0 check (puntaje_match >= 0 and puntaje_match <= 1),
  requiere_revision boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint captura_linea_item_unico check (
    ((producto_id is not null)::int + (combo_id is not null)::int) <= 1
  )
);

create table if not exists public.captura_venta_pagos (
  id uuid primary key default gen_random_uuid(),
  captura_id uuid not null references public.capturas_venta(id) on delete cascade,
  medio_detectado text,
  medio_normalizado public.medio_pago,
  monto numeric(12,0) not null default 0 check (monto >= 0),
  confianza_ia numeric(5,4) not null default 0 check (confianza_ia >= 0 and confianza_ia <= 1),
  requiere_revision boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists capturas_venta_created_at_idx on public.capturas_venta(created_at desc);
create index if not exists captura_venta_lineas_captura_idx on public.captura_venta_lineas(captura_id, orden);
create index if not exists captura_venta_pagos_captura_idx on public.captura_venta_pagos(captura_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'capturas_venta_set_updated_at') then
    create trigger capturas_venta_set_updated_at before update on public.capturas_venta for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'captura_venta_lineas_set_updated_at') then
    create trigger captura_venta_lineas_set_updated_at before update on public.captura_venta_lineas for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'captura_venta_pagos_set_updated_at') then
    create trigger captura_venta_pagos_set_updated_at before update on public.captura_venta_pagos for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.capturas_venta enable row level security;
alter table public.captura_venta_lineas enable row level security;
alter table public.captura_venta_pagos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capturas_venta' and policyname = 'capturas_venta_caja_admin_lee') then
    create policy capturas_venta_caja_admin_lee on public.capturas_venta for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capturas_venta' and policyname = 'capturas_venta_caja_admin_inserta') then
    create policy capturas_venta_caja_admin_inserta on public.capturas_venta for insert to authenticated with check (public.es_caja_o_admin() and usuario_id = public.perfil_actual_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capturas_venta' and policyname = 'capturas_venta_caja_admin_actualiza') then
    create policy capturas_venta_caja_admin_actualiza on public.capturas_venta for update to authenticated using (public.es_caja_o_admin()) with check (public.es_caja_o_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_lineas' and policyname = 'captura_venta_lineas_caja_admin_lee') then
    create policy captura_venta_lineas_caja_admin_lee on public.captura_venta_lineas for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_lineas' and policyname = 'captura_venta_lineas_caja_admin_inserta') then
    create policy captura_venta_lineas_caja_admin_inserta on public.captura_venta_lineas for insert to authenticated with check (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_lineas' and policyname = 'captura_venta_lineas_caja_admin_actualiza') then
    create policy captura_venta_lineas_caja_admin_actualiza on public.captura_venta_lineas for update to authenticated using (public.es_caja_o_admin()) with check (public.es_caja_o_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_pagos' and policyname = 'captura_venta_pagos_caja_admin_lee') then
    create policy captura_venta_pagos_caja_admin_lee on public.captura_venta_pagos for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_pagos' and policyname = 'captura_venta_pagos_caja_admin_inserta') then
    create policy captura_venta_pagos_caja_admin_inserta on public.captura_venta_pagos for insert to authenticated with check (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_pagos' and policyname = 'captura_venta_pagos_caja_admin_actualiza') then
    create policy captura_venta_pagos_caja_admin_actualiza on public.captura_venta_pagos for update to authenticated using (public.es_caja_o_admin()) with check (public.es_caja_o_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capturas_ventas_storage_caja_admin_lee') then
    create policy capturas_ventas_storage_caja_admin_lee on storage.objects for select to authenticated using (bucket_id = 'capturas-ventas' and public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capturas_ventas_storage_caja_admin_inserta') then
    create policy capturas_ventas_storage_caja_admin_inserta on storage.objects for insert to authenticated with check (bucket_id = 'capturas-ventas' and public.es_caja_o_admin());
  end if;
end $$;

grant select, insert, update on public.capturas_venta, public.captura_venta_lineas, public.captura_venta_pagos to authenticated;
