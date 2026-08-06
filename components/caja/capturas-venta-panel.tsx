"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";
type TipoItem = "producto" | "combo" | "desconocido";
type TipoDiferencia = "positiva" | "negativa" | "cero";

type ItemCatalogo = {
  clave: string;
  id: string;
  tipo: "producto" | "combo";
  nombre: string;
  precio_venta: number;
};

type CapturaVenta = {
  id: string;
  estado: string;
  storage_path: string;
  nombre_archivo: string | null;
  modelo_ia: string | null;
  advertencias: string[] | null;
  created_at: string;
};

type LineaRevision = {
  id: string;
  captura_id: string;
  grupo_id: string | null;
  orden: number;
  texto_original: string | null;
  item_nombre_detectado: string | null;
  tipo_item: TipoItem;
  producto_id: string | null;
  combo_id: string | null;
  cantidad: number;
  valor_unitario: number;
  subtotal: number;
  precio_catalogo: number;
  subtotal_esperado: number;
  confianza_ia: number;
  puntaje_match: number;
  requiere_revision: boolean;
  productos?: { nombre?: string; precio_venta?: number } | null;
  combos?: { nombre?: string; precio_venta?: number } | null;
};

type PagoRevision = {
  id: string;
  captura_id: string;
  grupo_id: string | null;
  orden: number;
  medio_detectado: string | null;
  medio_normalizado: MedioPago | null;
  cuenta_destino: string | null;
  monto: number;
  confianza_ia: number;
  requiere_revision: boolean;
};

type GrupoRevision = {
  id: string;
  captura_id: string;
  orden: number;
  texto_original: string | null;
  total_leido: number;
  total_esperado: number;
  diferencia: number;
  tipo_diferencia: TipoDiferencia;
  descuento_autorizado: boolean;
  ingreso_adicional: boolean;
  confianza_ia: number;
  requiere_revision: boolean;
  observacion: string | null;
  lineas: LineaRevision[];
  pagos: PagoRevision[];
};

type RespuestaProceso = {
  captura: CapturaVenta;
  grupos: GrupoRevision[];
  lineas?: LineaRevision[];
  pagos?: PagoRevision[];
};

const mediosPago: { id: MedioPago; nombre: string }[] = [
  { id: "efectivo", nombre: "Efectivo" },
  { id: "datafono", nombre: "Datafono" },
  { id: "nequi_daviplata", nombre: "Nequi/Daviplata" },
  { id: "transferencia", nombre: "Transferencia" },
];

function esNuevo(id: string) {
  return id.startsWith("nuevo:");
}

function nuevoId() {
  return `nuevo:${crypto.randomUUID()}`;
}

function porcentaje(valor: number) {
  return `${Math.round(Number(valor ?? 0) * 100)}%`;
}

function tipoDiferencia(diferencia: number): TipoDiferencia {
  if (diferencia > 0) return "positiva";
  if (diferencia < 0) return "negativa";
  return "cero";
}

function valorItem(linea: LineaRevision) {
  if (linea.tipo_item === "producto" && linea.producto_id) return `producto:${linea.producto_id}`;
  if (linea.tipo_item === "combo" && linea.combo_id) return `combo:${linea.combo_id}`;
  return "";
}

function nombreDetectado(linea: LineaRevision) {
  return linea.productos?.nombre ?? linea.combos?.nombre ?? linea.item_nombre_detectado ?? "Sin match";
}

function nombreMedio(medio: MedioPago | null) {
  return mediosPago.find((item) => item.id === medio)?.nombre ?? "Por revisar";
}

function recalcularGrupo(grupo: GrupoRevision): GrupoRevision {
  const totalEsperado = grupo.lineas.reduce((sum, linea) => sum + Number(linea.subtotal_esperado ?? 0), 0);
  const diferencia = Number(grupo.total_leido ?? 0) - totalEsperado;
  const pagosTotal = grupo.pagos.reduce((sum, pago) => sum + Number(pago.monto ?? 0), 0);
  const tipo = tipoDiferencia(diferencia);
  const ingresoAdicional = tipo === "positiva" ? grupo.ingreso_adicional : false;
  const descuentoAutorizado = tipo === "negativa" ? grupo.descuento_autorizado : false;
  const diferenciaPendiente =
    (tipo === "positiva" && !ingresoAdicional) ||
    (tipo === "negativa" && !descuentoAutorizado);
  const requiereRevision =
    grupo.lineas.some((linea) => linea.requiere_revision) ||
    grupo.pagos.some((pago) => pago.requiere_revision) ||
    diferenciaPendiente ||
    pagosTotal !== Number(grupo.total_leido ?? 0) ||
    grupo.lineas.length === 0;

  return {
    ...grupo,
    total_esperado: totalEsperado,
    diferencia,
    tipo_diferencia: tipo,
    ingreso_adicional: ingresoAdicional,
    descuento_autorizado: descuentoAutorizado,
    requiere_revision: requiereRevision,
  };
}

function diferenciaClass(tipo: TipoDiferencia) {
  if (tipo === "positiva") return "border-green-400/30 bg-green-950/25 text-green-100";
  if (tipo === "negativa") return "border-red-400/30 bg-red-950/30 text-red-100";
  return "border-antiguo/10 bg-espresso text-antiguo/80";
}

export function CapturasVentaPanel() {
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [foto, setFoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resultado, setResultado] = useState<RespuestaProceso | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [lineasEliminadas, setLineasEliminadas] = useState<string[]>([]);
  const [pagosEliminados, setPagosEliminados] = useState<string[]>([]);
  const camaraInputRef = useRef<HTMLInputElement | null>(null);
  const galeriaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargarCatalogo() {
      const supabase = supabaseBrowser();
      const [{ data: productos, error: productosError }, { data: combos, error: combosError }] = await Promise.all([
        supabase.from("v_productos_operativos").select("id,nombre,precio_venta,presentacion_compra").order("nombre"),
        supabase.from("combos").select("id,nombre,precio_venta").eq("activo", true).order("nombre"),
      ]);

      if (productosError) throw productosError;
      if (combosError) throw combosError;

      const items = [
        ...((productos ?? []) as any[]).map((producto) => ({
          clave: `producto:${producto.id}`,
          id: producto.id,
          tipo: "producto" as const,
          nombre: `${producto.nombre}${producto.presentacion_compra ? ` - ${producto.presentacion_compra}` : ""}`,
          precio_venta: Number(producto.precio_venta ?? 0),
        })),
        ...((combos ?? []) as any[]).map((combo) => ({
          clave: `combo:${combo.id}`,
          id: combo.id,
          tipo: "combo" as const,
          nombre: combo.nombre,
          precio_venta: Number(combo.precio_venta ?? 0),
        })),
      ];

      if (activo) setCatalogo(items);
    }

    cargarCatalogo().catch((err) => {
      if (activo) setMensaje(err instanceof Error ? err.message : "No se pudo cargar el catalogo.");
    });

    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    if (!foto) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(foto);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  const resumen = useMemo(() => {
    const grupos = resultado?.grupos ?? [];
    const totalLeido = grupos.reduce((sum, grupo) => sum + Number(grupo.total_leido ?? 0), 0);
    const totalEsperado = grupos.reduce((sum, grupo) => sum + Number(grupo.total_esperado ?? 0), 0);
    const faltante = grupos.reduce((sum, grupo) => sum + (grupo.diferencia < 0 ? Math.abs(Number(grupo.diferencia)) : 0), 0);
    const positivo = grupos.reduce((sum, grupo) => sum + (grupo.diferencia > 0 ? Number(grupo.diferencia) : 0), 0);
    return {
      totalLeido,
      totalEsperado,
      faltante,
      positivo,
      neto: positivo - faltante,
      pendientesRevision: grupos.filter((grupo) => grupo.requiere_revision).length,
    };
  }, [resultado]);

  function seleccionarArchivo(file: File | null) {
    setFoto(file);
    setResultado(null);
    setLineasEliminadas([]);
    setPagosEliminados([]);
    setMensaje(null);
  }

  function actualizarGrupo(id: string, cambios: Partial<GrupoRevision>) {
    setResultado((actual) => {
      if (!actual) return actual;
      return {
        ...actual,
        grupos: actual.grupos.map((grupo) => (grupo.id === id ? recalcularGrupo({ ...grupo, ...cambios }) : grupo)),
      };
    });
  }

  function actualizarLinea(grupoId: string, lineaId: string, cambios: Partial<LineaRevision>) {
    setResultado((actual) => {
      if (!actual) return actual;
      return {
        ...actual,
        grupos: actual.grupos.map((grupo) => {
          if (grupo.id !== grupoId) return grupo;
          const lineas = grupo.lineas.map((linea) => {
            if (linea.id !== lineaId) return linea;
            const siguiente = { ...linea, ...cambios };
            if ("cantidad" in cambios || "precio_catalogo" in cambios) {
              siguiente.subtotal_esperado = Math.max(0, Math.round(Number(siguiente.cantidad ?? 0) * Number(siguiente.precio_catalogo ?? 0)));
            }
            if ("cantidad" in cambios || "valor_unitario" in cambios) {
              siguiente.subtotal = Math.max(0, Math.round(Number(siguiente.cantidad ?? 0) * Number(siguiente.valor_unitario ?? 0)));
            }
            return siguiente;
          });
          return recalcularGrupo({ ...grupo, lineas });
        }),
      };
    });
  }

  function actualizarPago(grupoId: string, pagoId: string, cambios: Partial<PagoRevision>) {
    setResultado((actual) => {
      if (!actual) return actual;
      return {
        ...actual,
        grupos: actual.grupos.map((grupo) => {
          if (grupo.id !== grupoId) return grupo;
          const pagos = grupo.pagos.map((pago) => (pago.id === pagoId ? { ...pago, ...cambios } : pago));
          return recalcularGrupo({ ...grupo, pagos });
        }),
      };
    });
  }

  function seleccionarItem(grupoId: string, linea: LineaRevision, clave: string) {
    const item = catalogo.find((actual) => actual.clave === clave);
    if (!item) {
      actualizarLinea(grupoId, linea.id, { tipo_item: "desconocido", producto_id: null, combo_id: null, precio_catalogo: 0, subtotal_esperado: 0, requiere_revision: true });
      return;
    }

    const precio = Number(item.precio_venta ?? 0);
    actualizarLinea(grupoId, linea.id, {
      tipo_item: item.tipo,
      producto_id: item.tipo === "producto" ? item.id : null,
      combo_id: item.tipo === "combo" ? item.id : null,
      precio_catalogo: precio,
      subtotal_esperado: Math.max(0, Math.round(Number(linea.cantidad ?? 1) * precio)),
      requiere_revision: false,
    });
  }

  function agregarLinea(grupo: GrupoRevision) {
    const linea: LineaRevision = {
      id: nuevoId(),
      captura_id: grupo.captura_id,
      grupo_id: grupo.id,
      orden: grupo.lineas.length + 1,
      texto_original: null,
      item_nombre_detectado: null,
      tipo_item: "desconocido",
      producto_id: null,
      combo_id: null,
      cantidad: 1,
      valor_unitario: 0,
      subtotal: 0,
      precio_catalogo: 0,
      subtotal_esperado: 0,
      confianza_ia: 0,
      puntaje_match: 0,
      requiere_revision: true,
    };
    actualizarGrupo(grupo.id, { lineas: [...grupo.lineas, linea] });
  }

  function quitarLinea(grupoId: string, linea: LineaRevision) {
    if (!esNuevo(linea.id)) setLineasEliminadas((actual) => [...actual, linea.id]);
    setResultado((actual) => {
      if (!actual) return actual;
      return {
        ...actual,
        grupos: actual.grupos.map((grupo) => grupo.id === grupoId ? recalcularGrupo({ ...grupo, lineas: grupo.lineas.filter((actualLinea) => actualLinea.id !== linea.id) }) : grupo),
      };
    });
  }

  function agregarPago(grupo: GrupoRevision) {
    const pago: PagoRevision = {
      id: nuevoId(),
      captura_id: grupo.captura_id,
      grupo_id: grupo.id,
      orden: grupo.pagos.length + 1,
      medio_detectado: null,
      medio_normalizado: null,
      cuenta_destino: null,
      monto: 0,
      confianza_ia: 0,
      requiere_revision: true,
    };
    actualizarGrupo(grupo.id, { pagos: [...grupo.pagos, pago] });
  }

  function quitarPago(grupoId: string, pago: PagoRevision) {
    if (!esNuevo(pago.id)) setPagosEliminados((actual) => [...actual, pago.id]);
    setResultado((actual) => {
      if (!actual) return actual;
      return {
        ...actual,
        grupos: actual.grupos.map((grupo) => grupo.id === grupoId ? recalcularGrupo({ ...grupo, pagos: grupo.pagos.filter((actualPago) => actualPago.id !== pago.id) }) : grupo),
      };
    });
  }

  async function procesarFoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!foto) {
      setMensaje("Selecciona una foto primero.");
      return;
    }

    setMensaje(null);
    setProcesando(true);
    setResultado(null);
    setLineasEliminadas([]);
    setPagosEliminados([]);

    try {
      const supabase = supabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sesion requerida.");

      const formData = new FormData();
      formData.append("foto", foto);

      const response = await fetch("/api/capturas/procesar", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo procesar la foto.");

      setResultado(data as RespuestaProceso);
      setMensaje("Lectura lista por ventas. Todavia no se registra una venta real.");
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo procesar la foto.");
    } finally {
      setProcesando(false);
    }
  }

  async function guardarRevision() {
    if (!resultado) return;
    setMensaje(null);
    setGuardando(true);

    try {
      const supabase = supabaseBrowser();
      const grupos = resultado.grupos.map(recalcularGrupo);

      const deletes = [
        ...(pagosEliminados.length > 0 ? [supabase.from("captura_venta_pagos").delete().in("id", pagosEliminados)] : []),
        ...(lineasEliminadas.length > 0 ? [supabase.from("captura_venta_lineas").delete().in("id", lineasEliminadas)] : []),
      ];
      const deleteRespuestas = await Promise.all(deletes);
      const deleteError = deleteRespuestas.find((respuesta) => respuesta.error)?.error;
      if (deleteError) throw new Error(deleteError.message);

      const grupoUpdates = grupos.map((grupo) =>
        supabase
          .from("captura_venta_grupos")
          .update({
            total_leido: Math.max(0, Math.round(Number(grupo.total_leido ?? 0))),
            total_esperado: Math.max(0, Math.round(Number(grupo.total_esperado ?? 0))),
            diferencia: Math.round(Number(grupo.diferencia ?? 0)),
            tipo_diferencia: grupo.tipo_diferencia,
            descuento_autorizado: grupo.descuento_autorizado,
            ingreso_adicional: grupo.ingreso_adicional,
            requiere_revision: grupo.requiere_revision,
            observacion: grupo.observacion,
          })
          .eq("id", grupo.id),
      );

      const lineaOperaciones = grupos.flatMap((grupo) => groupLineOps(supabase, resultado.captura.id, grupo));
      const pagoOperaciones = grupos.flatMap((grupo) => groupPaymentOps(supabase, resultado.captura.id, grupo));
      const respuestas = await Promise.all([...grupoUpdates, ...lineaOperaciones, ...pagoOperaciones]);
      const error = respuestas.find((respuesta) => respuesta.error)?.error;
      if (error) throw new Error(error.message);

      const sigueDudosa = grupos.some((grupo) => grupo.requiere_revision);
      const { error: capturaError } = await supabase
        .from("capturas_venta")
        .update({ estado: sigueDudosa ? "requiere_revision" : "procesada" })
        .eq("id", resultado.captura.id);
      if (capturaError) throw new Error(capturaError.message);

      const recargado = await recargarResultado(supabase, resultado.captura.id);
      setResultado({
        captura: { ...resultado.captura, estado: sigueDudosa ? "requiere_revision" : "procesada" },
        grupos: recargado,
      });
      setLineasEliminadas([]);
      setPagosEliminados([]);
      setMensaje("Revision guardada. Las diferencias quedan listas para ajustar en Fase 2.");
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo guardar la revision.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">Lector de foto</p>
          <h2 className="text-xl font-black text-crema">Revision asistida</h2>
          <p className="mt-1 text-sm text-antiguo/70">Sube la anotacion, revisa ventas, pagos y diferencias.</p>
        </div>
        {resultado ? (
          <div className="grid grid-cols-2 gap-2 text-center text-xs sm:min-w-[28rem] sm:grid-cols-4">
            <div className="rounded-md border border-antiguo/10 bg-carbon p-2"><p className="text-antiguo/60">Ventas</p><p className="font-black text-dorado">{resultado.grupos.length}</p></div>
            <div className="rounded-md border border-red-400/20 bg-red-950/20 p-2"><p className="text-antiguo/60">Faltante</p><p className="font-black text-red-100">{formatoCOP(resumen.faltante)}</p></div>
            <div className="rounded-md border border-green-400/20 bg-green-950/20 p-2"><p className="text-antiguo/60">Positivo</p><p className="font-black text-green-100">{formatoCOP(resumen.positivo)}</p></div>
            <div className="rounded-md border border-antiguo/10 bg-carbon p-2"><p className="text-antiguo/60">Neto</p><p className="font-black text-dorado">{formatoCOP(resumen.neto)}</p></div>
          </div>
        ) : null}
      </div>

      <form onSubmit={procesarFoto} className="mt-4 grid gap-3 lg:grid-cols-[260px_1fr]">
        <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-antiguo/25 bg-carbon p-3 text-center text-sm text-antiguo/70">
          {previewUrl ? <Image src={previewUrl} alt="Foto seleccionada" width={640} height={480} unoptimized className="max-h-72 w-full rounded-md object-contain" /> : <span>Selecciona una foto de la hoja</span>}
          <input ref={camaraInputRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { seleccionarArchivo(event.target.files?.[0] ?? null); event.target.value = ""; }} />
          <input ref={galeriaInputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => { seleccionarArchivo(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        </div>
        <div className="flex flex-col justify-between gap-3 rounded-md border border-antiguo/10 bg-carbon p-3">
          <div>
            <p className="text-sm font-bold text-crema">Fase 1 activa</p>
            <p className="mt-1 text-sm text-antiguo/70">La IA agrupa productos por venta, asocia pagos y calcula diferencias contra catalogo.</p>
            {foto ? <p className="mt-3 text-xs text-antiguo/60">Archivo: {foto.name} ({Math.round(foto.size / 1024)} KB)</p> : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => camaraInputRef.current?.click()} className="tap-target rounded-md border border-antiguo/20 px-4 text-sm font-bold">Tomar foto</button>
            <button type="button" onClick={() => galeriaInputRef.current?.click()} className="tap-target rounded-md border border-antiguo/20 px-4 text-sm font-bold">Subir galeria</button>
            <button type="submit" disabled={procesando || !foto} className="tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">{procesando ? "Procesando..." : "Procesar foto"}</button>
            <button type="button" onClick={() => seleccionarArchivo(null)} className="tap-target rounded-md border border-antiguo/20 px-4 text-sm font-bold">Limpiar</button>
          </div>
        </div>
      </form>

      {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm text-champana">{mensaje}</p> : null}

      {resultado ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-oro/20 bg-carbon p-3">
            <div className="grid gap-2 text-sm sm:grid-cols-4">
              <p>Total leido: <strong className="text-dorado">{formatoCOP(resumen.totalLeido)}</strong></p>
              <p>Esperado: <strong className="text-dorado">{formatoCOP(resumen.totalEsperado)}</strong></p>
              <p>Faltante: <strong className="text-red-100">{formatoCOP(resumen.faltante)}</strong></p>
              <p>Positivo: <strong className="text-green-100">{formatoCOP(resumen.positivo)}</strong></p>
            </div>
          </div>

          {resultado.grupos.map((grupo) => (
            <article key={grupo.id} className="rounded-md border border-antiguo/10 bg-carbon p-3">
              <div className="flex flex-col gap-2 border-b border-antiguo/10 pb-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-oro">Venta {grupo.orden}</p>
                  <p className="text-sm text-antiguo/70">Leido: {grupo.texto_original ?? "-"}</p>
                  <p className="text-xs text-antiguo/55">Confianza {porcentaje(grupo.confianza_ia)}</p>
                </div>
                <div className={`rounded-md border px-3 py-2 text-sm font-bold ${diferenciaClass(grupo.tipo_diferencia)}`}>
                  Diferencia {formatoCOP(grupo.diferencia)}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label className="text-xs font-bold text-antiguo/80">Total leido<input type="number" min="0" inputMode="numeric" value={grupo.total_leido} onChange={(event) => actualizarGrupo(grupo.id, { total_leido: Number(event.target.value) })} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" /></label>
                <div className="rounded-md border border-antiguo/10 bg-espresso p-3 text-sm"><p className="text-antiguo/60">Esperado catalogo</p><p className="font-black text-dorado">{formatoCOP(grupo.total_esperado)}</p></div>
                <label className="flex items-center gap-2 rounded-md border border-antiguo/10 bg-espresso px-3 text-sm font-bold"><input type="checkbox" checked={grupo.requiere_revision} onChange={(event) => actualizarGrupo(grupo.id, { requiere_revision: event.target.checked })} />Revisar</label>
              </div>

              {grupo.tipo_diferencia === "negativa" ? <label className="mt-2 flex items-center gap-2 rounded-md border border-red-400/20 bg-red-950/20 px-3 py-2 text-sm"><input type="checkbox" checked={grupo.descuento_autorizado} onChange={(event) => actualizarGrupo(grupo.id, { descuento_autorizado: event.target.checked })} />Descuento/faltante autorizado</label> : null}
              {grupo.tipo_diferencia === "positiva" ? <label className="mt-2 flex items-center gap-2 rounded-md border border-green-400/20 bg-green-950/20 px-3 py-2 text-sm"><input type="checkbox" checked={grupo.ingreso_adicional} onChange={(event) => actualizarGrupo(grupo.id, { ingreso_adicional: event.target.checked })} />Registrar luego como ingreso adicional</label> : null}
              {grupo.observacion ? <p className="mt-2 rounded-md border border-antiguo/10 bg-espresso p-2 text-xs text-antiguo/70">{grupo.observacion}</p> : null}

              <section className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold text-dorado">Productos</p><button type="button" onClick={() => agregarLinea(grupo)} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold">Agregar item</button></div>
                {grupo.lineas.map((linea) => (
                  <div key={linea.id} className="rounded-md border border-antiguo/10 bg-espresso p-3">
                    <p className="text-xs text-antiguo/60">Leido: {linea.texto_original ?? linea.item_nombre_detectado ?? "-"} / match {porcentaje(linea.puntaje_match)}</p>
                    <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_80px_110px_110px_auto]">
                      <select value={valorItem(linea)} onChange={(event) => seleccionarItem(grupo.id, linea, event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema"><option value="">Sin match - {nombreDetectado(linea)}</option>{catalogo.map((item) => <option key={item.clave} value={item.clave}>{item.tipo === "combo" ? "Combo - " : ""}{item.nombre}</option>)}</select>
                      <input type="number" min="1" inputMode="numeric" value={linea.cantidad} onChange={(event) => actualizarLinea(grupo.id, linea.id, { cantidad: Number(event.target.value) })} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
                      <input type="number" min="0" inputMode="numeric" value={linea.precio_catalogo} onChange={(event) => actualizarLinea(grupo.id, linea.id, { precio_catalogo: Number(event.target.value), requiere_revision: true })} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
                      <p className="rounded-md border border-antiguo/10 bg-carbon px-3 py-3 text-sm font-bold text-dorado">{formatoCOP(linea.subtotal_esperado)}</p>
                      <button type="button" onClick={() => quitarLinea(grupo.id, linea)} className="tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100">Quitar</button>
                    </div>
                  </div>
                ))}
              </section>

              <section className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold text-dorado">Pagos</p><button type="button" onClick={() => agregarPago(grupo)} className="tap-target rounded-md border border-antiguo/20 px-3 text-xs font-bold">Agregar pago</button></div>
                {grupo.pagos.map((pago) => (
                  <div key={pago.id} className="rounded-md border border-antiguo/10 bg-espresso p-3">
                    <p className="text-xs text-antiguo/60">Leido: {pago.medio_detectado ?? nombreMedio(pago.medio_normalizado)} / confianza {porcentaje(pago.confianza_ia)}</p>
                    <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_130px_130px_auto]">
                      <select value={pago.medio_normalizado ?? ""} onChange={(event) => { const medio = event.target.value as MedioPago | ""; actualizarPago(grupo.id, pago.id, { medio_normalizado: medio || null, requiere_revision: !medio }); }} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema"><option value="">Medio por revisar</option>{mediosPago.map((medio) => <option key={medio.id} value={medio.id}>{medio.nombre}</option>)}</select>
                      <input value={pago.cuenta_destino ?? ""} onChange={(event) => actualizarPago(grupo.id, pago.id, { cuenta_destino: event.target.value || null })} placeholder="Cuenta" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                      <input type="number" min="0" inputMode="numeric" value={pago.monto} onChange={(event) => actualizarPago(grupo.id, pago.id, { monto: Number(event.target.value), requiere_revision: Number(event.target.value) <= 0 })} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
                      <button type="button" onClick={() => quitarPago(grupo.id, pago)} className="tap-target rounded-md border border-red-300/30 px-3 text-xs font-bold text-red-100">Quitar</button>
                    </div>
                  </div>
                ))}
              </section>
            </article>
          ))}

          {resultado.grupos.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">No se detectaron ventas.</p> : null}

          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <p className="text-xs text-antiguo/60">Este guardado solo conserva la revision asistida. La confirmacion transaccional entra en la Fase 2.</p>
            <button type="button" onClick={guardarRevision} disabled={guardando} className="tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">{guardando ? "Guardando..." : "Guardar revision"}</button>
          </div>
        </div>
      ) : null}
    </section>
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

    return esNuevo(linea.id)
      ? supabase.from("captura_venta_lineas").insert(payload)
      : supabase.from("captura_venta_lineas").update(payload).eq("id", linea.id);
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

    return esNuevo(pago.id)
      ? supabase.from("captura_venta_pagos").insert(payload)
      : supabase.from("captura_venta_pagos").update(payload).eq("id", pago.id);
  });
}
