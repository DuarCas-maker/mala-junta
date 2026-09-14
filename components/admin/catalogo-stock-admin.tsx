"use client";

import { ChangeEvent, FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Categoria = { id: string; nombre: string };
type Producto = {
  id: string;
  nombre: string;
  categoria_id: string | null;
  precio_venta: number;
  costo_unitario_actual: number;
  codigo_interno: string | null;
  imagen_url: string | null;
  stock_actual: number;
  stock_minimo: number;
  presentacion_compra: string;
  factor_compra: number;
  activo: boolean;
};
type Proveedor = {
  id: string;
  nombre: string;
  nit: string | null;
  contacto: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  observacion: string | null;
  activo: boolean;
};
type Motivo = { id: string; texto: string };
type ComboItem = { producto_id: string; cantidad: number; activo?: boolean; productos?: { nombre?: string; presentacion_compra?: string | null } | null };
type Combo = { id: string; nombre: string; precio_venta: number; imagen_url: string | null; activo: boolean; combo_items?: ComboItem[] };
type ItemStock = {
  orden_tipo: number;
  tipo_item: "producto" | "combo";
  item_id: string;
  nombre: string;
  categoria: string | null;
  precio_venta: number;
  costo_estimado: number | null;
  stock_disponible: number | null;
  stock_minimo: number | null;
  imagen_url: string | null;
  presentacion_compra: string | null;
  factor_compra: number | null;
  activo: boolean;
  componentes: { producto_id: string; producto: string; presentacion_compra?: string | null; cantidad: number; stock_actual: number }[] | null;
};

type ResumenValorInventario = {
  productos_activos: number;
  unidades_stock: number;
  valor_costo: number;
  valor_venta: number;
  margen_potencial: number;
  productos_sin_costo: number;
  productos_deficit?: number;
  unidades_deficit?: number;
  valor_deficit_reposicion?: number;
};
type CargaAdvertencia = { seccion: string; mensaje: string };
type MovimientoDescuento = {
  id: string;
  timestamp: string;
  dia_negocio: string;
  producto_id: string;
  producto: string;
  categoria: string | null;
  tipo: "venta" | "ajuste" | "merma" | "consumo_interno" | "devolucion" | "compra";
  cantidad: number;
  unidades_descontadas: number;
  stock_resultante: number | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  motivo: string | null;
  usuario: string | null;
  pedido_id: string | null;
  pedido_estado: string | null;
  cuenta_id: string | null;
  cuenta_origen: string | null;
  captura_id: string | null;
  captura_estado: string | null;
  captura_venta_orden: number | null;
  item_vendido_tipo: string | null;
  item_vendido_nombre: string | null;
  item_vendido_cantidad: number | null;
  precio_unitario_capturado: number | null;
  origen: string | null;
  detalle_referencia: string | null;
};
type ProductoForm = { id: string | null; nombre: string; categoriaId: string; precio: string; costo: string; codigo: string; minimo: string; presentacion: string; factor: string; activo: boolean; imagenUrl: string | null };
type StockInlineForm = { nombre: string; precio: string; costo: string; stock: string; minimo: string };
type EstadoStockTab = "activos" | "inactivos";
type FiltroStockAdmin = "todos" | "deficit" | "en_cero" | "bajo" | "disponible" | "rango";
type TipoDescuentoFiltro = "todos" | "venta" | "ajuste" | "merma" | "consumo_interno";
type OrdenStockAdmin = "prioridad" | "stock_asc" | "stock_desc" | "nombre" | "precio_asc" | "precio_desc" | "costo_asc" | "costo_desc" | "estado";
type AccionInventarioModal = "menu" | "producto" | "compra" | "combo";
type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";
type ComboFormItem = { producto_id: string; cantidad: string };
type ComboForm = { id: string | null; nombre: string; precio: string; items: ComboFormItem[]; activo: boolean; imagenUrl: string | null };
type ProveedorForm = { id: string | null; nombre: string; nit: string; contacto: string; telefono: string; correo: string; direccion: string; observacion: string; activo: boolean };
type CompraLineaForm = { producto_id: string; modo: "unidades" | "presentacion"; cantidad: string };

const presentacionesCompra = ["Unidad", "50 ml", "200 ml", "350 ml", "375 ml", "700 ml", "750 ml", "1 Lt", "1,5 Lt", "2 Lt"];
const productoInicial: ProductoForm = { id: null, nombre: "", categoriaId: "", precio: "", costo: "", codigo: "", minimo: "0", presentacion: "", factor: "1", activo: true, imagenUrl: null };
const comboInicial: ComboForm = { id: null, nombre: "", precio: "", items: [{ producto_id: "", cantidad: "1" }], activo: true, imagenUrl: null };
const proveedorInicial: ProveedorForm = { id: null, nombre: "", nit: "", contacto: "", telefono: "", correo: "", direccion: "", observacion: "", activo: true };
const compraLineaInicial: CompraLineaForm = { producto_id: "", modo: "presentacion", cantidad: "" };
const BUCKET_IMAGENES_CATALOGO = "catalogo-imagenes";
const mediosPago: { id: MedioPago; nombre: string }[] = [
  { id: "efectivo", nombre: "Efectivo" },
  { id: "datafono", nombre: "Datafono" },
  { id: "nequi_daviplata", nombre: "Nequi/Daviplata" },
  { id: "transferencia", nombre: "Transferencia" },
];

const ayudasCampos: Record<string, string> = {
  categoriaNueva: "Crea una categoria nueva cuando el producto no encaja en una existente.",
  productoNombre: "Nombre comercial que veran caja, meseros y reportes.",
  productoCategoria: "Agrupa el producto para busqueda, control y metricas.",
  productoPrecio: "Precio de venta al cliente.",
  productoCosto: "Costo unitario base para calcular margen y valor de inventario.",
  productoCodigo: "Codigo interno opcional para identificar el producto.",
  productoMinimo: "Cantidad minima esperada antes de alertar stock bajo.",
  productoPresentacion: "Medida visible para diferenciar productos con el mismo nombre, por ejemplo 750 ml.",
  productoFactor: "Cuantas unidades entran cuando registras una compra por presentacion.",
  productoImagen: "Imagen visible en el catalogo visual de caja y meseros.",
  productoActivo: "Si esta apagado, deja de aparecer para ventas y combos nuevos.",
  compraProveedor: "Proveedor asociado a esta entrada de inventario.",
  compraFecha: "Fecha contable de la compra de inventario.",
  compraMedio: "Referencia informativa del medio de pago; no afecta caja en admin.",
  compraFactura: "Numero de factura opcional para consulta posterior.",
  compraObservacion: "Nota interna de la compra.",
  compraProducto: "Producto activo que recibira stock.",
  compraCantidad: "Cantidad de presentaciones compradas del producto seleccionado.",
  comboNombre: "Nombre comercial del combo.",
  comboPrecio: "Precio final de venta del combo.",
  comboImagen: "Imagen visible del combo en el catalogo visual de caja y meseros.",
  comboItem: "Producto activo que compone el combo. Se muestra con presentacion para diferenciarlo.",
  comboCantidad: "Unidades del producto que se descuentan por cada combo vendido.",
  comboActivo: "Si esta apagado, deja de aparecer para ventas nuevas.",
};

function comboItems(combo: Combo) {
  return (combo.combo_items ?? [])
    .filter((item) => item.activo !== false)
    .map((item) => ({ producto_id: item.producto_id, cantidad: Number(item.cantidad) }))
    .filter((item) => item.producto_id && item.cantidad > 0);
}

function comboFormItemsValidos(form: ComboForm) {
  return form.items
    .map((item) => ({ producto_id: item.producto_id, cantidad: Number(item.cantidad) }))
    .filter((item) => item.producto_id && Number.isInteger(item.cantidad) && item.cantidad > 0);
}

function normalizarTexto(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function extensionArchivo(nombre: string) {
  const extension = nombre.split(".").pop()?.toLowerCase();
  return extension ? `.${extension}` : ".jpg";
}

function fechaHoraCorta(fecha: string) {
  return new Date(fecha).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ImagenCatalogo({ url, nombre, className = "h-16 w-16" }: { url?: string | null; nombre: string; className?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={nombre} className={`${className} rounded-md border border-antiguo/10 bg-espresso object-contain p-1`} loading="lazy" />;
  }

  return (
    <div className={`${className} grid place-items-center rounded-md border border-antiguo/10 bg-espresso text-xs font-black uppercase text-oro/80`}>
      {nombre.trim().slice(0, 2) || "MJ"}
    </div>
  );
}

function InfoCampo({ id }: { id: keyof typeof ayudasCampos }) {
  return (
    <span
      aria-label={ayudasCampos[id]}
      title={ayudasCampos[id]}
      className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full border border-oro/35 bg-oro/10 text-[11px] font-black leading-none text-dorado"
    >
      i
    </span>
  );
}

function CampoConInfo({ info, children }: { info: keyof typeof ayudasCampos; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">{children}<InfoCampo id={info} /></div>
    </div>
  );
}

function tipoMovimientoTexto(tipo: string) {
  if (tipo === "venta") return "Venta";
  if (tipo === "ajuste") return "Ajuste";
  if (tipo === "merma") return "Merma";
  if (tipo === "consumo_interno") return "Consumo interno";
  if (tipo === "devolucion") return "Devolucion";
  return tipo;
}

function codigoCorto(id?: string | null) {
  return id ? id.slice(0, 8) : "-";
}

function etiquetaProducto(producto?: Pick<Producto, "nombre" | "presentacion_compra"> | null) {
  if (!producto) return "Producto";
  const presentacion = producto.presentacion_compra?.trim();
  return presentacion ? `${producto.nombre} - ${presentacion}` : producto.nombre;
}

function etiquetaComponente(componente: { producto: string; presentacion_compra?: string | null }) {
  const presentacion = componente.presentacion_compra?.trim();
  return presentacion ? `${componente.producto} - ${presentacion}` : componente.producto;
}

function stockNumero(item: ItemStock) {
  return Number(item.stock_disponible ?? 0);
}

function minimoNumero(item: ItemStock) {
  return Number(item.stock_minimo ?? 0);
}

function prioridadStock(item: ItemStock) {
  const stock = stockNumero(item);
  if (stock <= 0) return 1;
  if (item.tipo_item === "producto" && stock <= minimoNumero(item)) return 2;
  return 3;
}

function coincideFiltroStock(item: ItemStock, filtro: FiltroStockAdmin, minimo: string, maximo: string) {
  const stock = stockNumero(item);
  const stockMin = minimo === "" ? null : Number(minimo);
  const stockMax = maximo === "" ? null : Number(maximo);

  if (stockMin !== null && stock < stockMin) return false;
  if (stockMax !== null && stock > stockMax) return false;
  if (filtro === "deficit") return stock < 0;
  if (filtro === "en_cero") return stock <= 0;
  if (filtro === "bajo") return item.tipo_item === "producto" && stock > 0 && stock <= minimoNumero(item);
  if (filtro === "disponible") return stock > 0 && (item.tipo_item === "combo" || stock > minimoNumero(item));
  return true;
}

function compararItemsStock(orden: OrdenStockAdmin) {
  return (a: ItemStock, b: ItemStock) => {
    if (orden === "stock_asc") return stockNumero(a) - stockNumero(b);
    if (orden === "stock_desc") return stockNumero(b) - stockNumero(a);
    if (orden === "precio_asc") return Number(a.precio_venta ?? 0) - Number(b.precio_venta ?? 0);
    if (orden === "precio_desc") return Number(b.precio_venta ?? 0) - Number(a.precio_venta ?? 0);
    if (orden === "costo_asc") return Number(a.costo_estimado ?? 0) - Number(b.costo_estimado ?? 0);
    if (orden === "costo_desc") return Number(b.costo_estimado ?? 0) - Number(a.costo_estimado ?? 0);
    if (orden === "estado") return Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, "es");
    if (orden === "nombre") return a.nombre.localeCompare(b.nombre, "es");

    const prioridad = prioridadStock(a) - prioridadStock(b);
    return prioridad || a.orden_tipo - b.orden_tipo || a.nombre.localeCompare(b.nombre, "es");
  };
}
function mensajeErrorCarga(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const mensaje = (error as { message?: unknown }).message;
    if (typeof mensaje === "string" && mensaje.trim()) return mensaje;
  }

  return "Error desconocido al cargar la seccion.";
}

function construirItemsStockFallback(productos: Producto[], combos: Combo[], categorias: Categoria[]): ItemStock[] {
  const categoriaPorId = new Map(categorias.map((categoria) => [categoria.id, categoria.nombre]));
  const productoPorId = new Map(productos.map((producto) => [producto.id, producto]));

  const productosItems: ItemStock[] = productos.map((producto) => ({
    orden_tipo: 1,
    tipo_item: "producto",
    item_id: producto.id,
    nombre: producto.nombre,
    categoria: producto.categoria_id ? categoriaPorId.get(producto.categoria_id) ?? null : null,
    precio_venta: Number(producto.precio_venta ?? 0),
    costo_estimado: Number(producto.costo_unitario_actual ?? 0),
    stock_disponible: Number(producto.stock_actual ?? 0),
    stock_minimo: Number(producto.stock_minimo ?? 0),
    imagen_url: producto.imagen_url,
    presentacion_compra: producto.presentacion_compra,
    factor_compra: Number(producto.factor_compra ?? 1),
    activo: producto.activo,
    componentes: null,
  }));

  const combosItems: ItemStock[] = combos.map((combo) => {
    const componentes = comboItems(combo).map((item) => {
      const producto = productoPorId.get(item.producto_id);
      return {
        producto_id: item.producto_id,
        producto: producto?.nombre ?? "Producto sin catalogo",
        presentacion_compra: producto?.presentacion_compra ?? null,
        cantidad: item.cantidad,
        stock_actual: Number(producto?.stock_actual ?? 0),
      };
    });
    const stockDisponible = componentes.length > 0
      ? Math.min(...componentes.map((item) => Math.floor(item.stock_actual / Math.max(item.cantidad, 1))))
      : 0;
    const costoEstimado = componentes.reduce((total, item) => {
      const producto = productoPorId.get(item.producto_id);
      return total + Number(producto?.costo_unitario_actual ?? 0) * item.cantidad;
    }, 0);

    return {
      orden_tipo: 2,
      tipo_item: "combo",
      item_id: combo.id,
      nombre: combo.nombre,
      categoria: "Combo",
      precio_venta: Number(combo.precio_venta ?? 0),
      costo_estimado: costoEstimado,
      stock_disponible: stockDisponible,
      stock_minimo: null,
      presentacion_compra: null,
      factor_compra: null,
      imagen_url: combo.imagen_url,
      activo: combo.activo,
      componentes,
    };
  });

  return [...productosItems, ...combosItems];
}

function calcularResumenInventario(items: ItemStock[], productosActivos: number): ResumenValorInventario {
  const productosFisicos = items.filter((item) => item.tipo_item === "producto" && item.activo);
  const unidadesStock = productosFisicos.reduce((total, item) => total + Math.max(Number(item.stock_disponible ?? 0), 0), 0);
  const valorCosto = productosFisicos.reduce((total, item) => total + Math.max(Number(item.stock_disponible ?? 0), 0) * Number(item.costo_estimado ?? 0), 0);
  const valorVenta = productosFisicos.reduce((total, item) => total + Math.max(Number(item.stock_disponible ?? 0), 0) * Number(item.precio_venta ?? 0), 0);
  const unidadesDeficit = productosFisicos.reduce((total, item) => total + Math.abs(Math.min(Number(item.stock_disponible ?? 0), 0)), 0);
  const valorDeficit = productosFisicos.reduce((total, item) => total + Math.abs(Math.min(Number(item.stock_disponible ?? 0), 0)) * Number(item.costo_estimado ?? 0), 0);

  return {
    productos_activos: productosFisicos.length || productosActivos,
    unidades_stock: unidadesStock,
    valor_costo: valorCosto,
    valor_venta: valorVenta,
    margen_potencial: valorVenta - valorCosto,
    productos_sin_costo: productosFisicos.filter((item) => Number(item.costo_estimado ?? 0) <= 0).length,
    productos_deficit: productosFisicos.filter((item) => Number(item.stock_disponible ?? 0) < 0).length,
    unidades_deficit: unidadesDeficit,
    valor_deficit_reposicion: valorDeficit,
  };
}
function proveedorAForm(proveedor: Proveedor): ProveedorForm {
  return {
    id: proveedor.id,
    nombre: proveedor.nombre,
    nit: proveedor.nit ?? "",
    contacto: proveedor.contacto ?? "",
    telefono: proveedor.telefono ?? "",
    correo: proveedor.correo ?? "",
    direccion: proveedor.direccion ?? "",
    observacion: proveedor.observacion ?? "",
    activo: proveedor.activo,
  };
}

export function CatalogoStockAdminPanel() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [itemsStock, setItemsStock] = useState<ItemStock[]>([]);
  const [movimientosDescuento, setMovimientosDescuento] = useState<MovimientoDescuento[]>([]);
  const [resumenInventario, setResumenInventario] = useState<ResumenValorInventario | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [advertenciasCarga, setAdvertenciasCarga] = useState<CargaAdvertencia[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [imagenSubiendo, setImagenSubiendo] = useState<string | null>(null);
  const [accionInventarioModal, setAccionInventarioModal] = useState<AccionInventarioModal | null>(null);

  const [categoriaNueva, setCategoriaNueva] = useState("");
  const [productoForm, setProductoForm] = useState<ProductoForm>(productoInicial);
  const [productoImagenArchivo, setProductoImagenArchivo] = useState<File | null>(null);
  const [comboForm, setComboForm] = useState<ComboForm>(comboInicial);
  const [comboImagenArchivo, setComboImagenArchivo] = useState<File | null>(null);
  const [proveedorForm, setProveedorForm] = useState<ProveedorForm>(proveedorInicial);
  const [compraProveedor, setCompraProveedor] = useState("");
  const [compraFecha, setCompraFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [compraMedio, setCompraMedio] = useState<MedioPago>("efectivo");
  const [compraFactura, setCompraFactura] = useState("");
  const [compraObservacion, setCompraObservacion] = useState("");
  const [compraLineas, setCompraLineas] = useState<CompraLineaForm[]>([{ ...compraLineaInicial }]);
  const [ajusteProducto, setAjusteProducto] = useState("");
  const [ajusteCantidad, setAjusteCantidad] = useState("");
  const [ajusteMotivo, setAjusteMotivo] = useState("");
  const [stockEditando, setStockEditando] = useState<string | null>(null);
  const [stockInline, setStockInline] = useState<Record<string, StockInlineForm>>({});
  const [categoriaFiltroStock, setCategoriaFiltroStock] = useState("");
  const [busquedaStock, setBusquedaStock] = useState("");
  const [estadoStockTab, setEstadoStockTab] = useState<EstadoStockTab>("activos");
  const [filtroStock, setFiltroStock] = useState<FiltroStockAdmin>("todos");
  const [stockMinFiltro, setStockMinFiltro] = useState("");
  const [stockMaxFiltro, setStockMaxFiltro] = useState("");
  const [ordenStock, setOrdenStock] = useState<OrdenStockAdmin>("prioridad");
  const [busquedaMovimiento, setBusquedaMovimiento] = useState("");
  const [productoMovimientoFiltro, setProductoMovimientoFiltro] = useState("");
  const [tipoMovimientoFiltro, setTipoMovimientoFiltro] = useState<TipoDescuentoFiltro>("todos");
  const cargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [productosRes, categoriasRes, proveedoresRes, motivosRes, combosRes, itemsStockRes, movimientosRes, resumenInventarioRes] = await Promise.all([
      supabase.from("productos").select("id,nombre,categoria_id,precio_venta,costo_unitario_actual,codigo_interno,imagen_url,stock_actual,stock_minimo,presentacion_compra,factor_compra,activo").order("nombre"),
      supabase.from("categorias").select("id,nombre").eq("activa", true).order("nombre"),
      supabase.from("proveedores").select("id,nombre,nit,contacto,telefono,correo,direccion,observacion,activo").order("nombre"),
      supabase.from("motivos").select("id,texto").eq("tipo", "ajuste_inventario").eq("activo", true).order("texto"),
      supabase.from("combos").select("id,nombre,precio_venta,imagen_url,activo,combo_items(id,producto_id,cantidad,activo,productos(nombre,presentacion_compra))").order("nombre"),
      supabase.from("v_catalogo_items_stock").select("*").order("orden_tipo").order("nombre"),
      supabase.from("v_admin_historial_descuentos_item").select("*").order("timestamp", { ascending: false }).limit(150),
      supabase.from("v_admin_resumen_valor_inventario").select("*").maybeSingle(),
    ]);

    const advertencias: CargaAdvertencia[] = [];
    const productosData = productosRes.error ? [] : (productosRes.data ?? []) as Producto[];
    const categoriasData = categoriasRes.error ? [] : (categoriasRes.data ?? []) as Categoria[];
    const proveedoresData = proveedoresRes.error ? [] : (proveedoresRes.data ?? []) as Proveedor[];
    const motivosData = motivosRes.error ? [] : (motivosRes.data ?? []) as Motivo[];
    const combosData = combosRes.error ? [] : (combosRes.data ?? []) as unknown as Combo[];

    if (productosRes.error) advertencias.push({ seccion: "Productos", mensaje: mensajeErrorCarga(productosRes.error) });
    if (categoriasRes.error) advertencias.push({ seccion: "Categorias", mensaje: mensajeErrorCarga(categoriasRes.error) });
    if (proveedoresRes.error) advertencias.push({ seccion: "Proveedores", mensaje: mensajeErrorCarga(proveedoresRes.error) });
    if (motivosRes.error) advertencias.push({ seccion: "Motivos", mensaje: mensajeErrorCarga(motivosRes.error) });
    if (combosRes.error) advertencias.push({ seccion: "Combos", mensaje: mensajeErrorCarga(combosRes.error) });
    if (itemsStockRes.error) advertencias.push({ seccion: "Items y stock", mensaje: `${mensajeErrorCarga(itemsStockRes.error)} Se uso una reconstruccion temporal desde productos y combos.` });
    if (movimientosRes.error) advertencias.push({ seccion: "Historial de descuentos", mensaje: mensajeErrorCarga(movimientosRes.error) });
    if (resumenInventarioRes.error) advertencias.push({ seccion: "Resumen de inventario", mensaje: `${mensajeErrorCarga(resumenInventarioRes.error)} Se calcularon totales desde el stock cargado.` });

    const itemsStockData = itemsStockRes.error
      ? construirItemsStockFallback(productosData, combosData, categoriasData)
      : (itemsStockRes.data ?? []) as ItemStock[];
    const resumenData = resumenInventarioRes.error || !resumenInventarioRes.data
      ? calcularResumenInventario(itemsStockData, productosData.filter((producto) => producto.activo).length)
      : resumenInventarioRes.data as ResumenValorInventario;

    setProductos(productosData);
    setCategorias(categoriasData);
    setProveedores(proveedoresData);
    setMotivos(motivosData);
    setCombos(combosData);
    setItemsStock(itemsStockData);
    setMovimientosDescuento(movimientosRes.error ? [] : (movimientosRes.data ?? []) as MovimientoDescuento[]);
    setResumenInventario(resumenData);
    setAdvertenciasCarga(advertencias);
    if (advertencias.length > 0) {
      setMensaje("Catalogo y stock cargo parcialmente. Revisa las advertencias de cada seccion.");
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const productosActivos = productos.filter((producto) => producto.activo);
  const productosCompra = useMemo(() => {
    const mapa = new Map(productos.map((producto) => [producto.id, producto]));
    itemsStock
      .filter((item) => item.tipo_item === "producto")
      .forEach((item) => {
        if (mapa.has(item.item_id)) return;
        mapa.set(item.item_id, {
          id: item.item_id,
          nombre: item.nombre,
          categoria_id: null,
          precio_venta: Number(item.precio_venta ?? 0),
          costo_unitario_actual: Number(item.costo_estimado ?? 0),
          codigo_interno: null,
          imagen_url: item.imagen_url,
          stock_actual: Number(item.stock_disponible ?? 0),
          stock_minimo: Number(item.stock_minimo ?? 0),
          presentacion_compra: item.presentacion_compra ?? "",
          factor_compra: Number(item.factor_compra ?? 1),
          activo: item.activo,
        });
      });
    return Array.from(mapa.values()).sort((a, b) => etiquetaProducto(a).localeCompare(etiquetaProducto(b), "es"));
  }, [itemsStock, productos]);
  const productosPorId = useMemo(() => new Map(productosCompra.map((producto) => [producto.id, producto])), [productosCompra]);
  function etiquetaProductoPorId(productoId: string, fallback?: { producto: string; presentacion_compra?: string | null }) {
    const producto = productosPorId.get(productoId);
    if (producto) return etiquetaProducto(producto);
    return fallback ? etiquetaComponente(fallback) : "Producto";
  }

  function abrirAccionesInventario() {
    setAccionInventarioModal("menu");
  }

  function cerrarAccionesInventario() {
    setAccionInventarioModal(null);
    setProductoForm(productoInicial);
    setProductoImagenArchivo(null);
    setComboForm(comboInicial);
    setComboImagenArchivo(null);
  }

  function abrirProductoNuevo() {
    setProductoForm(productoInicial);
    setProductoImagenArchivo(null);
    setAccionInventarioModal("producto");
  }

  function abrirCompraInventario() {
    setAccionInventarioModal("compra");
  }

  function abrirComboNuevo() {
    setComboForm(comboInicial);
    setComboImagenArchivo(null);
    setAccionInventarioModal("combo");
  }

  const compraLineasCalculadas = useMemo(() => compraLineas.map((linea) => {
    const producto = productosPorId.get(linea.producto_id) ?? null;
    const cantidad = Number(linea.cantidad || 0);
    const factor = producto && linea.modo === "presentacion" ? Number(producto.factor_compra ?? 1) : 1;
    const unidades = cantidad * factor;
    const costo = Number(producto?.costo_unitario_actual ?? 0);
    return {
      ...linea,
      producto,
      cantidad,
      factor,
      unidades,
      costo,
      subtotal: unidades * costo,
      stockProyectado: producto ? Number(producto.stock_actual ?? 0) + unidades : null,
      valida: Boolean(producto && Number.isInteger(cantidad) && cantidad > 0 && costo > 0),
    };
  }), [compraLineas, productosPorId]);
  const compraTotalEstimado = compraLineasCalculadas.reduce((total, linea) => total + linea.subtotal, 0);
  const compraUnidadesEstimadas = compraLineasCalculadas.reduce((total, linea) => total + linea.unidades, 0);
  const compraPuedeRegistrarse = Boolean(compraProveedor && compraFecha && compraLineasCalculadas.length > 0 && compraLineasCalculadas.every((linea) => linea.valida));
  const proveedoresActivos = proveedores.filter((proveedor) => proveedor.activo);
  const categoriasItemsStock = useMemo(() => {
    return Array.from(new Set(itemsStock.map((item) => item.categoria ?? "Sin categoria"))).sort((a, b) => a.localeCompare(b, "es"));
  }, [itemsStock]);
  const resumenStockTabs = useMemo(() => ({
    activos: itemsStock.filter((item) => item.activo).length,
    inactivos: itemsStock.filter((item) => !item.activo).length,
  }), [itemsStock]);

  const itemsStockFiltrados = useMemo(() => {
    const termino = normalizarTexto(busquedaStock.trim());

    return itemsStock
      .filter((item) => {
        const categoria = item.categoria ?? "Sin categoria";
        const textoItem = normalizarTexto(`${item.nombre} ${categoria} ${item.presentacion_compra ?? ""} ${JSON.stringify(item.componentes ?? [])}`);
        const coincideEstado = estadoStockTab === "activos" ? item.activo : !item.activo;
        const coincideCategoria = !categoriaFiltroStock || categoria === categoriaFiltroStock;
        const coincideBusqueda = !termino || textoItem.includes(termino);
        const coincideStock = coincideFiltroStock(item, filtroStock, stockMinFiltro, stockMaxFiltro);
        return coincideEstado && coincideCategoria && coincideBusqueda && coincideStock;
      })
      .sort(compararItemsStock(ordenStock));
  }, [busquedaStock, categoriaFiltroStock, estadoStockTab, filtroStock, itemsStock, ordenStock, stockMaxFiltro, stockMinFiltro]);


  const movimientosDescuentoFiltrados = useMemo(() => {
    const termino = normalizarTexto(busquedaMovimiento.trim());

    return movimientosDescuento.filter((movimiento) => {
      const coincideProducto = !productoMovimientoFiltro || movimiento.producto_id === productoMovimientoFiltro;
      const coincideTipo = tipoMovimientoFiltro === "todos" || movimiento.tipo === tipoMovimientoFiltro;
      const texto = normalizarTexto(`${movimiento.producto} ${movimiento.categoria ?? ""} ${movimiento.origen ?? ""} ${movimiento.detalle_referencia ?? ""} ${movimiento.motivo ?? ""} ${movimiento.usuario ?? ""} ${movimiento.cuenta_origen ?? ""}`);
      const coincideBusqueda = !termino || texto.includes(termino);
      return coincideProducto && coincideTipo && coincideBusqueda;
    });
  }, [busquedaMovimiento, movimientosDescuento, productoMovimientoFiltro, tipoMovimientoFiltro]);

  const resumenDescuentos = useMemo(() => ({
    movimientos: movimientosDescuentoFiltrados.length,
    unidades: movimientosDescuentoFiltrados.reduce((sum, movimiento) => sum + Number(movimiento.unidades_descontadas ?? 0), 0),
    ventas: movimientosDescuentoFiltrados.filter((movimiento) => movimiento.tipo === "venta").length,
  }), [movimientosDescuentoFiltrados]);
  async function ejecutar(accion: () => any, exito: string) {
    setGuardando(true);
    setMensaje(null);
    const { error } = await accion();
    let correcto = false;
    if (error) setMensaje(error.message);
    else {
      setMensaje(exito);
      await cargar();
      correcto = true;
    }
    setGuardando(false);
    return correcto;
  }

  async function crearCategoria(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(() => supabase.rpc("crear_categoria_catalogo", { p_nombre: categoriaNueva }), "Categoria guardada.");
    setCategoriaNueva("");
  }

  async function guardarImagenCatalogo(tipo: "producto" | "combo", itemId: string, archivo: File) {
    const supabase = supabaseBrowser();
    const ruta = `${tipo}/${itemId}${extensionArchivo(archivo.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_IMAGENES_CATALOGO)
      .upload(ruta, archivo, {
        cacheControl: "3600",
        contentType: archivo.type || undefined,
        upsert: true,
      });

    if (uploadError) throw new Error(uploadError.message);

    const { data } = supabase.storage.from(BUCKET_IMAGENES_CATALOGO).getPublicUrl(ruta);
    const { error: rpcError } = await supabase.rpc("guardar_imagen_catalogo", {
      p_tipo: tipo,
      p_item_id: itemId,
      p_imagen_url: data.publicUrl,
    });

    if (rpcError) throw new Error(rpcError.message);
  }

  function idGuardado(data: unknown, fallback?: string | null) {
    if (data && typeof data === "object" && "id" in data && typeof data.id === "string") return data.id;
    if (fallback) return fallback;
    throw new Error("No se pudo identificar el item guardado para asociar la imagen.");
  }

  async function guardarProducto(event?: FormEvent<HTMLFormElement>, form = productoForm, imagenArchivo = productoImagenArchivo) {
    event?.preventDefault();

    if (!form.id && !imagenArchivo) {
      setMensaje("La imagen es obligatoria para registrar un producto nuevo.");
      return;
    }

    setGuardando(true);
    setMensaje(null);

    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("guardar_producto_catalogo", {
        p_producto_id: form.id,
        p_nombre: form.nombre,
        p_categoria_id: form.categoriaId || null,
        p_precio_venta: Number(form.precio),
        p_costo_unitario: Number(form.costo),
        p_codigo_interno: form.codigo || null,
        p_stock_minimo: Number(form.minimo),
        p_presentacion_compra: form.presentacion,
        p_factor_compra: Number(form.factor),
        p_activo: form.activo,
      });

      if (error) throw new Error(error.message);

      const productoId = idGuardado(data, form.id);
      if (imagenArchivo) {
        setImagenSubiendo(productoId);
        await guardarImagenCatalogo("producto", productoId, imagenArchivo);
      }

      setMensaje(form.activo ? "Producto guardado." : "Producto eliminado del catalogo.");
      await cargar();
      setProductoForm(productoInicial);
      setProductoImagenArchivo(null);
      setAccionInventarioModal(null);
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudo guardar el producto.");
    } finally {
      setImagenSubiendo(null);
      setGuardando(false);
    }
  }


  async function cambiarEstadoProducto(producto: Producto, activo: boolean, costoActual: number) {
    await guardarProducto(undefined, {
      id: producto.id,
      nombre: producto.nombre,
      categoriaId: producto.categoria_id ?? "",
      precio: String(producto.precio_venta),
      costo: String(costoActual),
      codigo: producto.codigo_interno ?? "",
      minimo: String(producto.stock_minimo),
      presentacion: producto.presentacion_compra,
      factor: String(producto.factor_compra),
      imagenUrl: producto.imagen_url,
      activo,
    }, null);
  }

  function editarProductoCatalogo(producto: Producto, costoActual: number) {
    setProductoForm({
      id: producto.id,
      nombre: producto.nombre,
      categoriaId: producto.categoria_id ?? "",
      precio: String(producto.precio_venta),
      costo: String(costoActual),
      codigo: producto.codigo_interno ?? "",
      minimo: String(producto.stock_minimo),
      presentacion: producto.presentacion_compra,
      factor: String(producto.factor_compra),
      imagenUrl: producto.imagen_url,
      activo: producto.activo,
    });
    setProductoImagenArchivo(null);
    setAccionInventarioModal("producto");
  }

  async function registrarCompra(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!compraPuedeRegistrarse) {
      setMensaje("Completa proveedor, fecha y lineas con producto, cantidad y costo de catalogo.");
      return;
    }

    const supabase = supabaseBrowser();
    const correcto = await ejecutar(
      () => supabase.rpc("registrar_compra", {
        p_proveedor_id: compraProveedor,
        p_items: compraLineasCalculadas.map((linea) => ({
          producto_id: linea.producto_id,
          modo: linea.modo,
          cantidad_ingresada: linea.cantidad,
        })),
        p_fecha: compraFecha,
        p_observacion: compraObservacion || null,
      }),
      `Compra registrada: ${compraLineasCalculadas.length} linea(s).`,
    );
    if (correcto) {
      setCompraLineas([{ ...compraLineaInicial }]);
      setCompraObservacion("");
      setCompraFactura("");
      setCompraMedio("efectivo");
      setAccionInventarioModal(null);
    }
  }

  function actualizarLineaCompra(index: number, cambios: Partial<CompraLineaForm>) {
    setCompraLineas((actual) => actual.map((linea, lineaIndex) => (
      lineaIndex === index ? { ...linea, ...cambios } : linea
    )));
  }

  function agregarLineaCompra() {
    setCompraLineas((actual) => [...actual, { ...compraLineaInicial }]);
  }

  function quitarLineaCompra(index: number) {
    setCompraLineas((actual) => {
      const siguientes = actual.filter((_, lineaIndex) => lineaIndex !== index);
      return siguientes.length > 0 ? siguientes : [{ ...compraLineaInicial }];
    });
  }

  async function guardarCombo(event?: FormEvent<HTMLFormElement>, form = comboForm, imagenArchivo = comboImagenArchivo) {
    event?.preventDefault();
    const items = comboFormItemsValidos(form);

    if (items.length === 0) {
      setMensaje("Agrega al menos un item valido al combo.");
      return;
    }

    if (form.activo && !form.imagenUrl && !imagenArchivo) {
      setMensaje("La imagen es obligatoria para guardar el combo.");
      return;
    }

    setGuardando(true);
    setMensaje(null);

    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("crear_combo_catalogo", {
        p_combo_id: form.id,
        p_nombre: form.nombre,
        p_precio_venta: Number(form.precio),
        p_items: items,
        p_activo: form.activo,
      });

      if (error) throw new Error(error.message);

      const comboId = idGuardado(data, form.id);
      if (imagenArchivo) {
        setImagenSubiendo(comboId);
        await guardarImagenCatalogo("combo", comboId, imagenArchivo);
      }

      setMensaje(form.activo ? "Combo guardado." : "Combo eliminado del catalogo.");
      await cargar();
      setComboForm(comboInicial);
      setComboImagenArchivo(null);
      setAccionInventarioModal(null);
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudo guardar el combo.");
    } finally {
      setImagenSubiendo(null);
      setGuardando(false);
    }
  }

  function editarCombo(combo: Combo) {
    const items = comboItems(combo);
    setComboForm({
      id: combo.id,
      nombre: combo.nombre,
      precio: String(combo.precio_venta),
      items: items.length > 0
        ? items.map((item) => ({ producto_id: item.producto_id, cantidad: String(item.cantidad) }))
        : [{ producto_id: "", cantidad: "1" }],
      imagenUrl: combo.imagen_url,
      activo: combo.activo,
    });
    setComboImagenArchivo(null);
    setAccionInventarioModal("combo");
  }

  async function cambiarEstadoCombo(combo: Combo, activo: boolean) {
    const items = comboItems(combo);
    await guardarCombo(undefined, {
      id: combo.id,
      nombre: combo.nombre,
      precio: String(combo.precio_venta),
      items: items.length > 0
        ? items.map((item) => ({ producto_id: item.producto_id, cantidad: String(item.cantidad) }))
        : [{ producto_id: "", cantidad: "1" }],
      imagenUrl: combo.imagen_url,
      activo,
    }, null);
  }

  function agregarItemCombo() {
    setComboForm((actual) => ({
      ...actual,
      items: [...actual.items, { producto_id: "", cantidad: "1" }],
    }));
  }

  function actualizarItemCombo(index: number, valores: Partial<ComboFormItem>) {
    setComboForm((actual) => ({
      ...actual,
      items: actual.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...valores } : item),
    }));
  }

  function quitarItemCombo(index: number) {
    setComboForm((actual) => {
      const items = actual.items.filter((_, itemIndex) => itemIndex !== index);
      return { ...actual, items: items.length > 0 ? items : [{ producto_id: "", cantidad: "1" }] };
    });
  }
  async function guardarProveedor(event?: FormEvent<HTMLFormElement>, form = proveedorForm) {
    event?.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("guardar_proveedor_detalle", {
        p_proveedor_id: form.id,
        p_nombre: form.nombre,
        p_nit: form.nit || null,
        p_contacto: form.contacto || null,
        p_telefono: form.telefono || null,
        p_correo: form.correo || null,
        p_direccion: form.direccion || null,
        p_observacion: form.observacion || null,
        p_activo: form.activo,
      }),
      form.activo ? "Proveedor guardado." : "Proveedor eliminado del catalogo.",
    );
    setProveedorForm(proveedorInicial);
  }

  async function cambiarEstadoProveedor(proveedor: Proveedor, activo: boolean) {
    await guardarProveedor(undefined, { ...proveedorAForm(proveedor), activo });
  }

  async function registrarAjuste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("registrar_movimiento_inventario", {
        p_producto_id: ajusteProducto,
        p_tipo: "ajuste",
        p_cantidad: Number(ajusteCantidad),
        p_motivo_id: ajusteMotivo,
        p_observacion: "Ajuste manual desde admin",
      }),
      "Ajuste registrado en kardex.",
    );
    setAjusteCantidad("");
  }

  function iniciarEdicionStock(item: ItemStock) {
    setStockEditando(item.item_id);
    setStockInline((actual) => ({
      ...actual,
      [item.item_id]: {
        nombre: item.nombre,
        precio: String(item.precio_venta ?? 0),
        costo: String(item.costo_estimado ?? 0),
        stock: String(item.stock_disponible ?? 0),
        minimo: String(item.stock_minimo ?? 0),
      },
    }));
  }

  function cancelarEdicionStock(productoId: string) {
    setStockEditando(null);
    setStockInline((actual) => {
      const siguiente = { ...actual };
      delete siguiente[productoId];
      return siguiente;
    });
  }

  async function guardarStockInline(item: ItemStock) {
    const valores = stockInline[item.item_id];
    const nombre = valores?.nombre?.trim() ?? item.nombre;
    const precio = Number(valores?.precio ?? item.precio_venta);
    const costo = Number(valores?.costo ?? item.costo_estimado ?? 0);
    const minimo = Number(valores?.minimo ?? item.stock_minimo ?? 0);

    if (nombre.length < 2) {
      setMensaje("El nombre debe tener al menos 2 caracteres.");
      return;
    }

    if (!Number.isFinite(precio) || precio < 0 || !Number.isFinite(costo) || costo < 0) {
      setMensaje("Precio de venta y precio de compra deben ser mayores o iguales a cero.");
      return;
    }

    if (item.tipo_item === "producto" && (!Number.isInteger(minimo) || minimo < 0)) {
      setMensaje("El stock minimo debe ser un numero entero mayor o igual a cero.");
      return;
    }

    setGuardando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { error } = item.tipo_item === "producto"
      ? await supabase.rpc("guardar_producto_inline_admin", {
          p_producto_id: item.item_id,
          p_nombre: nombre,
          p_precio_venta: precio,
          p_costo_unitario: costo,
          p_stock_actual: Number(item.stock_disponible ?? 0),
          p_stock_minimo: minimo,
        })
      : await supabase.rpc("guardar_combo_inline_admin", {
          p_combo_id: item.item_id,
          p_nombre: nombre,
          p_precio_venta: precio,
        });

    if (error) {
      setMensaje(error.message);
    } else {
      setMensaje(item.tipo_item === "producto" ? "Producto actualizado." : "Combo actualizado.");
      cancelarEdicionStock(item.item_id);
      await cargar();
    }
    setGuardando(false);
  }

  async function subirImagenCatalogo(item: ItemStock, event: ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    event.target.value = "";
    if (!archivo) return;

    setImagenSubiendo(item.item_id);
    setMensaje(null);

    try {
      await guardarImagenCatalogo(item.tipo_item, item.item_id, archivo);
      setMensaje("Imagen actualizada.");
      await cargar();
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudo subir la imagen.");
    } finally {
      setImagenSubiendo(null);
    }
  }

  function ControlImagenCatalogo({ item, compacto = false }: { item: ItemStock; compacto?: boolean }) {
    const subiendo = imagenSubiendo === item.item_id;
    const sinImagen = !item.imagen_url;
    const texto = subiendo ? "Subiendo..." : sinImagen ? "Subir imagen" : "Cambiar imagen";
    const clases = sinImagen
      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
      : "border-antiguo/20 text-crema";
    return (
      <label className={`${compacto ? "tap-target inline-flex cursor-pointer items-center rounded-md border px-3 text-xs font-bold" : "inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-xs font-bold"} ${clases}`}>
        {texto}
        <input type="file" accept="image/*" className="hidden" disabled={subiendo} onChange={(event) => subirImagenCatalogo(item, event)} />
      </label>
    );
  }


  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-2 border-b border-antiguo/15 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">F3 Inventario</p>
          <h2 className="text-2xl font-black text-crema">Catalogo, compras y stock</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={abrirAccionesInventario} className="tap-target rounded-md bg-oro px-4 font-black text-carbon">Acciones de inventario</button>
          <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Refrescar</button>
        </div>
      </div>

      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm font-semibold">{mensaje}</p> : null}
      {advertenciasCarga.length > 0 ? (
        <div className="rounded-lg border border-dorado/30 bg-dorado/10 p-3 text-sm text-crema">
          <p className="font-black text-dorado">Algunas secciones no respondieron.</p>
          <ul className="mt-2 grid gap-1 text-antiguo/80">
            {advertenciasCarga.map((advertencia) => (
              <li key={advertencia.seccion}><strong className="text-crema">{advertencia.seccion}:</strong> {advertencia.mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">Productos activos</p>
          <p className="mt-1 text-2xl font-black text-crema">{resumenInventario?.productos_activos ?? productosActivos.length}</p>
        </div>
        <div className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">Unidades disponibles</p>
          <p className="mt-1 text-2xl font-black text-crema">{resumenInventario?.unidades_stock ?? 0}</p>
        </div>
        <div className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">Valor al costo</p>
          <p className="mt-1 text-xl font-black text-dorado">{formatoCOP(resumenInventario?.valor_costo ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">Valor de venta</p>
          <p className="mt-1 text-xl font-black text-dorado">{formatoCOP(resumenInventario?.valor_venta ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">Margen potencial</p>
          <p className="mt-1 text-xl font-black text-green-100">{formatoCOP(resumenInventario?.margen_potencial ?? 0)}</p>
          {(resumenInventario?.productos_sin_costo ?? 0) > 0 ? <p className="mt-1 text-xs font-bold text-red-100">{resumenInventario?.productos_sin_costo} sin costo</p> : null}
        </div>
        <div className="rounded-lg border border-red-300/25 bg-red-950/20 p-4 shadow-suave">
          <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">Deficit pendiente</p>
          <p className="mt-1 text-2xl font-black text-red-100">{resumenInventario?.unidades_deficit ?? 0}</p>
          <p className="mt-1 text-xs font-bold text-antiguo/70">{resumenInventario?.productos_deficit ?? 0} producto(s) / {formatoCOP(resumenInventario?.valor_deficit_reposicion ?? 0)}</p>
        </div>
      </section>

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-black text-crema">Items y stock</h3>
              <p className="text-sm text-antiguo/70">Productos y combos separados por estado.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-antiguo/10 bg-carbon p-1 text-sm font-bold sm:w-80">
              <button type="button" onClick={() => setEstadoStockTab("activos")} className={estadoStockTab === "activos" ? "tap-target rounded-md bg-oro px-3 text-carbon" : "tap-target rounded-md px-3 text-crema"}>Activos ({resumenStockTabs.activos})</button>
              <button type="button" onClick={() => setEstadoStockTab("inactivos")} className={estadoStockTab === "inactivos" ? "tap-target rounded-md bg-oro px-3 text-carbon" : "tap-target rounded-md px-3 text-crema"}>Inactivos ({resumenStockTabs.inactivos})</button>
            </div>
          </div>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_190px_170px_120px_120px_190px]">
            <input value={busquedaStock} onChange={(event) => setBusquedaStock(event.target.value)} placeholder="Buscar item" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
            <select value={categoriaFiltroStock} onChange={(event) => setCategoriaFiltroStock(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Todas las categorias</option>
              {categoriasItemsStock.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}
            </select>
            <select value={filtroStock} onChange={(event) => setFiltroStock(event.target.value as FiltroStockAdmin)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="todos">Todo el stock</option>
              <option value="deficit">Deficit</option>
              <option value="en_cero">Stock en cero</option>
              <option value="bajo">Stock bajo</option>
              <option value="disponible">Disponible</option>
              <option value="rango">Rango manual</option>
            </select>
            <input value={stockMinFiltro} onChange={(event) => setStockMinFiltro(event.target.value)} type="number" inputMode="numeric" placeholder="Stock min" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
            <input value={stockMaxFiltro} onChange={(event) => setStockMaxFiltro(event.target.value)} type="number" inputMode="numeric" placeholder="Stock max" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
            <select value={ordenStock} onChange={(event) => setOrdenStock(event.target.value as OrdenStockAdmin)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="prioridad">Prioridad stock</option>
              <option value="stock_asc">Stock menor primero</option>
              <option value="stock_desc">Stock mayor primero</option>
              <option value="nombre">Nombre</option>
              <option value="precio_asc">Precio venta menor</option>
              <option value="precio_desc">Precio venta mayor</option>
              <option value="costo_asc">Costo menor</option>
              <option value="costo_desc">Costo mayor</option>
              <option value="estado">Estado</option>
            </select>
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:hidden">
          {itemsStockFiltrados.map((item) => {
            const producto = item.tipo_item === "producto" ? productos.find((productoItem) => productoItem.id === item.item_id) : null;
            const combo = item.tipo_item === "combo" ? combos.find((comboItem) => comboItem.id === item.item_id) : null;
            const editandoStock = stockEditando === item.item_id;
            const stockBajo = Number(item.stock_disponible ?? 0) <= Number(item.stock_minimo ?? -1);
            return (
              <article key={`${item.tipo_item}-${item.item_id}`} className="rounded-md border border-antiguo/10 bg-carbon p-3">
                <div className="flex items-start justify-between gap-3">
                  <ImagenCatalogo url={item.imagen_url} nombre={item.nombre} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-wide text-oro">{item.tipo_item === "producto" ? "Producto" : "Combo"}</p>
                    {editandoStock ? (
                      <input value={stockInline[item.item_id]?.nombre ?? item.nombre} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { precio: String(item.precio_venta ?? 0), costo: String(item.costo_estimado ?? 0), stock: String(item.stock_disponible ?? 0), minimo: String(item.stock_minimo ?? 0) }), nombre: event.target.value } }))} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-2 text-crema" />
                    ) : (
                      <h3 className="break-words text-base font-black text-crema">{item.nombre}</h3>
                    )}
                    <p className="text-xs text-antiguo/65">{item.categoria ?? "Sin categoria"} - {item.activo ? "Activo" : "Inactivo"}</p>
                  </div>
                  <p className={stockBajo ? "shrink-0 text-right text-sm font-black text-dorado" : "shrink-0 text-right text-sm font-black text-crema"}>{item.stock_disponible ?? "-"}</p>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <label className="text-xs font-bold text-antiguo/75">
                    Stock
                    <span className="mt-1 block rounded-md border border-antiguo/10 bg-espresso p-2 text-crema">{item.stock_disponible ?? "-"}</span>
                  </label>
                  <label className="text-xs font-bold text-antiguo/75">
                    Minimo
                    {editandoStock && item.tipo_item === "producto" ? (
                      <input type="number" min="0" inputMode="numeric" value={stockInline[item.item_id]?.minimo ?? String(item.stock_minimo ?? 0)} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { nombre: item.nombre, precio: String(item.precio_venta ?? 0), costo: String(item.costo_estimado ?? 0), stock: String(item.stock_disponible ?? 0) }), minimo: event.target.value } }))} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-2 text-crema" />
                    ) : <span className="mt-1 block rounded-md border border-antiguo/10 bg-espresso p-2 text-crema">{item.stock_minimo ?? "-"}</span>}
                  </label>
                  <label className="text-xs font-bold text-antiguo/75">
                    Precio
                    {editandoStock ? (
                      <input type="number" min="0" inputMode="numeric" value={stockInline[item.item_id]?.precio ?? String(item.precio_venta ?? 0)} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { nombre: item.nombre, costo: String(item.costo_estimado ?? 0), stock: String(item.stock_disponible ?? 0), minimo: String(item.stock_minimo ?? 0) }), precio: event.target.value } }))} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-2 text-crema" />
                    ) : <span className="mt-1 block rounded-md border border-antiguo/10 bg-espresso p-2 text-dorado">{formatoCOP(item.precio_venta)}</span>}
                  </label>
                  <label className="text-xs font-bold text-antiguo/75">
                    Costo
                    {editandoStock && item.tipo_item === "producto" ? (
                      <input type="number" min="0" inputMode="numeric" value={stockInline[item.item_id]?.costo ?? String(item.costo_estimado ?? 0)} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { nombre: item.nombre, precio: String(item.precio_venta ?? 0), stock: String(item.stock_disponible ?? 0), minimo: String(item.stock_minimo ?? 0) }), costo: event.target.value } }))} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-2 text-crema" />
                    ) : <span className="mt-1 block rounded-md border border-antiguo/10 bg-espresso p-2 text-crema">{formatoCOP(item.costo_estimado)}</span>}
                  </label>
                </div>

                <p className="mt-3 break-words text-xs text-antiguo/75">{item.tipo_item === "producto" ? `${item.presentacion_compra ?? "unidad"} x${item.factor_compra ?? 1}` : (item.componentes ?? []).map((componente) => `${componente.cantidad} x ${etiquetaProductoPorId(componente.producto_id, componente)}`).join(", ")}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {editandoStock ? (
                    <>
                      <button disabled={guardando} onClick={() => guardarStockInline(item)} className="tap-target rounded-md bg-oro px-3 text-xs font-black text-carbon disabled:opacity-50">Guardar</button>
                      <button disabled={guardando} onClick={() => cancelarEdicionStock(item.item_id)} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold disabled:opacity-50">Cancelar</button>
                    </>
                  ) : null}
                  {!editandoStock ? <button onClick={() => iniciarEdicionStock(item)} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold">Editar</button> : null}
                  {!editandoStock ? <ControlImagenCatalogo item={item} compacto /> : null}
                  {producto && !editandoStock ? <button onClick={() => editarProductoCatalogo(producto, Number(item.costo_estimado ?? 0))} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold">Catalogo</button> : null}
                  {producto && !editandoStock ? <button onClick={() => cambiarEstadoProducto(producto, !producto.activo, Number(item.costo_estimado ?? 0))} className={producto.activo ? "tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100" : "tap-target rounded-md border border-green-300/30 px-3 text-xs font-bold text-green-100"}>{producto.activo ? "Eliminar" : "Reactivar"}</button> : null}
                  {combo && !editandoStock ? <button onClick={() => editarCombo(combo)} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold">Componentes</button> : null}
                  {combo && !editandoStock ? <button onClick={() => cambiarEstadoCombo(combo, !combo.activo)} className={combo.activo ? "tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100" : "tap-target rounded-md border border-green-300/30 px-3 text-xs font-bold text-green-100"}>{combo.activo ? "Eliminar" : "Reactivar"}</button> : null}
                </div>
              </article>
            );
          })}
          {itemsStockFiltrados.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">No hay items para ese filtro.</p> : null}
        </div>

        <div className="mt-3 hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1160px] text-left text-sm">
            <thead className="text-antiguo/70">
              <tr className="border-b border-antiguo/15">
                <th className="py-2 pr-3">Imagen</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Categoria</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Minimo</th>
                <th className="py-2 pr-3">Precio</th>
                <th className="py-2 pr-3">Costo</th>
                <th className="py-2 pr-3">Componentes/compra</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {itemsStockFiltrados.map((item) => {
                const producto = item.tipo_item === "producto" ? productos.find((productoItem) => productoItem.id === item.item_id) : null;
                const combo = item.tipo_item === "combo" ? combos.find((comboItem) => comboItem.id === item.item_id) : null;
                const editandoStock = stockEditando === item.item_id;
                return (
                  <tr key={`${item.tipo_item}-${item.item_id}`} className="border-b border-antiguo/10 align-top">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <ImagenCatalogo url={item.imagen_url} nombre={item.nombre} className="h-14 w-14" />
                        {!editandoStock ? <ControlImagenCatalogo item={item} /> : null}
                      </div>
                    </td>
                    <td className="py-3 pr-3 font-bold text-dorado">{item.tipo_item === "producto" ? "Producto" : "Combo"}</td>
                    <td className="py-3 pr-3 font-bold text-crema">{editandoStock ? <input value={stockInline[item.item_id]?.nombre ?? item.nombre} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { precio: String(item.precio_venta ?? 0), costo: String(item.costo_estimado ?? 0), stock: String(item.stock_disponible ?? 0), minimo: String(item.stock_minimo ?? 0) }), nombre: event.target.value } }))} className="tap-target w-56 rounded-md border border-antiguo/20 bg-carbon px-2 text-crema" /> : item.nombre}</td>
                    <td className="py-3 pr-3">{item.categoria ?? "-"}</td>
                    <td className={Number(item.stock_disponible ?? 0) <= Number(item.stock_minimo ?? -1) ? "py-3 pr-3 font-black text-dorado" : "py-3 pr-3"}>
                      {item.stock_disponible ?? "-"}
                    </td>
                    <td className="py-3 pr-3">
                      {editandoStock && item.tipo_item === "producto" ? (
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={stockInline[item.item_id]?.minimo ?? String(item.stock_minimo ?? 0)}
                          onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { nombre: item.nombre, precio: String(item.precio_venta ?? 0), costo: String(item.costo_estimado ?? 0), stock: String(item.stock_disponible ?? 0) }), minimo: event.target.value } }))}
                          className="tap-target w-24 rounded-md border border-antiguo/20 bg-carbon px-2 text-crema"
                        />
                      ) : item.stock_minimo ?? "-"}
                    </td>
                    <td className="py-3 pr-3">{editandoStock ? <input type="number" min="0" inputMode="numeric" value={stockInline[item.item_id]?.precio ?? String(item.precio_venta ?? 0)} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { nombre: item.nombre, costo: String(item.costo_estimado ?? 0), stock: String(item.stock_disponible ?? 0), minimo: String(item.stock_minimo ?? 0) }), precio: event.target.value } }))} className="tap-target w-28 rounded-md border border-antiguo/20 bg-carbon px-2 text-crema" /> : formatoCOP(item.precio_venta)}</td>
                    <td className="py-3 pr-3">{editandoStock && item.tipo_item === "producto" ? <input type="number" min="0" inputMode="numeric" value={stockInline[item.item_id]?.costo ?? String(item.costo_estimado ?? 0)} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { nombre: item.nombre, precio: String(item.precio_venta ?? 0), stock: String(item.stock_disponible ?? 0), minimo: String(item.stock_minimo ?? 0) }), costo: event.target.value } }))} className="tap-target w-28 rounded-md border border-antiguo/20 bg-carbon px-2 text-crema" /> : formatoCOP(item.costo_estimado)}</td>
                    <td className="max-w-[300px] py-3 pr-3 text-xs text-antiguo/75">
                      {item.tipo_item === "producto" ? `${item.presentacion_compra ?? "unidad"} x${item.factor_compra ?? 1}` : (item.componentes ?? []).map((componente) => `${componente.cantidad} x ${etiquetaProductoPorId(componente.producto_id, componente)}`).join(", ")}
                    </td>
                    <td className="py-3 pr-3">{item.activo ? "Activo" : "Inactivo"}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-2">
                        {editandoStock ? (
                          <>
                            <button disabled={guardando} onClick={() => guardarStockInline(item)} className="rounded-md bg-oro px-2 py-1 text-xs font-black text-carbon disabled:opacity-50">Guardar</button>
                            <button disabled={guardando} onClick={() => cancelarEdicionStock(item.item_id)} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold disabled:opacity-50">Cancelar</button>
                          </>
                        ) : null}
                        {!editandoStock ? <button onClick={() => iniciarEdicionStock(item)} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">Editar</button> : null}
                        {producto && !editandoStock ? <button onClick={() => editarProductoCatalogo(producto, Number(item.costo_estimado ?? 0))} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">Catalogo</button> : null}
                        {producto && !editandoStock ? <button onClick={() => cambiarEstadoProducto(producto, !producto.activo, Number(item.costo_estimado ?? 0))} className={producto.activo ? "rounded-md border border-red-300/30 px-2 py-1 text-xs font-bold text-red-100" : "rounded-md border border-green-300/30 px-2 py-1 text-xs font-bold text-green-100"}>{producto.activo ? "Eliminar" : "Reactivar"}</button> : null}
                        {combo && !editandoStock ? <button onClick={() => editarCombo(combo)} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">Componentes</button> : null}
                        {combo && !editandoStock ? <button onClick={() => cambiarEstadoCombo(combo, !combo.activo)} className={combo.activo ? "rounded-md border border-red-300/30 px-2 py-1 text-xs font-bold text-red-100" : "rounded-md border border-green-300/30 px-2 py-1 text-xs font-bold text-green-100"}>{combo.activo ? "Eliminar" : "Reactivar"}</button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {itemsStockFiltrados.length === 0 ? <p className="p-4 text-center text-sm text-antiguo/70">No hay items para ese filtro.</p> : null}
        </div>
      </section>

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-crema">Historial de descuentos por item</h3>
            <p className="text-sm text-antiguo/70">Salidas de inventario por ventas, combos, ajustes, mermas y consumo interno.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-[24rem]">
            <div className="rounded-md border border-antiguo/10 bg-carbon p-2"><p className="text-antiguo/60">Movimientos</p><p className="font-black text-dorado">{resumenDescuentos.movimientos}</p></div>
            <div className="rounded-md border border-antiguo/10 bg-carbon p-2"><p className="text-antiguo/60">Unidades</p><p className="font-black text-dorado">{resumenDescuentos.unidades}</p></div>
            <div className="rounded-md border border-antiguo/10 bg-carbon p-2"><p className="text-antiguo/60">Ventas</p><p className="font-black text-dorado">{resumenDescuentos.ventas}</p></div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_180px]">
          <input value={busquedaMovimiento} onChange={(event) => setBusquedaMovimiento(event.target.value)} placeholder="Buscar producto, origen, motivo o usuario" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
          <select value={productoMovimientoFiltro} onChange={(event) => setProductoMovimientoFiltro(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="">Todos los productos</option>
            {productos.map((producto) => <option key={producto.id} value={producto.id}>{etiquetaProducto(producto)}</option>)}
          </select>
          <select value={tipoMovimientoFiltro} onChange={(event) => setTipoMovimientoFiltro(event.target.value as TipoDescuentoFiltro)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="todos">Todos los tipos</option>
            <option value="venta">Ventas</option>
            <option value="ajuste">Ajustes negativos</option>
            <option value="merma">Mermas</option>
            <option value="consumo_interno">Consumo interno</option>
          </select>
        </div>

        <div className="mt-3 grid gap-3 lg:hidden">
          {movimientosDescuentoFiltrados.map((movimiento) => (
            <article key={movimiento.id} className="rounded-md border border-antiguo/10 bg-carbon p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-oro">{tipoMovimientoTexto(movimiento.tipo)} / {fechaHoraCorta(movimiento.timestamp)}</p>
                  <h4 className="break-words text-base font-black text-crema">{movimiento.producto}</h4>
                  <p className="text-xs text-antiguo/65">{movimiento.categoria ?? "Sin categoria"}</p>
                </div>
                <p className="shrink-0 rounded-md border border-red-300/25 bg-red-950/20 px-2 py-1 text-sm font-black text-red-100">-{movimiento.unidades_descontadas}</p>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <p><span className="text-antiguo/60">Origen:</span> <strong className="text-crema">{movimiento.origen ?? "-"}</strong></p>
                <p><span className="text-antiguo/60">Referencia:</span> {movimiento.detalle_referencia ?? movimiento.referencia_tipo ?? "-"}</p>
                <p><span className="text-antiguo/60">Cuenta:</span> {movimiento.cuenta_origen ?? "-"}</p>
                <p><span className="text-antiguo/60">Pedido:</span> {codigoCorto(movimiento.pedido_id)} {movimiento.captura_venta_orden ? `/ captura venta ${movimiento.captura_venta_orden}` : ""}</p>
                <p><span className="text-antiguo/60">Stock resultante:</span> {movimiento.stock_resultante ?? "-"}</p>
              </div>
            </article>
          ))}
          {movimientosDescuentoFiltrados.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">No hay descuentos para ese filtro.</p> : null}
        </div>

        <div className="mt-3 hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="text-antiguo/70">
              <tr className="border-b border-antiguo/15">
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Item descontado</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Unid.</th>
                <th className="py-2 pr-3">Origen</th>
                <th className="py-2 pr-3">Referencia venta</th>
                <th className="py-2 pr-3">Cuenta</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Usuario</th>
              </tr>
            </thead>
            <tbody>
              {movimientosDescuentoFiltrados.map((movimiento) => (
                <tr key={movimiento.id} className="border-b border-antiguo/10 align-top">
                  <td className="py-3 pr-3 text-xs text-antiguo/75">{fechaHoraCorta(movimiento.timestamp)}</td>
                  <td className="py-3 pr-3"><p className="font-black text-crema">{movimiento.producto}</p><p className="text-xs text-antiguo/60">{movimiento.categoria ?? "Sin categoria"}</p></td>
                  <td className="py-3 pr-3 font-bold text-dorado">{tipoMovimientoTexto(movimiento.tipo)}</td>
                  <td className="py-3 pr-3 font-black text-red-100">-{movimiento.unidades_descontadas}</td>
                  <td className="py-3 pr-3">{movimiento.origen ?? "-"}</td>
                  <td className="py-3 pr-3"><p>{movimiento.detalle_referencia ?? "-"}</p><p className="text-xs text-antiguo/55">Pedido {codigoCorto(movimiento.pedido_id)}{movimiento.captura_venta_orden ? ` / captura venta ${movimiento.captura_venta_orden}` : ""}</p></td>
                  <td className="py-3 pr-3">{movimiento.cuenta_origen ?? "-"}</td>
                  <td className="py-3 pr-3">{movimiento.stock_resultante ?? "-"}</td>
                  <td className="py-3 pr-3">{movimiento.usuario ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {movimientosDescuentoFiltrados.length === 0 ? <p className="p-4 text-center text-sm text-antiguo/70">No hay descuentos para ese filtro.</p> : null}
        </div>
      </section>
      {accionInventarioModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-3" role="dialog" aria-modal="true" onClick={cerrarAccionesInventario}>
          <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-antiguo/20 bg-espresso p-4 text-champana shadow-suave" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-antiguo/15 pb-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-oro">Acciones de inventario</p>
                <h3 className="text-2xl font-black text-crema">
                  {accionInventarioModal === "producto" ? (productoForm.id ? "Editar producto" : "Registrar producto nuevo") : accionInventarioModal === "compra" ? "Registrar compra de inventario" : accionInventarioModal === "combo" ? (comboForm.id ? "Editar combo" : "Crear combo") : "Selecciona una accion"}
                </h3>
              </div>
              <button type="button" onClick={cerrarAccionesInventario} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 text-sm font-bold text-crema">Cerrar</button>
            </div>

            {accionInventarioModal === "menu" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <button type="button" onClick={abrirProductoNuevo} className="rounded-md border border-oro/25 bg-carbon p-4 text-left hover:border-oro">
                  <span className="block text-lg font-black text-crema">Registrar producto nuevo</span>
                  <span className="mt-1 block text-sm text-antiguo/65">Crea un producto fisico con precio, costo, presentacion y categoria.</span>
                </button>
                <button type="button" onClick={abrirCompraInventario} className="rounded-md border border-oro/25 bg-carbon p-4 text-left hover:border-oro">
                  <span className="block text-lg font-black text-crema">Registrar compra de inventario</span>
                  <span className="mt-1 block text-sm text-antiguo/65">Suma stock al catalogo desde una compra administrativa sin afectar caja.</span>
                </button>
                <button type="button" onClick={abrirComboNuevo} className="rounded-md border border-oro/25 bg-carbon p-4 text-left hover:border-oro">
                  <span className="block text-lg font-black text-crema">Crear combo</span>
                  <span className="mt-1 block text-sm text-antiguo/65">Combina productos activos del inventario para venderlos como un paquete.</span>
                </button>
              </div>
            ) : null}

            {accionInventarioModal !== "menu" ? (
              <button type="button" onClick={() => setAccionInventarioModal("menu")} className="mt-4 rounded-md border border-antiguo/20 bg-carbon px-3 py-2 text-xs font-bold text-crema">Volver a acciones</button>
            ) : null}

            {accionInventarioModal === "producto" ? (
              <section className="mt-4 rounded-md border border-antiguo/15 bg-carbon p-3">
                <form onSubmit={crearCategoria} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <CampoConInfo info="categoriaNueva">
                    <input value={categoriaNueva} onChange={(event) => setCategoriaNueva(event.target.value)} placeholder="Nueva categoria" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                  </CampoConInfo>
                  <button disabled={guardando || categoriaNueva.length < 2} className="tap-target rounded-md border border-oro/30 px-3 font-bold text-dorado disabled:opacity-50">Crear</button>
                </form>
                <form onSubmit={(event) => guardarProducto(event)} className="mt-4 grid gap-2">
                  <CampoConInfo info="productoNombre">
                    <input value={productoForm.nombre} onChange={(event) => setProductoForm((actual) => ({ ...actual, nombre: event.target.value }))} placeholder="Nombre" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                  </CampoConInfo>
                  <CampoConInfo info="productoCategoria">
                    <select value={productoForm.categoriaId} onChange={(event) => setProductoForm((actual) => ({ ...actual, categoriaId: event.target.value }))} className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                      <option value="">Categoria</option>
                      {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nombre}</option>)}
                    </select>
                  </CampoConInfo>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <CampoConInfo info="productoPrecio">
                      <input value={productoForm.precio} onChange={(event) => setProductoForm((actual) => ({ ...actual, precio: event.target.value }))} type="number" placeholder="Precio venta" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                    </CampoConInfo>
                    <CampoConInfo info="productoCosto">
                      <input value={productoForm.costo} onChange={(event) => setProductoForm((actual) => ({ ...actual, costo: event.target.value }))} type="number" placeholder="Costo unidad" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                    </CampoConInfo>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <CampoConInfo info="productoCodigo">
                      <input value={productoForm.codigo} onChange={(event) => setProductoForm((actual) => ({ ...actual, codigo: event.target.value }))} placeholder="Codigo" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                    </CampoConInfo>
                    <CampoConInfo info="productoMinimo">
                      <input value={productoForm.minimo} onChange={(event) => setProductoForm((actual) => ({ ...actual, minimo: event.target.value }))} type="number" placeholder="Stock minimo" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                    </CampoConInfo>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <CampoConInfo info="productoPresentacion">
                      <select value={productoForm.presentacion} onChange={(event) => setProductoForm((actual) => ({ ...actual, presentacion: event.target.value }))} className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                        <option value="">Presentacion compra</option>
                        {productoForm.presentacion && !presentacionesCompra.includes(productoForm.presentacion) ? <option value={productoForm.presentacion}>{productoForm.presentacion}</option> : null}
                        {presentacionesCompra.map((presentacion) => <option key={presentacion} value={presentacion}>{presentacion}</option>)}
                      </select>
                    </CampoConInfo>
                    <CampoConInfo info="productoFactor">
                      <input value={productoForm.factor} onChange={(event) => setProductoForm((actual) => ({ ...actual, factor: event.target.value }))} type="number" min="1" placeholder="Factor" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                    </CampoConInfo>
                  </div>
                  <CampoConInfo info="productoImagen">
                    <label className="tap-target flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 rounded-md border border-emerald-400/45 bg-emerald-500/15 px-3 text-sm font-bold text-emerald-100 hover:bg-emerald-500/25">
                      <span className="truncate">
                        {productoImagenArchivo ? productoImagenArchivo.name : productoForm.imagenUrl ? "Cambiar imagen del producto" : "Subir imagen obligatoria"}
                      </span>
                      <span className="shrink-0 text-xs uppercase tracking-wide">Seleccionar</span>
                      <input type="file" accept="image/*" className="hidden" onChange={(event) => setProductoImagenArchivo(event.target.files?.[0] ?? null)} />
                    </label>
                  </CampoConInfo>
                  {productoForm.imagenUrl ? (
                    <div className="flex items-center gap-3 rounded-md border border-antiguo/10 bg-espresso p-2 text-xs text-antiguo/70">
                      <ImagenCatalogo url={productoForm.imagenUrl} nombre={productoForm.nombre || "Producto"} className="h-12 w-12" />
                      <span>Imagen actual del producto. Si seleccionas otra, se reemplaza al guardar.</span>
                    </div>
                  ) : !productoImagenArchivo ? (
                    <p className="text-xs font-bold text-emerald-100">La imagen es obligatoria para productos nuevos.</p>
                  ) : null}
                  <CampoConInfo info="productoActivo">
                    <label className="flex flex-1 items-center gap-2 rounded-md border border-antiguo/15 bg-espresso px-3 py-2 text-sm text-antiguo/80"><input checked={productoForm.activo} onChange={(event) => setProductoForm((actual) => ({ ...actual, activo: event.target.checked }))} type="checkbox" />Activo</label>
                  </CampoConInfo>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button disabled={guardando || productoForm.nombre.length < 2 || !productoForm.presentacion || (!productoForm.id && !productoImagenArchivo)} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{productoForm.id ? "Actualizar producto" : "Guardar producto"}</button>
                    {productoForm.id ? <button type="button" onClick={cerrarAccionesInventario} className="tap-target rounded-md border border-antiguo/20 px-4 font-bold">Cancelar</button> : null}
                  </div>
                </form>
              </section>
            ) : null}

            {accionInventarioModal === "compra" ? (
              <form onSubmit={registrarCompra} className="mt-4 rounded-md border border-antiguo/15 bg-carbon p-3">
                <div className="grid gap-2 lg:grid-cols-[1fr_160px_170px]">
                  <CampoConInfo info="compraProveedor">
                    <select value={compraProveedor} onChange={(event) => setCompraProveedor(event.target.value)} className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                      <option value="">Proveedor obligatorio</option>
                      {proveedoresActivos.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
                    </select>
                  </CampoConInfo>
                  <CampoConInfo info="compraFecha">
                    <input type="date" value={compraFecha} onChange={(event) => setCompraFecha(event.target.value)} className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                  </CampoConInfo>
                  <CampoConInfo info="compraMedio">
                    <select value={compraMedio} onChange={(event) => setCompraMedio(event.target.value as MedioPago)} className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                      {mediosPago.map((medio) => <option key={medio.id} value={medio.id}>{medio.nombre}</option>)}
                    </select>
                  </CampoConInfo>
                </div>
                <div className="mt-2 grid gap-2 lg:grid-cols-[180px_1fr]">
                  <CampoConInfo info="compraFactura">
                    <input value={compraFactura} onChange={(event) => setCompraFactura(event.target.value)} placeholder="Factura opcional" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50" />
                  </CampoConInfo>
                  <CampoConInfo info="compraObservacion">
                    <input value={compraObservacion} onChange={(event) => setCompraObservacion(event.target.value)} placeholder="Observacion" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50" />
                  </CampoConInfo>
                </div>
                <p className="mt-2 text-xs text-antiguo/60">Medio de pago y factura quedan como referencia visual en este sprint; esta compra administrativa no afecta caja ni gastos.</p>
                <div className="mt-3 grid gap-2">
                  {compraLineasCalculadas.map((linea, index) => (
                    <div key={index} className={linea.producto && linea.costo <= 0 ? "rounded-md border border-red-300/30 bg-red-950/20 p-2" : "rounded-md border border-antiguo/10 bg-espresso p-2"}>
                      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_140px_auto]">
                        <CampoConInfo info="compraProducto">
                          <select value={linea.producto_id} onChange={(event) => actualizarLineaCompra(index, { producto_id: event.target.value })} className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                            <option value="">Producto linea {index + 1}</option>
                            {productosCompra.map((producto) => <option key={producto.id} value={producto.id}>{etiquetaProducto(producto)} - stock {producto.stock_actual}{producto.activo ? "" : " - inactivo"}</option>)}
                            {productosCompra.length === 0 ? <option value="" disabled>No hay productos cargados</option> : null}
                          </select>
                        </CampoConInfo>
                        <CampoConInfo info="compraCantidad">
                          <input value={linea.cantidad} onChange={(event) => actualizarLineaCompra(index, { cantidad: event.target.value })} type="number" min="1" inputMode="numeric" placeholder="Cantidad" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                        </CampoConInfo>
                        <button type="button" onClick={() => quitarLineaCompra(index)} disabled={compraLineas.length === 1} className="tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100 disabled:opacity-40">Quitar</button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs lg:grid-cols-5">
                        <div className="rounded-md border border-antiguo/10 bg-carbon p-2">
                          <p className="text-antiguo/60">Stock actual</p>
                          <p className="font-black text-crema">{linea.producto ? linea.producto.stock_actual : "-"}</p>
                        </div>
                        <div className="rounded-md border border-antiguo/10 bg-carbon p-2">
                          <p className="text-antiguo/60">Conteo</p>
                          <p className="font-black text-dorado">
                            {linea.producto ? `${linea.cantidad || 0} x ${linea.factor} = ${linea.unidades || 0}` : "-"}
                          </p>
                          <p className="mt-1 text-[10px] text-antiguo/55">
                            {linea.producto ? `${linea.cantidad || 0} ${linea.producto.presentacion_compra || "presentacion"}(s)` : "Selecciona producto"}
                          </p>
                        </div>
                        <div className="rounded-md border border-antiguo/10 bg-carbon p-2">
                          <p className="text-antiguo/60">Costo unidad</p>
                          <p className="font-black text-crema">{linea.producto ? formatoCOP(linea.costo) : "-"}</p>
                        </div>
                        <div className="rounded-md border border-antiguo/10 bg-carbon p-2">
                          <p className="text-antiguo/60">Despues</p>
                          <p className="font-black text-crema">{linea.stockProyectado ?? "-"}</p>
                        </div>
                        <div className="rounded-md border border-antiguo/10 bg-carbon p-2">
                          <p className="text-antiguo/60">Subtotal</p>
                          <p className="font-black text-dorado">{formatoCOP(linea.subtotal)}</p>
                          <p className="mt-1 text-[10px] text-antiguo/55">
                            {linea.producto ? `${linea.unidades || 0} x ${formatoCOP(linea.costo)}` : "-"}
                          </p>
                        </div>
                      </div>
                      {linea.producto && linea.costo <= 0 ? <p className="mt-2 text-xs font-bold text-red-100">Este producto no tiene costo configurado.</p> : null}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={agregarLineaCompra} className="tap-target mt-3 rounded-md border border-antiguo/20 px-3 font-bold text-crema">Agregar linea</button>
                <div className="mt-3 rounded-md border border-antiguo/10 bg-espresso p-3 text-sm">
                  <p className="font-black text-crema">{compraLineasCalculadas.length} linea(s)</p>
                  <p className="text-xs font-semibold text-antiguo/70">Total unidades calculadas: {compraUnidadesEstimadas}</p>
                  <p className="text-lg font-black text-dorado">{formatoCOP(compraTotalEstimado)}</p>
                </div>
                <button disabled={guardando || !compraPuedeRegistrarse} className="tap-target mt-3 w-full rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Registrar compra</button>
              </form>
            ) : null}

            {accionInventarioModal === "combo" ? (
              <form onSubmit={(event) => guardarCombo(event)} className="mt-4 grid gap-2 rounded-md border border-antiguo/15 bg-carbon p-3">
                <CampoConInfo info="comboNombre">
                  <input value={comboForm.nombre} onChange={(event) => setComboForm((actual) => ({ ...actual, nombre: event.target.value }))} placeholder="Nombre combo" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                </CampoConInfo>
                <CampoConInfo info="comboPrecio">
                  <input value={comboForm.precio} onChange={(event) => setComboForm((actual) => ({ ...actual, precio: event.target.value }))} type="number" placeholder="Precio combo" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                </CampoConInfo>
                <CampoConInfo info="comboImagen">
                  <label className="tap-target flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 rounded-md border border-emerald-400/45 bg-emerald-500/15 px-3 text-sm font-bold text-emerald-100 hover:bg-emerald-500/25">
                    <span className="truncate">
                      {comboImagenArchivo ? comboImagenArchivo.name : comboForm.imagenUrl ? "Cambiar imagen del combo" : "Subir imagen obligatoria"}
                    </span>
                    <span className="shrink-0 text-xs uppercase tracking-wide">Seleccionar</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => setComboImagenArchivo(event.target.files?.[0] ?? null)} />
                  </label>
                </CampoConInfo>
                {comboForm.imagenUrl ? (
                  <div className="flex items-center gap-3 rounded-md border border-antiguo/10 bg-espresso p-2 text-xs text-antiguo/70">
                    <ImagenCatalogo url={comboForm.imagenUrl} nombre={comboForm.nombre || "Combo"} className="h-12 w-12" />
                    <span>Imagen actual del combo. Si seleccionas otra, se reemplaza al guardar.</span>
                  </div>
                ) : !comboImagenArchivo && comboForm.activo ? (
                  <p className="text-xs font-bold text-emerald-100">La imagen es obligatoria para combos activos.</p>
                ) : null}
                <div className="grid gap-2">
                  {comboForm.items.map((item, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_auto]">
                      <CampoConInfo info="comboItem">
                        <select value={item.producto_id} onChange={(event) => actualizarItemCombo(index, { producto_id: event.target.value })} className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                          <option value="">Item {index + 1}</option>
                          {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{etiquetaProducto(producto)}</option>)}
                        </select>
                      </CampoConInfo>
                      <CampoConInfo info="comboCantidad">
                        <input value={item.cantidad} onChange={(event) => actualizarItemCombo(index, { cantidad: event.target.value })} type="number" min="1" className="tap-target min-w-0 flex-1 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                      </CampoConInfo>
                      <button type="button" onClick={() => quitarItemCombo(index)} disabled={comboForm.items.length === 1} className="tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100 disabled:opacity-40">Quitar</button>
                    </div>
                  ))}
                  <button type="button" onClick={agregarItemCombo} className="tap-target rounded-md border border-antiguo/20 px-3 font-bold text-crema">Agregar item</button>
                </div>
                <CampoConInfo info="comboActivo">
                  <label className="flex flex-1 items-center gap-2 rounded-md border border-antiguo/15 bg-espresso px-3 py-2 text-sm text-antiguo/80"><input checked={comboForm.activo} onChange={(event) => setComboForm((actual) => ({ ...actual, activo: event.target.checked }))} type="checkbox" />Activo</label>
                </CampoConInfo>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button disabled={guardando || !comboForm.nombre || comboFormItemsValidos(comboForm).length === 0 || (comboForm.activo && !comboForm.imagenUrl && !comboImagenArchivo)} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">{comboForm.id ? "Actualizar combo" : "Guardar combo"}</button>
                  {comboForm.id ? <button type="button" onClick={cerrarAccionesInventario} className="tap-target rounded-md border border-antiguo/20 px-4 font-bold">Cancelar</button> : null}
                </div>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
        <div>
          <h3 className="text-lg font-black text-crema">Ajuste manual de stock</h3>
          <p className="text-sm text-antiguo/70">Herramienta administrativa independiente para corregir unidades de inventario.</p>
        </div>
        <form onSubmit={registrarAjuste} className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_auto]">
          <select value={ajusteProducto} onChange={(event) => setAjusteProducto(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="">Producto ajuste</option>
            {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{etiquetaProducto(producto)}</option>)}
          </select>
          <input value={ajusteCantidad} onChange={(event) => setAjusteCantidad(event.target.value)} type="number" placeholder="+/- unidades" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <select value={ajusteMotivo} onChange={(event) => setAjusteMotivo(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="">Motivo</option>
            {motivos.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.texto}</option>)}
          </select>
          <button disabled={guardando || !ajusteProducto || !ajusteCantidad || !ajusteMotivo} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">Registrar ajuste</button>
        </form>
      </section>

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
        <h3 className="text-lg font-black text-crema">Proveedores</h3>
        <form onSubmit={(event) => guardarProveedor(event)} className="mt-3 grid gap-2 lg:grid-cols-4">
          <input value={proveedorForm.nombre} onChange={(event) => setProveedorForm((actual) => ({ ...actual, nombre: event.target.value }))} placeholder="Nombre" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.nit} onChange={(event) => setProveedorForm((actual) => ({ ...actual, nit: event.target.value }))} placeholder="NIT/CC" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.contacto} onChange={(event) => setProveedorForm((actual) => ({ ...actual, contacto: event.target.value }))} placeholder="Contacto" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.telefono} onChange={(event) => setProveedorForm((actual) => ({ ...actual, telefono: event.target.value }))} placeholder="Telefono" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.correo} onChange={(event) => setProveedorForm((actual) => ({ ...actual, correo: event.target.value }))} placeholder="Correo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.direccion} onChange={(event) => setProveedorForm((actual) => ({ ...actual, direccion: event.target.value }))} placeholder="Direccion" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.observacion} onChange={(event) => setProveedorForm((actual) => ({ ...actual, observacion: event.target.value }))} placeholder="Observacion" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <div className="grid gap-2 sm:grid-cols-2">
            <button disabled={guardando || proveedorForm.nombre.length < 2} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{proveedorForm.id ? "Actualizar" : "Guardar"}</button>
            {proveedorForm.id ? <button type="button" onClick={() => setProveedorForm(proveedorInicial)} className="tap-target rounded-md border border-antiguo/20 px-4 font-bold">Cancelar</button> : null}
          </div>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[940px] text-left text-sm">
            <thead className="text-antiguo/70">
              <tr className="border-b border-antiguo/15">
                <th className="py-2 pr-3">Nombre</th>
                <th className="py-2 pr-3">NIT/CC</th>
                <th className="py-2 pr-3">Contacto</th>
                <th className="py-2 pr-3">Telefono</th>
                <th className="py-2 pr-3">Correo</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((proveedor) => (
                <tr key={proveedor.id} className="border-b border-antiguo/10">
                  <td className="py-3 pr-3 font-bold text-crema">{proveedor.nombre}</td>
                  <td className="py-3 pr-3">{proveedor.nit ?? "-"}</td>
                  <td className="py-3 pr-3">{proveedor.contacto ?? "-"}</td>
                  <td className="py-3 pr-3">{proveedor.telefono ?? "-"}</td>
                  <td className="py-3 pr-3">{proveedor.correo ?? "-"}</td>
                  <td className="py-3 pr-3">{proveedor.activo ? "Activo" : "Inactivo"}</td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setProveedorForm(proveedorAForm(proveedor))} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">Editar</button>
                      <button onClick={() => cambiarEstadoProveedor(proveedor, !proveedor.activo)} className="rounded-md border border-red-300/30 px-2 py-1 text-xs font-bold text-red-100">{proveedor.activo ? "Eliminar" : "Reactivar"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
