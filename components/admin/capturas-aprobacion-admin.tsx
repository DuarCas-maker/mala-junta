"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";
type TipoItem = "producto" | "combo" | "desconocido";
type TipoDiferencia = "positiva" | "negativa" | "cero";
type FiltroEstado = "pendientes" | "todas" | "confirmadas" | "eliminadas";

type ItemCatalogo = { clave: string; id: string; tipo: "producto" | "combo"; nombre: string; precio_venta: number };
type CapturaResumen = {
  id: string; estado: string; fecha_venta: string | null; dia_negocio: string | null; created_at: string;
  enviado_aprobacion_at: string | null; aprobado_at: string | null; confirmado_at: string | null; eliminado_at: string | null;
  storage_bucket: string | null; storage_path: string; nombre_archivo: string | null; modelo_ia: string | null; advertencias: string[] | null;
  subido_por: string | null; enviado_por: string | null; aprobado_por: string | null;
  ventas_total: number; ventas_confirmadas: number; ventas_pendientes: number; ventas_eliminadas: number;
  total_leido: number; total_esperado: number; diferencia: number;
};
type CapturaVenta = Pick<CapturaResumen, "id" | "estado" | "storage_bucket" | "storage_path" | "nombre_archivo" | "modelo_ia" | "advertencias" | "created_at" | "fecha_venta" | "enviado_aprobacion_at" | "aprobado_at" | "confirmado_at" | "eliminado_at">;
type LineaRevision = {
  id: string; captura_id: string; grupo_id: string | null; orden: number; texto_original: string | null; item_nombre_detectado: string | null;
  tipo_item: TipoItem; producto_id: string | null; combo_id: string | null; cantidad: number; valor_unitario: number; subtotal: number;
  precio_catalogo: number; subtotal_esperado: number; confianza_ia: number; puntaje_match: number; requiere_revision: boolean;
  productos?: { nombre?: string; precio_venta?: number } | null; combos?: { nombre?: string; precio_venta?: number } | null;
};
type PagoRevision = {
  id: string; captura_id: string; grupo_id: string | null; orden: number; medio_detectado: string | null;
  medio_normalizado: MedioPago | null; cuenta_destino: string | null; monto: number; confianza_ia: number; requiere_revision: boolean;
};
type GrupoRevision = {
  id: string; captura_id: string; cuenta_id?: string | null; pedido_id?: string | null; orden: number; texto_original: string | null;
  total_leido: number; total_esperado: number; diferencia: number; tipo_diferencia: TipoDiferencia; descuento_autorizado: boolean;
  ingreso_adicional: boolean; confianza_ia: number; requiere_revision: boolean; observacion: string | null; aprobado?: boolean;
  aprobado_at?: string | null; estado?: string | null; enviado_aprobacion_at?: string | null; confirmado_at?: string | null;
  confirmado_por?: string | null; eliminado_at?: string | null; lineas: LineaRevision[]; pagos: PagoRevision[];
};
type CapturaDetalle = { captura: CapturaVenta; grupos: GrupoRevision[]; imagen_url: string | null };
type EliminacionCapturaResultado = { ventas_eliminadas?: number; ventas_reversadas?: number };

const mediosPago: { id: MedioPago; nombre: string }[] = [
  { id: "efectivo", nombre: "Efectivo" },
  { id: "datafono", nombre: "Datafono" },
  { id: "nequi_daviplata", nombre: "Nequi/Daviplata" },
  { id: "transferencia", nombre: "Transferencia" },
];

function esNuevo(id: string) { return id.startsWith("nuevo:"); }
function nuevoId() { return `nuevo:${crypto.randomUUID()}`; }
function tipoDiferencia(diferencia: number): TipoDiferencia { return diferencia > 0 ? "positiva" : diferencia < 0 ? "negativa" : "cero"; }
function formatoFecha(fecha?: string | null) { return fecha ? new Date(`${fecha}T12:00:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "Sin fecha"; }
function fechaInputHoy() { return new Date().toISOString().slice(0, 10); }
function fechaHoraCorta(fecha?: string | null) { return fecha ? new Date(fecha).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-"; }
function valorItem(linea: LineaRevision) { return linea.tipo_item === "producto" && linea.producto_id ? `producto:${linea.producto_id}` : linea.tipo_item === "combo" && linea.combo_id ? `combo:${linea.combo_id}` : ""; }
function nombreDetectado(linea: LineaRevision) { return linea.productos?.nombre ?? linea.combos?.nombre ?? linea.item_nombre_detectado ?? "Sin match"; }
function estadoCapturaTexto(estado: string) {
  if (estado === "pendiente_aprobacion") return "Pendiente admin";
  if (estado === "aprobada_parcial") return "Aprobada parcial";
  if (estado === "confirmada") return "Confirmada";
  if (estado === "eliminada" || estado === "rechazada") return "Eliminada";
  if (estado === "procesada") return "Lista";
  if (estado === "requiere_revision") return "En revision";
  return estado;
}
function estadoVentaTexto(grupo: GrupoRevision) {
  if (grupo.eliminado_at || grupo.estado === "eliminada") return { texto: "Eliminada", clase: "border-red-300/30 bg-red-950/20 text-red-100" };
  if (grupo.pedido_id || grupo.estado === "confirmada") return { texto: "Confirmada", clase: "border-green-300/40 bg-green-950/25 text-green-100" };
  if (grupo.requiere_revision || !grupo.aprobado) return { texto: "Pendiente", clase: "border-white bg-white/10 text-white" };
  return { texto: "Lista", clase: "border-blue-200/50 bg-blue-950/25 text-blue-100" };
}
function diferenciaClass(tipo: TipoDiferencia) {
  if (tipo === "positiva") return "border-green-400/30 bg-green-950/25 text-green-100";
  if (tipo === "negativa") return "border-red-400/30 bg-red-950/30 text-red-100";
  return "border-antiguo/10 bg-espresso text-antiguo/80";
}
function recalcularGrupo(grupo: GrupoRevision): GrupoRevision {
  const lineas = grupo.lineas.map((linea) => ({
    ...linea,
    cantidad: Math.max(0, Number(linea.cantidad ?? 0)),
    precio_catalogo: Math.max(0, Number(linea.precio_catalogo ?? 0)),
    subtotal_esperado: Math.max(0, Math.round(Number(linea.cantidad ?? 0) * Number(linea.precio_catalogo ?? 0))),
    subtotal: Math.max(0, Number(linea.subtotal ?? 0)),
  }));
  const totalEsperado = lineas.reduce((sum, linea) => sum + Number(linea.subtotal_esperado ?? 0), 0);
  const diferencia = Number(grupo.total_leido ?? 0) - totalEsperado;
  const pagosTotal = grupo.pagos.reduce((sum, pago) => sum + Number(pago.monto ?? 0), 0);
  const tipo = tipoDiferencia(diferencia);
  const ingresoAdicional = tipo === "positiva" ? grupo.ingreso_adicional : false;
  const descuentoAutorizado = tipo === "negativa" ? grupo.descuento_autorizado : false;
  const diferenciaPendiente = (tipo === "positiva" && !ingresoAdicional) || (tipo === "negativa" && !descuentoAutorizado);
  const requiereRevision = lineas.length === 0 ||
    lineas.some((linea) => linea.requiere_revision || linea.cantidad <= 0 || linea.tipo_item === "desconocido" || (!linea.producto_id && !linea.combo_id)) ||
    grupo.pagos.length === 0 ||
    grupo.pagos.some((pago) => pago.requiere_revision || !pago.medio_normalizado || Number(pago.monto ?? 0) <= 0) ||
    diferenciaPendiente || pagosTotal !== Number(grupo.total_leido ?? 0);

  return { ...grupo, lineas, total_esperado: totalEsperado, diferencia, tipo_diferencia: tipo, ingreso_adicional: ingresoAdicional, descuento_autorizado: descuentoAutorizado, requiere_revision: requiereRevision };
}

function resumenGrupos(grupos: GrupoRevision[]) {
  const vigentes = grupos.filter((grupo) => !grupo.eliminado_at && grupo.estado !== "eliminada");
  return {
    totalLeido: vigentes.reduce((sum, grupo) => sum + Number(grupo.total_leido ?? 0), 0),
    totalEsperado: vigentes.reduce((sum, grupo) => sum + Number(grupo.total_esperado ?? 0), 0),
    pendientes: vigentes.filter((grupo) => !grupo.pedido_id && (grupo.requiere_revision || !grupo.aprobado)).length,
    confirmadas: vigentes.filter((grupo) => grupo.pedido_id).length,
  };
}

function itemEditable(grupo: GrupoRevision) { return !grupo.pedido_id && !grupo.eliminado_at && grupo.estado !== "confirmada" && grupo.estado !== "eliminada"; }
function capturaEditable(captura: CapturaVenta, grupos: GrupoRevision[]) { return !["confirmada", "eliminada", "rechazada"].includes(captura.estado) && grupos.every((grupo) => !grupo.pedido_id && grupo.estado !== "confirmada"); }
function problemasGrupo(grupo: GrupoRevision) {
  const problemas: string[] = [];
  const revisado = recalcularGrupo(grupo);
  if (revisado.lineas.length === 0) problemas.push("agrega al menos un item");
  if (revisado.lineas.some((linea) => linea.tipo_item === "desconocido" || (!linea.producto_id && !linea.combo_id))) problemas.push("hay items sin producto/combo oficial");
  if (revisado.pagos.length === 0) problemas.push("agrega al menos un pago");
  if (revisado.pagos.some((pago) => !pago.medio_normalizado || Number(pago.monto ?? 0) <= 0)) problemas.push("hay pagos sin medio o monto");
  if (revisado.pagos.reduce((sum, pago) => sum + Number(pago.monto ?? 0), 0) !== Number(revisado.total_leido ?? 0)) problemas.push("los pagos no coinciden con el total leido");
  if (revisado.tipo_diferencia === "negativa" && !revisado.descuento_autorizado) problemas.push("autoriza el faltante o corrige el total");
  if (revisado.tipo_diferencia === "positiva" && !revisado.ingreso_adicional) problemas.push("marca el positivo como ingreso adicional o corrige el total");
  return problemas;
}
function capturaFiltrada(captura: CapturaResumen, filtro: FiltroEstado) {
  if (filtro === "pendientes") return ["pendiente_aprobacion", "aprobada_parcial", "requiere_revision", "procesada"].includes(captura.estado) && captura.ventas_pendientes > 0;
  if (filtro === "confirmadas") return captura.estado === "confirmada" || captura.ventas_confirmadas > 0;
  if (filtro === "eliminadas") return captura.estado === "eliminada" || captura.estado === "rechazada" || captura.ventas_eliminadas > 0;
  return true;
}

export function CapturasAprobacionAdminPanel() {
  const [capturas, setCapturas] = useState<CapturaResumen[]>([]);
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [detalles, setDetalles] = useState<Record<string, CapturaDetalle>>({});
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [lineasEliminadas, setLineasEliminadas] = useState<Record<string, string[]>>({});
  const [pagosEliminados, setPagosEliminados] = useState<Record<string, string[]>>({});
  const [filtro, setFiltro] = useState<FiltroEstado>("pendientes");

  const capturasVisibles = useMemo(() => capturas.filter((captura) => capturaFiltrada(captura, filtro)), [capturas, filtro]);
  const resumen = useMemo(() => ({
    pendientes: capturas.filter((captura) => capturaFiltrada(captura, "pendientes")).length,
    confirmadas: capturas.filter((captura) => capturaFiltrada(captura, "confirmadas")).length,
    total: capturas.length,
  }), [capturas]);

  const cargarResumen = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.from("v_admin_capturas_venta_aprobacion").select("*").order("enviado_aprobacion_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(60);
    if (error) throw new Error(error.message);
    setCapturas((data ?? []) as CapturaResumen[]);
  }, []);

  const cargarCatalogo = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [{ data: productos, error: productosError }, { data: combos, error: combosError }] = await Promise.all([
      supabase.from("v_productos_operativos").select("id,nombre,precio_venta,presentacion_compra").order("nombre"),
      supabase.from("combos").select("id,nombre,precio_venta").eq("activo", true).order("nombre"),
    ]);
    if (productosError) throw new Error(productosError.message);
    if (combosError) throw new Error(combosError.message);
    setCatalogo([
      ...((productos ?? []) as any[]).map((producto) => ({ clave: `producto:${producto.id}`, id: producto.id, tipo: "producto" as const, nombre: `${producto.nombre}${producto.presentacion_compra ? ` - ${producto.presentacion_compra}` : ""}`, precio_venta: Number(producto.precio_venta ?? 0) })),
      ...((combos ?? []) as any[]).map((combo) => ({ clave: `combo:${combo.id}`, id: combo.id, tipo: "combo" as const, nombre: combo.nombre, precio_venta: Number(combo.precio_venta ?? 0) })),
    ]);
  }, []);

  const cargarInicial = useCallback(async () => {
    setCargando(true); setMensaje(null);
    try { await Promise.all([cargarResumen(), cargarCatalogo()]); }
    catch (err) { setMensaje(err instanceof Error ? err.message : "No se pudo cargar solicitudes de carga."); }
    finally { setCargando(false); }
  }, [cargarCatalogo, cargarResumen]);

  useEffect(() => { void cargarInicial(); }, [cargarInicial]);
  async function cargarDetalle(capturaId: string) {
    const supabase = supabaseBrowser();
    const resumenCaptura = capturas.find((item) => item.id === capturaId);
    const [{ data: captura, error: capturaError }, grupos, { data: urlData }] = await Promise.all([
      supabase.from("capturas_venta").select("id,estado,storage_bucket,storage_path,nombre_archivo,modelo_ia,advertencias,created_at,fecha_venta,enviado_aprobacion_at,aprobado_at,confirmado_at,eliminado_at").eq("id", capturaId).maybeSingle(),
      recargarResultado(supabase, capturaId),
      resumenCaptura?.storage_path ? supabase.storage.from(resumenCaptura.storage_bucket ?? "capturas-ventas").createSignedUrl(resumenCaptura.storage_path, 60 * 60) : Promise.resolve({ data: { signedUrl: null } }),
    ]);
    if (capturaError) throw new Error(capturaError.message);
    if (!captura) throw new Error("Captura no encontrada.");
    setDetalles((actual) => ({ ...actual, [capturaId]: { captura: captura as CapturaVenta, grupos, imagen_url: urlData?.signedUrl ?? null } }));
  }

  async function toggleCaptura(capturaId: string) {
    const abrir = !abiertas[capturaId];
    setAbiertas((actual) => ({ ...actual, [capturaId]: abrir }));
    if (abrir && !detalles[capturaId]) {
      setGuardando(capturaId); setMensaje(null);
      try { await cargarDetalle(capturaId); }
      catch (err) { setMensaje(err instanceof Error ? err.message : "No se pudo cargar el detalle."); }
      finally { setGuardando(null); }
    }
  }

  function actualizarDetalle(capturaId: string, grupos: GrupoRevision[]) {
    setDetalles((actual) => actual[capturaId] ? { ...actual, [capturaId]: { ...actual[capturaId], grupos } } : actual);
  }
  function actualizarFechaVenta(capturaId: string, fechaVenta: string) {
    setDetalles((actual) => actual[capturaId] ? { ...actual, [capturaId]: { ...actual[capturaId], captura: { ...actual[capturaId].captura, fecha_venta: fechaVenta } } } : actual);
    setCapturas((actual) => actual.map((captura) => captura.id === capturaId ? { ...captura, fecha_venta: fechaVenta, dia_negocio: fechaVenta } : captura));
  }
  function actualizarGrupo(capturaId: string, grupoId: string, cambios: Partial<GrupoRevision>) {
    const detalle = detalles[capturaId]; if (!detalle) return;
    const defineAprobacion = Object.prototype.hasOwnProperty.call(cambios, "aprobado");
    actualizarDetalle(capturaId, detalle.grupos.map((grupo) => {
      if (grupo.id !== grupoId) return grupo;
      const actualizado = { ...grupo, ...cambios };
      return recalcularGrupo({ ...actualizado, aprobado: defineAprobacion ? actualizado.aprobado : false, aprobado_at: defineAprobacion ? actualizado.aprobado_at : null });
    }));
  }
  function actualizarLinea(capturaId: string, grupoId: string, lineaId: string, cambios: Partial<LineaRevision>) {
    const detalle = detalles[capturaId]; if (!detalle) return;
    actualizarDetalle(capturaId, detalle.grupos.map((grupo) => grupo.id !== grupoId ? grupo : recalcularGrupo({ ...grupo, aprobado: false, aprobado_at: null, lineas: grupo.lineas.map((linea) => linea.id === lineaId ? { ...linea, ...cambios } : linea) })));
  }
  function actualizarPago(capturaId: string, grupoId: string, pagoId: string, cambios: Partial<PagoRevision>) {
    const detalle = detalles[capturaId]; if (!detalle) return;
    actualizarDetalle(capturaId, detalle.grupos.map((grupo) => grupo.id !== grupoId ? grupo : recalcularGrupo({ ...grupo, aprobado: false, aprobado_at: null, pagos: grupo.pagos.map((pago) => pago.id === pagoId ? { ...pago, ...cambios } : pago) })));
  }
  function seleccionarItem(capturaId: string, grupoId: string, linea: LineaRevision, clave: string) {
    const item = catalogo.find((catalogoItem) => catalogoItem.clave === clave);
    if (!item) { actualizarLinea(capturaId, grupoId, linea.id, { tipo_item: "desconocido", producto_id: null, combo_id: null, requiere_revision: true }); return; }
    actualizarLinea(capturaId, grupoId, linea.id, { tipo_item: item.tipo, producto_id: item.tipo === "producto" ? item.id : null, combo_id: item.tipo === "combo" ? item.id : null, precio_catalogo: item.precio_venta, subtotal_esperado: Math.max(0, Math.round(Number(linea.cantidad ?? 1) * item.precio_venta)), requiere_revision: false });
  }
  function agregarLinea(capturaId: string, grupo: GrupoRevision) {
    const linea: LineaRevision = { id: nuevoId(), captura_id: grupo.captura_id, grupo_id: grupo.id, orden: grupo.lineas.length + 1, texto_original: null, item_nombre_detectado: null, tipo_item: "desconocido", producto_id: null, combo_id: null, cantidad: 1, valor_unitario: 0, subtotal: 0, precio_catalogo: 0, subtotal_esperado: 0, confianza_ia: 0, puntaje_match: 0, requiere_revision: true };
    actualizarGrupo(capturaId, grupo.id, { lineas: [...grupo.lineas, linea] });
  }
  function quitarLinea(capturaId: string, grupo: GrupoRevision, linea: LineaRevision) {
    if (!esNuevo(linea.id)) setLineasEliminadas((actual) => ({ ...actual, [capturaId]: [...(actual[capturaId] ?? []), linea.id] }));
    actualizarGrupo(capturaId, grupo.id, { lineas: grupo.lineas.filter((item) => item.id !== linea.id) });
  }
  function agregarPago(capturaId: string, grupo: GrupoRevision) {
    const pago: PagoRevision = { id: nuevoId(), captura_id: grupo.captura_id, grupo_id: grupo.id, orden: grupo.pagos.length + 1, medio_detectado: null, medio_normalizado: null, cuenta_destino: null, monto: 0, confianza_ia: 0, requiere_revision: true };
    actualizarGrupo(capturaId, grupo.id, { pagos: [...grupo.pagos, pago] });
  }
  function quitarPago(capturaId: string, grupo: GrupoRevision, pago: PagoRevision) {
    if (!esNuevo(pago.id)) setPagosEliminados((actual) => ({ ...actual, [capturaId]: [...(actual[capturaId] ?? []), pago.id] }));
    actualizarGrupo(capturaId, grupo.id, { pagos: grupo.pagos.filter((item) => item.id !== pago.id) });
  }
  function marcarLista(capturaId: string, grupo: GrupoRevision) {
    const problemas = problemasGrupo(grupo);
    if (problemas.length > 0) { setMensaje(`Venta ${grupo.orden}: ${problemas.join(", ")}.`); return; }
    actualizarGrupo(capturaId, grupo.id, { requiere_revision: false, aprobado: true, aprobado_at: new Date().toISOString(), lineas: grupo.lineas.map((linea) => ({ ...linea, requiere_revision: false })), pagos: grupo.pagos.map((pago) => ({ ...pago, requiere_revision: false })) });
  }

  function marcarTodasListas(capturaId: string) {
    const detalle = detalles[capturaId]; if (!detalle) return;
    const editables = detalle.grupos.filter(itemEditable);
    if (editables.length === 0) { setMensaje("No hay ventas editables para marcar como listas."); return; }

    const errores = editables
      .map((grupo) => ({ orden: grupo.orden, problemas: problemasGrupo(grupo) }))
      .filter((item) => item.problemas.length > 0);

    if (errores.length > 0) {
      const resumenErrores = errores.slice(0, 4).map((item) => `Venta ${item.orden}: ${item.problemas.join(", ")}`).join(" / ");
      setMensaje(`${resumenErrores}${errores.length > 4 ? ` / ${errores.length - 4} venta(s) mas con pendientes` : ""}.`);
      return;
    }

    const aprobadoAt = new Date().toISOString();
    actualizarDetalle(capturaId, detalle.grupos.map((grupo) => {
      if (!itemEditable(grupo)) return grupo;
      return recalcularGrupo({
        ...grupo,
        requiere_revision: false,
        aprobado: true,
        aprobado_at: aprobadoAt,
        lineas: grupo.lineas.map((linea) => ({ ...linea, requiere_revision: false })),
        pagos: grupo.pagos.map((pago) => ({ ...pago, requiere_revision: false })),
      });
    }));
    setMensaje(`${editables.length} venta(s) marcadas como listas. Ahora puedes aprobar la captura completa.`);
  }

  async function agregarVenta(capturaId: string) {
    const detalle = detalles[capturaId]; if (!detalle) return;
    if (!capturaEditable(detalle.captura, detalle.grupos)) { setMensaje("Esta captura ya tiene ventas confirmadas o esta cerrada; no permite agregar ventas."); return; }
    setGuardando(capturaId); setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const orden = detalle.grupos.reduce((max, grupo) => Math.max(max, Number(grupo.orden ?? 0)), 0) + 1;
      const { error } = await supabase.from("captura_venta_grupos").insert({
        captura_id: capturaId,
        orden,
        texto_original: "Venta agregada manualmente por admin",
        total_leido: 0,
        total_esperado: 0,
        diferencia: 0,
        tipo_diferencia: "cero",
        descuento_autorizado: false,
        ingreso_adicional: false,
        requiere_revision: true,
        aprobado: false,
        estado: "pendiente_aprobacion",
        enviado_aprobacion_at: detalle.captura.enviado_aprobacion_at ?? new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      await Promise.all([cargarDetalle(capturaId), cargarResumen()]);
      setMensaje(`Venta ${orden} agregada. Completa productos, pagos y total antes de aprobar.`);
    } catch (err) { setMensaje(err instanceof Error ? err.message : "No se pudo agregar la venta."); }
    finally { setGuardando(null); }
  }

  async function guardarRevision(capturaId: string, silencioso = false) {
    const detalle = detalles[capturaId]; if (!detalle) return false;
    setGuardando(capturaId); setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const grupos = detalle.grupos.map(recalcularGrupo);
      const fechaVenta = detalle.captura.fecha_venta ?? fechaInputHoy();
      const deletes = [
        ...((pagosEliminados[capturaId] ?? []).length > 0 ? [supabase.from("captura_venta_pagos").delete().in("id", pagosEliminados[capturaId])] : []),
        ...((lineasEliminadas[capturaId] ?? []).length > 0 ? [supabase.from("captura_venta_lineas").delete().in("id", lineasEliminadas[capturaId])] : []),
      ];
      const deleteRespuestas = await Promise.all(deletes);
      const deleteError = deleteRespuestas.find((respuesta) => respuesta.error)?.error;
      if (deleteError) throw new Error(deleteError.message);
      const operaciones = [
        supabase.from("capturas_venta").update({ fecha_venta: fechaVenta, dia_negocio: fechaVenta }).eq("id", capturaId),
        ...grupos.map((grupo) => supabase.from("captura_venta_grupos").update({ total_leido: Math.max(0, Math.round(Number(grupo.total_leido ?? 0))), total_esperado: Math.max(0, Math.round(Number(grupo.total_esperado ?? 0))), diferencia: Math.round(Number(grupo.diferencia ?? 0)), tipo_diferencia: grupo.tipo_diferencia, descuento_autorizado: grupo.descuento_autorizado, ingreso_adicional: grupo.ingreso_adicional, requiere_revision: grupo.requiere_revision, aprobado: Boolean(grupo.aprobado), aprobado_at: grupo.aprobado ? (grupo.aprobado_at ?? new Date().toISOString()) : null, observacion: grupo.observacion }).eq("id", grupo.id)),
        ...grupos.flatMap((grupo) => groupLineOps(supabase, capturaId, grupo)),
        ...grupos.flatMap((grupo) => groupPaymentOps(supabase, capturaId, grupo)),
      ];
      const respuestas = await Promise.all(operaciones);
      const error = respuestas.find((respuesta) => respuesta.error)?.error;
      if (error) throw new Error(error.message);
      await Promise.all([cargarDetalle(capturaId), cargarResumen()]);
      setLineasEliminadas((actual) => ({ ...actual, [capturaId]: [] }));
      setPagosEliminados((actual) => ({ ...actual, [capturaId]: [] }));
      if (!silencioso) setMensaje("Revision admin guardada.");
      return true;
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo guardar la revision admin.");
      return false;
    } finally { setGuardando(null); }
  }
  async function aprobarVenta(capturaId: string, grupo: GrupoRevision) {
    if (!window.confirm(`Aprobar venta ${grupo.orden} y descontar inventario?`)) return;
    const guardada = await guardarRevision(capturaId, true); if (!guardada) return;
    setGuardando(grupo.id); setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("aprobar_venta_captura_admin", { p_grupo_id: grupo.id });
      if (error) throw new Error(error.message);
      await Promise.all([cargarDetalle(capturaId), cargarResumen()]);
      setMensaje(`Venta ${grupo.orden} aprobada y descontada del inventario.`);
    } catch (err) { setMensaje(err instanceof Error ? err.message : "No se pudo aprobar la venta."); }
    finally { setGuardando(null); }
  }

  async function aprobarCaptura(capturaId: string) {
    if (!window.confirm("Aprobar toda la captura y descontar inventario de todas las ventas listas?")) return;
    const detalle = detalles[capturaId]; if (!detalle) return;
    const pendientes = detalle.grupos.map(recalcularGrupo).filter((grupo) => !grupo.pedido_id && !grupo.eliminado_at && (grupo.requiere_revision || !grupo.aprobado)).length;
    if (pendientes > 0) { setMensaje(`Hay ${pendientes} venta(s) pendientes. Marcalas listas o eliminalas antes de aprobar toda la captura.`); return; }
    const guardada = await guardarRevision(capturaId, true); if (!guardada) return;
    setGuardando(capturaId); setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("aprobar_captura_venta_admin", { p_captura_id: capturaId });
      if (error) throw new Error(error.message);
      const ventas = Number((data as { ventas_confirmadas?: number } | null)?.ventas_confirmadas ?? 0);
      await Promise.all([cargarDetalle(capturaId), cargarResumen()]);
      setMensaje(`Captura aprobada. Se confirmaron ${ventas} venta(s).`);
    } catch (err) { setMensaje(err instanceof Error ? err.message : "No se pudo aprobar la captura."); }
    finally { setGuardando(null); }
  }

  async function eliminarVenta(capturaId: string, grupo: GrupoRevision) {
    if (!window.confirm(`Eliminar venta ${grupo.orden}? Si ya estaba confirmada, se devuelve inventario.`)) return;
    setGuardando(grupo.id); setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("eliminar_venta_captura", { p_grupo_id: grupo.id });
      if (error) throw new Error(error.message);
      await Promise.all([cargarDetalle(capturaId), cargarResumen()]);
      setMensaje(`Venta ${grupo.orden} eliminada.`);
    } catch (err) { setMensaje(err instanceof Error ? err.message : "No se pudo eliminar la venta."); }
    finally { setGuardando(null); }
  }

  async function eliminarCaptura(capturaId: string) {
    if (!window.confirm("Eliminar toda la captura? Si tenia ventas confirmadas, se devuelve inventario.")) return;
    setGuardando(capturaId); setMensaje(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("eliminar_captura_venta", { p_captura_id: capturaId });
      if (error) throw new Error(error.message);
      const resultado = data as EliminacionCapturaResultado | null;
      await cargarResumen();
      setDetalles((actual) => { const copia = { ...actual }; delete copia[capturaId]; return copia; });
      setAbiertas((actual) => ({ ...actual, [capturaId]: false }));
      setMensaje(`Captura eliminada. Ventas cerradas: ${resultado?.ventas_eliminadas ?? 0}. Reversadas: ${resultado?.ventas_reversadas ?? 0}.`);
    } catch (err) { setMensaje(err instanceof Error ? err.message : "No se pudo eliminar la captura."); }
    finally { setGuardando(null); }
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <ResumenCard titulo="Pendientes" valor={resumen.pendientes} />
        <ResumenCard titulo="Confirmadas" valor={resumen.confirmadas} />
        <ResumenCard titulo="Capturas" valor={resumen.total} />
      </div>

      <div className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-crema">Solicitudes de carga</h3>
            <p className="text-sm text-antiguo/65">Aprueba capturas enviadas por caja. La aprobacion registra ventas, pagos y descuento de inventario.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["pendientes", "todas", "confirmadas", "eliminadas"] as FiltroEstado[]).map((opcion) => (
              <button key={opcion} type="button" onClick={() => setFiltro(opcion)} className={filtro === opcion ? "tap-target rounded-md bg-oro px-3 text-sm font-black text-carbon" : "tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold text-crema"}>{opcion}</button>
            ))}
            <button type="button" onClick={() => void cargarInicial()} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold text-crema">Actualizar</button>
          </div>
        </div>
        {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm font-semibold text-champana">{mensaje}</p> : null}

        <div className="mt-4 space-y-3">
          {cargando ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">Cargando solicitudes...</p> : null}
          {!cargando && capturasVisibles.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">No hay capturas para este filtro.</p> : null}
          {capturasVisibles.map((captura) => {
            const abierta = Boolean(abiertas[captura.id]);
            const detalle = detalles[captura.id];
            const resumenDetalle = detalle ? resumenGrupos(detalle.grupos) : null;
            const puedeMarcarTodas = detalle ? detalle.grupos.some(itemEditable) : false;
            const capturaYaEliminada = detalle ? ["eliminada", "rechazada"].includes(detalle.captura.estado) : ["eliminada", "rechazada"].includes(captura.estado);
            return (
              <article key={captura.id} className="rounded-md border border-antiguo/15 bg-carbon">
                <button type="button" onClick={() => void toggleCaptura(captura.id)} className="w-full px-3 py-3 text-left sm:px-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-oro">{estadoCapturaTexto(captura.estado)}</p>
                      <h4 className="text-base font-black text-crema">Venta {formatoFecha(captura.fecha_venta)} / subida {fechaHoraCorta(captura.created_at)}</h4>
                      <p className="text-xs text-antiguo/60">Subio: {captura.subido_por ?? "-"} / Envio: {captura.enviado_por ?? "-"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[32rem]"><MiniDato etiqueta="Ventas" valor={captura.ventas_total} /><MiniDato etiqueta="Pendientes" valor={captura.ventas_pendientes} /><MiniDato etiqueta="Confirmadas" valor={captura.ventas_confirmadas} /><MiniDato etiqueta="Total" valor={formatoCOP(captura.total_leido)} /></div>
                  </div>
                </button>
                {abierta ? (
                  <div className="border-t border-antiguo/10 p-3 sm:p-4">
                    {!detalle ? <p className="rounded-md border border-antiguo/10 bg-espresso p-3 text-sm text-antiguo/70">Cargando detalle...</p> : null}
                    {detalle ? (
                      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
                        <aside className="space-y-3">
                          <div className="rounded-md border border-antiguo/10 bg-espresso p-2">{detalle.imagen_url ? <Image src={detalle.imagen_url} alt="Captura subida" width={700} height={900} unoptimized className="max-h-[32rem] w-full rounded-md object-contain" /> : <p className="p-4 text-center text-sm text-antiguo/70">Imagen no disponible</p>}</div>
                          <div className="grid grid-cols-2 gap-2 text-sm"><MiniDato etiqueta="Leido" valor={formatoCOP(resumenDetalle?.totalLeido ?? 0)} /><MiniDato etiqueta="Esperado" valor={formatoCOP(resumenDetalle?.totalEsperado ?? 0)} /><MiniDato etiqueta="Pendientes" valor={resumenDetalle?.pendientes ?? 0} /><MiniDato etiqueta="Confirmadas" valor={resumenDetalle?.confirmadas ?? 0} /></div>
                          <div className="grid gap-2">
                            <label className="text-xs font-bold text-antiguo/80">Fecha de venta<input type="date" value={detalle.captura.fecha_venta ?? fechaInputHoy()} onChange={(event) => actualizarFechaVenta(captura.id, event.target.value)} disabled={guardando !== null || !capturaEditable(detalle.captura, detalle.grupos)} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema disabled:opacity-60" /></label>
                            <button type="button" onClick={() => void guardarRevision(captura.id)} disabled={guardando !== null} className="tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">Guardar cambios</button>
                            <button type="button" onClick={() => void agregarVenta(captura.id)} disabled={guardando !== null || !capturaEditable(detalle.captura, detalle.grupos)} className="tap-target rounded-md border border-white/40 px-4 text-sm font-black text-white disabled:opacity-50">Agregar venta</button>
                            <button type="button" onClick={() => marcarTodasListas(captura.id)} disabled={guardando !== null || !puedeMarcarTodas} className="tap-target rounded-md bg-white px-4 text-sm font-black text-carbon disabled:opacity-50">Marcar como lista todas las ventas</button>
                            <button type="button" onClick={() => void aprobarCaptura(captura.id)} disabled={guardando !== null || (resumenDetalle?.pendientes ?? 1) > 0} className="tap-target rounded-md bg-green-600 px-4 text-sm font-black text-white disabled:opacity-50">Aprobar captura completa</button>
                            <button type="button" onClick={() => void eliminarCaptura(captura.id)} disabled={guardando !== null || capturaYaEliminada} className="tap-target rounded-md border border-red-300/40 px-4 text-sm font-bold text-red-100 disabled:opacity-50">{guardando === captura.id ? "Eliminando..." : "Eliminar captura"}</button>
                          </div>
                        </aside>
                        <div className="space-y-4">{detalle.grupos.map((grupo) => <GrupoAdminCard key={grupo.id} capturaId={captura.id} grupo={grupo} catalogo={catalogo} ocupado={guardando !== null} actualizarGrupo={actualizarGrupo} actualizarLinea={actualizarLinea} actualizarPago={actualizarPago} seleccionarItem={seleccionarItem} agregarLinea={agregarLinea} quitarLinea={quitarLinea} agregarPago={agregarPago} quitarPago={quitarPago} marcarLista={marcarLista} aprobarVenta={aprobarVenta} eliminarVenta={eliminarVenta} />)}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
function ResumenCard({ titulo, valor }: { titulo: string; valor: number }) {
  return <div className="rounded-md border border-antiguo/15 bg-espresso p-3 shadow-suave"><p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">{titulo}</p><p className="mt-1 text-2xl font-black text-dorado">{valor}</p></div>;
}
function MiniDato({ etiqueta, valor }: { etiqueta: string; valor: string | number }) {
  return <div className="rounded-md border border-antiguo/10 bg-espresso p-2"><p className="text-antiguo/60">{etiqueta}</p><p className="font-black text-dorado">{valor}</p></div>;
}

type GrupoAdminCardProps = {
  capturaId: string; grupo: GrupoRevision; catalogo: ItemCatalogo[]; ocupado: boolean;
  actualizarGrupo: (capturaId: string, grupoId: string, cambios: Partial<GrupoRevision>) => void;
  actualizarLinea: (capturaId: string, grupoId: string, lineaId: string, cambios: Partial<LineaRevision>) => void;
  actualizarPago: (capturaId: string, grupoId: string, pagoId: string, cambios: Partial<PagoRevision>) => void;
  seleccionarItem: (capturaId: string, grupoId: string, linea: LineaRevision, clave: string) => void;
  agregarLinea: (capturaId: string, grupo: GrupoRevision) => void; quitarLinea: (capturaId: string, grupo: GrupoRevision, linea: LineaRevision) => void;
  agregarPago: (capturaId: string, grupo: GrupoRevision) => void; quitarPago: (capturaId: string, grupo: GrupoRevision, pago: PagoRevision) => void;
  marcarLista: (capturaId: string, grupo: GrupoRevision) => void; aprobarVenta: (capturaId: string, grupo: GrupoRevision) => Promise<void>; eliminarVenta: (capturaId: string, grupo: GrupoRevision) => Promise<void>;
};

function GrupoAdminCard({ capturaId, grupo, catalogo, ocupado, actualizarGrupo, actualizarLinea, actualizarPago, seleccionarItem, agregarLinea, quitarLinea, agregarPago, quitarPago, marcarLista, aprobarVenta, eliminarVenta }: GrupoAdminCardProps) {
  const editable = itemEditable(grupo) && !ocupado;
  const estado = estadoVentaTexto(grupo);
  return (
    <article className="rounded-md border-2 border-white bg-espresso p-3">
      <div className="flex flex-col gap-2 border-b border-white/25 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-wide text-oro">Venta {grupo.orden}</p><p className="text-sm text-antiguo/70">{grupo.texto_original ?? "Sin texto original"}</p></div>
        <div className="flex flex-wrap gap-2"><span className={`rounded-md border px-3 py-2 text-xs font-black ${estado.clase}`}>{estado.texto}</span><span className={`rounded-md border px-3 py-2 text-xs font-black ${diferenciaClass(grupo.tipo_diferencia)}`}>Diferencia {formatoCOP(grupo.diferencia)}</span></div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-bold text-antiguo/80">Total leido<input type="number" min="0" inputMode="numeric" value={grupo.total_leido} onChange={(event) => actualizarGrupo(capturaId, grupo.id, { total_leido: Number(event.target.value) })} disabled={!editable} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema disabled:opacity-60" /></label>
        <MiniDato etiqueta="Esperado catalogo" valor={formatoCOP(grupo.total_esperado)} />
        <MiniDato etiqueta="Pagos" valor={formatoCOP(grupo.pagos.reduce((sum, pago) => sum + Number(pago.monto ?? 0), 0))} />
      </div>
      {grupo.tipo_diferencia === "negativa" ? <label className="mt-2 flex items-center gap-2 rounded-md border border-red-400/20 bg-red-950/20 px-3 py-2 text-sm"><input type="checkbox" checked={grupo.descuento_autorizado} onChange={(event) => actualizarGrupo(capturaId, grupo.id, { descuento_autorizado: event.target.checked })} disabled={!editable} />Faltante autorizado</label> : null}
      {grupo.tipo_diferencia === "positiva" ? <label className="mt-2 flex items-center gap-2 rounded-md border border-green-400/20 bg-green-950/20 px-3 py-2 text-sm"><input type="checkbox" checked={grupo.ingreso_adicional} onChange={(event) => actualizarGrupo(capturaId, grupo.id, { ingreso_adicional: event.target.checked })} disabled={!editable} />Ingreso adicional</label> : null}
      <section className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold text-dorado">Productos</p><button type="button" onClick={() => agregarLinea(capturaId, grupo)} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold disabled:opacity-50">Agregar item</button></div>
        {grupo.lineas.map((linea) => (
          <div key={linea.id} className="rounded-md border border-antiguo/10 bg-carbon p-3"><p className="text-xs text-antiguo/60">Leido: {linea.texto_original ?? linea.item_nombre_detectado ?? "-"}</p>
            <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_80px_110px_110px_auto]">
              <select value={valorItem(linea)} onChange={(event) => seleccionarItem(capturaId, grupo.id, linea, event.target.value)} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema disabled:opacity-60"><option value="">Sin match - {nombreDetectado(linea)}</option>{catalogo.map((item) => <option key={item.clave} value={item.clave}>{item.tipo === "combo" ? "Combo - " : ""}{item.nombre}</option>)}</select>
              <input type="number" min="1" inputMode="numeric" value={linea.cantidad} onChange={(event) => actualizarLinea(capturaId, grupo.id, linea.id, { cantidad: Number(event.target.value) })} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema disabled:opacity-60" />
              <input type="number" min="0" inputMode="numeric" value={linea.precio_catalogo} onChange={(event) => actualizarLinea(capturaId, grupo.id, linea.id, { precio_catalogo: Number(event.target.value), requiere_revision: true })} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema disabled:opacity-60" />
              <p className="rounded-md border border-antiguo/10 bg-espresso px-3 py-3 text-sm font-bold text-dorado">{formatoCOP(linea.subtotal_esperado)}</p>
              <button type="button" onClick={() => quitarLinea(capturaId, grupo, linea)} disabled={!editable} className="tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100 disabled:opacity-50">Quitar</button>
            </div>
          </div>
        ))}
      </section>
      <section className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold text-dorado">Pagos</p><button type="button" onClick={() => agregarPago(capturaId, grupo)} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold disabled:opacity-50">Agregar pago</button></div>
        {grupo.pagos.map((pago) => (
          <div key={pago.id} className="rounded-md border border-antiguo/10 bg-carbon p-3"><p className="text-xs text-antiguo/60">Leido: {pago.medio_detectado ?? "-"}</p>
            <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_130px_130px_auto]">
              <select value={pago.medio_normalizado ?? ""} onChange={(event) => { const medio = event.target.value as MedioPago | ""; actualizarPago(capturaId, grupo.id, pago.id, { medio_normalizado: medio || null, requiere_revision: !medio }); }} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema disabled:opacity-60"><option value="">Medio por revisar</option>{mediosPago.map((medio) => <option key={medio.id} value={medio.id}>{medio.nombre}</option>)}</select>
              <input value={pago.cuenta_destino ?? ""} onChange={(event) => actualizarPago(capturaId, grupo.id, pago.id, { cuenta_destino: event.target.value || null })} placeholder="Cuenta" disabled={!editable} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50 disabled:opacity-60" />
              <input type="number" min="0" inputMode="numeric" value={pago.monto} onChange={(event) => actualizarPago(capturaId, grupo.id, pago.id, { monto: Number(event.target.value), requiere_revision: Number(event.target.value) <= 0 })} disabled={!editable} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema disabled:opacity-60" />
              <button type="button" onClick={() => quitarPago(capturaId, grupo, pago)} disabled={!editable} className="tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100 disabled:opacity-50">Quitar</button>
            </div>
          </div>
        ))}
      </section>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => marcarLista(capturaId, grupo)} disabled={!editable} className="tap-target rounded-md bg-white px-3 text-xs font-black text-carbon disabled:opacity-50">Marcar lista</button>
        <button type="button" onClick={() => actualizarGrupo(capturaId, grupo.id, { requiere_revision: true, aprobado: false, aprobado_at: null })} disabled={!editable} className="tap-target rounded-md border border-white/35 px-3 text-xs font-bold text-white disabled:opacity-50">Marcar para revisar</button>
        <button type="button" onClick={() => void aprobarVenta(capturaId, grupo)} disabled={!editable || grupo.requiere_revision || !grupo.aprobado} className="tap-target rounded-md bg-green-600 px-3 text-xs font-black text-white disabled:opacity-50">Aprobar venta</button>
        <button type="button" onClick={() => void eliminarVenta(capturaId, grupo)} disabled={ocupado || Boolean(grupo.eliminado_at)} className="tap-target rounded-md border border-red-300/40 px-3 text-xs font-bold text-red-100 disabled:opacity-50">Eliminar venta</button>
      </div>
    </article>
  );
}
async function recargarResultado(supabase: ReturnType<typeof supabaseBrowser>, capturaId: string) {
  const [{ data: grupos, error: gruposError }, { data: lineas, error: lineasError }, { data: pagos, error: pagosError }] = await Promise.all([
    supabase.from("captura_venta_grupos").select("*").eq("captura_id", capturaId).order("orden"),
    supabase.from("captura_venta_lineas").select("*, productos(nombre,precio_venta), combos(nombre,precio_venta)").eq("captura_id", capturaId).order("orden"),
    supabase.from("captura_venta_pagos").select("*").eq("captura_id", capturaId).order("orden"),
  ]);
  if (gruposError) throw new Error(gruposError.message);
  if (lineasError) throw new Error(lineasError.message);
  if (pagosError) throw new Error(pagosError.message);
  return ((grupos ?? []) as GrupoRevision[]).map((grupo) => ({
    ...grupo,
    lineas: ((lineas ?? []) as LineaRevision[]).filter((linea) => linea.grupo_id === grupo.id),
    pagos: ((pagos ?? []) as PagoRevision[]).filter((pago) => pago.grupo_id === grupo.id),
  }));
}

function groupLineOps(supabase: ReturnType<typeof supabaseBrowser>, capturaId: string, grupo: GrupoRevision) {
  return grupo.lineas.map((linea) => {
    const payload = {
      captura_id: capturaId,
      grupo_id: grupo.id,
      orden: linea.orden,
      texto_original: linea.texto_original,
      item_nombre_detectado: linea.item_nombre_detectado,
      tipo_item: linea.tipo_item,
      producto_id: linea.producto_id,
      combo_id: linea.combo_id,
      cantidad: Math.max(1, Math.round(Number(linea.cantidad ?? 1))),
      valor_unitario: Math.max(0, Math.round(Number(linea.valor_unitario ?? 0))),
      subtotal: Math.max(0, Math.round(Number(linea.subtotal ?? 0))),
      precio_catalogo: Math.max(0, Math.round(Number(linea.precio_catalogo ?? 0))),
      subtotal_esperado: Math.max(0, Math.round(Number(linea.subtotal_esperado ?? 0))),
      requiere_revision: linea.requiere_revision,
    };
    return esNuevo(linea.id) ? supabase.from("captura_venta_lineas").insert(payload) : supabase.from("captura_venta_lineas").update(payload).eq("id", linea.id);
  });
}

function groupPaymentOps(supabase: ReturnType<typeof supabaseBrowser>, capturaId: string, grupo: GrupoRevision) {
  return grupo.pagos.map((pago) => {
    const payload = {
      captura_id: capturaId,
      grupo_id: grupo.id,
      orden: pago.orden,
      medio_detectado: pago.medio_detectado,
      medio_normalizado: pago.medio_normalizado,
      cuenta_destino: pago.cuenta_destino,
      monto: Math.max(0, Math.round(Number(pago.monto ?? 0))),
      requiere_revision: pago.requiere_revision,
    };
    return esNuevo(pago.id) ? supabase.from("captura_venta_pagos").insert(payload) : supabase.from("captura_venta_pagos").update(payload).eq("id", pago.id);
  });
}
