-- F2 - Cierre de caja: apertura, retiros, resumen y cierre con conteo.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_cierre_caja') then
    create type public.estado_cierre_caja as enum ('abierta','cerrada');
  end if;
end $$;

create table if not exists public.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  dia_negocio date not null default public.dia_negocio(now()),
  abierto_por uuid not null references public.perfiles(id) on delete restrict,
  base_inicial numeric(12,0) not null check (base_inicial >= 0),
  abierto_at timestamptz not null default now(),
  cerrado_por uuid references public.perfiles(id) on delete restrict,
  cerrado_at timestamptz,
  efectivo_esperado numeric(12,0),
  efectivo_contado numeric(12,0),
  diferencia numeric(12,0),
  aprobado_por uuid references public.perfiles(id) on delete restrict,
  justificacion_diferencia text,
  estado public.estado_cierre_caja not null default 'abierta',
  ticket_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cierre_cerrado_campos check (
    estado = 'abierta'
    or (cerrado_por is not null and cerrado_at is not null and efectivo_esperado is not null and efectivo_contado is not null and diferencia is not null)
  ),
  constraint cierre_descuadre_aprobado check (
    estado = 'abierta'
    or coalesce(diferencia, 0) = 0
    or aprobado_por is not null
  )
);

create unique index if not exists cierres_caja_uno_abierto_idx
on public.cierres_caja ((estado))
where estado = 'abierta';

create table if not exists public.retiros_caja (
  id uuid primary key default gen_random_uuid(),
  cierre_caja_id uuid not null references public.cierres_caja(id) on delete restrict,
  monto numeric(12,0) not null check (monto > 0),
  motivo_id uuid references public.motivos(id) on delete restrict,
  observacion text,
  numero_factura text,
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint retiro_observacion_o_motivo check (motivo_id is not null or char_length(trim(coalesce(observacion, ''))) >= 3)
);

alter table public.pagos add column if not exists cierre_caja_id uuid references public.cierres_caja(id) on delete restrict;
alter table public.cuentas add column if not exists cierre_caja_id uuid references public.cierres_caja(id) on delete restrict;

create index if not exists pagos_cierre_caja_idx on public.pagos(cierre_caja_id);
create index if not exists retiros_caja_cierre_idx on public.retiros_caja(cierre_caja_id);
create index if not exists cuentas_cierre_caja_idx on public.cuentas(cierre_caja_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'cierres_caja_set_updated_at') then
    create trigger cierres_caja_set_updated_at before update on public.cierres_caja for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.cierre_caja_abierto_actual()
returns public.cierres_caja
language sql
security definer
set search_path = public
as $$
  select c.*
  from public.cierres_caja c
  where c.estado = 'abierta'
  order by c.abierto_at desc
  limit 1;
$$;

create or replace function public.abrir_caja(p_base_inicial numeric)
returns public.cierres_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_abre_caja' using errcode = '42501';
  end if;

  if coalesce(p_base_inicial, -1) < 0 then
    raise exception 'base_inicial_invalida' using errcode = '22023';
  end if;

  if exists (select 1 from public.cierres_caja where estado = 'abierta') then
    raise exception 'ya_existe_caja_abierta' using errcode = '23505';
  end if;

  insert into public.cierres_caja (abierto_por, base_inicial, dia_negocio)
  values (public.perfil_actual_id(), p_base_inicial, public.dia_negocio(now()))
  returning * into v_cierre;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'abrir_caja', 'cierres_caja', v_cierre.id, jsonb_build_object('base_inicial', p_base_inicial));

  return v_cierre;
end;
$$;

create or replace function public.registrar_retiro_caja(
  p_monto numeric,
  p_motivo_id uuid default null,
  p_observacion text default null,
  p_numero_factura text default null
)
returns public.retiros_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_retiro public.retiros_caja;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_retiros' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  if coalesce(p_monto, 0) <= 0 then
    raise exception 'monto_retiro_invalido' using errcode = '22023';
  end if;

  if p_motivo_id is not null and not exists (select 1 from public.motivos where id = p_motivo_id and tipo = 'retiro_caja' and activo = true) then
    raise exception 'motivo_retiro_invalido' using errcode = '22023';
  end if;

  if p_motivo_id is null and char_length(trim(coalesce(p_observacion, ''))) < 3 then
    raise exception 'retiro_requiere_motivo_u_observacion' using errcode = '22023';
  end if;

  insert into public.retiros_caja (cierre_caja_id, monto, motivo_id, observacion, numero_factura, usuario_id)
  values (v_cierre.id, p_monto, p_motivo_id, nullif(trim(coalesce(p_observacion, '')), ''), nullif(trim(coalesce(p_numero_factura, '')), ''), public.perfil_actual_id())
  returning * into v_retiro;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_retiro_caja', 'retiros_caja', v_retiro.id, jsonb_build_object('monto', p_monto, 'cierre_caja_id', v_cierre.id));

  return v_retiro;
end;
$$;

create or replace function public.resumen_caja_actual()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_efectivo_pagos numeric(12,0) := 0;
  v_retiros numeric(12,0) := 0;
  v_propinas numeric(12,0) := 0;
  v_efectivo_esperado numeric(12,0) := 0;
  v_pagos_medio jsonb := '{}'::jsonb;
  v_retiros_json jsonb := '[]'::jsonb;
  v_cuentas jsonb := '{}'::jsonb;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_lee_resumen_caja' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();

  if v_cierre.id is null then
    return jsonb_build_object('cierre_abierto', null, 'requiere_apertura', true);
  end if;

  select coalesce(sum(monto), 0), coalesce(sum(propina), 0)
  into v_efectivo_pagos, v_propinas
  from public.pagos
  where cierre_caja_id = v_cierre.id
    and medio = 'efectivo';

  select coalesce(sum(propina), 0)
  into v_propinas
  from public.pagos
  where cierre_caja_id = v_cierre.id;

  select coalesce(sum(monto), 0)
  into v_retiros
  from public.retiros_caja
  where cierre_caja_id = v_cierre.id;

  v_efectivo_esperado := v_cierre.base_inicial + v_efectivo_pagos - v_retiros;

  select coalesce(jsonb_object_agg(medio, total), '{}'::jsonb)
  into v_pagos_medio
  from (
    select medio::text, coalesce(sum(monto), 0) as total
    from public.pagos
    where cierre_caja_id = v_cierre.id
    group by medio
  ) pagos_por_medio;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'monto', r.monto,
    'observacion', r.observacion,
    'numero_factura', r.numero_factura,
    'timestamp', r.timestamp,
    'motivo', m.texto
  ) order by r.timestamp desc), '[]'::jsonb)
  into v_retiros_json
  from public.retiros_caja r
  left join public.motivos m on m.id = r.motivo_id
  where r.cierre_caja_id = v_cierre.id;

  select jsonb_build_object(
    'abiertas', count(*) filter (where estado in ('abierta','por_cobrar','pagada_parcial')),
    'pendientes', count(*) filter (where estado = 'pendiente'),
    'pagadas_turno', count(*) filter (where estado = 'pagada' and id in (select cuenta_id from public.pagos where cierre_caja_id = v_cierre.id))
  )
  into v_cuentas
  from public.cuentas;

  return jsonb_build_object(
    'cierre_abierto', to_jsonb(v_cierre),
    'requiere_apertura', false,
    'efectivo_pagos', v_efectivo_pagos,
    'retiros_total', v_retiros,
    'efectivo_esperado', v_efectivo_esperado,
    'pagos_por_medio', v_pagos_medio,
    'propinas_total', v_propinas,
    'retiros', v_retiros_json,
    'cuentas', v_cuentas
  );
end;
$$;

create or replace function public.cerrar_caja(p_efectivo_contado numeric, p_justificacion text default null)
returns public.cierres_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_efectivo_pagos numeric(12,0) := 0;
  v_retiros numeric(12,0) := 0;
  v_esperado numeric(12,0) := 0;
  v_diferencia numeric(12,0) := 0;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_cierra_caja' using errcode = '42501';
  end if;

  if coalesce(p_efectivo_contado, -1) < 0 then
    raise exception 'efectivo_contado_invalido' using errcode = '22023';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  select coalesce(sum(monto), 0)
  into v_efectivo_pagos
  from public.pagos
  where cierre_caja_id = v_cierre.id
    and medio = 'efectivo';

  select coalesce(sum(monto), 0)
  into v_retiros
  from public.retiros_caja
  where cierre_caja_id = v_cierre.id;

  v_esperado := v_cierre.base_inicial + v_efectivo_pagos - v_retiros;
  v_diferencia := p_efectivo_contado - v_esperado;

  if v_diferencia <> 0 and not public.es_admin() then
    raise exception 'cierre_descuadrado_requiere_admin' using errcode = '42501';
  end if;

  if v_diferencia <> 0 and char_length(trim(coalesce(p_justificacion, ''))) < 3 then
    raise exception 'cierre_descuadrado_requiere_justificacion' using errcode = '22023';
  end if;

  update public.cierres_caja
  set estado = 'cerrada',
      cerrado_por = public.perfil_actual_id(),
      cerrado_at = now(),
      efectivo_esperado = v_esperado,
      efectivo_contado = p_efectivo_contado,
      diferencia = v_diferencia,
      aprobado_por = case when v_diferencia <> 0 then public.perfil_actual_id() else null end,
      justificacion_diferencia = nullif(trim(coalesce(p_justificacion, '')), '')
  where id = v_cierre.id
  returning * into v_cierre;

  update public.cuentas c
  set estado = 'cerrada', cierre_caja_id = v_cierre.id
  where c.estado = 'pagada'
    and exists (select 1 from public.pagos p where p.cuenta_id = c.id and p.cierre_caja_id = v_cierre.id);

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'cerrar_caja', 'cierres_caja', v_cierre.id, jsonb_build_object('efectivo_esperado', v_esperado, 'efectivo_contado', p_efectivo_contado, 'diferencia', v_diferencia));

  return v_cierre;
end;
$$;

-- Reemplaza pagos para exigir caja abierta y asociar el pago al ciclo actual.
create or replace function public.registrar_pagos_cuenta(
  p_cuenta_id uuid,
  p_pagos jsonb,
  p_propina numeric default 0,
  p_dejar_pendiente boolean default false,
  p_responsable_pendiente text default null
)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_medio public.medio_pago;
  v_monto numeric(12,0);
  v_total numeric(12,0);
  v_pagado numeric(12,0);
  v_cuenta public.cuentas;
  v_cierre public.cierres_caja;
  v_propina_restante numeric(12,0) := greatest(coalesce(p_propina, 0), 0);
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_pagos' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  if jsonb_typeof(p_pagos) <> 'array' then
    raise exception 'pagos_invalidos' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_pagos)
  loop
    v_medio := (v_item ->> 'medio')::public.medio_pago;
    v_monto := coalesce((v_item ->> 'monto')::numeric, 0);

    if v_monto <= 0 then
      continue;
    end if;

    insert into public.pagos (cuenta_id, cierre_caja_id, medio, monto, propina, es_abono_pendiente, usuario_id)
    values (p_cuenta_id, v_cierre.id, v_medio, v_monto, v_propina_restante, false, public.perfil_actual_id());

    v_propina_restante := 0;
  end loop;

  select total_cuenta into v_total from public.cuentas where id = p_cuenta_id;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos where cuenta_id = p_cuenta_id;

  update public.cuentas
  set estado = case
      when p_dejar_pendiente then 'pendiente'
      when v_pagado >= v_total then 'pagada'
      when v_pagado > 0 then 'pagada_parcial'
      else estado
    end,
    responsable_pendiente = case when p_dejar_pendiente then nullif(trim(coalesce(p_responsable_pendiente, '')), '') else responsable_pendiente end
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_pagos_cuenta', 'cuentas', p_cuenta_id, jsonb_build_object('pagado', v_pagado, 'total', v_total, 'pendiente', p_dejar_pendiente, 'cierre_caja_id', v_cierre.id));

  return v_cuenta;
end;
$$;

alter table public.cierres_caja enable row level security;
alter table public.retiros_caja enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cierres_caja' and policyname = 'cierres_caja_caja_admin_lee') then
    create policy cierres_caja_caja_admin_lee on public.cierres_caja for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'retiros_caja' and policyname = 'retiros_caja_caja_admin_lee') then
    create policy retiros_caja_caja_admin_lee on public.retiros_caja for select to authenticated using (public.es_caja_o_admin());
  end if;
end $$;

grant select on public.cierres_caja, public.retiros_caja to authenticated;
grant execute on function public.cierre_caja_abierto_actual() to authenticated;
grant execute on function public.abrir_caja(numeric) to authenticated;
grant execute on function public.registrar_retiro_caja(numeric, uuid, text, text) to authenticated;
grant execute on function public.resumen_caja_actual() to authenticated;
grant execute on function public.cerrar_caja(numeric, text) to authenticated;
grant execute on function public.registrar_pagos_cuenta(uuid, jsonb, numeric, boolean, text) to authenticated;
