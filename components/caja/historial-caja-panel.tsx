"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ResumenHistorialCaja = {
  turnos: number;
  total_pagado: number;
  efectivo_pagos: number;
  retiros_total: number;
  gastos_total: number;
  gastos_efectivo_total: number;
  compras_inventario_total: number;
  gastos_urgencia_total: number;
  propinas_total: number;
  diferencias_total: number;
  cuentas_pagadas: number;
  pendientes_cobrados: number;
};

type CierreHistorialCaja = {
  id: string;
  dia_negocio: string;
  dia_cierre: string;
  abierto_at: string;
  cerrado_at: string;
  abierto_por: string | null;
  cerrado_por: string | null;
  aprobado_por: string | null;
  base_inicial: number;
  efectivo_pagos: number;
  retiros_total: number;
  gastos_efectivo_total: number;
  gastos_total: number;
  compras_inventario_total: number;
  gastos_urgencia_total: number;
  salidas_efectivo_total: number;
  efectivo_esperado: number;
  efectivo_contado: number;
  diferencia: number;
  total_pagado: number;
  propinas_total: number;
  pagos_por_medio: Record<string, number>;
  cuentas: { pagadas: number; pendientes_cobrados: number };
  retiros: SalidaCaja[];
  gastos: SalidaCaja[];
  nota_apertura: string | null;
  nota_cierre: string | null;
  estado: string;
};

type SalidaCaja = {
  id: string;
  tipo?: string;
  medio?: string;
  monto: number;
  observacion?: string | null;
  numero_factura?: string | null;
  timestamp?: string;
  motivo?: string | null;
  categoria?: string | null;
  proveedor?: string | null;
  usuario?: string | null;
};

type HistorialCaja = {
  desde: string | null;
  hasta: string | null;
  resumen: ResumenHistorialCaja;
  cierres: CierreHistorialCaja[];
};

const medios: Record<string, string> = {
  efectivo: "Efectivo",
  datafono: "Datafono",
  nequi_daviplata: "Nequi/Daviplata",
  transferencia: "Transferencia",
};

const resumenVacio: ResumenHistorialCaja = {
  turnos: 0,
  total_pagado: 0,
  efectivo_pagos: 0,
  retiros_total: 0,
  gastos_total: 0,
  gastos_efectivo_total: 0,
  compras_inventario_total: 0,
  gastos_urgencia_total: 0,
  propinas_total: 0,
  diferencias_total: 0,
  cuentas_pagadas: 0,
  pendientes_cobrados: 0,
};

function isoLocal(fecha: Date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

function haceDias(dias: number) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return isoLocal(fecha);
}

function fechaHora(fecha?: string | null) {
  if (!fecha) return "-";
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function numero(valor: unknown) {
  return Number(valor ?? 0);
}

function normalizarHistorial(data: unknown): HistorialCaja {
  const origen = typeof data === "string" ? JSON.parse(data) : data;
  const historial = (origen ?? {}) as Partial<HistorialCaja>;
  return {
    desde: historial.desde ?? null,
    hasta: historial.hasta ?? null,
    resumen: { ...resumenVacio, ...(historial.resumen ?? {}) },
    cierres: Array.isArray(historial.cierres) ? historial.cierres : [],
  };
}

function descargar(nombre: string, contenido: string, tipo: string) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nombre;
  link.click();
  URL.revokeObjectURL(url);
}

function valorCsv(valor: unknown) {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

function filasExport(cierres: CierreHistorialCaja[]) {
  return cierres.map((cierre) => ({
    dia_cierre: cierre.dia_cierre,
    fecha_apertura: fechaHora(cierre.abierto_at),
    fecha_cierre: fechaHora(cierre.cerrado_at),
    abierto_por: cierre.abierto_por ?? "",
    cerrado_por: cierre.cerrado_por ?? "",
    base_inicial: cierre.base_inicial,
    efectivo: cierre.pagos_por_medio?.efectivo ?? 0,
    datafono: cierre.pagos_por_medio?.datafono ?? 0,
    nequi_daviplata: cierre.pagos_por_medio?.nequi_daviplata ?? 0,
    transferencia: cierre.pagos_por_medio?.transferencia ?? 0,
    total_pagado: cierre.total_pagado,
    propinas: cierre.propinas_total,
    retiros: cierre.retiros_total,
    gastos_efectivo: cierre.gastos_efectivo_total,
    gastos_total: cierre.gastos_total,
    compras_inventario: cierre.compras_inventario_total,
    efectivo_esperado: cierre.efectivo_esperado,
    efectivo_contado: cierre.efectivo_contado,
    diferencia: cierre.diferencia,
    cuentas_pagadas: cierre.cuentas?.pagadas ?? 0,
    pendientes_cobrados: cierre.cuentas?.pendientes_cobrados ?? 0,
    nota_apertura: cierre.nota_apertura ?? "",
    nota_cierre: cierre.nota_cierre ?? "",
  }));
}

function tablaCsv(filas: Record<string, unknown>[]) {
  if (filas.length === 0) return "sin_datos\n";
  const columnas = Object.keys(filas[0]);
  return [columnas.join(","), ...filas.map((fila) => columnas.map((columna) => valorCsv(fila[columna])).join(","))].join("\n");
}

function tablaExcel(nombre: string, filas: Record<string, unknown>[]) {
  const columnas = filas.length > 0 ? Object.keys(filas[0]) : ["sin_datos"];
  const trs = filas.length > 0
    ? filas.map((fila) => `<tr>${columnas.map((columna) => `<td>${String(fila[columna] ?? "")}</td>`).join("")}</tr>`).join("")
    : "<tr><td>sin datos</td></tr>";
  return `<html><head><meta charset="utf-8" /></head><body><table><caption>${nombre}</caption><thead><tr>${columnas.map((columna) => `<th>${columna}</th>`).join("")}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
}

export function HistorialCajaPanel() {
  const [desde, setDesde] = useState(haceDias(30));
  const [hasta, setHasta] = useState(isoLocal(new Date()));
  const [historial, setHistorial] = useState<HistorialCaja>({ desde: null, hasta: null, resumen: resumenVacio, cierres: [] });
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});
  const [notas, setNotas] = useState<Record<string, { nota_apertura: string; nota_cierre: string }>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("historial_caja", { p_desde: desde, p_hasta: hasta });

    if (error) {
      setMensaje(error.message);
      setHistorial({ desde, hasta, resumen: resumenVacio, cierres: [] });
      setCargando(false);
      return;
    }

    try {
      const siguiente = normalizarHistorial(data);
      setHistorial(siguiente);
      setNotas(Object.fromEntries(siguiente.cierres.map((cierre) => [cierre.id, {
        nota_apertura: cierre.nota_apertura ?? "",
        nota_cierre: cierre.nota_cierre ?? "",
      }])));
    } catch {
      setMensaje("No se pudo interpretar el historial de caja.");
      setHistorial({ desde, hasta, resumen: resumenVacio, cierres: [] });
    }

    setCargando(false);
  }, [desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filas = useMemo(() => filasExport(historial.cierres), [historial.cierres]);

  async function guardarNotas(cierre: CierreHistorialCaja) {
    setGuardando(cierre.id);
    setMensaje(null);
    const nota = notas[cierre.id] ?? { nota_apertura: "", nota_cierre: "" };
    const supabase = supabaseBrowser();
    const { error } = await supabase.rpc("actualizar_notas_cierre_caja", {
      p_cierre_id: cierre.id,
      p_nota_apertura: nota.nota_apertura || null,
      p_justificacion_diferencia: nota.nota_cierre || null,
    });

    if (error) setMensaje(error.message);
    else {
      setMensaje("Notas guardadas.");
      await cargar();
    }
    setGuardando(null);
  }

  function exportar(formato: "csv" | "xls") {
    const base = `mala-junta-historial-caja-${desde}-${hasta}`;
    if (formato === "csv") descargar(`${base}.csv`, tablaCsv(filas), "text/csv;charset=utf-8");
    else descargar(`${base}.xls`, tablaExcel("historial_caja", filas), "application/vnd.ms-excel;charset=utf-8");
  }

  const resumen = historial.resumen;

  return (
    <section className="grid gap-5 rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
      <div className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">Historial de caja</p>
          <h2 className="text-2xl font-black text-crema">Cierres por turno</h2>
          <p className="mt-1 text-sm text-antiguo/70">Consulta cierres cerrados por fecha de cierre, con resumen, notas y salidas de caja.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[150px_150px_auto_auto_auto]">
          <input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <button type="button" onClick={() => void cargar()} disabled={cargando} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{cargando ? "Cargando" : "Actualizar"}</button>
          <button type="button" onClick={() => exportar("csv")} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 text-sm font-bold">CSV</button>
          <button type="button" onClick={() => exportar("xls")} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 text-sm font-bold">Excel</button>
        </div>
      </div>

      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-carbon p-3 text-sm font-semibold">{mensaje}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi titulo="Turnos" valor={resumen.turnos} />
        <Kpi titulo="Total pagado" valor={formatoCOP(resumen.total_pagado)} destacado />
        <Kpi titulo="Efectivo" valor={formatoCOP(resumen.efectivo_pagos)} />
        <Kpi titulo="Salidas" valor={formatoCOP(resumen.retiros_total + resumen.gastos_efectivo_total)} />
        <Kpi titulo="Diferencias" valor={formatoCOP(resumen.diferencias_total)} destacado={numero(resumen.diferencias_total) !== 0} alerta={numero(resumen.diferencias_total) !== 0} />
        <Kpi titulo="Cuentas" valor={resumen.cuentas_pagadas} detalle={`${resumen.pendientes_cobrados} pendientes cobrados`} />
      </div>

      <div className="grid gap-3">
        {historial.cierres.map((cierre) => {
          const abierto = Boolean(expandidos[cierre.id]);
          const nota = notas[cierre.id] ?? { nota_apertura: cierre.nota_apertura ?? "", nota_cierre: cierre.nota_cierre ?? "" };
          const diferencia = numero(cierre.diferencia);

          return (
            <article key={cierre.id} className="rounded-md border border-antiguo/10 bg-carbon p-3">
              <button type="button" onClick={() => setExpandidos((actual) => ({ ...actual, [cierre.id]: !abierto }))} className="block w-full text-left">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(120px,1fr))] lg:items-center">
                  <div>
                    <p className="text-lg font-black text-dorado">{cierre.dia_cierre}</p>
                    <p className="text-sm text-antiguo/70">Abre {fechaHora(cierre.abierto_at)}</p>
                    <p className="text-sm text-antiguo/70">Cierra {fechaHora(cierre.cerrado_at)}</p>
                  </div>
                  <MiniDato etiqueta="Cajero" valor={cierre.cerrado_por ?? "-"} />
                  <MiniDato etiqueta="Pagado" valor={formatoCOP(cierre.total_pagado)} />
                  <MiniDato etiqueta="Esperado" valor={formatoCOP(cierre.efectivo_esperado)} />
                  <MiniDato etiqueta="Diferencia" valor={formatoCOP(diferencia)} alerta={diferencia !== 0} />
                </div>
              </button>

              {abierto ? (
                <div className="mt-4 grid gap-4 border-t border-antiguo/10 pt-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MiniDato etiqueta="Abierto por" valor={cierre.abierto_por ?? "-"} />
                    <MiniDato etiqueta="Aprobado por" valor={cierre.aprobado_por ?? "-"} />
                    <MiniDato etiqueta="Base inicial" valor={formatoCOP(cierre.base_inicial)} />
                    <MiniDato etiqueta="Efectivo contado" valor={formatoCOP(cierre.efectivo_contado)} />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <section className="rounded-md border border-antiguo/10 bg-espresso p-3">
                      <p className="text-sm font-bold text-dorado">Pagos</p>
                      <ul className="mt-2 space-y-1 text-sm text-antiguo/80">
                        {Object.keys(medios).map((medio) => <li key={medio} className="flex justify-between gap-3"><span>{medios[medio]}</span><span>{formatoCOP(cierre.pagos_por_medio?.[medio] ?? 0)}</span></li>)}
                        <li className="flex justify-between gap-3 border-t border-antiguo/10 pt-2"><span>Propinas</span><span>{formatoCOP(cierre.propinas_total)}</span></li>
                      </ul>
                    </section>

                    <section className="rounded-md border border-antiguo/10 bg-espresso p-3">
                      <p className="text-sm font-bold text-dorado">Salidas</p>
                      <ul className="mt-2 space-y-1 text-sm text-antiguo/80">
                        <li className="flex justify-between gap-3"><span>Retiros</span><span>{formatoCOP(cierre.retiros_total)}</span></li>
                        <li className="flex justify-between gap-3"><span>Gastos efectivo</span><span>{formatoCOP(cierre.gastos_efectivo_total)}</span></li>
                        <li className="flex justify-between gap-3"><span>Gastos total</span><span>{formatoCOP(cierre.gastos_total)}</span></li>
                        <li className="flex justify-between gap-3"><span>Compras inventario</span><span>{formatoCOP(cierre.compras_inventario_total)}</span></li>
                      </ul>
                    </section>

                    <section className="rounded-md border border-antiguo/10 bg-espresso p-3">
                      <p className="text-sm font-bold text-dorado">Cuentas</p>
                      <ul className="mt-2 space-y-1 text-sm text-antiguo/80">
                        <li className="flex justify-between gap-3"><span>Cuentas pagadas</span><span>{cierre.cuentas?.pagadas ?? 0}</span></li>
                        <li className="flex justify-between gap-3"><span>Pendientes cobrados</span><span>{cierre.cuentas?.pendientes_cobrados ?? 0}</span></li>
                      </ul>
                    </section>
                  </div>

                  <section className="rounded-md border border-antiguo/10 bg-espresso p-3">
                    <p className="text-sm font-bold text-dorado">Notas del cierre</p>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <label className="text-xs font-bold text-antiguo/80">
                        Nota de apertura
                        <textarea value={nota.nota_apertura} onChange={(event) => setNotas((actual) => ({ ...actual, [cierre.id]: { ...nota, nota_apertura: event.target.value } }))} rows={3} className="mt-1 w-full rounded-md border border-antiguo/20 bg-carbon p-3 text-sm text-crema placeholder:text-antiguo/50" placeholder="Sin nota de apertura" />
                      </label>
                      <label className="text-xs font-bold text-antiguo/80">
                        Nota de cierre / justificacion
                        <textarea value={nota.nota_cierre} onChange={(event) => setNotas((actual) => ({ ...actual, [cierre.id]: { ...nota, nota_cierre: event.target.value } }))} rows={3} className="mt-1 w-full rounded-md border border-antiguo/20 bg-carbon p-3 text-sm text-crema placeholder:text-antiguo/50" placeholder="Sin nota de cierre" />
                      </label>
                    </div>
                    <button type="button" onClick={() => void guardarNotas(cierre)} disabled={guardando === cierre.id} className="tap-target mt-3 rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">{guardando === cierre.id ? "Guardando..." : "Guardar notas"}</button>
                  </section>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <ListaSalidas titulo="Retiros registrados" salidas={cierre.retiros} />
                    <ListaSalidas titulo="Gastos y compras" salidas={cierre.gastos} />
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}

        {historial.cierres.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-6 text-center text-sm text-antiguo/70">No hay cierres de caja en este rango.</p> : null}
      </div>
    </section>
  );
}

function Kpi({ titulo, valor, detalle, destacado = false, alerta = false }: { titulo: string; valor: string | number; detalle?: string; destacado?: boolean; alerta?: boolean }) {
  return (
    <div className={destacado ? "rounded-md border border-oro/20 bg-carbon p-3" : "rounded-md border border-antiguo/10 bg-carbon p-3"}>
      <p className="text-xs text-antiguo/60">{titulo}</p>
      <p className={alerta ? "break-words text-xl font-black leading-tight text-red-100" : destacado ? "break-words text-xl font-black leading-tight text-dorado" : "break-words text-xl font-black leading-tight text-crema"}>{valor}</p>
      {detalle ? <p className="text-xs text-antiguo/55">{detalle}</p> : null}
    </div>
  );
}

function MiniDato({ etiqueta, valor, alerta = false }: { etiqueta: string; valor: string | number; alerta?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-antiguo/10 bg-espresso p-3">
      <p className="text-xs text-antiguo/60">{etiqueta}</p>
      <p className={alerta ? "break-words text-sm font-black text-red-100" : "break-words text-sm font-black text-crema"}>{valor}</p>
    </div>
  );
}

function ListaSalidas({ titulo, salidas }: { titulo: string; salidas: SalidaCaja[] }) {
  return (
    <section className="rounded-md border border-antiguo/10 bg-espresso p-3">
      <p className="text-sm font-bold text-dorado">{titulo}</p>
      <ul className="mt-2 max-h-56 space-y-2 overflow-auto text-sm text-antiguo/80">
        {salidas.map((salida) => (
          <li key={salida.id} className="border-t border-antiguo/10 pt-2">
            <div className="flex justify-between gap-3">
              <span>{salida.motivo ?? salida.categoria ?? salida.proveedor ?? salida.tipo ?? "Salida"}</span>
              <span className="font-bold text-dorado">{formatoCOP(salida.monto)}</span>
            </div>
            <p className="text-xs text-antiguo/55">{[salida.medio ? medios[salida.medio] ?? salida.medio : null, salida.usuario, salida.timestamp ? fechaHora(salida.timestamp) : null].filter(Boolean).join(" - ")}</p>
            {salida.observacion ? <p className="mt-1 text-xs text-antiguo/70">{salida.observacion}</p> : null}
            {salida.numero_factura ? <p className="text-xs text-antiguo/50">Factura: {salida.numero_factura}</p> : null}
          </li>
        ))}
        {salidas.length === 0 ? <li className="text-antiguo/50">Sin registros.</li> : null}
      </ul>
    </section>
  );
}
