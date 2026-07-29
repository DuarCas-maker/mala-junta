insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@malajunta.local', crypt('Admin1234!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Administrador"}', false),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'caja@malajunta.local', crypt('Caja1234!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Caja"}', false),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mesero1@mesero.malajunta.local', crypt('1111', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Mesero 1"}', false),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mesero2@mesero.malajunta.local', crypt('2222', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Mesero 2"}', false),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mesero3@mesero.malajunta.local', crypt('3333', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"nombre":"Mesero 3"}', false)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@malajunta.local"}', 'email', 'admin@malajunta.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000002', '{"sub":"00000000-0000-0000-0000-000000000002","email":"caja@malajunta.local"}', 'email', 'caja@malajunta.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000011', '{"sub":"00000000-0000-0000-0000-000000000011","email":"mesero1@mesero.malajunta.local"}', 'email', 'mesero1@mesero.malajunta.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000012', '{"sub":"00000000-0000-0000-0000-000000000012","email":"mesero2@mesero.malajunta.local"}', 'email', 'mesero2@mesero.malajunta.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-000000000013', '{"sub":"00000000-0000-0000-0000-000000000013","email":"mesero3@mesero.malajunta.local"}', 'email', 'mesero3@mesero.malajunta.local', now(), now(), now())
on conflict (provider, provider_id) do nothing;

insert into public.perfiles (id, auth_user_id, nombre, usuario_login, rol, pin, activo)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Administrador', null, 'admin', null, true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Caja Principal', null, 'caja', null, true),
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'Mesero 1', 'mesero1', 'mesero', '1111', true),
  ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000012', 'Mesero 2', 'mesero2', 'mesero', '2222', true),
  ('10000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000013', 'Mesero 3', 'mesero3', 'mesero', '3333', true)
on conflict (id) do nothing;

insert into public.parametros (clave, valor, descripcion)
values
  ('uvt_2026', '52374', 'Valor UVT Colombia 2026. Parametrizable; validar anualmente.'),
  ('propina_sugerida_pct', '10', 'Porcentaje sugerido de propina.'),
  ('hora_corte_dia_negocio', '"06:00"', 'Hora de corte del día de negocio en America/Bogota.'),
  ('emisor_nit', '"TODO"', 'NIT del emisor pendiente de confirmar.'),
  ('emisor_razon_social', '"Mala Junta"', 'Razón social o nombre comercial del emisor.'),
  ('emisor_responsabilidades_fiscales', '[]', 'Responsabilidades fiscales DIAN pendientes de contador.')
on conflict (clave) do update set valor = excluded.valor, descripcion = excluded.descripcion;

insert into public.motivos (tipo, texto, activo)
values
  ('modificacion', 'Cliente cambió de opinión', true),
  ('modificacion', 'Error de digitación', true),
  ('anulacion', 'Producto agotado', true),
  ('anulacion', 'Cliente canceló el pedido', true),
  ('ajuste_inventario', 'Botella rota', true),
  ('ajuste_inventario', 'Producto vencido', true),
  ('ajuste_inventario', 'Consumo interno no registrado', true),
  ('ajuste_inventario', 'Faltante sin justificar', true),
  ('retiro_caja', 'Taxi', true),
  ('retiro_caja', 'Compra urgente de hielo', true),
  ('retiro_caja', 'Pago a proveedor', true)
on conflict (tipo, texto) do update set activo = excluded.activo;

-- F3 seed: proveedores y combos reales por componentes.
insert into public.proveedores (nombre, nit, contacto, activo)
values
  ('Distribuidora Andina', '900000001-1', 'compras@andina.example', true),
  ('Licores del Centro', '900000002-2', 'WhatsApp proveedor', true)
on conflict (nombre) do update set nit = excluded.nit, contacto = excluded.contacto, activo = excluded.activo;

update public.productos
set activo = false
where codigo_interno like 'COM-%';

do $$
declare
  v_combo_id uuid;
begin
  insert into public.combos (nombre, precio_venta, activo)
  values ('Combo Aguardiente + 4 gaseosas', 145000, true)
  on conflict (nombre) do update set precio_venta = excluded.precio_venta, activo = excluded.activo
  returning id into v_combo_id;

  update public.combo_items set activo = false where combo_id = v_combo_id;
  insert into public.combo_items (combo_id, producto_id, cantidad, activo)
  select v_combo_id, p.id, v.cantidad, true
  from (
    values
      ('LIC-AGU-ANT', 1),
      ('BEB-COCA', 4)
  ) as v(codigo, cantidad)
  join public.productos p on p.codigo_interno = v.codigo;

  insert into public.combos (nombre, precio_venta, activo)
  values ('Combo Ron + 6 cervezas', 175000, true)
  on conflict (nombre) do update set precio_venta = excluded.precio_venta, activo = excluded.activo
  returning id into v_combo_id;

  update public.combo_items set activo = false where combo_id = v_combo_id;
  insert into public.combo_items (combo_id, producto_id, cantidad, activo)
  select v_combo_id, p.id, v.cantidad, true
  from (
    values
      ('LIC-RON-CALDAS', 1),
      ('CER-POKER', 6)
  ) as v(codigo, cantidad)
  join public.productos p on p.codigo_interno = v.codigo;
end $$;
