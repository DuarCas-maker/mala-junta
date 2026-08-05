-- F6 - Reset operativo y catalogo base desde Inventario (1).xlsx.
-- Deja ventas, caja, compras, auditorias, documentos, combos e inventario en cero.

create extension if not exists pgcrypto;

truncate table
  public.envios_comprobante,
  public.documento_lineas,
  public.documentos,
  public.pagos,
  public.modificaciones_pedido,
  public.pedido_items,
  public.pedidos,
  public.sub_cuentas,
  public.cuentas,
  public.retiros_caja,
  public.cierres_caja,
  public.compra_items,
  public.compras,
  public.auditoria_items,
  public.auditorias_inventario,
  public.movimientos_inventario,
  public.historial_precios,
  public.combo_items,
  public.combos,
  public.productos,
  public.categorias,
  public.proveedores
restart identity cascade;

update public.consecutivos_documento
set siguiente = 1,
    updated_at = now();

insert into public.categorias (nombre, activa)
values
  ('Cigarrillos', true),
  ('Bebidas sin alcohol', true),
  ('Cervezas', true),
  ('Licores', true)
on conflict (nombre) do update set activa = excluded.activa;

insert into public.productos (
  nombre,
  categoria_id,
  precio_venta,
  costo_unitario_actual,
  codigo_interno,
  stock_actual,
  stock_minimo,
  presentacion_compra,
  factor_compra,
  activo
)
select
  v.nombre,
  c.id,
  v.precio_venta,
  v.costo_unitario,
  v.codigo_interno,
  0,
  0,
  v.presentacion,
  1,
  true
from (
  values
    ('Cigarrillo Rothamans', 'Cigarrillos', 1200::numeric, 301::numeric, 'CIG-ROTHMANS', 'Unidad'),
    ('Cigarrillo malboro gold', 'Cigarrillos', 1200::numeric, 335::numeric, 'CIG-MALBORO-GOLD', 'Unidad'),
    ('Botella de agua', 'Bebidas sin alcohol', 4000::numeric, 1158::numeric, 'BEB-AGUA', 'Unidad'),
    ('Cigarrillo luky strike', 'Cigarrillos', 1200::numeric, 349::numeric, 'CIG-LUKY-STRIKE', 'Unidad'),
    ('Smirnoff de tamarindo', 'Licores', 120000::numeric, 42400::numeric, 'LIC-SMIRNOFF-TAMARINDO', '750 ml'),
    ('Aguardiente Antioqueño verde', 'Licores', 110000::numeric, 42600::numeric, 'LIC-AGU-VERDE-750', '750 ml'),
    ('Aguardiente amarillo', 'Licores', 120000::numeric, 46900::numeric, 'LIC-AGU-AMARILLO-750', '750 ml'),
    ('Aguardiente amarillo', 'Licores', 60000::numeric, 24000::numeric, 'LIC-AGU-AMARILLO-MEDIA', 'Media'),
    ('Aguardiente Antioqueño verde', 'Licores', 55000::numeric, 22000::numeric, 'LIC-AGU-VERDE-MEDIA', 'Media'),
    ('Poker', 'Cervezas', 4000::numeric, 2250::numeric, 'CER-POKER', 'Unidad'),
    ('Águila', 'Cervezas', 4000::numeric, 2250::numeric, 'CER-AGUILA', 'Unidad'),
    ('Aguardiente Antioqueño azul', 'Licores', 110000::numeric, 47200::numeric, 'LIC-AGU-AZUL-750', '750 ml'),
    ('Hidralyte uva', 'Bebidas sin alcohol', 8000::numeric, 3500::numeric, 'BEB-HIDRALYTE-UVA', 'Unidad'),
    ('Hidralyte Blueberry', 'Bebidas sin alcohol', 8000::numeric, 3500::numeric, 'BEB-HIDRALYTE-BLUEBERRY', 'Unidad'),
    ('Aguardiente Antioqueño azul', 'Licores', 55000::numeric, 25700::numeric, 'LIC-AGU-AZUL-MEDIA', 'Media'),
    ('Gatorade', 'Bebidas sin alcohol', 6000::numeric, 2900::numeric, 'BEB-GATORADE', 'Unidad'),
    ('Cistal xs', 'Licores', 35000::numeric, 17300::numeric, 'LIC-CISTAL-XS', 'Unidad'),
    ('Smirnoff Ice', 'Licores', 10000::numeric, 5300::numeric, 'LIC-SMIRNOFF-ICE', 'Botella'),
    ('Coronita', 'Cervezas', 5000::numeric, 2812::numeric, 'CER-CORONITA', 'Botella'),
    ('Buchanans Master', 'Licores', 290000::numeric, 168300::numeric, 'LIC-BUCHANANS-MASTER', 'Unidad'),
    ('Caldas', 'Licores', 80000::numeric, 48000::numeric, 'LIC-CALDAS', 'Unidad'),
    ('Buchanans 12 años', 'Licores', 220000::numeric, 144900::numeric, 'LIC-BUCHANANS-12', 'Unidad'),
    ('Redbull', 'Bebidas sin alcohol', 8000::numeric, 5300::numeric, 'BEB-REDBULL', 'Unidad')
) as v(nombre, categoria_nombre, precio_venta, costo_unitario, codigo_interno, presentacion)
join public.categorias c on c.nombre = v.categoria_nombre
on conflict (codigo_interno) do update set
  nombre = excluded.nombre,
  categoria_id = excluded.categoria_id,
  precio_venta = excluded.precio_venta,
  costo_unitario_actual = excluded.costo_unitario_actual,
  stock_actual = 0,
  stock_minimo = 0,
  presentacion_compra = excluded.presentacion_compra,
  factor_compra = 1,
  activo = true;