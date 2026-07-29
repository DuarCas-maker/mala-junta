-- F4 - Facturacion DIAN-ready sin transmision real.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_documento_dian') then
    create type public.tipo_documento_dian as enum ('pos','factura_venta','nota_credito','nota_debito');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_dian') then
    create type public.estado_dian as enum ('no_transmitido','pendiente_futuro','error_futuro','validado_futuro');
  end if;

  if not exists (select 1 from pg_type where typname = 'canal_envio_comprobante') then
    create type public.canal_envio_comprobante as enum ('correo','whatsapp');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_envio_comprobante') then
    create type public.estado_envio_comprobante as enum ('solicitado','simulado','fallido');
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_impuesto_producto') then
    create type public.tipo_impuesto_producto as enum ('iva','inc','impoconsumo_licor','exento');
  end if;
end $$;

alter table public.productos add column if not exists tipo_impuesto public.tipo_impuesto_producto not null default 'exento';
alter table public.productos add column if not exists tarifa_pct numeric(6,3) not null default 0;
alter table public.productos add column if not exists tarifa_especifica numeric(12,0) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_tarifa_pct_no_negativa') then
    alter table public.productos add constraint productos_tarifa_pct_no_negativa check (tarifa_pct >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productos_tarifa_especifica_no_negativa') then
    alter table public.productos add constraint productos_tarifa_especifica_no_negativa check (tarifa_especifica >= 0);
  end if;
end $$;

insert into public.parametros (clave, valor, descripcion)
values
  ('dian_resolucion_referencia', '"Resolucion 000165 de 2023"', 'Referencia normativa usada para estructura DIAN-ready. Validar con contador antes de produccion fiscal.'),
  ('dian_modo_operacion', '"interno_no_fiscal"', 'F4 no transmite a DIAN. Solo comprobante interno no fiscal.'),
  ('emisor_nombre_comercial', '"Mala Junta Bar"', 'Nombre comercial visible en comprobante interno.'),
  ('emisor_direccion', '"TODO"', 'Direccion del establecimiento pendiente de confirmar.'),
  ('emisor_municipio', '"TODO"', 'Municipio del establecimiento pendiente de confirmar.'),
  ('emisor_departamento', '"TODO"', 'Departamento del establecimiento pendiente de confirmar.')
on conflict (clave) do update set valor = excluded.valor, descripcion = excluded.descripcion;

create table if not exists public.consecutivos_documento (
  tipo public.tipo_documento_dian primary key,
  prefijo text not null default '',
  siguiente int not null default 1 check (siguiente > 0),
  rango_desde int,
  rango_hasta int,
  resolucion_autorizacion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documentos (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_documento_dian not null,
  prefijo text not null default '',
  consecutivo int not null check (consecutivo > 0),
  numero text not null,
  cuenta_id uuid not null references public.cuentas(id) on delete restrict,
  emisor jsonb not null default '{}'::jsonb,
  adquiriente jsonb,
  subtotal numeric(12,0) not null check (subtotal >= 0),
  impuestos jsonb not null default '[]'::jsonb,
  propina numeric(12,0) not null default 0 check (propina >= 0),
  total numeric(12,0) not null check (total >= 0),
  medios_pago jsonb not null default '[]'::jsonb,
  dia_negocio date not null default public.dia_negocio(now()),
  cufe_cude text,
  xml_url text,
  pdf_url text,
  respuesta_dian jsonb,
  estado_dian public.estado_dian not null default 'no_transmitido',
  etiqueta_no_fiscal text not null default 'COMPROBANTE INTERNO - DOCUMENTO NO FISCAL - NO TRANSMITIDO A LA DIAN',
  generado_por uuid references public.perfiles(id) on delete restrict,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tipo, prefijo, consecutivo),
  constraint documento_factura_adquiriente check (
    tipo <> 'factura_venta'
    or (
      adquiriente is not null
      and char_length(trim(coalesce(adquiriente ->> 'razon_social', ''))) >= 2
      and char_length(trim(coalesce(adquiriente ->> 'numero_id', ''))) >= 3
    )
  ),
  constraint documento_no_transmitido_f4 check (estado_dian = 'no_transmitido')
);

create table if not exists public.documento_lineas (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos(id) on delete restrict,
  pedido_item_id uuid references public.pedido_items(id) on delete restrict,
  producto_id uuid references public.productos(id) on delete restrict,
  combo_id uuid references public.combos(id) on delete restrict,
  descripcion text not null,
  cantidad int not null check (cantidad > 0),
  valor_unitario numeric(12,0) not null check (valor_unitario >= 0),
  subtotal numeric(12,0) not null check (subtotal >= 0),
  tipo_impuesto text not null default 'exento',
  tarifa_pct numeric(6,3) not null default 0,
  impuesto numeric(12,0) not null default 0,
  total numeric(12,0) not null check (total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.envios_comprobante (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos(id) on delete restrict,
  canal public.canal_envio_comprobante not null,
  destino text not null check (char_length(trim(destino)) >= 3),
  estado public.estado_envio_comprobante not null default 'solicitado',
  respuesta jsonb not null default '{}'::jsonb,
  usuario_id uuid references public.perfiles(id) on delete restrict,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists documentos_cuenta_idx on public.documentos(cuenta_id);
create index if not exists documento_lineas_documento_idx on public.documento_lineas(documento_id);
create index if not exists envios_comprobante_documento_idx on public.envios_comprobante(documento_id);

insert into public.consecutivos_documento (tipo, prefijo, siguiente, activo)
values
  ('pos', 'POS', 1, true),
  ('factura_venta', 'FEV', 1, true),
  ('nota_credito', 'NC', 1, true),
  ('nota_debito', 'ND', 1, true)
on conflict (tipo) do nothing;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'consecutivos_documento_set_updated_at') then
    create trigger consecutivos_documento_set_updated_at before update on public.consecutivos_documento for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'documentos_set_updated_at') then
    create trigger documentos_set_updated_at before update on public.documentos for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.uvt_vigente(p_fecha date default current_date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clave text := 'uvt_' || extract(year from coalesce(p_fecha, current_date))::int::text;
  v_valor numeric;
begin
  select case
    when jsonb_typeof(valor) = 'number' then (valor #>> '{}')::numeric
    when jsonb_typeof(valor) = 'string' then trim(both '"' from valor::text)::numeric
    else null
  end
  into v_valor
  from public.parametros
  where clave = v_clave;

  if v_valor is null then
    raise exception 'uvt_no_configurada' using errcode = '22023';
  end if;

  return v_valor;
end;
$$;

create or replace function public.clasificar_documento(p_subtotal numeric, p_fecha date default current_date)
returns public.tipo_documento_dian
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(p_subtotal, 0) > (5 * public.uvt_vigente(p_fecha)) then
    return 'factura_venta';
  end if;
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
    v_adquiriente := null;
  else
    v_adquiriente := jsonb_build_object(
      'razon_social', nullif(trim(coalesce(p_adquiriente ->> 'razon_social', '')), ''),
      'tipo_id', coalesce(nullif(trim(coalesce(p_adquiriente ->> 'tipo_id', '')), ''), 'CC'),
      'numero_id', nullif(trim(coalesce(p_adquiriente ->> 'numero_id', '')), ''),
      'correo', nullif(trim(coalesce(p_adquiriente ->> 'correo', '')), ''),
      'telefono', nullif(trim(coalesce(p_adquiriente ->> 'telefono', '')), '')
    );
  end if;

  if p_tipo = 'factura_venta' and (
    v_adquiriente is null
    or char_length(trim(coalesce(v_adquiriente ->> 'razon_social', ''))) < 2
    or char_length(trim(coalesce(v_adquiriente ->> 'numero_id', ''))) < 3
  ) then
    raise exception 'factura_venta_requiere_adquiriente' using errcode = '22023';
  end if;

  return v_adquiriente;
end;
$$;

create or replace function public.emisor_dian_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nit', coalesce((select valor #>> '{}' from public.parametros where clave = 'emisor_nit'), 'TODO'),
    'razon_social', coalesce((select valor #>> '{}' from public.parametros where clave = 'emisor_razon_social'), 'Mala Junta'),
    'nombre_comercial', coalesce((select valor #>> '{}' from public.parametros where clave = 'emisor_nombre_comercial'), 'Mala Junta Bar'),
    'direccion', coalesce((select valor #>> '{}' from public.parametros where clave = 'emisor_direccion'), 'TODO'),
    'municipio', coalesce((select valor #>> '{}' from public.parametros where clave = 'emisor_municipio'), 'TODO'),
    'departamento', coalesce((select valor #>> '{}' from public.parametros where clave = 'emisor_departamento'), 'TODO'),
    'responsabilidades_fiscales', coalesce((select valor from public.parametros where clave = 'emisor_responsabilidades_fiscales'), '[]'::jsonb),
    'modo', 'interno_no_fiscal'
  );
$$;

create or replace function public.siguiente_consecutivo_documento(p_tipo public.tipo_documento_dian)
returns table(prefijo text, consecutivo int, numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.consecutivos_documento;
begin
  update public.consecutivos_documento
  set siguiente = siguiente + 1
  where tipo = p_tipo
    and activo = true
  returning * into v_row;

  if v_row.tipo is null then
    raise exception 'consecutivo_documento_no_configurado' using errcode = '22023';
  end if;

  prefijo := v_row.prefijo;
  consecutivo := v_row.siguiente - 1;
  numero := v_row.prefijo || lpad((v_row.siguiente - 1)::text, 8, '0');
  return next;
end;
$$;

create or replace function public.impuestos_cuenta_json(p_cuenta_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo_impuesto', tipo_impuesto,
    'tarifa_pct', tarifa_pct,
    'base', base,
    'impuesto', impuesto
  ) order by tipo_impuesto, tarifa_pct), '[]'::jsonb)
  from (
    select
      coalesce(pr.tipo_impuesto::text, 'exento') as tipo_impuesto,
      coalesce(pr.tarifa_pct, 0) as tarifa_pct,
      coalesce(sum(pi.cantidad * pi.precio_unitario_capturado), 0) as base,
      round(coalesce(sum(pi.cantidad * pi.precio_unitario_capturado * coalesce(pr.tarifa_pct, 0) / 100), 0), 0) as impuesto
    from public.pedido_items pi
    join public.pedidos p on p.id = pi.pedido_id
    left join public.productos pr on pr.id = pi.producto_id
    where p.cuenta_id = p_cuenta_id
      and p.estado <> 'anulado'
      and pi.estado <> 'anulado'
    group by coalesce(pr.tipo_impuesto::text, 'exento'), coalesce(pr.tarifa_pct, 0)
  ) impuestos;
$$;

create or replace function public.medios_pago_cuenta_json(p_cuenta_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'medio', medio,
    'monto', monto,
    'propina', propina
  ) order by medio), '[]'::jsonb)
  from (
    select medio::text, sum(monto) as monto, sum(propina) as propina
    from public.pagos
    where cuenta_id = p_cuenta_id
    group by medio
  ) pagos;
$$;

create or replace function public.generar_documento_cuenta(
  p_cuenta_id uuid,
  p_adquiriente jsonb default null
)
returns public.documentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.cuentas;
  v_tipo public.tipo_documento_dian;
  v_adquiriente jsonb;
  v_propina numeric(12,0);
  v_total numeric(12,0);
  v_cons record;
  v_documento public.documentos;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_genera_documentos' using errcode = '42501';
  end if;

  select * into v_cuenta
  from public.cuentas
  where id = p_cuenta_id;

  if v_cuenta.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  if exists (select 1 from public.documentos where cuenta_id = p_cuenta_id and tipo in ('pos','factura_venta')) then
    select * into v_documento
    from public.documentos
    where cuenta_id = p_cuenta_id and tipo in ('pos','factura_venta')
    order by generated_at desc
    limit 1;
    return v_documento;
  end if;

  v_tipo := public.clasificar_documento(v_cuenta.total_cuenta, v_cuenta.dia_negocio);
  v_adquiriente := public.validar_adquiriente_factura(v_tipo, p_adquiriente);

  select coalesce(sum(propina), 0) into v_propina
  from public.pagos
  where cuenta_id = p_cuenta_id;

  v_total := v_cuenta.total_cuenta + v_propina;

  select * into v_cons
  from public.siguiente_consecutivo_documento(v_tipo);

  insert into public.documentos (
    tipo, prefijo, consecutivo, numero, cuenta_id, emisor, adquiriente,
    subtotal, impuestos, propina, total, medios_pago, dia_negocio, generado_por
  )
  values (
    v_tipo, v_cons.prefijo, v_cons.consecutivo, v_cons.numero, p_cuenta_id,
    public.emisor_dian_snapshot(), v_adquiriente,
    v_cuenta.total_cuenta, public.impuestos_cuenta_json(p_cuenta_id), v_propina, v_total,
    public.medios_pago_cuenta_json(p_cuenta_id), v_cuenta.dia_negocio, public.perfil_actual_id()
  )
  returning * into v_documento;

  insert into public.documento_lineas (
    documento_id, pedido_item_id, producto_id, combo_id, descripcion, cantidad,
    valor_unitario, subtotal, tipo_impuesto, tarifa_pct, impuesto, total
  )
  select
    v_documento.id,
    pi.id,
    pi.producto_id,
    pi.combo_id,
    coalesce(pr.nombre, co.nombre, 'Item'),
    pi.cantidad,
    pi.precio_unitario_capturado,
    pi.cantidad * pi.precio_unitario_capturado,
    coalesce(pr.tipo_impuesto::text, 'exento'),
    coalesce(pr.tarifa_pct, 0),
    round((pi.cantidad * pi.precio_unitario_capturado) * coalesce(pr.tarifa_pct, 0) / 100, 0),
    (pi.cantidad * pi.precio_unitario_capturado) + round((pi.cantidad * pi.precio_unitario_capturado) * coalesce(pr.tarifa_pct, 0) / 100, 0)
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.pedido_id
  left join public.productos pr on pr.id = pi.producto_id
  left join public.combos co on co.id = pi.combo_id
  where p.cuenta_id = p_cuenta_id
    and p.estado <> 'anulado'
    and pi.estado <> 'anulado';

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'generar_documento_cuenta',
    'documentos',
    v_documento.id,
    jsonb_build_object('cuenta_id', p_cuenta_id, 'tipo', v_documento.tipo, 'numero', v_documento.numero, 'estado_dian', v_documento.estado_dian)
  );

  return v_documento;
end;
$$;

create or replace function public.solicitar_envio_comprobante(
  p_documento_id uuid,
  p_canal public.canal_envio_comprobante,
  p_destino text
)
returns public.envios_comprobante
language plpgsql
security definer
set search_path = public
as $$
declare
  v_envio public.envios_comprobante;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_envia_comprobantes' using errcode = '42501';
  end if;

  if not exists (select 1 from public.documentos where id = p_documento_id) then
    raise exception 'documento_no_encontrado' using errcode = '02000';
  end if;

  insert into public.envios_comprobante (documento_id, canal, destino, estado, respuesta, usuario_id)
  values (
    p_documento_id,
    p_canal,
    trim(p_destino),
    'simulado',
    jsonb_build_object('modo', 'stub_f4', 'mensaje', 'Envio no fiscal simulado. Integracion real pendiente.'),
    public.perfil_actual_id()
  )
  returning * into v_envio;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'solicitar_envio_comprobante', 'envios_comprobante', v_envio.id, jsonb_build_object('documento_id', p_documento_id, 'canal', p_canal, 'destino', p_destino));

  return v_envio;
end;
$$;

-- Copia controlada de la logica de pago F2 para que F4 pueda validar/generar documento en la misma transaccion.
create or replace function public.registrar_pagos_cuenta_base(
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

create or replace function public.registrar_pagos_cuenta_dian(
  p_cuenta_id uuid,
  p_pagos jsonb,
  p_propina numeric default 0,
  p_dejar_pendiente boolean default false,
  p_responsable_pendiente text default null,
  p_adquiriente jsonb default null,
  p_envio jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta_antes public.cuentas;
  v_cuenta public.cuentas;
  v_tipo public.tipo_documento_dian;
  v_documento public.documentos;
  v_envio public.envios_comprobante;
  v_canal public.canal_envio_comprobante;
  v_destino text;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_pagos' using errcode = '42501';
  end if;

  select * into v_cuenta_antes
  from public.cuentas
  where id = p_cuenta_id;

  if v_cuenta_antes.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  v_tipo := public.clasificar_documento(v_cuenta_antes.total_cuenta, v_cuenta_antes.dia_negocio);
  perform public.validar_adquiriente_factura(v_tipo, p_adquiriente);

  v_cuenta := public.registrar_pagos_cuenta_base(p_cuenta_id, p_pagos, p_propina, p_dejar_pendiente, p_responsable_pendiente);

  if v_cuenta.estado in ('pagada','cerrada') and not p_dejar_pendiente then
    v_documento := public.generar_documento_cuenta(p_cuenta_id, p_adquiriente);

    if p_envio is not null and jsonb_typeof(p_envio) = 'object' and coalesce(p_envio ->> 'destino', '') <> '' then
      v_canal := coalesce(p_envio ->> 'canal', 'correo')::public.canal_envio_comprobante;
      v_destino := p_envio ->> 'destino';
      v_envio := public.solicitar_envio_comprobante(v_documento.id, v_canal, v_destino);
    end if;
  end if;

  return jsonb_build_object(
    'cuenta', to_jsonb(v_cuenta),
    'documento', case when v_documento.id is null then null else to_jsonb(v_documento) end,
    'envio', case when v_envio.id is null then null else to_jsonb(v_envio) end
  );
end;
$$;

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
  v_resultado jsonb;
  v_cuenta public.cuentas;
begin
  v_resultado := public.registrar_pagos_cuenta_dian(
    p_cuenta_id,
    p_pagos,
    p_propina,
    p_dejar_pendiente,
    p_responsable_pendiente,
    null,
    null
  );

  select * into v_cuenta
  from jsonb_populate_record(null::public.cuentas, v_resultado -> 'cuenta');

  return v_cuenta;
end;
$$;

create or replace function public.registrar_pago_cuenta(p_cuenta_id uuid, p_medio public.medio_pago, p_monto numeric, p_propina numeric default 0)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago public.pagos;
begin
  perform public.registrar_pagos_cuenta(
    p_cuenta_id,
    jsonb_build_array(jsonb_build_object('medio', p_medio, 'monto', p_monto)),
    p_propina,
    false,
    null
  );

  select * into v_pago
  from public.pagos
  where cuenta_id = p_cuenta_id
  order by timestamp desc
  limit 1;

  return v_pago;
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
                'productos', case when pr.id is null then null else jsonb_build_object('nombre', pr.nombre) end,
                'combos', case when co.id is null then null else jsonb_build_object('nombre', co.nombre) end
              ) order by pi.created_at)
              from public.pedido_items pi
              left join public.productos pr on pr.id = pi.producto_id
              left join public.combos co on co.id = pi.combo_id
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

alter table public.consecutivos_documento enable row level security;
alter table public.documentos enable row level security;
alter table public.documento_lineas enable row level security;
alter table public.envios_comprobante enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'consecutivos_documento' and policyname = 'consecutivos_documento_admin_lee') then
    create policy consecutivos_documento_admin_lee on public.consecutivos_documento for select to authenticated using (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documentos' and policyname = 'documentos_caja_admin_lee') then
    create policy documentos_caja_admin_lee on public.documentos for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documento_lineas' and policyname = 'documento_lineas_caja_admin_lee') then
    create policy documento_lineas_caja_admin_lee on public.documento_lineas for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'envios_comprobante' and policyname = 'envios_comprobante_caja_admin_lee') then
    create policy envios_comprobante_caja_admin_lee on public.envios_comprobante for select to authenticated using (public.es_caja_o_admin());
  end if;
end $$;

grant select on public.consecutivos_documento, public.documentos, public.documento_lineas, public.envios_comprobante to authenticated;
grant execute on function public.uvt_vigente(date) to authenticated;
grant execute on function public.clasificar_documento(numeric, date) to authenticated;
grant execute on function public.generar_documento_cuenta(uuid, jsonb) to authenticated;
grant execute on function public.solicitar_envio_comprobante(uuid, public.canal_envio_comprobante, text) to authenticated;
grant execute on function public.registrar_pagos_cuenta_dian(uuid, jsonb, numeric, boolean, text, jsonb, jsonb) to authenticated;
grant execute on function public.registrar_pagos_cuenta(uuid, jsonb, numeric, boolean, text) to authenticated;
grant execute on function public.registrar_pago_cuenta(uuid, public.medio_pago, numeric, numeric) to authenticated;
grant execute on function public.cuentas_activas_caja() to authenticated;

revoke all on function public.registrar_pagos_cuenta_base(uuid, jsonb, numeric, boolean, text) from public, anon, authenticated;
