"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";
type TipoItem = "producto" | "combo" | "desconocido";

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
  orden: number;
  texto_original: string | null;
  item_nombre_detectado: string | null;
  tipo_item: TipoItem;
  producto_id: string | null;
  combo_id: string | null;
  cantidad: number;
  valor_unitario: number;
  subtotal: number;
  confianza_ia: number;
  puntaje_match: number;
  requiere_revision: boolean;
  productos?: { nombre?: string; precio_venta?: number } | null;
  combos?: { nombre?: string; precio_venta?: number } | null;
};

type PagoRevision = {
  id: string;
  captura_id: string;
  medio_detectado: string | null;
  medio_normalizado: MedioPago | null;
  monto: number;
  confianza_ia: number;
  requiere_revision: boolean;
};

type RespuestaProceso = {
  captura: CapturaVenta;
  lineas: LineaRevision[];
  pagos: PagoRevision[];
};

const mediosPago: { id: MedioPago; nombre: string }[] = [
  { id: "efectivo", nombre: "Efectivo" },
  { id: "datafono", nombre: "Datafono" },
  { id: "nequi_daviplata", nombre: "Nequi/Daviplata" },
  { id: "transferencia", nombre: "Transferencia" },
];

function porcentaje(valor: number) {
  return `${Math.round(Number(valor ?? 0) * 100)}%`;
}

function totalLineas(lineas: LineaRevision[]) {
  return lineas.reduce((sum, linea) => sum + Number(linea.subtotal ?? 0), 0);
}

function totalPagos(pagos: PagoRevision[]) {
  return pagos.reduce((sum, pago) => sum + Number(pago.monto ?? 0), 0);
}

function valorItem(linea: LineaRevision) {
  if (linea.tipo_item === "producto" && linea.producto_id) return `producto:${linea.producto_id}`;
  if (linea.tipo_item === "combo" && linea.combo_id) return `combo:${linea.combo_id}`;
  return "";
}

function nombreDetectado(linea: LineaRevision) {
  return linea.productos?.nombre ?? linea.combos?.nombre ?? linea.item_nombre_detectado ?? "Sin match";
}

export function CapturasVentaPanel() {
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [foto, setFoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resultado, setResultado] = useState<RespuestaProceso | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let activo = true;
    async function cargarCatalogo() {
      const supabase = supabaseBrowser();
      const [{ data: productos, error: productosError }, { data: combos, error: combosError }] = await Promise.all([
        supabase.from("productos").select("id,nombre,precio_venta").eq("activo", true).order("nombre"),
        supabase.from("combos").select("id,nombre,precio_venta").eq("activo", true).order("nombre"),
      ]);

      if (productosError) throw productosError;
      if (combosError) throw combosError;

      const items = [
        ...((productos ?? []) as any[]).map((producto) => ({
          clave: `producto:${producto.id}`,
          id: producto.id,
          tipo: "producto" as const,
          nombre: producto.nombre,
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
    const lineas = resultado?.lineas ?? [];
    const pagos = resultado?.pagos ?? [];
    return {
      total: totalLineas(lineas),
      pagado: totalPagos(pagos),
      pendientesRevision: lineas.filter((linea) => linea.requiere_revision).length + pagos.filter((pago) => pago.requiere_revision).length,
    };
  }, [resultado]);

  function actualizarLinea(id: string, cambios: Partial<LineaRevision>) {
    setResultado((actual) => {
      if (!actual) return actual;
      return {
        ...actual,
        lineas: actual.lineas.map((linea) => {
          if (linea.id !== id) return linea;
          const siguiente = { ...linea, ...cambios };
          if ("cantidad" in cambios || "valor_unitario" in cambios) {
            siguiente.subtotal = Math.max(0, Math.round(Number(siguiente.cantidad ?? 0) * Number(siguiente.valor_unitario ?? 0)));
          }
          return siguiente;
        }),
      };
    });
  }

  function actualizarPago(id: string, cambios: Partial<PagoRevision>) {
    setResultado((actual) => {
      if (!actual) return actual;
      return { ...actual, pagos: actual.pagos.map((pago) => (pago.id === id ? { ...pago, ...cambios } : pago)) };
    });
  }

  function seleccionarItem(linea: LineaRevision, clave: string) {
    const item = catalogo.find((actual) => actual.clave === clave);
    if (!item) {
      actualizarLinea(linea.id, { tipo_item: "desconocido", producto_id: null, combo_id: null, requiere_revision: true });
      return;
    }

    actualizarLinea(linea.id, {
      tipo_item: item.tipo,
      producto_id: item.tipo === "producto" ? item.id : null,
      combo_id: item.tipo === "combo" ? item.id : null,
      valor_unitario: Number(linea.valor_unitario || item.precio_venta),
      subtotal: Math.max(0, Math.round(Number(linea.cantidad ?? 1) * Number(linea.valor_unitario || item.precio_venta))),
      requiere_revision: false,
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
      setMensaje("Lectura lista para revision. Todavia no se registra una venta real.");
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
      const lineaUpdates = resultado.lineas.map((linea) =>
        supabase
          .from("captura_venta_lineas")
          .update({
            texto_original: linea.texto_original,
            item_nombre_detectado: linea.item_nombre_detectado,
            tipo_item: linea.tipo_item,
            producto_id: linea.producto_id,
            combo_id: linea.combo_id,
            cantidad: Math.max(1, Math.round(Number(linea.cantidad ?? 1))),
            valor_unitario: Math.max(0, Math.round(Number(linea.valor_unitario ?? 0))),
            subtotal: Math.max(0, Math.round(Number(linea.subtotal ?? 0))),
            requiere_revision: linea.requiere_revision,
          })
          .eq("id", linea.id),
      );
      const pagoUpdates = resultado.pagos.map((pago) =>
        supabase
          .from("captura_venta_pagos")
          .update({
            medio_detectado: pago.medio_detectado,
            medio_normalizado: pago.medio_normalizado,
            monto: Math.max(0, Math.round(Number(pago.monto ?? 0))),
            requiere_revision: pago.requiere_revision,
          })
          .eq("id", pago.id),
      );

      const respuestas = await Promise.all([...lineaUpdates, ...pagoUpdates]);
      const error = respuestas.find((respuesta) => respuesta.error)?.error;
      if (error) throw new Error(error.message);

      const sigueDudosa = resultado.lineas.some((linea) => linea.requiere_revision) || resultado.pagos.some((pago) => pago.requiere_revision);
      const { error: capturaError } = await supabase
        .from("capturas_venta")
        .update({ estado: sigueDudosa ? "requiere_revision" : "procesada" })
        .eq("id", resultado.captura.id);
      if (capturaError) throw new Error(capturaError.message);

      setResultado((actual) => (actual ? { ...actual, captura: { ...actual.captura, estado: sigueDudosa ? "requiere_revision" : "procesada" } } : actual));
      setMensaje("Revision guardada. La venta sigue sin registrarse hasta la Fase 2.");
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
          <p className="mt-1 text-sm text-antiguo/70">Sube la anotacion, revisa los datos y deja el borrador listo.</p>
        </div>
        {resultado ? (
          <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-80">
            <div className="rounded-md border border-antiguo/10 bg-carbon p-2">
              <p className="text-antiguo/60">Items</p>
              <p className="font-black text-dorado">{resultado.lineas.length}</p>
            </div>
            <div className="rounded-md border border-antiguo/10 bg-carbon p-2">
              <p className="text-antiguo/60">Total</p>
              <p className="font-black text-dorado">{formatoCOP(resumen.total)}</p>
            </div>
            <div className="rounded-md border border-antiguo/10 bg-carbon p-2">
              <p className="text-antiguo/60">Revisar</p>
              <p className="font-black text-dorado">{resumen.pendientesRevision}</p>
            </div>
          </div>
        ) : null}
      </div>

      <form onSubmit={procesarFoto} className="mt-4 grid gap-3 lg:grid-cols-[260px_1fr]">
        <label className="flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-antiguo/25 bg-carbon p-3 text-center text-sm text-antiguo/70">
          {previewUrl ? <Image src={previewUrl} alt="Foto seleccionada" width={640} height={480} unoptimized className="max-h-72 w-full rounded-md object-contain" /> : <span>Tomar o seleccionar foto</span>}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => setFoto(event.target.files?.[0] ?? null)}
          />
        </label>
        <div className="flex flex-col justify-between gap-3 rounded-md border border-antiguo/10 bg-carbon p-3">
          <div>
            <p className="text-sm font-bold text-crema">Fase 1 activa</p>
            <p className="mt-1 text-sm text-antiguo/70">La IA propone productos, cantidades, valores y pagos. Caja confirma visualmente antes de cualquier registro real.</p>
            {foto ? <p className="mt-3 text-xs text-antiguo/60">Archivo: {foto.name} ({Math.round(foto.size / 1024)} KB)</p> : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="submit" disabled={procesando || !foto} className="tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">
              {procesando ? "Procesando..." : "Procesar foto"}
            </button>
            <button type="button" onClick={() => { setFoto(null); setResultado(null); setMensaje(null); }} className="tap-target rounded-md border border-antiguo/20 px-4 text-sm font-bold">
              Limpiar
            </button>
          </div>
        </div>
      </form>

      {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm text-champana">{mensaje}</p> : null}

      {resultado ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-oro/20 bg-carbon p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-dorado">Captura {resultado.captura.estado}</p>
                <p className="text-xs text-antiguo/60">Modelo: {resultado.captura.modelo_ia ?? "-"}</p>
              </div>
              <div className="text-sm sm:text-right">
                <p>Total items: <strong className="text-dorado">{formatoCOP(resumen.total)}</strong></p>
                <p>Pagos leidos: <strong className="text-dorado">{formatoCOP(resumen.pagado)}</strong></p>
              </div>
            </div>
            {(resultado.captura.advertencias ?? []).length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-antiguo/75">
                {(resultado.captura.advertencias ?? []).map((advertencia, index) => <li key={`${advertencia}-${index}`}>{advertencia}</li>)}
              </ul>
            ) : null}
          </div>

          <div className="space-y-3">
            {resultado.lineas.map((linea) => (
              <article key={linea.id} className="rounded-md border border-antiguo/10 bg-carbon p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-oro">Linea {linea.orden}</p>
                    <p className="text-sm text-antiguo/70">Leido: {linea.texto_original ?? linea.item_nombre_detectado ?? "-"}</p>
                    <p className="text-xs text-antiguo/55">Confianza {porcentaje(linea.confianza_ia)} / match {porcentaje(linea.puntaje_match)}</p>
                  </div>
                  <label className="flex items-center gap-2 rounded-md border border-antiguo/10 bg-espresso px-3 py-2 text-xs font-bold">
                    <input type="checkbox" checked={linea.requiere_revision} onChange={(event) => actualizarLinea(linea.id, { requiere_revision: event.target.checked })} />
                    Revisar
                  </label>
                </div>

                <div className="mt-3 grid gap-2 lg:grid-cols-[1.5fr_90px_130px_130px]">
                  <label className="text-xs font-bold text-antiguo/80">
                    Producto
                    <select value={valorItem(linea)} onChange={(event) => seleccionarItem(linea, event.target.value)} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                      <option value="">Sin match - {nombreDetectado(linea)}</option>
                      {catalogo.map((item) => <option key={item.clave} value={item.clave}>{item.tipo === "combo" ? "Combo - " : ""}{item.nombre}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-bold text-antiguo/80">
                    Cant.
                    <input type="number" min="1" inputMode="numeric" value={linea.cantidad} onChange={(event) => actualizarLinea(linea.id, { cantidad: Number(event.target.value) })} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                  </label>
                  <label className="text-xs font-bold text-antiguo/80">
                    Unitario
                    <input type="number" min="0" inputMode="numeric" value={linea.valor_unitario} onChange={(event) => actualizarLinea(linea.id, { valor_unitario: Number(event.target.value) })} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                  </label>
                  <label className="text-xs font-bold text-antiguo/80">
                    Subtotal
                    <input type="number" min="0" inputMode="numeric" value={linea.subtotal} onChange={(event) => actualizarLinea(linea.id, { subtotal: Number(event.target.value) })} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                  </label>
                </div>
              </article>
            ))}
            {resultado.lineas.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">No se detectaron items.</p> : null}
          </div>

          <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
            <p className="text-sm font-bold text-dorado">Pagos detectados</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {resultado.pagos.map((pago) => (
                <article key={pago.id} className="rounded-md border border-antiguo/10 bg-espresso p-3">
                  <p className="text-xs text-antiguo/60">Leido: {pago.medio_detectado ?? "-"} / confianza {porcentaje(pago.confianza_ia)}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_130px]">
                    <select value={pago.medio_normalizado ?? ""} onChange={(event) => {
                        const medio = event.target.value as MedioPago | "";
                        actualizarPago(pago.id, { medio_normalizado: medio || null, requiere_revision: !medio });
                      }} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                      <option value="">Medio por revisar</option>
                      {mediosPago.map((medio) => <option key={medio.id} value={medio.id}>{medio.nombre}</option>)}
                    </select>
                    <input type="number" min="0" inputMode="numeric" value={pago.monto} onChange={(event) => actualizarPago(pago.id, { monto: Number(event.target.value) })} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
                  </div>
                </article>
              ))}
            </div>
            {resultado.pagos.length === 0 ? <p className="mt-2 text-sm text-antiguo/70">No se detectaron pagos en la foto.</p> : null}
          </section>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <p className="text-xs text-antiguo/60">Este guardado solo conserva la revision asistida. La confirmacion transaccional entra en la Fase 2.</p>
            <button type="button" onClick={guardarRevision} disabled={guardando} className="tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">
              {guardando ? "Guardando..." : "Guardar revision"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
