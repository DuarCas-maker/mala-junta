-- F43: compras/gastos operativos en caja y pendientes visibles entre turnos.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_gasto_caja') then
    create type public.tipo_gasto_caja as enum ('urgencia','compra_inventario');
  end if;
end $$;

create table if not exists public.categorias_gasto_caja (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (char_length(trim(nombre)) >= 3),
  activa boolean not null default true,
  creada_por uuid references public.perfiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gastos_caja (
  id uuid primary key default gen_random_uuid(),
  cierre_caja_id uuid not null references public.cierres_caja(id) on delete restrict,
  tipo public.tipo_gasto_caja not null,
  categoria_id uuid references public.categorias_gasto_caja(id) on delete restrict,
  medio public.medio_pago not null,
  monto numeric(12,0) not null check (monto > 0),
  proveedor_id uuid references public.proveedores(id) on delete restrict,
  compra_id uuid references public.compras(id) on delete restrict,
  observacion text,
  numero_factura text,
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists gastos_caja_cierre_idx on public.gastos_caja(cierre_caja_id);
create index if not exists gastos_caja_tipo_idx on public.gastos_caja(tipo);
create index if not exists gastos_caja_compra_idx on public.gastos_caja(compra_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'categorias_gasto_caja_set_updated_at') then
    create trigger categorias_gasto_caja_set_updated_at
    before update on public.categorias_gasto_caja
    for each row execute function public.set_updated_at();
  end if;
end $$;

insert into public.categorias_gasto_caja (nombre, activa)
values
  ('Hielo', true),
  ('Vasos', true),
  ('Aseo', true),
  ('Transporte', true),
  ('Compra menor', true),
  ('Otro gasto operativo', true)
on conflict (nombre) do update set activa = true;

create or replace function public.crear_categoria_gasto_caja(p_nombre text)
returns public.categorias_gasto_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria public.categorias_gasto_caja;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_crea_categoria_gasto' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) < 3 then
    raise exception 'categoria_gasto_invalida' using errcode = '22023';
  end if;

  insert into public.categorias_gasto_caja (nombre, activa, creada_por)
  values (trim(p_nombre), true, public.perfil_actual_id())
  on conflict (nombre) do update set activa = true
  returning * into v_categoria;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'crear_categoria_gasto_caja', 'categorias_gasto_caja', v_categoria.id, jsonb_build_object('nombre', v_categoria.nombre));

  return v_categoria;
end;
$$;

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

  if char_length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'nombre_producto_invalido' using errcode = '22023';
  end if;

  if coalesce(p_precio_venta, -1) < 0 or coalesce(p_costo_unitario, -1) < 0 then
    raise exception 'valores_producto_invalidos' using errcode = '22023';
  end if;

  if coalesce(p_stock_minimo, -1) < 0 or coalesce(p_factor_compra, 0) <= 0 then
    raise exception 'stock_o_factor_invalido' using errcode = '22023';
  end if;

  if v_categoria_id is null and char_length(trim(coalesce(p_categoria_nombre, ''))) >= 2 then
    insert into public.categorias (nombre, activa)
    values (trim(p_categoria_nombre), true)
    on conflict (nombre) do update set activa = true
    returning id into v_categoria_id;
  end if;

  insert into public.productos (
    nombre, categoria_id, precio_venta, costo_unitario_actual, codigo_interno,
    stock_minimo, presentacion_compra, factor_compra, activo, stock_actual
  )
  values (
    trim(p_nombre), v_categoria_id, coalesce(p_precio_venta, 0), coalesce(p_costo_unitario, 0), nullif(trim(coalesce(p_codigo_interno, '')), ''),
    coalesce(p_stock_minimo, 0), coalesce(nullif(trim(coalesce(p_presentacion_compra, '')), ''), 'unidad'), p_factor_compra, true, 0
  )
  returning * into v_producto;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'crear_producto_desde_caja',
    'productos',
    v_producto.id,
    jsonb_build_object('nombre', v_producto.nombre, 'categoria_id', v_categoria_id)
  );

  return v_producto;
end;
$$;

create or replace function public.registrar_gasto_urgencia_caja(
  p_categoria_id uuid default null,
  p_categoria_nombre text default null,
  p_monto numeric default 0,
  p_medio public.medio_pago default 'efectivo',
  p_observacion text default null,
  p_numero_factura text default null
)
returns public.gastos_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_categoria public.categorias_gasto_caja;
  v_gasto public.gastos_caja;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_gasto' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  if coalesce(p_monto, 0) <= 0 then
    raise exception 'monto_gasto_invalido' using errcode = '22023';
  end if;

  if p_categoria_id is not null then
    select * into v_categoria
    from public.categorias_gasto_caja
    where id = p_categoria_id and activa = true;
  elsif char_length(trim(coalesce(p_categoria_nombre, ''))) >= 3 then
    v_categoria := public.crear_categoria_gasto_caja(p_categoria_nombre);
  end if;

  if v_categoria.id is null then
    raise exception 'categoria_gasto_requerida' using errcode = '22023';
  end if;

  if char_length(trim(coalesce(p_observacion, ''))) < 3 then
    raise exception 'observacion_gasto_requerida' using errcode = '22023';
  end if;

  insert into public.gastos_caja (
    cierre_caja_id, tipo, categoria_id, medio, monto, observacion, numero_factura, usuario_id
  )
  values (
    v_cierre.id, 'urgencia', v_categoria.id, p_medio, p_monto,
    nullif(trim(coalesce(p_observacion, '')), ''), nullif(trim(coalesce(p_numero_factura, '')), ''), public.perfil_actual_id()
  )
  returning * into v_gasto;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'registrar_gasto_urgencia_caja',
    'gastos_caja',
    v_gasto.id,
    jsonb_build_object('monto', p_monto, 'medio', p_medio, 'categoria_id', v_categoria.id, 'cierre_caja_id', v_cierre.id)
  );

  return v_gasto;
end;
$$;

create or replace function public.registrar_compra_inventario_caja(
  p_items jsonb,
  p_medio public.medio_pago default 'efectivo',
  p_proveedor_id uuid default null,
  p_proveedor_nombre text default null,
  p_fecha date default current_date,
  p_observacion text default null,
  p_numero_factura text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_compra public.compras;
  v_compra_item public.compra_items;
  v_movimiento public.movimientos_inventario;
  v_item jsonb;
  v_producto public.productos;
  v_proveedor_id uuid := p_proveedor_id;
  v_modo public.modo_compra_item;
  v_cantidad int;
  v_factor int;
  v_unidades int;
  v_costo numeric(12,0);
  v_subtotal numeric(12,0);
  v_total numeric(12,0) := 0;
  v_items int := 0;
  v_gasto public.gastos_caja;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_compra_inventario' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'compra_sin_items' using errcode = '22023';
  end if;

  if v_proveedor_id is null and char_length(trim(coalesce(p_proveedor_nombre, ''))) >= 2 then
    insert into public.proveedores (nombre, activo)
    values (trim(p_proveedor_nombre), true)
    on conflict (nombre) do update set activo = true
    returning id into v_proveedor_id;
  end if;

  insert into public.compras (proveedor_id, fecha, usuario_id, observacion)
  values (v_proveedor_id, coalesce(p_fecha, current_date), public.perfil_actual_id(), nullif(trim(coalesce(p_observacion, '')), ''))
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
    v_factor := case when v_modo = 'presentacion' then coalesce(nullif(v_producto.factor_compra, 0), 1) else 1 end;
    v_unidades := v_cantidad * v_factor;
    v_costo := coalesce(nullif((v_item ->> 'costo_unitario')::numeric, 0), v_producto.costo_unitario_actual, 0);

    if v_cantidad <= 0 or v_factor <= 0 or v_unidades <= 0 or v_costo <= 0 then
      raise exception 'item_compra_invalido' using errcode = '22023';
    end if;

    v_subtotal := v_unidades * v_costo;

    insert into public.compra_items (
      compra_id, producto_id, modo, cantidad_ingresada, factor_aplicado,
      unidades_resultantes, costo_unitario, subtotal
    )
    values (
      v_compra.id, v_producto.id, v_modo, v_cantidad, v_factor,
      v_unidades, v_costo, v_subtotal
    )
    returning * into v_compra_item;

    insert into public.movimientos_inventario (
      producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id
    )
    values (
      v_producto.id, 'compra', v_unidades, 'compra_item', v_compra_item.id, public.perfil_actual_id()
    )
    returning * into v_movimiento;

    v_total := v_total + v_subtotal;
    v_items := v_items + 1;
  end loop;

  update public.compras
  set total = v_total
  where id = v_compra.id
  returning * into v_compra;

  insert into public.gastos_caja (
    cierre_caja_id, tipo, medio, monto, proveedor_id, compra_id, observacion, numero_factura, usuario_id
  )
  values (
    v_cierre.id, 'compra_inventario', p_medio, v_total, v_proveedor_id, v_compra.id,
    nullif(trim(coalesce(p_observacion, '')), ''), nullif(trim(coalesce(p_numero_factura, '')), ''), public.perfil_actual_id()
  )
  returning * into v_gasto;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'registrar_compra_inventario_caja',
    'compras',
    v_compra.id,
    jsonb_build_object('total', v_total, 'items', v_items, 'medio', p_medio, 'gasto_caja_id', v_gasto.id, 'cierre_caja_id', v_cierre.id)
  );

  return jsonb_build_object('compra', to_jsonb(v_compra), 'gasto', to_jsonb(v_gasto), 'items', v_items, 'total', v_total);
end;
$$;

create or replace function public.marcar_cuenta_pendiente_caja(
  p_cuenta_id uuid,
  p_responsable_pendiente text,
  p_observacion text default null
)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierre public.cierres_caja;
  v_cuenta public.cuentas;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_marca_pendiente' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  if char_length(trim(coalesce(p_responsable_pendiente, ''))) < 2 then
    raise exception 'responsable_pendiente_requerido' using errcode = '22023';
  end if;

  update public.cuentas
  set estado = 'pendiente',
      responsable_pendiente = trim(p_responsable_pendiente)
  where id = p_cuenta_id
    and estado not in ('pagada','cerrada','anulada')
  returning * into v_cuenta;

  if v_cuenta.id is null then
    raise exception 'cuenta_no_encontrada_o_no_editable' using errcode = '02000';
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'marcar_cuenta_pendiente_caja',
    'cuentas',
    p_cuenta_id,
    jsonb_build_object('responsable', p_responsable_pendiente, 'observacion', p_observacion, 'cierre_caja_id', v_cierre.id)
  );

  return v_cuenta;
end;
$$;

create or replace function public.quitar_pendiente_cuenta_caja(p_cuenta_id uuid)
returns public.cuentas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(12,0);
  v_pagado numeric(12,0);
  v_cuenta public.cuentas;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_quita_pendiente' using errcode = '42501';
  end if;

  select total_cuenta into v_total
  from public.cuentas
  where id = p_cuenta_id
    and estado = 'pendiente';

  if v_total is null then
    raise exception 'cuenta_pendiente_no_encontrada' using errcode = '02000';
  end if;

  select coalesce(sum(monto), 0)
  into v_pagado
  from public.pagos
  where cuenta_id = p_cuenta_id
    and not coalesce(anulado, false);

  update public.cuentas
  set estado = case
        when v_pagado >= v_total then 'pagada'::public.estado_cuenta
        when v_pagado > 0 then 'pagada_parcial'::public.estado_cuenta
        else 'por_cobrar'::public.estado_cuenta
      end,
      responsable_pendiente = null
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'quitar_pendiente_cuenta_caja',
    'cuentas',
    p_cuenta_id,
    jsonb_build_object('pagado', v_pagado, 'total', v_total, 'estado_nuevo', v_cuenta.estado)
  );

  return v_cuenta;
end;
$$;

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
  v_cuenta_antes public.cuentas;
  v_cuenta public.cuentas;
  v_cierre public.cierres_caja;
  v_propina_restante numeric(12,0) := greatest(coalesce(p_propina, 0), 0);
  v_es_abono_pendiente boolean := false;
begin
  if not public.es_caja_o_admin() then
    raise exception 'solo_caja_o_admin_registra_pagos' using errcode = '42501';
  end if;

  select * into v_cierre from public.cierre_caja_abierto_actual();
  if v_cierre.id is null then
    raise exception 'caja_no_abierta' using errcode = '22023';
  end if;

  select * into v_cuenta_antes
  from public.cuentas
  where id = p_cuenta_id
  for update;

  if v_cuenta_antes.id is null then
    raise exception 'cuenta_no_encontrada' using errcode = '02000';
  end if;

  v_es_abono_pendiente := v_cuenta_antes.estado = 'pendiente';

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
    values (p_cuenta_id, v_cierre.id, v_medio, v_monto, v_propina_restante, v_es_abono_pendiente, public.perfil_actual_id());

    v_propina_restante := 0;
  end loop;

  select total_cuenta into v_total from public.cuentas where id = p_cuenta_id;
  select coalesce(sum(monto), 0) into v_pagado
  from public.pagos
  where cuenta_id = p_cuenta_id
    and not coalesce(anulado, false);

  update public.cuentas
  set estado = case
      when p_dejar_pendiente then 'pendiente'
      when v_pagado >= v_total then 'pagada'
      when v_pagado > 0 then 'pagada_parcial'
      else estado
    end,
    responsable_pendiente = case
      when p_dejar_pendiente then nullif(trim(coalesce(p_responsable_pendiente, '')), '')
      when v_pagado >= v_total then null
      else responsable_pendiente
    end
  where id = p_cuenta_id
  returning * into v_cuenta;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (public.perfil_actual_id(), 'registrar_pagos_cuenta', 'cuentas', p_cuenta_id, jsonb_build_object('pagado', v_pagado, 'total', v_total, 'pendiente', p_dejar_pendiente, 'abono_pendiente', v_es_abono_pendiente, 'cierre_caja_id', v_cierre.id));

  return v_cuenta;
end;
$$;

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
      from public.categorias_gasto_caja
      where activa = true
    ), '[]'::jsonb),
    'categorias_producto', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre)
      from public.categorias
      where activa = true
    ), '[]'::jsonb),
    'proveedores', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre)
      from public.proveedores
      where activo = true
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
        'factor_compra', p.factor_compra
      ) order by p.nombre)
      from public.productos p
      left join public.categorias c on c.id = p.categoria_id
      where p.activo = true
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
      where v_cierre.id is not null
        and g.cierre_caja_id = v_cierre.id
    ), '[]'::jsonb)
  );
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
  v_gastos_efectivo numeric(12,0) := 0;
  v_gastos_total numeric(12,0) := 0;
  v_compras_total numeric(12,0) := 0;
  v_urgencias_total numeric(12,0) := 0;
  v_propinas numeric(12,0) := 0;
  v_efectivo_esperado numeric(12,0) := 0;
  v_pagos_medio jsonb := '{}'::jsonb;
  v_retiros_json jsonb := '[]'::jsonb;
  v_gastos_json jsonb := '[]'::jsonb;
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
    and medio = 'efectivo'
    and not coalesce(anulado, false);

  select coalesce(sum(propina), 0)
  into v_propinas
  from public.pagos
  where cierre_caja_id = v_cierre.id
    and not coalesce(anulado, false);

  select coalesce(sum(monto), 0)
  into v_retiros
  from public.retiros_caja
  where cierre_caja_id = v_cierre.id;

  select
    coalesce(sum(monto) filter (where medio = 'efectivo'), 0),
    coalesce(sum(monto), 0),
    coalesce(sum(monto) filter (where tipo = 'compra_inventario'), 0),
    coalesce(sum(monto) filter (where tipo = 'urgencia'), 0)
  into v_gastos_efectivo, v_gastos_total, v_compras_total, v_urgencias_total
  from public.gastos_caja
  where cierre_caja_id = v_cierre.id;

  v_efectivo_esperado := v_cierre.base_inicial + v_efectivo_pagos - v_retiros - v_gastos_efectivo;

  select coalesce(jsonb_object_agg(medio, total), '{}'::jsonb)
  into v_pagos_medio
  from (
    select medio::text, coalesce(sum(monto), 0) as total
    from public.pagos
    where cierre_caja_id = v_cierre.id
      and not coalesce(anulado, false)
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'tipo', g.tipo,
    'medio', g.medio,
    'monto', g.monto,
    'observacion', g.observacion,
    'numero_factura', g.numero_factura,
    'timestamp', g.timestamp,
    'categoria', cg.nombre,
    'proveedor', pr.nombre
  ) order by g.timestamp desc), '[]'::jsonb)
  into v_gastos_json
  from public.gastos_caja g
  left join public.categorias_gasto_caja cg on cg.id = g.categoria_id
  left join public.proveedores pr on pr.id = g.proveedor_id
  where g.cierre_caja_id = v_cierre.id;

  select jsonb_build_object(
    'abiertas', count(*) filter (where estado in ('abierta','por_cobrar','pagada_parcial')),
    'pendientes', count(*) filter (where estado = 'pendiente'),
    'pagadas_turno', count(*) filter (where estado = 'pagada' and id in (select cuenta_id from public.pagos where cierre_caja_id = v_cierre.id and not coalesce(anulado, false))),
    'pendientes_cobrados', coalesce((
      select count(distinct cuenta_id)
      from public.pagos
      where cierre_caja_id = v_cierre.id
        and es_abono_pendiente = true
        and not coalesce(anulado, false)
    ), 0)
  )
  into v_cuentas
  from public.cuentas;

  return jsonb_build_object(
    'cierre_abierto', to_jsonb(v_cierre),
    'requiere_apertura', false,
    'efectivo_pagos', v_efectivo_pagos,
    'retiros_total', v_retiros,
    'gastos_efectivo_total', v_gastos_efectivo,
    'gastos_total', v_gastos_total,
    'compras_inventario_total', v_compras_total,
    'gastos_urgencia_total', v_urgencias_total,
    'salidas_efectivo_total', v_retiros + v_gastos_efectivo,
    'efectivo_esperado', v_efectivo_esperado,
    'pagos_por_medio', v_pagos_medio,
    'propinas_total', v_propinas,
    'retiros', v_retiros_json,
    'gastos', v_gastos_json,
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
  v_gastos_efectivo numeric(12,0) := 0;
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
    and medio = 'efectivo'
    and not coalesce(anulado, false);

  select coalesce(sum(monto), 0)
  into v_retiros
  from public.retiros_caja
  where cierre_caja_id = v_cierre.id;

  select coalesce(sum(monto), 0)
  into v_gastos_efectivo
  from public.gastos_caja
  where cierre_caja_id = v_cierre.id
    and medio = 'efectivo';

  v_esperado := v_cierre.base_inicial + v_efectivo_pagos - v_retiros - v_gastos_efectivo;
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

  update public.cuentas
  set estado = 'cerrada', cierre_caja_id = v_cierre.id
  where estado = 'pagada'
    and exists (select 1 from public.pagos p where p.cuenta_id = cuentas.id and p.cierre_caja_id = v_cierre.id and not coalesce(p.anulado, false));

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    public.perfil_actual_id(),
    'cerrar_caja',
    'cierres_caja',
    v_cierre.id,
    jsonb_build_object('efectivo_contado', p_efectivo_contado, 'efectivo_esperado', v_esperado, 'diferencia', v_diferencia, 'gastos_efectivo', v_gastos_efectivo)
  );

  return v_cierre;
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
    select jsonb_agg(
      cuenta_json
      order by prioridad_cobro asc, pedido_estado_prioridad asc, coalesce(ultimo_pedido_at, created_at) desc, created_at desc
    )
    from (
      select
        c.created_at,
        stats.ultimo_pedido_at,
        stats.pedido_estado_prioridad,
        case
          when c.estado = 'pendiente' then 0
          when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 1
          when stats.tiene_en_preparacion then 2
          when stats.tiene_enviado then 3
          when c.estado = 'pagada_parcial' then 4
          when c.estado = 'abierta' then 6
          else 9
        end as prioridad_cobro,
        jsonb_build_object(
          'id', c.id,
          'estado', c.estado,
          'estado_cobro', case
            when c.estado = 'pendiente' then 'Pendiente'
            when c.estado = 'pagada_parcial' then 'Pago parcial'
            when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 'Por cobrar'
            when stats.tiene_en_preparacion then 'En preparacion'
            when stats.tiene_enviado then 'Enviado'
            else 'Abierta'
          end,
          'prioridad_cobro', case
            when c.estado = 'pendiente' then 0
            when c.estado = 'por_cobrar' or (stats.tiene_pedidos and not stats.tiene_pedidos_no_entregados) then 1
            when stats.tiene_en_preparacion then 2
            when stats.tiene_enviado then 3
            when c.estado = 'pagada_parcial' then 4
            when c.estado = 'abierta' then 6
            else 9
          end,
          'pedido_estado_prioridad', stats.pedido_estado_prioridad,
          'ultimo_pedido_at', stats.ultimo_pedido_at,
          'dia_negocio', c.dia_negocio,
          'es_pendiente_anterior', c.estado = 'pendiente' and c.dia_negocio < public.dia_negocio(now()),
          'total_cuenta', c.total_cuenta,
          'total_pagado', stats.total_pagado,
          'saldo', greatest(coalesce(c.total_cuenta, 0) - stats.total_pagado, 0),
          'responsable_pendiente', c.responsable_pendiente,
          'nickname', c.nickname,
          'created_at', c.created_at,
          'mesas', case when m.id is null then null else jsonb_build_object('nombre', m.nombre, 'zona', m.zona) end,
          'perfiles', jsonb_build_object('nombre', coalesce(pa.nombre, '-')),
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
              'es_abono_pendiente', pg.es_abono_pendiente,
              'timestamp', pg.timestamp
            ) order by pg.timestamp)
            from public.pagos pg
            where pg.cuenta_id = c.id
              and not coalesce(pg.anulado, false)
          ), '[]'::jsonb),
          'pedidos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', p.id,
              'estado', p.estado,
              'enviado_at', p.enviado_at,
              'notas', p.notas,
              'perfiles', jsonb_build_object('nombre', coalesce(pm.nombre, '-')),
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
                  and pi.estado <> 'anulado'
              ), '[]'::jsonb)
            ) order by p.enviado_at)
            from public.pedidos p
            left join public.perfiles pm on pm.id = p.mesero_id
            where p.cuenta_id = c.id
              and p.estado <> 'anulado'
          ), '[]'::jsonb)
        ) as cuenta_json
      from public.cuentas c
      left join public.mesas m on m.id = c.mesa_id
      left join public.perfiles pa on pa.id = c.abierta_por
      cross join lateral (
        select
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado <> 'anulado') as tiene_pedidos,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado = 'enviado') as tiene_enviado,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado = 'en_preparacion') as tiene_en_preparacion,
          exists (select 1 from public.pedidos p where p.cuenta_id = c.id and p.estado not in ('entregado', 'anulado')) as tiene_pedidos_no_entregados,
          coalesce((
            select min(case p.estado when 'entregado' then 1 when 'en_preparacion' then 2 when 'enviado' then 3 else 9 end)
            from public.pedidos p
            where p.cuenta_id = c.id and p.estado <> 'anulado'
          ), 9) as pedido_estado_prioridad,
          (select max(p.enviado_at) from public.pedidos p where p.cuenta_id = c.id and p.estado <> 'anulado') as ultimo_pedido_at,
          coalesce((
            select sum(pg.monto)
            from public.pagos pg
            where pg.cuenta_id = c.id
              and not coalesce(pg.anulado, false)
          ), 0)::numeric(12,0) as total_pagado
      ) stats
      where c.estado not in ('pagada', 'cerrada', 'anulada')
        and (
          c.estado in ('abierta', 'por_cobrar', 'pagada_parcial', 'pendiente')
          or stats.tiene_pedidos
          or coalesce(c.total_cuenta, 0) > stats.total_pagado
        )
    ) cuentas
  ), '[]'::jsonb);
end;
$$;

alter table public.categorias_gasto_caja enable row level security;
alter table public.gastos_caja enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categorias_gasto_caja' and policyname = 'categorias_gasto_caja_caja_admin_lee') then
    create policy categorias_gasto_caja_caja_admin_lee on public.categorias_gasto_caja for select to authenticated using (public.es_caja_o_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gastos_caja' and policyname = 'gastos_caja_caja_admin_lee') then
    create policy gastos_caja_caja_admin_lee on public.gastos_caja for select to authenticated using (public.es_caja_o_admin());
  end if;
end $$;

grant select on public.categorias_gasto_caja, public.gastos_caja to authenticated;
grant execute on function public.crear_categoria_gasto_caja(text) to authenticated;
grant execute on function public.crear_producto_desde_caja(text, uuid, text, numeric, numeric, text, int, text, int) to authenticated;
grant execute on function public.registrar_gasto_urgencia_caja(uuid, text, numeric, public.medio_pago, text, text) to authenticated;
grant execute on function public.registrar_compra_inventario_caja(jsonb, public.medio_pago, uuid, text, date, text, text) to authenticated;
grant execute on function public.marcar_cuenta_pendiente_caja(uuid, text, text) to authenticated;
grant execute on function public.quitar_pendiente_cuenta_caja(uuid) to authenticated;
grant execute on function public.datos_compras_gastos_caja() to authenticated;
grant execute on function public.registrar_pagos_cuenta_base(uuid, jsonb, numeric, boolean, text) to authenticated;
grant execute on function public.resumen_caja_actual() to authenticated;
grant execute on function public.cerrar_caja(numeric, text) to authenticated;
grant execute on function public.cuentas_activas_caja() to authenticated;
