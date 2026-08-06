-- 018_f10_capturas_ventas_detectadas.sql
-- Agrupa la lectura de fotos por venta detectada: productos, totales, diferencias y pagos por venta.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_alias_operativo') then
    create type public.tipo_alias_operativo as enum ('producto','combo','medio_pago','cuenta_pago');
  end if;
end $$;

create table if not exists public.alias_operativos (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_alias_operativo not null,
  alias text not null check (char_length(trim(alias)) >= 1),
  alias_normalizado text not null,
  producto_id uuid references public.productos(id) on delete restrict,
  combo_id uuid references public.combos(id) on delete restrict,
  medio_normalizado public.medio_pago,
  cuenta_destino text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tipo, alias_normalizado),
  constraint alias_operativo_destino_valido check (
    (tipo = 'producto' and producto_id is not null and combo_id is null and medio_normalizado is null)
    or (tipo = 'combo' and combo_id is not null and producto_id is null and medio_normalizado is null)
    or (tipo = 'medio_pago' and medio_normalizado is not null and producto_id is null and combo_id is null)
    or (tipo = 'cuenta_pago' and medio_normalizado is not null and cuenta_destino is not null and producto_id is null and combo_id is null)
  )
);

create table if not exists public.captura_venta_grupos (
  id uuid primary key default gen_random_uuid(),
  captura_id uuid not null references public.capturas_venta(id) on delete cascade,
  orden int not null default 1,
  texto_original text,
  total_leido numeric(12,0) not null default 0 check (total_leido >= 0),
  total_esperado numeric(12,0) not null default 0 check (total_esperado >= 0),
  diferencia numeric(12,0) not null default 0,
  tipo_diferencia text not null default 'cero' check (tipo_diferencia in ('positiva','negativa','cero')),
  descuento_autorizado boolean not null default false,
  ingreso_adicional boolean not null default false,
  confianza_ia numeric(5,4) not null default 0 check (confianza_ia >= 0 and confianza_ia <= 1),
  requiere_revision boolean not null default true,
  observacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (captura_id, orden)
);

alter table public.captura_venta_lineas add column if not exists grupo_id uuid references public.captura_venta_grupos(id) on delete cascade;
alter table public.captura_venta_lineas add column if not exists precio_catalogo numeric(12,0) not null default 0 check (precio_catalogo >= 0);
alter table public.captura_venta_lineas add column if not exists subtotal_esperado numeric(12,0) not null default 0 check (subtotal_esperado >= 0);

alter table public.captura_venta_pagos add column if not exists grupo_id uuid references public.captura_venta_grupos(id) on delete cascade;
alter table public.captura_venta_pagos add column if not exists captura_linea_id uuid references public.captura_venta_lineas(id) on delete cascade;
alter table public.captura_venta_pagos add column if not exists cuenta_destino text;
alter table public.captura_venta_pagos add column if not exists orden int not null default 1;

create index if not exists alias_operativos_normalizado_idx on public.alias_operativos(tipo, alias_normalizado) where activo = true;
create index if not exists captura_venta_grupos_captura_idx on public.captura_venta_grupos(captura_id, orden);
create index if not exists captura_venta_lineas_grupo_idx on public.captura_venta_lineas(grupo_id, orden);
create index if not exists captura_venta_pagos_grupo_idx on public.captura_venta_pagos(grupo_id, orden);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'alias_operativos_set_updated_at') then
    create trigger alias_operativos_set_updated_at before update on public.alias_operativos for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'captura_venta_grupos_set_updated_at') then
    create trigger captura_venta_grupos_set_updated_at before update on public.captura_venta_grupos for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.alias_operativos enable row level security;
alter table public.captura_venta_grupos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'alias_operativos' and policyname = 'alias_operativos_caja_admin_lee') then
    create policy alias_operativos_caja_admin_lee on public.alias_operativos for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'alias_operativos' and policyname = 'alias_operativos_caja_admin_inserta') then
    create policy alias_operativos_caja_admin_inserta on public.alias_operativos for insert to authenticated with check (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'alias_operativos' and policyname = 'alias_operativos_caja_admin_actualiza') then
    create policy alias_operativos_caja_admin_actualiza on public.alias_operativos for update to authenticated using (public.es_caja_o_admin()) with check (public.es_caja_o_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_grupos' and policyname = 'captura_venta_grupos_caja_admin_lee') then
    create policy captura_venta_grupos_caja_admin_lee on public.captura_venta_grupos for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_grupos' and policyname = 'captura_venta_grupos_caja_admin_inserta') then
    create policy captura_venta_grupos_caja_admin_inserta on public.captura_venta_grupos for insert to authenticated with check (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_grupos' and policyname = 'captura_venta_grupos_caja_admin_actualiza') then
    create policy captura_venta_grupos_caja_admin_actualiza on public.captura_venta_grupos for update to authenticated using (public.es_caja_o_admin()) with check (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_grupos' and policyname = 'captura_venta_grupos_caja_admin_borra') then
    create policy captura_venta_grupos_caja_admin_borra on public.captura_venta_grupos for delete to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_lineas' and policyname = 'captura_venta_lineas_caja_admin_borra') then
    create policy captura_venta_lineas_caja_admin_borra on public.captura_venta_lineas for delete to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captura_venta_pagos' and policyname = 'captura_venta_pagos_caja_admin_borra') then
    create policy captura_venta_pagos_caja_admin_borra on public.captura_venta_pagos for delete to authenticated using (public.es_caja_o_admin());
  end if;
end $$;

insert into public.alias_operativos (tipo, alias, alias_normalizado, medio_normalizado, cuenta_destino, activo)
values
  ('medio_pago', 'E', 'e', 'efectivo', null, true),
  ('medio_pago', 'Efec', 'efec', 'efectivo', null, true),
  ('medio_pago', 'Efect', 'efect', 'efectivo', null, true),
  ('medio_pago', 'Efectivo', 'efectivo', 'efectivo', null, true),
  ('medio_pago', 'N', 'n', 'nequi_daviplata', null, true),
  ('medio_pago', 'Neq', 'neq', 'nequi_daviplata', null, true),
  ('medio_pago', 'Nequi', 'nequi', 'nequi_daviplata', null, true),
  ('medio_pago', 'Tarj', 'tarj', 'datafono', null, true),
  ('medio_pago', 'Tarjeta', 'tarjeta', 'datafono', null, true),
  ('medio_pago', 'Datafono', 'datafono', 'datafono', null, true),
  ('medio_pago', 'Transf', 'transf', 'transferencia', null, true),
  ('medio_pago', 'Transferencia', 'transferencia', 'transferencia', null, true),
  ('cuenta_pago', 'Seb', 'seb', 'nequi_daviplata', 'Sebas', true),
  ('cuenta_pago', 'Sebas', 'sebas', 'nequi_daviplata', 'Sebas', true),
  ('cuenta_pago', 'Nico', 'nico', 'nequi_daviplata', 'Nico', true)
on conflict (tipo, alias_normalizado) do update set
  medio_normalizado = excluded.medio_normalizado,
  cuenta_destino = excluded.cuenta_destino,
  activo = true;

grant select, insert, update on public.alias_operativos, public.captura_venta_grupos to authenticated;
grant delete on public.captura_venta_grupos, public.captura_venta_lineas, public.captura_venta_pagos to authenticated;
