"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Proveedor = {
  id: string;
  nombre: string;
};

type Categoria = {
  id: string;
  nombre: string;
};

type ProductoCatalogo = {
  id: string;
  nombre: string;
  precio_venta: number;
  costo_unitario_actual: number;
  codigo_interno: string | null;
  stock_actual: number;
  stock_minimo: number;
  presentacion_compra: string;
  factor_compra: number;
};

type CapturaCompraResumen = {
  id: string;
  estado: string;
  fecha_ingreso: string;
  created_at: string;
  aprobado_at: string | null;
  confirmado_at: string | null;
  eliminado_at: string | null;
  storage_bucket: string | null;
  storage_path: string;
  nombre_archivo: string | null;
  proveedor_id: string | null;
  proveedor: string | null;
  subido_por: string | null;
  aprobado_por: string | null;
  compra_id: string | null;
  items_total: number;
  items_confirmados: number;
  items_pendientes: number;
  unidades_total: number;
  costo_total: number;
};

type CapturaCompraLinea = {
  id: string;
  captura_id: string;
  orden: number;
  texto_original: string | null;
  producto_nombre_detectado: string | null;
  producto_id: string | null;
  modo: "unidades" | "presentacion";
  cantidad_ingresada: number;
  factor_aplicado: number;
  unidades_resultantes: number;
  costo_unitario_catalogo: number;
  precio_venta_catalogo: number;
  subtotal_costo: number;
  stock_actual_snapshot: number | null;
  stock_proyectado: number | null;
  confianza_ia: number;
  puntaje_match: number;
  requiere_revision: boolean;
  precio_catalogo_confirmado: boolean;
  estado: string;
  observacion: string | null;
  productos?: { nombre?: string; presentacion_compra?: string } | null;
};

type EntradaInventarioOcr = {
  captura_id: string;
  compra_id: string | null;
  compra_item_id: string | null;
  movimiento_id: string | null;
  fecha_ingreso: string;
  registrado_at: string;
  confirmado_at: string | null;
  nombre_archivo: string | null;
  proveedor_id: string | null;
  proveedor: string | null;
  producto_id: string;
  producto: string;
  orden: number;
  modo: "unidades" | "presentacion";
  cantidad_ingresada: number;
  factor_aplicado: number;
  unidades_resultantes: number;
  costo_unitario_catalogo: number;
  precio_venta_catalogo: number;
  subtotal_costo: number;
  stock_actual_snapshot: number | null;
  stock_resultante: number | null;
  subido_por: string | null;
  aprobado_por: string | null;
};

type LineaEliminadaPorCaptura = Record<string, string[]>;
type FiltroCompra = "pendientes" | "todas" | "confirmadas" | "rechazadas";
type FiltrosBusqueda = { proveedorId: string; fechaDesde: string; fechaHasta: string; busqueda: string };

type AprobarCompraResultado = {
  compra_id?: string;
  items_confirmados?: number;
  total?: number | string;
};

type RechazarCompraResultado = {
  lineas_rechazadas?: number;
};

function fechaInputHoy() {
  const partes = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

function fechaCorta(fecha?: string | null) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fechaDia(fecha?: string | null) {
  if (!fecha) return "Sin fecha";
  return new Date(`${fecha}T12:00:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function estadoCompra(estado: string) {
  if (estado === "confirmada") return { texto: "Confirmada", clase: "border-green-300/40 bg-green-950/25 text-green-100" };
  if (estado === "pendiente_aprobacion") return { texto: "Pendiente", clase: "border-blue-200/50 bg-blue-950/25 text-blue-100" };
  if (estado === "procesada") return { texto: "Procesada", clase: "border-white/45 bg-white/10 text-white" };
  if (estado === "requiere_revision") return { texto: "Revision", clase: "border-oro/40 bg-oro/10 text-dorado" };
  if (estado === "eliminada" || estado === "rechazada") return { texto: "Eliminada", clase: "border-red-300/35 bg-red-950/25 text-red-100" };
  if (estado === "error") return { texto: "Error", clase: "border-red-300/35 bg-red-950/25 text-red-100" };
  return { texto: "Pendiente OCR", clase: "border-antiguo/20 bg-carbon text-antiguo/80" };
}

function codigoCorto(id?: string | null) {
  return id ? id.slice(0, 8) : "-";
}

function porcentaje(valor: number) {
  return `${Math.round(Number(valor ?? 0) * 100)}%`;
}

function nombreLinea(linea: CapturaCompraLinea) {
  return linea.productos?.nombre ?? linea.producto_nombre_detectado ?? "Producto sin match";
}

function esNuevo(id: string) {
  return id.startsWith("nuevo:");
}

function nuevoId() {
  return `nuevo:${crypto.randomUUID()}`;
}

function capturaEditable(captura: CapturaCompraResumen) {
  return !["confirmada", "eliminada", "rechazada", "pendiente_aprobacion"].includes(captura.estado) && !captura.compra_id;
}

function capturaRechazable(captura: CapturaCompraResumen) {
  return !["confirmada", "eliminada", "rechazada"].includes(captura.estado) && !captura.compra_id;
}

function problemasLinea(linea: CapturaCompraLinea) {
  const problemas: string[] = [];
  if (!linea.producto_id) problemas.push("producto sin match");
  if (Number(linea.cantidad_ingresada ?? 0) <= 0) problemas.push("cantidad invalida");
  if (Number(linea.factor_aplicado ?? 0) <= 0) problemas.push("factor invalido");
  if (Number(linea.unidades_resultantes ?? 0) <= 0) problemas.push("unidades invalidas");
  if (Number(linea.costo_unitario_catalogo ?? 0) <= 0) problemas.push("costo de compra sin configurar");
  if (Number(linea.precio_venta_catalogo ?? 0) <= 0) problemas.push("precio de venta sin configurar");
  if (!linea.precio_catalogo_confirmado) problemas.push("falta confirmar costo/precio");
  return problemas;
}

function recalcularLinea(linea: CapturaCompraLinea, producto?: ProductoCatalogo | null): CapturaCompraLinea {
  const cantidad = Math.max(1, Math.round(Number(linea.cantidad_ingresada ?? 1)));
  const factor = Math.max(1, Math.round(Number(linea.factor_aplicado ?? 1)));
  const unidades = cantidad * factor;
  const costo = Math.max(0, Math.round(Number(producto?.costo_unitario_actual ?? linea.costo_unitario_catalogo ?? 0)));
  const precio = Math.max(0, Math.round(Number(producto?.precio_venta ?? linea.precio_venta_catalogo ?? 0)));
  const stockActual = producto ? Math.max(0, Math.round(Number(producto.stock_actual ?? 0))) : linea.stock_actual_snapshot;
  const stockProyectado = stockActual === null || stockActual === undefined ? null : stockActual + unidades;
  const siguiente = {
    ...linea,
    productos: producto ? { nombre: producto.nombre, presentacion_compra: producto.presentacion_compra } : linea.productos,
    cantidad_ingresada: cantidad,
    factor_aplicado: factor,
    unidades_resultantes: unidades,
    costo_unitario_catalogo: costo,
    precio_venta_catalogo: precio,
    subtotal_costo: unidades * costo,
    stock_actual_snapshot: stockActual ?? null,
    stock_proyectado: stockProyectado,
  };
  const problemas = problemasLinea(siguiente);
  return {
    ...siguiente,
    requiere_revision: problemas.length > 0,
    estado: problemas.length > 0 ? "requiere_revision" : "lista",
    observacion: problemas.length > 0 ? problemas.join(" | ") : null,
  };
}

function lineasListasParaAprobar(lineas: CapturaCompraLinea[], productos: ProductoCatalogo[]) {
  if (lineas.length === 0) return false;
  return lineas.every((linea) => {
    const producto = linea.producto_id ? productos.find((item) => item.id === linea.producto_id) ?? null : null;
    const recalculada = recalcularLinea(linea, producto);
    return Boolean(recalculada.producto_id) && !recalculada.requiere_revision && recalculada.precio_catalogo_confirmado;
  });
}

function capturaCompraFiltrada(captura: CapturaCompraResumen, filtro: FiltroCompra) {
  if (filtro === "pendientes") return !["confirmada", "eliminada", "rechazada"].includes(captura.estado) && !captura.compra_id;
  if (filtro === "confirmadas") return captura.estado === "confirmada" || Boolean(captura.compra_id);
  if (filtro === "rechazadas") return captura.estado === "rechazada" || captura.estado === "eliminada";
  return true;
}

function textoCoincide(valor: string, busqueda: string) {
  return valor.toLocaleLowerCase("es").includes(busqueda.trim().toLocaleLowerCase("es"));
}

function fechaEnRango(fecha: string | null | undefined, filtros: FiltrosBusqueda) {
  if (!fecha) return false;
  if (filtros.fechaDesde && fecha < filtros.fechaDesde) return false;
  if (filtros.fechaHasta && fecha > filtros.fechaHasta) return false;
  return true;
}

function capturaCumpleBusqueda(captura: CapturaCompraResumen, filtros: FiltrosBusqueda) {
  if (filtros.proveedorId && captura.proveedor_id !== filtros.proveedorId) return false;
  if (!fechaEnRango(captura.fecha_ingreso, filtros)) return false;
  const busqueda = filtros.busqueda.trim();
  if (!busqueda) return true;
  return textoCoincide([
    captura.proveedor,
    captura.nombre_archivo,
    captura.compra_id,
    captura.id,
  ].filter(Boolean).join(" "), busqueda);
}

function entradaCumpleBusqueda(entrada: EntradaInventarioOcr, filtros: FiltrosBusqueda) {
  if (filtros.proveedorId && entrada.proveedor_id !== filtros.proveedorId) return false;
  if (!fechaEnRango(entrada.fecha_ingreso, filtros)) return false;
  const busqueda = filtros.busqueda.trim();
  if (!busqueda) return true;
  return textoCoincide([
    entrada.proveedor,
    entrada.producto,
    entrada.nombre_archivo,
    entrada.compra_id,
    entrada.movimiento_id,
    entrada.captura_id,
  ].filter(Boolean).join(" "), busqueda);
}

export function CapturasCompraAdminPanel() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [capturas, setCapturas] = useState<CapturaCompraResumen[]>([]);
  const [lineasPorCaptura, setLineasPorCaptura] = useState<Record<string, CapturaCompraLinea[]>>({});
  const [lineasEliminadas, setLineasEliminadas] = useState<LineaEliminadaPorCaptura>({});
  const [entradasAuditoria, setEntradasAuditoria] = useState<EntradaInventarioOcr[]>([]);
  const [imagenes, setImagenes] = useState<Record<string, string | null>>({});
  const [foto, setFoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState("");
  const [proveedorFiltro, setProveedorFiltro] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [fechaIngreso, setFechaIngreso] = useState(fechaInputHoy);
  const [observacion, setObservacion] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [filtro, setFiltro] = useState<FiltroCompra>("pendientes");
  const camaraInputRef = useRef<HTMLInputElement | null>(null);
  const galeriaInputRef = useRef<HTMLInputElement | null>(null);

  const filtrosBusqueda = useMemo(() => ({ proveedorId: proveedorFiltro, fechaDesde, fechaHasta, busqueda }), [busqueda, fechaDesde, fechaHasta, proveedorFiltro]);
  const capturasVisibles = useMemo(() => capturas.filter((captura) => capturaCompraFiltrada(captura, filtro) && capturaCumpleBusqueda(captura, filtrosBusqueda)), [capturas, filtro, filtrosBusqueda]);
  const entradasVisibles = useMemo(() => entradasAuditoria.filter((entrada) => entradaCumpleBusqueda(entrada, filtrosBusqueda)), [entradasAuditoria, filtrosBusqueda]);
  const resumen = useMemo(() => ({
    pendientes: capturas.filter((captura) => capturaCompraFiltrada(captura, "pendientes")).length,
    confirmadas: capturas.filter((captura) => capturaCompraFiltrada(captura, "confirmadas")).length,
    rechazadas: capturas.filter((captura) => capturaCompraFiltrada(captura, "rechazadas")).length,
    entradas: entradasAuditoria.length,
    total: capturas.length,
  }), [capturas, entradasAuditoria]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const [{ data: proveedoresData, error: proveedoresError }, { data: productosData, error: productosError }, { data: categoriasData, error: categoriasError }, { data: capturasData, error: capturasError }, { data: entradasData, error: entradasError }] = await Promise.all([
        supabase.from("proveedores").select("id,nombre").eq("activo", true).order("nombre"),
        supabase.from("productos").select("id,nombre,precio_venta,costo_unitario_actual,codigo_interno,stock_actual,stock_minimo,presentacion_compra,factor_compra").eq("activo", true).order("nombre"),
        supabase.from("categorias").select("id,nombre").eq("activa", true).order("nombre"),
        supabase.from("v_admin_capturas_compra_aprobacion").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("v_admin_entradas_inventario_ocr").select("*").order("registrado_at", { ascending: false }).limit(120),
      ]);

      if (proveedoresError) throw new Error(proveedoresError.message);
      if (productosError) throw new Error(productosError.message);
      if (categoriasError) throw new Error(categoriasError.message);
      if (capturasError) throw new Error(capturasError.message);
      if (entradasError) throw new Error(entradasError.message);

      const lista = (capturasData ?? []) as CapturaCompraResumen[];
      setProveedores((proveedoresData ?? []) as Proveedor[]);
      setProductos((productosData ?? []) as ProductoCatalogo[]);
      setCategorias((categoriasData ?? []) as Categoria[]);
      setCapturas(lista);
      setEntradasAuditoria((entradasData ?? []) as EntradaInventarioOcr[]);
      const ids = lista.map((captura) => captura.id);

      const { data: lineasData, error: lineasError } = ids.length > 0
        ? await supabase
            .from("captura_compra_lineas")
            .select("*, productos(nombre,presentacion_compra)")
            .in("captura_id", ids)
            .order("orden")
        : { data: [], error: null };

      if (lineasError) throw new Error(lineasError.message);

      const agrupadas = ((lineasData ?? []) as CapturaCompraLinea[]).reduce<Record<string, CapturaCompraLinea[]>>((acc, linea) => {
        acc[linea.captura_id] = [...(acc[linea.captura_id] ?? []), linea];
        return acc;
      }, {});
      setLineasPorCaptura(agrupadas);

      const firmadas = await Promise.all(
        lista.map(async (captura) => {
          const bucket = captura.storage_bucket ?? "capturas-compras";
          const { data } = await supabase.storage.from(bucket).createSignedUrl(captura.storage_path, 60 * 60);
          return [captura.id, data?.signedUrl ?? null] as const;
        }),
      );
      setImagenes(Object.fromEntries(firmadas));
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo cargar solicitudes de inventario.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (!foto) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(foto);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  function seleccionarArchivo(file: File | null) {
    setFoto(file);
      setMensaje(null);
  }

  function actualizarCaptura(capturaId: string, cambios: Partial<CapturaCompraResumen>) {
    setCapturas((actual) => actual.map((captura) => (captura.id === capturaId ? { ...captura, ...cambios } : captura)));
  }

  function actualizarLinea(capturaId: string, lineaId: string, cambios: Partial<CapturaCompraLinea>) {
    setLineasPorCaptura((actual) => {
      const lineas = actual[capturaId] ?? [];
      return {
        ...actual,
        [capturaId]: lineas.map((linea) => {
          if (linea.id !== lineaId) return linea;
          const siguiente = { ...linea, ...cambios };
          const producto = siguiente.producto_id ? productos.find((item) => item.id === siguiente.producto_id) ?? null : null;
          return recalcularLinea(siguiente, producto);
        }),
      };
    });
  }

  function seleccionarProducto(capturaId: string, linea: CapturaCompraLinea, productoId: string) {
    const producto = productos.find((item) => item.id === productoId) ?? null;
    const factor = producto && linea.modo === "presentacion" ? producto.factor_compra : 1;
    setLineasPorCaptura((actual) => ({
      ...actual,
      [capturaId]: (actual[capturaId] ?? []).map((item) => (
        item.id === linea.id
          ? recalcularLinea({
              ...item,
              producto_id: producto?.id ?? null,
              producto_nombre_detectado: producto?.nombre ?? item.producto_nombre_detectado,
              factor_aplicado: factor,
              precio_catalogo_confirmado: false,
              puntaje_match: producto ? Math.max(Number(item.puntaje_match ?? 0), 1) : 0,
            }, producto)
          : item
      )),
    }));
  }

  function cambiarModo(capturaId: string, linea: CapturaCompraLinea, modo: "unidades" | "presentacion") {
    const producto = linea.producto_id ? productos.find((item) => item.id === linea.producto_id) ?? null : null;
    actualizarLinea(capturaId, linea.id, {
      modo,
      factor_aplicado: producto && modo === "presentacion" ? producto.factor_compra : 1,
      precio_catalogo_confirmado: false,
    });
  }

  function agregarLinea(captura: CapturaCompraResumen) {
    const lineas = lineasPorCaptura[captura.id] ?? [];
    const linea: CapturaCompraLinea = {
      id: nuevoId(),
      captura_id: captura.id,
      orden: lineas.length + 1,
      texto_original: null,
      producto_nombre_detectado: null,
      producto_id: null,
      modo: "unidades",
      cantidad_ingresada: 1,
      factor_aplicado: 1,
      unidades_resultantes: 1,
      costo_unitario_catalogo: 0,
      precio_venta_catalogo: 0,
      subtotal_costo: 0,
      stock_actual_snapshot: null,
      stock_proyectado: null,
      confianza_ia: 0,
      puntaje_match: 0,
      requiere_revision: true,
      precio_catalogo_confirmado: false,
      estado: "requiere_revision",
      observacion: "producto sin match | costo de compra sin configurar | precio de venta sin configurar | falta confirmar costo/precio",
      productos: null,
    };

    setLineasPorCaptura((actual) => ({ ...actual, [captura.id]: [...lineas, linea] }));
  }

  function quitarLinea(capturaId: string, linea: CapturaCompraLinea) {
    if (!esNuevo(linea.id)) {
      setLineasEliminadas((actual) => ({ ...actual, [capturaId]: [...(actual[capturaId] ?? []), linea.id] }));
    }
    setLineasPorCaptura((actual) => ({ ...actual, [capturaId]: (actual[capturaId] ?? []).filter((item) => item.id !== linea.id) }));
  }

  function confirmarPrecio(capturaId: string, linea: CapturaCompraLinea) {
    actualizarLinea(capturaId, linea.id, { precio_catalogo_confirmado: true });
  }

  async function crearProductoDesdeLinea(capturaId: string, linea: CapturaCompraLinea) {
    const nombre = (linea.producto_nombre_detectado ?? linea.texto_original ?? "").trim();
    if (nombre.length < 2) {
      setMensaje("La linea no tiene un nombre suficiente para crear producto.");
      return;
    }
    if (!window.confirm(`Crear producto "${nombre}" en catalogo? Quedara con costo y precio en 0 para completarlo antes de aprobar.`)) return;

    setGuardando(true);
    setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("guardar_producto_catalogo", {
        p_producto_id: null,
        p_nombre: nombre,
        p_categoria_id: categorias[0]?.id ?? null,
        p_precio_venta: 0,
        p_costo_unitario: 0,
        p_codigo_interno: null,
        p_stock_minimo: 0,
        p_presentacion_compra: "unidad",
        p_factor_compra: 1,
        p_activo: true,
      });
      if (error) throw new Error(error.message);
      const producto = data as ProductoCatalogo;
      setProductos((actual) => [...actual, producto].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
      setLineasPorCaptura((actual) => ({
        ...actual,
        [capturaId]: (actual[capturaId] ?? []).map((item) => (
          item.id === linea.id
            ? recalcularLinea({
                ...item,
                producto_id: producto.id,
                producto_nombre_detectado: producto.nombre,
                productos: { nombre: producto.nombre, presentacion_compra: producto.presentacion_compra },
                factor_aplicado: item.modo === "presentacion" ? producto.factor_compra : 1,
                puntaje_match: 1,
                precio_catalogo_confirmado: false,
              }, producto)
            : item
        )),
      }));
      setMensaje(`Producto creado: ${producto.nombre}. Completa costo y precio en catalogo antes de aprobar.`);
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo crear el producto.");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarRevision(captura: CapturaCompraResumen, opciones: { silencioso?: boolean } = {}) {
    const lineas = (lineasPorCaptura[captura.id] ?? []).map((linea, index) => recalcularLinea({ ...linea, orden: index + 1 }, linea.producto_id ? productos.find((producto) => producto.id === linea.producto_id) ?? null : null));
    if (!captura.proveedor_id) {
      setMensaje("Selecciona proveedor antes de guardar la revision.");
      return false;
    }
    if (!captura.fecha_ingreso) {
      setMensaje("Selecciona fecha de ingreso antes de guardar la revision.");
      return false;
    }
    if (lineas.length === 0) {
      setMensaje("La solicitud de inventario debe tener al menos una linea para guardar revision.");
      return false;
    }

    setGuardando(true);
    setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const eliminadas = lineasEliminadas[captura.id] ?? [];
      const deletes = eliminadas.length > 0 ? [supabase.from("captura_compra_lineas").delete().in("id", eliminadas)] : [];
      const deleteRespuestas = await Promise.all(deletes);
      const deleteError = deleteRespuestas.find((respuesta) => respuesta.error)?.error;
      if (deleteError) throw new Error(deleteError.message);

      const operaciones = lineas.map((linea) => {
        const payload = {
          captura_id: captura.id,
          orden: linea.orden,
          texto_original: linea.texto_original,
          producto_nombre_detectado: linea.producto_nombre_detectado,
          producto_id: linea.producto_id,
          modo: linea.modo,
          cantidad_ingresada: linea.cantidad_ingresada,
          factor_aplicado: linea.factor_aplicado,
          unidades_resultantes: linea.unidades_resultantes,
          costo_unitario_catalogo: linea.costo_unitario_catalogo,
          precio_venta_catalogo: linea.precio_venta_catalogo,
          subtotal_costo: linea.subtotal_costo,
          stock_actual_snapshot: linea.stock_actual_snapshot,
          stock_proyectado: linea.stock_proyectado,
          requiere_revision: linea.requiere_revision,
          precio_catalogo_confirmado: linea.precio_catalogo_confirmado,
          estado: linea.estado,
          observacion: linea.observacion,
        };
        return esNuevo(linea.id)
          ? supabase.from("captura_compra_lineas").insert(payload)
          : supabase.from("captura_compra_lineas").update(payload).eq("id", linea.id);
      });

      const respuestas = await Promise.all([
        supabase
          .from("capturas_compra")
          .update({
            proveedor_id: captura.proveedor_id,
            fecha_ingreso: captura.fecha_ingreso,
            estado: lineas.some((linea) => linea.requiere_revision || !linea.precio_catalogo_confirmado) ? "requiere_revision" : "procesada",
          })
          .eq("id", captura.id),
        ...operaciones,
      ]);
      const error = respuestas.find((respuesta) => respuesta.error)?.error;
      if (error) throw new Error(error.message);

      setLineasEliminadas((actual) => ({ ...actual, [captura.id]: [] }));
      if (!opciones.silencioso) setMensaje("Revision de inventario guardada.");
      await cargar();
      return true;
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo guardar la revision.");
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function aprobarCaptura(captura: CapturaCompraResumen) {
    const lineas = lineasPorCaptura[captura.id] ?? [];
    const totalActual = lineas.reduce((suma, linea) => {
      const producto = linea.producto_id ? productos.find((item) => item.id === linea.producto_id) ?? null : null;
      return suma + recalcularLinea(linea, producto).subtotal_costo;
    }, 0);
    if (!captura.proveedor_id || !captura.fecha_ingreso || !lineasListasParaAprobar(lineas, productos)) {
      setMensaje("Completa proveedor, fecha, productos, cantidades y confirma costo/precio antes de ingresar inventario.");
      return;
    }
    if (!window.confirm(`Ingresar este inventario por ${formatoCOP(totalActual)}?`)) return;

    const revisionGuardada = await guardarRevision(captura, { silencioso: true });
    if (!revisionGuardada) return;

    setGuardando(true);
    setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("aprobar_captura_compra_admin", { p_captura_id: captura.id });
      if (error) throw new Error(error.message);

      const resultado = data as AprobarCompraResultado | null;
      setMensaje(`Inventario ingresado. Items: ${resultado?.items_confirmados ?? lineas.length}. Total: ${formatoCOP(Number(resultado?.total ?? totalActual))}.`);
      await cargar();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo ingresar el inventario.");
    } finally {
      setGuardando(false);
    }
  }

  async function rechazarCaptura(captura: CapturaCompraResumen) {
    if (!capturaRechazable(captura)) {
      setMensaje("Esta solicitud de inventario ya esta confirmada o cerrada.");
      return;
    }

    const motivo = window.prompt("Motivo del rechazo de esta solicitud de inventario:");
    if (motivo === null) return;
    if (motivo.trim().length < 3) {
      setMensaje("Escribe un motivo de rechazo de al menos 3 caracteres.");
      return;
    }
    if (!window.confirm("Rechazar esta solicitud? No se afectara inventario y quedara en historial.")) return;

    setGuardando(true);
    setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("rechazar_captura_compra_admin", {
        p_captura_id: captura.id,
        p_observacion: motivo.trim(),
      });
      if (error) throw new Error(error.message);

      const resultado = data as RechazarCompraResultado | null;
      setMensaje(`Solicitud rechazada. Lineas cerradas: ${resultado?.lineas_rechazadas ?? 0}.`);
      await cargar();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo rechazar la solicitud.");
    } finally {
      setGuardando(false);
    }
  }

  async function procesarCaptura(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!foto) {
      setMensaje("Selecciona una factura primero.");
      return;
    }
    if (!proveedorId) {
      setMensaje("Selecciona el proveedor.");
      return;
    }
    if (!fechaIngreso) {
      setMensaje("Selecciona la fecha de ingreso.");
      return;
    }

    setGuardando(true);
    setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sesion requerida.");

      const formData = new FormData();
      formData.append("foto", foto);
      formData.append("proveedor_id", proveedorId);
      formData.append("fecha_ingreso", fechaIngreso);
      formData.append("observacion", observacion);

      const response = await fetch("/api/capturas/inventario/procesar", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo procesar la factura de inventario.");

      const lineas = Number((data as { lineas?: unknown[] }).lineas?.length ?? 0);
      setMensaje(`Factura de inventario procesada. Se detectaron ${lineas} item(s) para revision.`);
      setFoto(null);
      setObservacion("");
      await cargar();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo procesar la factura de inventario.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <ResumenCard titulo="Pendientes" valor={resumen.pendientes} />
        <ResumenCard titulo="Confirmadas" valor={resumen.confirmadas} />
        <ResumenCard titulo="Rechazadas" valor={resumen.rechazadas} />
        <ResumenCard titulo="Entradas" valor={resumen.entradas} />
      </div>

      <div className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-crema">Entrada de inventario por OCR</h3>
            <p className="text-sm text-antiguo/65">La IA lee facturas de compra; costo, precio y stock salen del catalogo.</p>
          </div>
          <button type="button" onClick={() => void cargar()} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold text-crema">Actualizar</button>
        </div>

        <form onSubmit={procesarCaptura} className="mt-4 grid gap-3 lg:grid-cols-[260px_1fr]">
          <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-antiguo/25 bg-carbon p-3 text-center text-sm text-antiguo/70">
            {previewUrl ? <Image src={previewUrl} alt="Factura de inventario seleccionada" width={640} height={480} unoptimized className="max-h-72 w-full rounded-md object-contain" /> : <span>Factura de inventario</span>}
            <input ref={camaraInputRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { seleccionarArchivo(event.target.files?.[0] ?? null); event.target.value = ""; }} />
            <input ref={galeriaInputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => { seleccionarArchivo(event.target.files?.[0] ?? null); event.target.value = ""; }} />
          </div>

          <div className="grid gap-3 rounded-md border border-antiguo/10 bg-carbon p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={proveedorId} onChange={(event) => setProveedorId(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                <option value="">Proveedor obligatorio</option>
                {proveedores.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
              </select>
              <label className="text-xs font-bold text-antiguo/80">
                Fecha de ingreso
                <input type="date" value={fechaIngreso} onChange={(event) => setFechaIngreso(event.target.value)} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
              </label>
            </div>
            <input value={observacion} onChange={(event) => setObservacion(event.target.value)} placeholder="Observacion" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50" />
            {foto ? <p className="text-xs text-antiguo/60">Archivo: {foto.name} ({Math.round(foto.size / 1024)} KB)</p> : null}
            <div className="grid gap-2 sm:grid-cols-4">
              <button type="button" onClick={() => camaraInputRef.current?.click()} className="tap-target rounded-md border border-antiguo/20 px-4 text-sm font-bold">Tomar foto</button>
              <button type="button" onClick={() => galeriaInputRef.current?.click()} className="tap-target rounded-md border border-antiguo/20 px-4 text-sm font-bold">Subir galeria</button>
              <button type="submit" disabled={guardando || !foto || !proveedorId || !fechaIngreso} className="tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">{guardando ? "Procesando..." : "Procesar OCR inventario"}</button>
              <button type="button" onClick={() => seleccionarArchivo(null)} className="tap-target rounded-md border border-antiguo/20 px-4 text-sm font-bold">Limpiar</button>
            </div>
          </div>
        </form>

        {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm text-champana">{mensaje}</p> : null}
      </div>

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-crema">Solicitudes de inventario</h3>
            <p className="text-sm text-antiguo/65">{cargando ? "Cargando..." : `${capturasVisibles.length} de ${resumen.total} registro(s)`}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["pendientes", "todas", "confirmadas", "rechazadas"] as FiltroCompra[]).map((opcion) => (
              <button key={opcion} type="button" onClick={() => setFiltro(opcion)} className={filtro === opcion ? "tap-target rounded-md bg-oro px-3 text-sm font-black text-carbon" : "tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold text-crema"}>{opcion}</button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-2 border-t border-antiguo/10 pt-3 md:grid-cols-[minmax(0,1fr)_150px_150px_180px_auto]">
          <input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar producto, proveedor, entrada o archivo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
          <input type="date" value={fechaDesde} onChange={(event) => setFechaDesde(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <select value={proveedorFiltro} onChange={(event) => setProveedorFiltro(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="">Todos los proveedores</option>
            {proveedores.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
          </select>
          <button type="button" onClick={() => { setBusqueda(""); setFechaDesde(""); setFechaHasta(""); setProveedorFiltro(""); }} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold text-crema">Limpiar</button>
        </div>

        <div className="mt-4 space-y-3">
          {cargando ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">Cargando inventario...</p> : null}
          {!cargando && capturasVisibles.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">No hay solicitudes de inventario para este filtro.</p> : null}
          {capturasVisibles.map((captura) => {
            const estado = estadoCompra(captura.estado);
            const imagenUrl = imagenes[captura.id];
            const lineas = lineasPorCaptura[captura.id] ?? [];
            const editable = capturaEditable(captura) && !guardando;
            const puedeAprobar = editable && Boolean(captura.proveedor_id && captura.fecha_ingreso) && lineasListasParaAprobar(lineas, productos);
            const rechazable = capturaRechazable(captura) && !guardando;
            return (
              <article key={captura.id} className="rounded-md border border-antiguo/15 bg-carbon p-3">
                <div className="grid gap-3 sm:grid-cols-[96px_1fr_auto] sm:items-center">
                  <div className="flex h-20 w-full items-center justify-center overflow-hidden rounded-md border border-antiguo/10 bg-espresso sm:w-24">
                    {imagenUrl ? <Image src={imagenUrl} alt="Factura de inventario" width={160} height={120} unoptimized className="h-full w-full object-cover" /> : <span className="text-xs text-antiguo/50">Sin imagen</span>}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md border px-2 py-1 text-xs font-black ${estado.clase}`}>{estado.texto}</span>
                      <p className="text-sm font-black text-crema">{captura.proveedor ?? "Proveedor sin nombre"} / ingreso {fechaDia(captura.fecha_ingreso)}</p>
                    </div>
                    <p className="mt-1 text-xs text-antiguo/60">Subida {fechaCorta(captura.created_at)} por {captura.subido_por ?? "-"} / archivo {captura.nombre_archivo ?? "-"}</p>
                    <p className="mt-1 text-xs text-antiguo/60">Auditoria: aprobada {fechaCorta(captura.aprobado_at)} por {captura.aprobado_por ?? "-"} / confirmada {fechaCorta(captura.confirmado_at)} / rechazada {fechaCorta(captura.eliminado_at)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                      <MiniDato etiqueta="Items" valor={captura.items_total} />
                      <MiniDato etiqueta="Pend." valor={captura.items_pendientes} />
                      <MiniDato etiqueta="Unid." valor={captura.unidades_total} />
                      <MiniDato etiqueta="Costo" valor={formatoCOP(captura.costo_total)} />
                      <MiniDato etiqueta="Entrada" valor={codigoCorto(captura.compra_id)} />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <span className="rounded-md border border-antiguo/15 px-3 py-2 text-center text-xs font-bold text-antiguo/80">{lineas.length > 0 ? "Rectificacion" : "Sin items"}</span>
                    <button type="button" onClick={() => agregarLinea(captura)} disabled={!editable} className="tap-target rounded-md border border-white/35 px-3 text-xs font-bold text-white disabled:opacity-50">Agregar linea</button>
                    <button type="button" onClick={() => void guardarRevision(captura)} disabled={!editable || lineas.length === 0} className="tap-target rounded-md bg-oro px-3 text-xs font-black text-carbon disabled:opacity-50">Guardar revision</button>
                    <button type="button" onClick={() => void aprobarCaptura(captura)} disabled={!puedeAprobar} className="tap-target rounded-md bg-green-200 px-3 text-xs font-black text-green-950 disabled:opacity-50">Ingresar inventario</button>
                    <button type="button" onClick={() => void rechazarCaptura(captura)} disabled={!rechazable} className="tap-target rounded-md border border-red-300/40 px-3 text-xs font-bold text-red-100 disabled:opacity-50">Rechazar</button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 border-t border-antiguo/10 pt-3 sm:grid-cols-2">
                  <label className="text-xs font-bold text-antiguo/80">
                    Proveedor
                    <select
                      value={captura.proveedor_id ?? ""}
                      onChange={(event) => {
                        const proveedor = proveedores.find((item) => item.id === event.target.value);
                        actualizarCaptura(captura.id, { proveedor_id: event.target.value || null, proveedor: proveedor?.nombre ?? null });
                      }}
                      disabled={!editable}
                      className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema disabled:opacity-60"
                    >
                      <option value="">Proveedor obligatorio</option>
                      {proveedores.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-bold text-antiguo/80">
                    Fecha de ingreso
                    <input type="date" value={captura.fecha_ingreso} onChange={(event) => actualizarCaptura(captura.id, { fecha_ingreso: event.target.value })} disabled={!editable} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema disabled:opacity-60" />
                  </label>
                </div>
                {lineas.length > 0 ? (
                  <div className="mt-3 space-y-2 border-t border-antiguo/10 pt-3">
                    {lineas.map((linea) => (
                      <div key={linea.id} className="rounded-md border border-antiguo/10 bg-espresso p-3 text-sm">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className={linea.requiere_revision ? "font-black text-dorado" : "font-black text-crema"}>{nombreLinea(linea)}</p>
                            <p className="mt-1 text-xs text-antiguo/60">Leido: {linea.texto_original ?? linea.producto_nombre_detectado ?? "-"} / match {porcentaje(linea.puntaje_match)} / confianza {porcentaje(linea.confianza_ia)}</p>
                          </div>
                          <span className={linea.requiere_revision ? "rounded-md border border-oro/35 bg-oro/10 px-2 py-1 text-xs font-black text-dorado" : "rounded-md border border-white/35 bg-white/10 px-2 py-1 text-xs font-black text-white"}>
                            {linea.requiere_revision ? "Por revisar" : "Lista"}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1.45fr)_104px_124px_96px_auto]">
                          <select value={linea.producto_id ?? ""} onChange={(event) => seleccionarProducto(captura.id, linea, event.target.value)} disabled={!editable} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema disabled:opacity-60">
                            <option value="">Sin match - {linea.producto_nombre_detectado ?? "producto"}</option>
                            {productos.map((producto) => (
                              <option key={producto.id} value={producto.id}>
                                {producto.nombre} - {producto.presentacion_compra} x{producto.factor_compra}
                              </option>
                            ))}
                          </select>
                          <input type="number" min="1" inputMode="numeric" value={linea.cantidad_ingresada} onChange={(event) => actualizarLinea(captura.id, linea.id, { cantidad_ingresada: Number(event.target.value), precio_catalogo_confirmado: false })} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema disabled:opacity-60" />
                          <select value={linea.modo} onChange={(event) => cambiarModo(captura.id, linea, event.target.value as "unidades" | "presentacion")} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema disabled:opacity-60">
                            <option value="unidades">Unidades</option>
                            <option value="presentacion">Presentacion</option>
                          </select>
                          <input type="number" min="1" inputMode="numeric" value={linea.factor_aplicado} onChange={(event) => actualizarLinea(captura.id, linea.id, { factor_aplicado: Number(event.target.value), precio_catalogo_confirmado: false })} disabled={!editable || linea.modo === "unidades"} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema disabled:opacity-60" />
                          <button type="button" onClick={() => quitarLinea(captura.id, linea)} disabled={!editable} className="tap-target rounded-md border border-red-300/40 px-3 text-xs font-bold text-red-100 disabled:opacity-50">Quitar</button>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
                          <MiniDato etiqueta="Entran" valor={linea.unidades_resultantes} />
                          <MiniDato etiqueta="Costo" valor={formatoCOP(linea.costo_unitario_catalogo)} />
                          <MiniDato etiqueta="Precio" valor={formatoCOP(linea.precio_venta_catalogo)} />
                          <MiniDato etiqueta="Subtotal" valor={formatoCOP(linea.subtotal_costo)} />
                          <MiniDato etiqueta="Stock" valor={`${linea.stock_actual_snapshot ?? "-"} -> ${linea.stock_proyectado ?? "-"}`} />
                          <MiniDato etiqueta="OK precio" valor={linea.precio_catalogo_confirmado ? "Si" : "No"} />
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => confirmarPrecio(captura.id, linea)} disabled={!editable || !linea.producto_id || linea.costo_unitario_catalogo <= 0 || linea.precio_venta_catalogo <= 0} className="tap-target rounded-md bg-white px-3 text-xs font-black text-carbon disabled:opacity-50">Confirmar costo/precio</button>
                          {!linea.producto_id ? (
                            <button type="button" onClick={() => void crearProductoDesdeLinea(captura.id, linea)} disabled={!editable} className="tap-target rounded-md border border-white/35 px-3 text-xs font-bold text-white disabled:opacity-50">Crear producto</button>
                          ) : null}
                        </div>

                        {linea.observacion ? <p className="mt-2 rounded-md border border-antiguo/10 bg-carbon p-2 text-xs text-antiguo/70">{linea.observacion}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-crema">Auditoria de entradas OCR</h3>
            <p className="text-sm text-antiguo/65">{entradasVisibles.length} movimiento(s) confirmado(s) con los filtros actuales</p>
          </div>
          <span className="rounded-md border border-antiguo/15 px-3 py-2 text-xs font-bold text-antiguo/80">Ultimas 120 lineas</span>
        </div>

        <div className="mt-4 space-y-2">
          {entradasVisibles.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">No hay entradas confirmadas para mostrar.</p> : null}
          {entradasVisibles.map((entrada) => (
            <article key={`${entrada.captura_id}-${entrada.orden}-${entrada.compra_item_id ?? entrada.producto_id}`} className="rounded-md border border-antiguo/10 bg-carbon p-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-black text-crema">{entrada.producto}</p>
                  <p className="mt-1 text-xs text-antiguo/60">{entrada.proveedor ?? "Proveedor sin nombre"} / ingreso {fechaDia(entrada.fecha_ingreso)} / registrado {fechaCorta(entrada.registrado_at)}</p>
                  <p className="mt-1 text-xs text-antiguo/60">Aprobo {entrada.aprobado_por ?? "-"} / compra {codigoCorto(entrada.compra_id)} / movimiento {codigoCorto(entrada.movimiento_id)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5 lg:min-w-[34rem]">
                  <MiniDato etiqueta="Cantidad" valor={entrada.cantidad_ingresada} />
                  <MiniDato etiqueta="Entran" valor={entrada.unidades_resultantes} />
                  <MiniDato etiqueta="Costo" valor={formatoCOP(entrada.costo_unitario_catalogo)} />
                  <MiniDato etiqueta="Subtotal" valor={formatoCOP(entrada.subtotal_costo)} />
                  <MiniDato etiqueta="Stock" valor={`${entrada.stock_actual_snapshot ?? "-"} -> ${entrada.stock_resultante ?? "-"}`} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function ResumenCard({ titulo, valor }: { titulo: string; valor: number }) {
  return <div className="rounded-md border border-antiguo/15 bg-espresso p-3 shadow-suave"><p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">{titulo}</p><p className="mt-1 text-2xl font-black text-dorado">{valor}</p></div>;
}

function MiniDato({ etiqueta, valor }: { etiqueta: string; valor: string | number }) {
  return <div className="rounded-md border border-antiguo/10 bg-espresso p-2"><p className="text-antiguo/60">{etiqueta}</p><p className="font-black text-dorado">{valor}</p></div>;
}
