"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
type ComboItem = { producto_id: string; cantidad: number; activo?: boolean; productos?: { nombre?: string } | null };
type Combo = { id: string; nombre: string; precio_venta: number; activo: boolean; combo_items?: ComboItem[] };
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
  presentacion_compra: string | null;
  factor_compra: number | null;
  activo: boolean;
  componentes: { producto_id: string; producto: string; cantidad: number; stock_actual: number }[] | null;
};

type ResumenValorInventario = {
  productos_activos: number;
  unidades_stock: number;
  valor_costo: number;
  valor_venta: number;
  margen_potencial: number;
  productos_sin_costo: number;
};
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
type ProductoForm = { id: string | null; nombre: string; categoriaId: string; precio: string; costo: string; codigo: string; minimo: string; presentacion: string; factor: string; activo: boolean };
type StockInlineForm = { nombre: string; precio: string; costo: string; stock: string; minimo: string };
type EstadoStockTab = "activos" | "inactivos";
type FiltroStockAdmin = "todos" | "en_cero" | "bajo" | "disponible" | "rango";
type TipoDescuentoFiltro = "todos" | "venta" | "ajuste" | "merma" | "consumo_interno";
type OrdenStockAdmin = "prioridad" | "stock_asc" | "stock_desc" | "nombre" | "precio_asc" | "precio_desc" | "costo_asc" | "costo_desc" | "estado";
type ComboFormItem = { producto_id: string; cantidad: string };
type ComboForm = { id: string | null; nombre: string; precio: string; items: ComboFormItem[]; activo: boolean };
type ProveedorForm = { id: string | null; nombre: string; nit: string; contacto: string; telefono: string; correo: string; direccion: string; observacion: string; activo: boolean };

const productoInicial: ProductoForm = { id: null, nombre: "", categoriaId: "", precio: "", costo: "", codigo: "", minimo: "0", presentacion: "unidad", factor: "1", activo: true };
const comboInicial: ComboForm = { id: null, nombre: "", precio: "", items: [{ producto_id: "", cantidad: "1" }], activo: true };
const proveedorInicial: ProveedorForm = { id: null, nombre: "", nit: "", contacto: "", telefono: "", correo: "", direccion: "", observacion: "", activo: true };

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

function fechaHoraCorta(fecha: string) {
  return new Date(fecha).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
  const [guardando, setGuardando] = useState(false);

  const [categoriaNueva, setCategoriaNueva] = useState("");
  const [productoForm, setProductoForm] = useState<ProductoForm>(productoInicial);
  const [comboForm, setComboForm] = useState<ComboForm>(comboInicial);
  const [proveedorForm, setProveedorForm] = useState<ProveedorForm>(proveedorInicial);
  const [compraProveedor, setCompraProveedor] = useState("");
  const [compraProducto, setCompraProducto] = useState("");
  const [compraModo, setCompraModo] = useState<"unidades" | "presentacion">("unidades");
  const [compraCantidad, setCompraCantidad] = useState("");
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
      supabase.from("productos").select("id,nombre,categoria_id,precio_venta,costo_unitario_actual,codigo_interno,stock_actual,stock_minimo,presentacion_compra,factor_compra,activo").order("nombre"),
      supabase.from("categorias").select("id,nombre").eq("activa", true).order("nombre"),
      supabase.from("proveedores").select("id,nombre,nit,contacto,telefono,correo,direccion,observacion,activo").order("nombre"),
      supabase.from("motivos").select("id,texto").eq("tipo", "ajuste_inventario").eq("activo", true).order("texto"),
      supabase.from("combos").select("id,nombre,precio_venta,activo,combo_items(id,producto_id,cantidad,activo,productos(nombre))").order("nombre"),
      supabase.from("v_catalogo_items_stock").select("*").order("orden_tipo").order("nombre"),
      supabase.from("v_admin_historial_descuentos_item").select("*").order("timestamp", { ascending: false }).limit(150),
      supabase.from("v_admin_resumen_valor_inventario").select("*").maybeSingle(),
    ]);

    const errores = [productosRes.error, categoriasRes.error, proveedoresRes.error, motivosRes.error, combosRes.error, itemsStockRes.error, movimientosRes.error, resumenInventarioRes.error].filter(Boolean);
    if (errores.length > 0) {
      setMensaje(errores[0]?.message ?? "No se pudo cargar catalogo y stock.");
      return;
    }

    setProductos((productosRes.data ?? []) as Producto[]);
    setCategorias((categoriasRes.data ?? []) as Categoria[]);
    setProveedores((proveedoresRes.data ?? []) as Proveedor[]);
    setMotivos((motivosRes.data ?? []) as Motivo[]);
    setCombos((combosRes.data ?? []) as unknown as Combo[]);
    setItemsStock((itemsStockRes.data ?? []) as ItemStock[]);
    setMovimientosDescuento((movimientosRes.data ?? []) as MovimientoDescuento[]);
    setResumenInventario((resumenInventarioRes.data ?? null) as ResumenValorInventario | null);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const productosActivos = productos.filter((producto) => producto.activo);
  const productoCompraSeleccionado = productos.find((producto) => producto.id === compraProducto) ?? null;
  const costoCompraCatalogo = Number(productoCompraSeleccionado?.costo_unitario_actual ?? 0);
  const factorCompraAplicado = compraModo === "presentacion" ? Number(productoCompraSeleccionado?.factor_compra ?? 1) : 1;
  const unidadesCompraEstimadas = Number(compraCantidad || 0) * factorCompraAplicado;
  const totalCompraEstimado = unidadesCompraEstimadas * costoCompraCatalogo;
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
    if (error) setMensaje(error.message);
    else {
      setMensaje(exito);
      await cargar();
    }
    setGuardando(false);
  }

  async function crearCategoria(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(() => supabase.rpc("crear_categoria_catalogo", { p_nombre: categoriaNueva }), "Categoria guardada.");
    setCategoriaNueva("");
  }

  async function guardarProducto(event?: FormEvent<HTMLFormElement>, form = productoForm) {
    event?.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("guardar_producto_catalogo", {
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
      }),
      form.activo ? "Producto guardado." : "Producto eliminado del catalogo.",
    );
    setProductoForm(productoInicial);
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
      activo,
    });
  }

  async function registrarCompra(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!productoCompraSeleccionado || costoCompraCatalogo <= 0) {
      setMensaje("Configura primero el costo de compra del producto en catalogo.");
      return;
    }

    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("registrar_compra", {
        p_proveedor_id: compraProveedor,
        p_items: [{
          producto_id: compraProducto,
          modo: compraModo,
          cantidad_ingresada: Number(compraCantidad),
        }],
        p_fecha: new Date().toISOString().slice(0, 10),
        p_observacion: null,
      }),
      "Compra registrada con costo de catalogo y stock actualizado.",
    );
    setCompraCantidad("");
  }
  async function guardarCombo(event?: FormEvent<HTMLFormElement>, form = comboForm) {
    event?.preventDefault();
    const items = comboFormItemsValidos(form);

    if (items.length === 0) {
      setMensaje("Agrega al menos un item valido al combo.");
      return;
    }

    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("crear_combo_catalogo", {
        p_combo_id: form.id,
        p_nombre: form.nombre,
        p_precio_venta: Number(form.precio),
        p_items: items,
        p_activo: form.activo,
      }),
      form.activo ? "Combo guardado." : "Combo eliminado del catalogo.",
    );
    setComboForm(comboInicial);
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
      activo: combo.activo,
    });
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
      activo,
    });
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
    const stock = Number(valores?.stock ?? item.stock_disponible ?? 0);
    const minimo = Number(valores?.minimo ?? item.stock_minimo ?? 0);

    if (nombre.length < 2) {
      setMensaje("El nombre debe tener al menos 2 caracteres.");
      return;
    }

    if (!Number.isFinite(precio) || precio < 0 || !Number.isFinite(costo) || costo < 0) {
      setMensaje("Precio de venta y precio de compra deben ser mayores o iguales a cero.");
      return;
    }

    if (item.tipo_item === "producto" && (!Number.isInteger(stock) || !Number.isInteger(minimo) || stock < 0 || minimo < 0)) {
      setMensaje("Stock y minimo deben ser numeros enteros mayores o iguales a cero.");
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
          p_stock_actual: stock,
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


  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-2 border-b border-antiguo/15 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">F3 Inventario</p>
          <h2 className="text-2xl font-black text-crema">Catalogo, compras y stock</h2>
        </div>
        <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Refrescar</button>
      </div>

      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm font-semibold">{mensaje}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">Productos activos</p>
          <p className="mt-1 text-2xl font-black text-crema">{resumenInventario?.productos_activos ?? productosActivos.length}</p>
        </div>
        <div className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">Unidades en stock</p>
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
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Producto</h3>
          <form onSubmit={crearCategoria} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input value={categoriaNueva} onChange={(event) => setCategoriaNueva(event.target.value)} placeholder="Nueva categoria" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <button disabled={guardando || categoriaNueva.length < 2} className="tap-target rounded-md border border-oro/30 px-3 font-bold text-dorado disabled:opacity-50">Crear</button>
          </form>
          <form onSubmit={(event) => guardarProducto(event)} className="mt-4 grid gap-2">
            <input value={productoForm.nombre} onChange={(event) => setProductoForm((actual) => ({ ...actual, nombre: event.target.value }))} placeholder="Nombre" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <select value={productoForm.categoriaId} onChange={(event) => setProductoForm((actual) => ({ ...actual, categoriaId: event.target.value }))} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Categoria</option>
              {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nombre}</option>)}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={productoForm.precio} onChange={(event) => setProductoForm((actual) => ({ ...actual, precio: event.target.value }))} type="number" placeholder="Precio venta" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoForm.costo} onChange={(event) => setProductoForm((actual) => ({ ...actual, costo: event.target.value }))} type="number" placeholder="Costo unidad" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={productoForm.codigo} onChange={(event) => setProductoForm((actual) => ({ ...actual, codigo: event.target.value }))} placeholder="Codigo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoForm.minimo} onChange={(event) => setProductoForm((actual) => ({ ...actual, minimo: event.target.value }))} type="number" placeholder="Stock minimo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={productoForm.presentacion} onChange={(event) => setProductoForm((actual) => ({ ...actual, presentacion: event.target.value }))} placeholder="Presentacion compra" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoForm.factor} onChange={(event) => setProductoForm((actual) => ({ ...actual, factor: event.target.value }))} type="number" min="1" placeholder="Factor" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <label className="flex items-center gap-2 text-sm text-antiguo/80"><input checked={productoForm.activo} onChange={(event) => setProductoForm((actual) => ({ ...actual, activo: event.target.checked }))} type="checkbox" />Activo</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button disabled={guardando || productoForm.nombre.length < 2} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{productoForm.id ? "Actualizar producto" : "Guardar producto"}</button>
              {productoForm.id ? <button type="button" onClick={() => setProductoForm(productoInicial)} className="tap-target rounded-md border border-antiguo/20 px-4 font-bold">Cancelar</button> : null}
            </div>
          </form>
        </section>
        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Compra</h3>
          <form onSubmit={registrarCompra} className="mt-3 grid gap-2">
            <select value={compraProveedor} onChange={(event) => setCompraProveedor(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Proveedor obligatorio</option>
              {proveedoresActivos.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
            </select>
            <select value={compraProducto} onChange={(event) => setCompraProducto(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Producto</option>
              {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
            </select>
            <select value={compraModo} onChange={(event) => setCompraModo(event.target.value as "unidades" | "presentacion")} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="unidades">Unidades</option>
              <option value="presentacion">Presentacion de compra</option>
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={compraCantidad} onChange={(event) => setCompraCantidad(event.target.value)} type="number" min="1" placeholder="Cantidad" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <div className="rounded-md border border-antiguo/20 bg-carbon px-3 py-2 text-sm">
                <p className="text-xs font-bold text-antiguo/60">Costo catalogo</p>
                <p className={costoCompraCatalogo > 0 ? "font-black text-dorado" : "font-black text-red-100"}>{productoCompraSeleccionado ? formatoCOP(costoCompraCatalogo) : "Selecciona producto"}</p>
              </div>
            </div>
            {productoCompraSeleccionado ? (
              <div className={costoCompraCatalogo > 0 ? "rounded-md border border-antiguo/10 bg-carbon p-3 text-sm text-antiguo/80" : "rounded-md border border-red-300/30 bg-red-950/20 p-3 text-sm text-red-100"}>
                {costoCompraCatalogo > 0
                  ? `Entraran ${unidadesCompraEstimadas || 0} unidad(es). Total estimado: ${formatoCOP(totalCompraEstimado)}.`
                  : "Este producto no tiene costo configurado. Editalo en la tabla antes de registrar compra."}
              </div>
            ) : null}
            <button disabled={guardando || !compraProveedor || !compraProducto || !compraCantidad || costoCompraCatalogo <= 0} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Registrar compra</button>
          </form>
        </section>

        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Combo y ajuste</h3>
          <form onSubmit={(event) => guardarCombo(event)} className="mt-3 grid gap-2">
            <input value={comboForm.nombre} onChange={(event) => setComboForm((actual) => ({ ...actual, nombre: event.target.value }))} placeholder="Nombre combo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <input value={comboForm.precio} onChange={(event) => setComboForm((actual) => ({ ...actual, precio: event.target.value }))} type="number" placeholder="Precio combo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <div className="grid gap-2">
              {comboForm.items.map((item, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_84px_auto]">
                  <select value={item.producto_id} onChange={(event) => actualizarItemCombo(index, { producto_id: event.target.value })} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                    <option value="">Item {index + 1}</option>
                    {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
                  </select>
                  <input value={item.cantidad} onChange={(event) => actualizarItemCombo(index, { cantidad: event.target.value })} type="number" min="1" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
                  <button type="button" onClick={() => quitarItemCombo(index)} disabled={comboForm.items.length === 1} className="tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100 disabled:opacity-40">Quitar</button>
                </div>
              ))}
              <button type="button" onClick={agregarItemCombo} className="tap-target rounded-md border border-antiguo/20 px-3 font-bold text-crema">Agregar item</button>
            </div>
            <label className="flex items-center gap-2 text-sm text-antiguo/80"><input checked={comboForm.activo} onChange={(event) => setComboForm((actual) => ({ ...actual, activo: event.target.checked }))} type="checkbox" />Activo</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button disabled={guardando || !comboForm.nombre || comboFormItemsValidos(comboForm).length === 0} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">{comboForm.id ? "Actualizar combo" : "Guardar combo"}</button>
              {comboForm.id ? <button type="button" onClick={() => setComboForm(comboInicial)} className="tap-target rounded-md border border-antiguo/20 px-4 font-bold">Cancelar</button> : null}
            </div>
          </form>

          <form onSubmit={registrarAjuste} className="mt-4 grid gap-2 border-t border-antiguo/10 pt-4">
            <select value={ajusteProducto} onChange={(event) => setAjusteProducto(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Producto ajuste</option>
              {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
            </select>
            <input value={ajusteCantidad} onChange={(event) => setAjusteCantidad(event.target.value)} type="number" placeholder="+/- unidades" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <select value={ajusteMotivo} onChange={(event) => setAjusteMotivo(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Motivo</option>
              {motivos.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.texto}</option>)}
            </select>
            <button disabled={guardando || !ajusteProducto || !ajusteCantidad || !ajusteMotivo} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">Registrar ajuste</button>
          </form>
        </section>
      </div>
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
              <option value="en_cero">Stock en cero</option>
              <option value="bajo">Stock bajo</option>
              <option value="disponible">Disponible</option>
              <option value="rango">Rango manual</option>
            </select>
            <input value={stockMinFiltro} onChange={(event) => setStockMinFiltro(event.target.value)} type="number" min="0" inputMode="numeric" placeholder="Stock min" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
            <input value={stockMaxFiltro} onChange={(event) => setStockMaxFiltro(event.target.value)} type="number" min="0" inputMode="numeric" placeholder="Stock max" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
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
                    {editandoStock && item.tipo_item === "producto" ? (
                      <input type="number" min="0" inputMode="numeric" value={stockInline[item.item_id]?.stock ?? String(item.stock_disponible ?? 0)} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { nombre: item.nombre, precio: String(item.precio_venta ?? 0), costo: String(item.costo_estimado ?? 0), minimo: String(item.stock_minimo ?? 0) }), stock: event.target.value } }))} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-2 text-crema" />
                    ) : <span className="mt-1 block rounded-md border border-antiguo/10 bg-espresso p-2 text-crema">{item.stock_disponible ?? "-"}</span>}
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

                <p className="mt-3 break-words text-xs text-antiguo/75">{item.tipo_item === "producto" ? `${item.presentacion_compra ?? "unidad"} x${item.factor_compra ?? 1}` : (item.componentes ?? []).map((componente) => `${componente.cantidad} x ${componente.producto}`).join(", ")}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {editandoStock ? (
                    <>
                      <button disabled={guardando} onClick={() => guardarStockInline(item)} className="tap-target rounded-md bg-oro px-3 text-xs font-black text-carbon disabled:opacity-50">Guardar</button>
                      <button disabled={guardando} onClick={() => cancelarEdicionStock(item.item_id)} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold disabled:opacity-50">Cancelar</button>
                    </>
                  ) : null}
                  {!editandoStock ? <button onClick={() => iniciarEdicionStock(item)} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold">Editar</button> : null}
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
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="text-antiguo/70">
              <tr className="border-b border-antiguo/15">
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
                    <td className="py-3 pr-3 font-bold text-dorado">{item.tipo_item === "producto" ? "Producto" : "Combo"}</td>
                    <td className="py-3 pr-3 font-bold text-crema">{editandoStock ? <input value={stockInline[item.item_id]?.nombre ?? item.nombre} onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { precio: String(item.precio_venta ?? 0), costo: String(item.costo_estimado ?? 0), stock: String(item.stock_disponible ?? 0), minimo: String(item.stock_minimo ?? 0) }), nombre: event.target.value } }))} className="tap-target w-56 rounded-md border border-antiguo/20 bg-carbon px-2 text-crema" /> : item.nombre}</td>
                    <td className="py-3 pr-3">{item.categoria ?? "-"}</td>
                    <td className={Number(item.stock_disponible ?? 0) <= Number(item.stock_minimo ?? -1) ? "py-3 pr-3 font-black text-dorado" : "py-3 pr-3"}>
                      {editandoStock && item.tipo_item === "producto" ? (
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={stockInline[item.item_id]?.stock ?? String(item.stock_disponible ?? 0)}
                          onChange={(event) => setStockInline((actual) => ({ ...actual, [item.item_id]: { ...(actual[item.item_id] ?? { nombre: item.nombre, precio: String(item.precio_venta ?? 0), costo: String(item.costo_estimado ?? 0), minimo: String(item.stock_minimo ?? 0) }), stock: event.target.value } }))}
                          className="tap-target w-24 rounded-md border border-antiguo/20 bg-carbon px-2 text-crema"
                        />
                      ) : item.stock_disponible ?? "-"}
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
                      {item.tipo_item === "producto" ? `${item.presentacion_compra ?? "unidad"} x${item.factor_compra ?? 1}` : (item.componentes ?? []).map((componente) => `${componente.cantidad} x ${componente.producto}`).join(", ")}
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
            {productos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
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
