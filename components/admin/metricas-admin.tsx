"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { consultasMetricasAdmin, consultaExportarMetricas } from "@/lib/metricas-consultas";
import { agruparLineasPorDia, ultimas15JornadasConRegistros, totalizarDesglose, cuentasPorEstado, agruparEstadosPorDia, type PuntoDesglose } from "@/lib/metricas-presentacion";

type ResumenMetricas = {
  desde: string;
  hasta: string;
  ventas: number;
  costo_estimado: number;
  margen_estimado: number;
  margen_pct: number | null;
  compras: number;
  ganancia_vs_compras: number;
  propinas: number;
  retiros: number;
  diferencias_caja: number;
  tiempo_preparacion_promedio_min: number;
  cobradas: number;
  cobradas_pagadas: number;
  cobradas_cerradas: number;
  abiertas: number;
  por_cobrar: number;
  pendientes: number;
  parcial_pagado: number;
  parcial_faltante: number;
  anulado: number;
  pedidos_anulados: number;
};

type ProductoMargen = { item_nombre: string; categoria: string; unidades_vendidas: number; ventas: number; costo_estimado: number; margen_estimado: number; margen_pct: number | null };
type VentaMesero = { dia_negocio: string; mesero: string; cuentas: number; pedidos: number; ventas_brutas: number; ventas_pendientes: number | null };
type CierreCaja = { dia_negocio: string; cerrado_por: string | null; efectivo_esperado: number | null; efectivo_contado: number | null; diferencia: number | null; estado: string };
type Rotacion = { producto: string; categoria: string | null; stock_actual: number; stock_minimo: number; unidades_vendidas_30d: number; dias_stock_estimado: number | null };
type TiempoPrep = { dia_negocio: string; mesero: string; minutos_preparacion: number; items: number };
type DiaMargen = { dia_negocio: string; ventas: number; costo_estimado: number; margen_estimado: number; margen_pct: number | null };
type LineaVenta = { dia_negocio: string; item_nombre: string; categoria: string; cantidad: number; ingreso: number; costo_estimado: number; margen_estimado: number; anulado?: boolean };
type EstadoCuenta = { segmento: string; estado_cuenta: string; cuentas: number; pedidos: number; venta_bruta: number; pagado: number; faltante: number };
type EstadoDia = EstadoCuenta & { dia_negocio: string };
type AnuladoDia = { dia_negocio: string; pedidos_anulados: number; cuentas_anuladas: number; monto_anulado: number };
type IngresoMedioPago = { jornada_laboral: string; efectivo: number; datafono: number; nequi_daviplata: number; transferencia: number; total: number };
type ConsumoHora = { hora: number; etiqueta: string; cantidad: number; valor_total: number };
type ConsumoDiaJornada = { dia_semana: number; etiqueta: string; cantidad: number; valor_total: number };
type ProductoEstrella = {
  item_nombre: string;
  categoria: string;
  unidades_vendidas: number;
  venta_bruta: number;
  costo_estimado: number;
  ganancia_bruta: number;
  margen_pct: number | null;
  participacion_ganancia_pct: number | null;
  score_estrella: number;
  ranking_ganancia: number;
  ranking_unidades: number;
  cuadrante: string;
};
type ModoDesglose = "categoria" | "item";
type Resultado<T> = { data: T; error: string | null };
type EjeMoneda = { ticks: number[]; domain: [number, number] };

const hoy = new Date().toISOString().slice(0, 10);
const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const coloresEstado: Record<string, string> = {
  cobradas: "#58d68d",
  pagada_parcial: "#f4d35e",
  por_cobrar: "#7db7ff",
  pendiente: "#d7a2ff",
  abiertas: "#e2b07f",
};

const coloresMedioPago: Record<keyof Pick<IngresoMedioPago, "efectivo" | "datafono" | "nequi_daviplata" | "transferencia">, string> = {
  efectivo: "#58d68d",
  datafono: "#7db7ff",
  nequi_daviplata: "#f4d35e",
  transferencia: "#d7a2ff",
};

const coloresCuadrante: Record<string, string> = {
  estrella: "#58d68d",
  volumen_bajo_margen: "#f4d35e",
  premium_oportunidad: "#7db7ff",
  baja_prioridad: "#bda88f",
};

function isoLocal(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

function inicioMesActual() {
  const fecha = new Date();
  return isoLocal(new Date(fecha.getFullYear(), fecha.getMonth(), 1));
}

function inicioSemanaActual() {
  const fecha = new Date();
  const dia = fecha.getDay() || 7;
  const inicio = new Date(fecha);
  inicio.setDate(fecha.getDate() - dia + 1);
  return isoLocal(inicio);
}

function fechaCorta(fecha: string) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

function etiquetaSegmento(segmento: string) {
  if (segmento === "cobradas") return "Cobradas";
  if (segmento === "pagada_parcial") return "Pagada parcial";
  if (segmento === "por_cobrar") return "Por cobrar";
  if (segmento === "pendiente") return "Pendiente";
  if (segmento === "abiertas") return "Abiertas";
  return segmento;
}

function etiquetaCuadrante(cuadrante: string) {
  if (cuadrante === "estrella") return "Producto estrella";
  if (cuadrante === "volumen_bajo_margen") return "Alto volumen, baja ganancia";
  if (cuadrante === "premium_oportunidad") return "Alta ganancia, bajo volumen";
  if (cuadrante === "baja_prioridad") return "Baja prioridad";
  return cuadrante;
}

function numero(valor: unknown) {
  return Number(valor ?? 0);
}

function monedaCorta(valor: unknown) {
  const numeroValor = numero(valor);
  if (numeroValor === 0) return "";
  if (Math.abs(numeroValor) >= 1000000) return `$${(numeroValor / 1000000).toFixed(1)}M`;
  return `$${Math.round(numeroValor / 1000)}k`;
}

function monedaEje(valor: unknown) {
  const numeroValor = numero(valor);
  if (numeroValor === 0) return "$0";
  if (Math.abs(numeroValor) < 1000000) return `$${Math.round(numeroValor / 1000)}K`;
  const millones = numeroValor / 1000000;
  if (numeroValor === 1000000) return "$1M";
  if (numeroValor % 1000000 === 0) return `$${millones.toFixed(1)}M`;
  if (numeroValor % 500000 === 0) return `$${millones.toFixed(1)}M`;
  return `$${millones.toFixed(2)}M`;
}

function numeroCorto(valor: unknown) {
  const numeroValor = numero(valor);
  if (numeroValor === 0) return "";
  return numeroValor.toLocaleString("es-CO");
}

function conEspacioParaEtiquetas(cantidadPuntos: number, series = 1) {
  return cantidadPuntos * series <= 14;
}

function construirEjeMoneda(maximo: number): EjeMoneda {
  const limite = Math.max(1000000, Math.ceil(maximo / 250000) * 250000);
  const ticks = [0, 200000, 800000, 1000000];
  for (let valor = 1250000; valor <= limite; valor += 250000) {
    ticks.push(valor);
  }
  return { ticks: ticks.filter((valor, indice, lista) => valor <= limite && lista.indexOf(valor) === indice), domain: [0, limite] };
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

async function resolver<T>(consulta: PromiseLike<{ data: T | null; error: { message?: string } | null }>, fallback: T): Promise<Resultado<T>> {
  const { data, error } = await consulta;
  return { data: data ?? fallback, error: error?.message ?? null };
}

function sumarEstado(filas: EstadoCuenta[], segmento: string, campo: keyof EstadoCuenta) {
  return filas.filter((fila) => fila.segmento === segmento).reduce((total, fila) => total + numero(fila[campo]), 0);
}

export function MetricasAdminPanel() {
  const [desde, setDesde] = useState(hace30);
  const [hasta, setHasta] = useState(hoy);
  const [resumen, setResumen] = useState<ResumenMetricas | null>(null);
  const [productos, setProductos] = useState<ProductoMargen[]>([]);
  const [ventasMesero, setVentasMesero] = useState<VentaMesero[]>([]);
  const [cierres, setCierres] = useState<CierreCaja[]>([]);
  const [rotacion, setRotacion] = useState<Rotacion[]>([]);
  const [tiempos, setTiempos] = useState<TiempoPrep[]>([]);
  const [dias, setDias] = useState<DiaMargen[]>([]);
  const [lineasVenta, setLineasVenta] = useState<LineaVenta[]>([]);
  const [estados, setEstados] = useState<EstadoCuenta[]>([]);
  const [estadosDia, setEstadosDia] = useState<EstadoDia[]>([]);
  const [anulados, setAnulados] = useState<AnuladoDia[]>([]);
  const [productosEstrella, setProductosEstrella] = useState<ProductoEstrella[]>([]);
  const [ingresosMedioPago, setIngresosMedioPago] = useState<IngresoMedioPago[]>([]);
  const [consumoHoras, setConsumoHoras] = useState<ConsumoHora[]>([]);
  const [consumoDiasJornada, setConsumoDiasJornada] = useState<ConsumoDiaJornada[]>([]);
  const [modoDesglose, setModoDesglose] = useState<ModoDesglose>("categoria");
  const [filtroDesglose, setFiltroDesglose] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);
  const ultimaCarga = useRef(0);

  const cargar = useCallback(async () => {
    const carga = ++ultimaCarga.current;
    setCargando(true);
    setErrores({});
    const supabase = supabaseBrowser();
    const consultas = consultasMetricasAdmin(supabase, desde, hasta);

    const [
      resumenRes,
      productosRes,
      meserosRes,
      cierresRes,
      rotacionRes,
      tiemposRes,
      diasRes,
      lineasRes,
      estadosRes,
      estadosDiaRes,
      anuladosRes,
      estrellasRes,
      ingresosMedioRes,
      consumoHorasRes,
      consumoDiasJornadaRes,
    ] = await Promise.all([
      resolver<ResumenMetricas>(consultas.resumen, null as unknown as ResumenMetricas),
      resolver<ProductoMargen[]>(consultas.productos, []),
      resolver<VentaMesero[]>(consultas.meseros, []),
      resolver<CierreCaja[]>(consultas.cierres, []),
      resolver<Rotacion[]>(consultas.rotacion, []),
      resolver<TiempoPrep[]>(consultas.tiempos, []),
      resolver<DiaMargen[]>(consultas.dias, []),
      resolver<LineaVenta[]>(consultas.lineas, []),
      resolver<EstadoCuenta[]>(consultas.estados, []),
      resolver<EstadoDia[]>(consultas.estadosDia, []),
      resolver<AnuladoDia[]>(consultas.anulados, []),
      resolver<ProductoEstrella[]>(consultas.estrellas, []),
      resolver<IngresoMedioPago[]>(consultas.ingresosMedio, []),
      resolver<ConsumoHora[]>(consultas.consumoHoras, []),
      resolver<ConsumoDiaJornada[]>(consultas.consumoDiasJornada, []),
    ]);

    if (carga !== ultimaCarga.current) return;
    if (!resumenRes.error) setResumen(resumenRes.data);
    if (!productosRes.error) setProductos(productosRes.data);
    if (!meserosRes.error) setVentasMesero(meserosRes.data);
    if (!cierresRes.error) setCierres(cierresRes.data);
    if (!rotacionRes.error) setRotacion(rotacionRes.data);
    if (!tiemposRes.error) setTiempos(tiemposRes.data);
    if (!diasRes.error) setDias(diasRes.data);
    if (!lineasRes.error) setLineasVenta(lineasRes.data);
    if (!estadosRes.error) setEstados(estadosRes.data);
    if (!estadosDiaRes.error) setEstadosDia(estadosDiaRes.data);
    if (!anuladosRes.error) setAnulados(anuladosRes.data);
    if (!estrellasRes.error) setProductosEstrella(estrellasRes.data);
    if (!ingresosMedioRes.error) setIngresosMedioPago(ingresosMedioRes.data);
    if (!consumoHorasRes.error) setConsumoHoras(consumoHorasRes.data);
    if (!consumoDiasJornadaRes.error) setConsumoDiasJornada(consumoDiasJornadaRes.data);

    setErrores({
      ...(resumenRes.error ? { resumen: resumenRes.error } : {}),
      ...(productosRes.error ? { productos: productosRes.error } : {}),
      ...(meserosRes.error ? { meseros: meserosRes.error } : {}),
      ...(cierresRes.error ? { cierres: cierresRes.error } : {}),
      ...(rotacionRes.error ? { rotacion: rotacionRes.error } : {}),
      ...(tiemposRes.error ? { tiempos: tiemposRes.error } : {}),
      ...(diasRes.error ? { dias: diasRes.error } : {}),
      ...(lineasRes.error ? { lineas: lineasRes.error } : {}),
      ...(estadosRes.error ? { estados: estadosRes.error } : {}),
      ...(estadosDiaRes.error ? { estadosDia: estadosDiaRes.error } : {}),
      ...(anuladosRes.error ? { anulados: anuladosRes.error } : {}),
      ...(estrellasRes.error ? { productosEstrella: estrellasRes.error } : {}),
      ...(ingresosMedioRes.error ? { ingresosMedioPago: ingresosMedioRes.error } : {}),
      ...(consumoHorasRes.error ? { consumoHoras: consumoHorasRes.error } : {}),
      ...(consumoDiasJornadaRes.error ? { consumoDiasJornada: consumoDiasJornadaRes.error } : {}),
    });
    setCargando(false);
  }, [desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const opcionesDesglose = useMemo(() => {
    const valores = new Set(lineasVenta.map((linea) => modoDesglose === "categoria" ? linea.categoria : linea.item_nombre).filter(Boolean));
    return [...valores].sort((a, b) => a.localeCompare(b, "es"));
  }, [lineasVenta, modoDesglose]);

  useEffect(() => {
    setFiltroDesglose("");
  }, [modoDesglose]);

  const puntosDesglose = useMemo(() => agruparLineasPorDia(lineasVenta, modoDesglose, filtroDesglose, desde, hasta), [lineasVenta, modoDesglose, filtroDesglose, desde, hasta]);
  const diasDesglose = useMemo(() => ultimas15JornadasConRegistros(puntosDesglose, desde, hasta), [puntosDesglose, desde, hasta]);
  const totalDesglose = useMemo(() => totalizarDesglose(puntosDesglose), [puntosDesglose]);

  const datosEstado = useMemo(() => {
    const orden = ["cobradas", "pagada_parcial", "por_cobrar", "pendiente", "abiertas"];
    return orden.map((segmento) => ({
      segmento,
      etiqueta: etiquetaSegmento(segmento),
      valor: segmento === "cobradas" ? sumarEstado(estados, segmento, "pagado") : sumarEstado(estados, segmento, "venta_bruta"),
      cuentas: sumarEstado(estados, segmento, "cuentas"),
      pedidos: sumarEstado(estados, segmento, "pedidos"),
    })).filter((fila) => fila.valor > 0 || fila.cuentas > 0);
  }, [estados]);

  const parcial = useMemo(() => [{
    etiqueta: "Pagada parcial",
    pagado: sumarEstado(estados, "pagada_parcial", "pagado"),
    faltante: sumarEstado(estados, "pagada_parcial", "faltante"),
  }], [estados]);

  const estadoDiaGrafica = useMemo<Record<string, string | number>[]>(() => agruparEstadosPorDia(estadosDia).map((fila) => ({ ...fila, etiqueta: fechaCorta(String(fila.dia)) })), [estadosDia]);

  const ejeVentasIngresos = useMemo(() => {
    const maximoVentas = estadoDiaGrafica.reduce((maximo, fila) => Math.max(maximo, numero(fila.total)), 0);
    const maximoIngresos = ingresosMedioPago.reduce((maximo, fila) => Math.max(maximo, numero(fila.total)), 0);
    return construirEjeMoneda(Math.max(maximoVentas, maximoIngresos));
  }, [estadoDiaGrafica, ingresosMedioPago]);

  const topGanancia = useMemo(() => [...productosEstrella].sort((a, b) => numero(b.ganancia_bruta) - numero(a.ganancia_bruta)).slice(0, 10), [productosEstrella]);
  const topUnidades = useMemo(() => [...productosEstrella].sort((a, b) => numero(b.unidades_vendidas) - numero(a.unidades_vendidas)).slice(0, 10), [productosEstrella]);
  const topScore = useMemo(() => [...productosEstrella].sort((a, b) => numero(b.score_estrella) - numero(a.score_estrella)).slice(0, 10), [productosEstrella]);
  const productoTopScore = topScore[0];
  const productoTopGanancia = topGanancia[0];
  const productoTopUnidades = topUnidades[0];
  const promedioEstrella = useMemo(() => {
    if (productosEstrella.length === 0) return { unidades: 0, ganancia: 0 };
    return {
      unidades: productosEstrella.reduce((acc, item) => acc + numero(item.unidades_vendidas), 0) / productosEstrella.length,
      ganancia: productosEstrella.reduce((acc, item) => acc + numero(item.ganancia_bruta), 0) / productosEstrella.length,
    };
  }, [productosEstrella]);

  const exportables = useMemo(() => ({
    productos: productos as unknown as Record<string, unknown>[],
    productos_estrella: productosEstrella as unknown as Record<string, unknown>[],
    ventas_mesero: ventasMesero as unknown as Record<string, unknown>[],
    cierres: cierres as unknown as Record<string, unknown>[],
    rotacion: rotacion as unknown as Record<string, unknown>[],
    tiempos: tiempos as unknown as Record<string, unknown>[],
    ventas_dia: dias as unknown as Record<string, unknown>[],
  }), [productos, productosEstrella, ventasMesero, cierres, rotacion, tiempos, dias]);

  async function exportarSql(reporte: string) {
    const supabase = supabaseBrowser();
    const { data, error } = await consultaExportarMetricas(supabase, reporte, desde, hasta);
    if (error) {
      setErrores((actual) => ({ ...actual, exportar: error.message }));
      return;
    }
    descargar(`mala-junta-${reporte}-${desde}-${hasta}.csv`, data ?? "", "text/csv;charset=utf-8");
  }

  function exportarLocal(nombre: keyof typeof exportables, formato: "csv" | "xls") {
    const filas = exportables[nombre];
    if (formato === "csv") descargar(`mala-junta-${nombre}-${desde}-${hasta}.csv`, tablaCsv(filas), "text/csv;charset=utf-8");
    else descargar(`mala-junta-${nombre}-${desde}-${hasta}.xls`, tablaExcel(nombre, filas), "application/vnd.ms-excel;charset=utf-8");
  }

  function aplicarUltimos30() {
    setDesde(hace30);
    setHasta(hoy);
  }

  function aplicarSemana() {
    setDesde(inicioSemanaActual());
    setHasta(hoy);
  }

  function aplicarMes() {
    setDesde(inicioMesActual());
    setHasta(hoy);
  }

  const erroresLista = Object.entries(errores);

  return (
    <section className="grid gap-5 rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
      <div className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">Metricas</p>
          <h2 className="text-2xl font-black text-crema">Ventas y ganancias</h2>
          <p className="mt-1 text-sm text-antiguo/70">Jornada laboral global: 10:00 a. m. hasta 9:59 a. m. del dia siguiente.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-[auto_auto_auto_150px_minmax(150px,auto)]">
          <button onClick={aplicarUltimos30} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">30 dias</button>
          <button onClick={aplicarSemana} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">Semana</button>
          <button onClick={aplicarMes} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">Mes</button>
          <input aria-label="Fecha desde" type="date" value={desde} onChange={(event) => setDesde(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <div className="grid gap-2 sm:grid-cols-[150px_auto]">
            <input aria-label="Fecha hasta" type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <button onClick={() => void cargar()} disabled={cargando} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{cargando ? "Cargando" : "Actualizar"}</button>
          </div>
        </div>
      </div>

      {erroresLista.length > 0 ? (
        <div className="rounded-md border border-oro/25 bg-carbon p-3 text-sm text-antiguo/80">
          <p className="font-bold text-dorado">Algunos bloques no cargaron.</p>
          <p className="mt-1">{erroresLista.slice(0, 3).map(([bloque, error]) => `${bloque}: ${error}`).join(" / ")}</p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi titulo="Ventas brutas" valor={formatoCOP(resumen?.ventas)} cuentas={cuentasPorEstado(estados)} />
        <Kpi titulo="Cobradas" valor={formatoCOP(resumen?.cobradas)} cuentas={cuentasPorEstado(estados, "cobradas")} detalle={`Pagadas ${formatoCOP(resumen?.cobradas_pagadas)} / Cerradas ${formatoCOP(resumen?.cobradas_cerradas)}`} destacado />
        <Kpi titulo="Ganancia" valor={formatoCOP(resumen?.margen_estimado)} cuentas={cuentasPorEstado(estados)} detalle={`${resumen?.margen_pct ?? 0}%`} destacado />
        <Kpi titulo="Parcial" valor={formatoCOP(resumen?.parcial_pagado)} cuentas={cuentasPorEstado(estados, "pagada_parcial")} detalle={`Falta ${formatoCOP(resumen?.parcial_faltante)}`} />
        <Kpi titulo="Por cobrar" valor={formatoCOP(resumen?.por_cobrar)} cuentas={cuentasPorEstado(estados, "por_cobrar")} />
        <Kpi titulo="Pendientes" valor={formatoCOP(resumen?.pendientes)} cuentas={cuentasPorEstado(estados, "pendiente")} />
        <Kpi titulo="Abiertas" valor={formatoCOP(resumen?.abiertas)} cuentas={cuentasPorEstado(estados, "abiertas")} />
        <Kpi titulo="Anulado" valor={formatoCOP(resumen?.anulado)} detalle={`${resumen?.pedidos_anulados ?? 0} pedidos`} />
      </div>

      <PanelGrafica titulo="Ventas por jornada laboral" subtitulo="Monto y cantidad de cuentas por estado. Pasa sobre una jornada para ver su detalle." pie={
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {["cobradas", "pagada_parcial", "por_cobrar", "pendiente", "abiertas"].map((segmento) => {
            const estado = datosEstado.find((fila) => fila.segmento === segmento);
            return <div key={segmento} className="rounded-md border border-antiguo/10 p-2 text-xs">
              <p style={{ color: coloresEstado[segmento] }}>{etiquetaSegmento(segmento)}</p>
              <p className="mt-1 font-bold text-crema">{formatoCOP(estado?.valor ?? 0)}</p>
              <p className="text-antiguo/70">{textoCuentas(estado?.cuentas ?? 0)} en el intervalo</p>
            </div>;
          })}
        </div>
      }>
        <GraficaEstadoDia datos={estadoDiaGrafica} eje={ejeVentasIngresos} />
      </PanelGrafica>

      <PanelGrafica titulo="Ingresos por medios de pago" subtitulo="Cada barra representa una jornada laboral y se segmenta por medio de pago.">
        <GraficaIngresosMedioPago datos={ingresosMedioPago} eje={ejeVentasIngresos} />
      </PanelGrafica>

      <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="font-black text-crema">Detalle por {modoDesglose === "categoria" ? "categoria" : "item"}</h3>
            <p className="text-sm text-antiguo/60">Ultimas 15 jornadas con registros: {diasDesglose.length ? `${fechaCorta(diasDesglose[0].etiqueta)} al ${fechaCorta(diasDesglose[diasDesglose.length - 1].etiqueta)}` : "sin registros en el intervalo"}. La jornada mas reciente aparece a la derecha.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[150px_minmax(180px,280px)]">
            <select aria-label="Tipo de desglose" value={modoDesglose} onChange={(event) => setModoDesglose(event.target.value as ModoDesglose)} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
              <option value="categoria">Categoria</option>
              <option value="item">Item</option>
            </select>
            <select aria-label="Categoria o item" value={filtroDesglose} onChange={(event) => setFiltroDesglose(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
              <option value="">Todas</option>
              {opcionesDesglose.map((opcion) => <option key={opcion} value={opcion}>{opcion}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <div className="h-[300px] min-w-[780px]">
            <GraficaDesglose datos={diasDesglose} />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
        <h3 className="font-black text-crema">Reparticion por jornada laboral</h3>
        <p className="text-sm text-antiguo/60">{desde} al {hasta} · {filtroDesglose || "Todas"}. Costo y ganancia por jornada; la linea muestra el total vendido. Incluye todas las jornadas con registros del intervalo.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi titulo="Ventas filtro" valor={formatoCOP(totalDesglose.ventas)} />
          <Kpi titulo="Costo filtro" valor={formatoCOP(totalDesglose.costo)} />
          <Kpi titulo="Ganancia filtro" valor={formatoCOP(totalDesglose.margen)} destacado />
          <Kpi titulo="Unidades" valor={totalDesglose.unidades.toLocaleString("es-CO")} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <div className="h-[340px]" style={{ minWidth: Math.max(780, puntosDesglose.length * 72) }}>
            <GraficaReparticionJornada datos={puntosDesglose} />
          </div>
        </div>
      </section>

      <PanelGrafica titulo="Consumo por días de jornada laboral" subtitulo="Cantidad vendida y valor total por lunes a domingo, usando jornada 10:00 a 09:59.">
        <GraficaConsumoDiaJornada datos={consumoDiasJornada} />
      </PanelGrafica>

      <PanelGrafica titulo="Horas más comunes de consumo" subtitulo="Valor vendido y cantidad consumida agrupados por hora del pedido.">
        <GraficaConsumoHora datos={consumoHoras} />
      </PanelGrafica>

      <PanelGrafica titulo="Ventas por estado" subtitulo="Cobradas por pagos registrados; otros estados por venta bruta.">
        <GraficaEstados datos={datosEstado} />
      </PanelGrafica>

      <PanelGrafica titulo="Pago parcial" subtitulo="Pagado y faltante apilados.">
        <GraficaParcial datos={parcial} />
      </PanelGrafica>

      <PanelGrafica titulo="Anulados por jornada laboral" subtitulo="Monto anulado y cantidad de pedidos/cuentas anuladas.">
        <GraficaAnulados datos={anulados} />
      </PanelGrafica>

      <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="font-black text-crema">Productos estrella</h3>
            <p className="text-sm text-antiguo/60">Relacion entre unidades vendidas y ganancia bruta; score 50% ganancia, 40% unidades y 10% margen.</p>
          </div>
          <button onClick={() => exportarLocal("productos_estrella", "csv")} className="w-fit rounded-md border border-antiguo/20 px-3 py-2 text-xs font-bold">CSV</button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Kpi titulo="Estrella combinado" valor={productoTopScore?.item_nombre ?? "Sin datos"} detalle={productoTopScore ? `Score ${productoTopScore.score_estrella}% / ${formatoCOP(productoTopScore.ganancia_bruta)}` : undefined} destacado />
          <Kpi titulo="Mayor ganancia" valor={productoTopGanancia?.item_nombre ?? "Sin datos"} detalle={productoTopGanancia ? `${formatoCOP(productoTopGanancia.ganancia_bruta)} / ${productoTopGanancia.unidades_vendidas} unid.` : undefined} />
          <Kpi titulo="Mayor cantidad" valor={productoTopUnidades?.item_nombre ?? "Sin datos"} detalle={productoTopUnidades ? `${productoTopUnidades.unidades_vendidas} unid. / ${formatoCOP(productoTopUnidades.ganancia_bruta)}` : undefined} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <PanelGrafica titulo="Matriz estrella" subtitulo="X: cantidad vendida. Y: ganancia. Tamano: venta bruta.">
            <GraficaMatrizEstrella datos={productosEstrella} promedioUnidades={promedioEstrella.unidades} promedioGanancia={promedioEstrella.ganancia} />
          </PanelGrafica>
          <TablaEstrella filas={topScore} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <PanelGrafica titulo="Top 10 por ganancia" subtitulo="Productos/combos con mayor utilidad bruta.">
            <GraficaTopProductos datos={topGanancia} campo="ganancia_bruta" nombre="Ganancia" color="#58d68d" moneda />
          </PanelGrafica>
          <PanelGrafica titulo="Top 10 por cantidad" subtitulo="Productos/combos con mayor volumen vendido.">
            <GraficaTopProductos datos={topUnidades} campo="unidades_vendidas" nombre="Unidades" color="#7db7ff" />
          </PanelGrafica>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Tabla titulo="Margen por producto/combo" filas={productos.map((p) => [p.item_nombre, p.categoria, p.unidades_vendidas, formatoCOP(p.ventas), formatoCOP(p.margen_estimado), `${p.margen_pct ?? 0}%`])} columnas={["Item", "Categoria", "Unid.", "Ventas", "Ganancia", "%"]} onCsv={() => exportarLocal("productos", "csv")} onXls={() => exportarLocal("productos", "xls")} onSql={() => void exportarSql("productos")} />
        <Tabla titulo="Ventas por jornada laboral" filas={dias.map((d) => [d.dia_negocio, formatoCOP(d.ventas), formatoCOP(d.costo_estimado), formatoCOP(d.margen_estimado), `${d.margen_pct ?? 0}%`])} columnas={["Jornada", "Ventas", "Costo", "Ganancia", "%"]} onCsv={() => exportarLocal("ventas_dia", "csv")} onXls={() => exportarLocal("ventas_dia", "xls")} />
        <Tabla titulo="Ventas por mesero" filas={ventasMesero.map((v) => [v.dia_negocio, v.mesero, v.cuentas, v.pedidos, formatoCOP(v.ventas_brutas), formatoCOP(v.ventas_pendientes)])} columnas={["Jornada", "Mesero", "Cuentas", "Pedidos", "Ventas", "Pendiente"]} onCsv={() => exportarLocal("ventas_mesero", "csv")} onXls={() => exportarLocal("ventas_mesero", "xls")} onSql={() => void exportarSql("ventas_mesero")} />
        <Tabla titulo="Cierres de caja" filas={cierres.map((c) => [c.dia_negocio, c.cerrado_por ?? "-", formatoCOP(c.efectivo_esperado), formatoCOP(c.efectivo_contado), formatoCOP(c.diferencia), c.estado])} columnas={["Jornada", "Cajero", "Esperado", "Contado", "Dif.", "Estado"]} onCsv={() => exportarLocal("cierres", "csv")} onXls={() => exportarLocal("cierres", "xls")} onSql={() => void exportarSql("cierres")} />
        <Tabla titulo="Rotacion y dias de stock" filas={rotacion.map((r) => [r.producto, r.categoria ?? "-", r.stock_actual, r.stock_minimo, r.unidades_vendidas_30d, r.dias_stock_estimado ?? "-"])} columnas={["Producto", "Categoria", "Stock", "Min", "Venta 30d", "Dias"]} onCsv={() => exportarLocal("rotacion", "csv")} onXls={() => exportarLocal("rotacion", "xls")} />
        <Tabla titulo="Tiempos de preparacion" filas={tiempos.map((t) => [t.dia_negocio, t.mesero, t.minutos_preparacion, t.items])} columnas={["Dia", "Mesero", "Min", "Items"]} onCsv={() => exportarLocal("tiempos", "csv")} onXls={() => exportarLocal("tiempos", "xls")} />
      </div>
    </section>
  );
}

function textoCuentas(cantidad: number) {
  return `${cantidad.toLocaleString("es-CO")} ${cantidad === 1 ? "cuenta" : "cuentas"}`;
}

function Kpi({ titulo, valor, detalle, cuentas, destacado = false }: { titulo: string; valor: string | number; detalle?: string; cuentas?: number; destacado?: boolean }) {
  return (
    <div className={destacado ? "rounded-md border border-oro/20 bg-carbon p-3" : "rounded-md border border-antiguo/10 bg-carbon p-3"}>
      <p className="text-xs text-antiguo/60">{titulo}</p>
      <p className={destacado ? "break-words text-xl font-black leading-tight text-dorado" : "break-words text-xl font-black leading-tight text-crema"}>{valor}</p>
      {cuentas !== undefined ? <p className="mt-1 text-sm font-bold text-crema/85">Cantidad: {textoCuentas(cuentas)}</p> : null}
      {detalle ? <p className="text-xs text-antiguo/55">{detalle}</p> : null}
    </div>
  );
}

function PanelGrafica({ titulo, subtitulo, children, pie }: { titulo: string; subtitulo: string; children: React.ReactNode; pie?: React.ReactNode }) {
  return (
    <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
      <h3 className="font-black text-crema">{titulo}</h3>
      <p className="text-sm text-antiguo/60">{subtitulo}</p>
      <div className="mt-3 h-[310px]">{children}</div>
      {pie}
    </section>
  );
}

function TooltipMoneda({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-antiguo/20 bg-carbon p-2 text-xs text-crema shadow-suave">
      <p className="font-bold">{label}</p>
      {payload.map((item: any) => (
        <p key={item.dataKey} style={{ color: item.color }}>{item.name}: {formatoCOP(item.value)}</p>
      ))}
    </div>
  );
}

function TooltipEstadoDia({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const punto = payload[0].payload;
  return (
    <div className="rounded-md border border-antiguo/20 bg-carbon p-3 text-xs text-crema shadow-suave">
      <p className="font-bold">Jornada {label}</p>
      {["cobradas", "pagada_parcial", "por_cobrar", "pendiente", "abiertas"].map((segmento) => (
        <p key={segmento} className="mt-1" style={{ color: coloresEstado[segmento] }}>
          {etiquetaSegmento(segmento)}: {formatoCOP(punto[segmento])} · Cantidad: {textoCuentas(numero(punto[`cuentas_${segmento}`]))}
        </p>
      ))}
      <p className="mt-2 border-t border-antiguo/20 pt-2 font-bold">Total: {formatoCOP(punto.total)} · {textoCuentas(numero(punto.cuentas_total))}</p>
    </div>
  );
}

function TooltipMixto({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-antiguo/20 bg-carbon p-2 text-xs text-crema shadow-suave">
      <p className="font-bold">{label}</p>
      {payload.map((item: any) => (
        <p key={item.dataKey} style={{ color: item.color }}>{item.name}: {item.dataKey === "pedidos_anulados" || item.dataKey === "cuentas_anuladas" ? Number(item.value).toLocaleString("es-CO") : formatoCOP(item.value)}</p>
      ))}
    </div>
  );
}

function TooltipCantidadValor({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const punto = payload[0]?.payload ?? {};
  return (
    <div className="rounded-md border border-antiguo/20 bg-carbon p-2 text-xs text-crema shadow-suave">
      <p className="font-bold">{label}</p>
      <p>Cantidad: {numero(punto.cantidad).toLocaleString("es-CO")}</p>
      <p>Valor total: {formatoCOP(punto.valor_total)}</p>
    </div>
  );
}

function TooltipMediosPago({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum: number, item: any) => sum + numero(item.value), 0);
  return (
    <div className="rounded-md border border-antiguo/20 bg-carbon p-2 text-xs text-crema shadow-suave">
      <p className="font-bold">Jornada {label}</p>
      {payload.map((item: any) => (
        <p key={item.dataKey} style={{ color: item.color }}>{item.name}: {formatoCOP(item.value)}</p>
      ))}
      <p className="mt-1 font-bold text-dorado">Total: {formatoCOP(total)}</p>
    </div>
  );
}

function GraficaIngresosMedioPago({ datos, eje }: { datos: IngresoMedioPago[]; eje: EjeMoneda }) {
  const conDatos = datos.filter((fila) => numero(fila.total) > 0);
  if (conDatos.length === 0) return <Vacio texto="Sin ingresos por medios de pago en el rango." />;
  const normalizados = conDatos.map((fila) => {
    const orden = ["efectivo", "datafono", "nequi_daviplata", "transferencia"] as const;
    const superior = [...orden].reverse().find((campo) => numero(fila[campo]) > 0);
    return {
      ...fila,
      etiqueta: fechaCorta(fila.jornada_laboral),
      label_efectivo: superior === "efectivo" ? fila.total : null,
      label_datafono: superior === "datafono" ? fila.total : null,
      label_nequi_daviplata: superior === "nequi_daviplata" ? fila.total : null,
      label_transferencia: superior === "transferencia" ? fila.total : null,
    };
  });
  const mostrarLabels = conEspacioParaEtiquetas(normalizados.length, 4);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={normalizados} margin={{ top: 30, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis domain={eje.domain} ticks={eje.ticks} tickFormatter={monedaEje} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
        <Tooltip content={<TooltipMediosPago />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar dataKey="efectivo" name="Efectivo" stackId="medio" fill={coloresMedioPago.efectivo}>
          {mostrarLabels ? <LabelList dataKey="efectivo" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_efectivo" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
        <Bar dataKey="datafono" name="Datafono" stackId="medio" fill={coloresMedioPago.datafono}>
          {mostrarLabels ? <LabelList dataKey="datafono" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_datafono" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
        <Bar dataKey="nequi_daviplata" name="Nequi/Daviplata" stackId="medio" fill={coloresMedioPago.nequi_daviplata}>
          {mostrarLabels ? <LabelList dataKey="nequi_daviplata" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_nequi_daviplata" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
        <Bar dataKey="transferencia" name="Transferencia" stackId="medio" fill={coloresMedioPago.transferencia} radius={[4, 4, 0, 0]}>
          {mostrarLabels ? <LabelList dataKey="transferencia" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_transferencia" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GraficaConsumoHora({ datos }: { datos: ConsumoHora[] }) {
  const conDatos = datos.filter((fila) => numero(fila.valor_total) > 0 || numero(fila.cantidad) > 0);
  if (conDatos.length === 0) return <Vacio texto="Sin consumo por hora en el rango." />;
  const mostrarLabels = conEspacioParaEtiquetas(conDatos.length);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={conDatos} margin={{ top: 22, right: 18, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="valor" tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={58} />
        <YAxis yAxisId="cantidad" orientation="right" allowDecimals={false} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={38} />
        <Tooltip content={<TooltipCantidadValor />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar yAxisId="valor" dataKey="valor_total" name="Valor total" fill="#e2b07f" radius={[4, 4, 0, 0]}>
          {mostrarLabels ? <LabelList dataKey="valor_total" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={10} /> : null}
        </Bar>
        <Line yAxisId="cantidad" type="monotone" dataKey="cantidad" name="Cantidad" stroke="#58d68d" strokeWidth={2} dot={{ r: 3 }}>
          {mostrarLabels ? <LabelList dataKey="cantidad" position="top" formatter={numeroCorto} fill="#58d68d" fontSize={10} /> : null}
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function GraficaConsumoDiaJornada({ datos }: { datos: ConsumoDiaJornada[] }) {
  const conDatos = datos.filter((fila) => numero(fila.valor_total) > 0 || numero(fila.cantidad) > 0);
  if (conDatos.length === 0) return <Vacio texto="Sin consumo por dia de jornada en el rango." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={datos} margin={{ top: 22, right: 18, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="valor" tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={58} />
        <YAxis yAxisId="cantidad" orientation="right" allowDecimals={false} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={38} />
        <Tooltip content={<TooltipCantidadValor />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar yAxisId="valor" dataKey="valor_total" name="Valor total" fill="#7db7ff" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="valor_total" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={10} />
        </Bar>
        <Line yAxisId="cantidad" type="monotone" dataKey="cantidad" name="Cantidad" stroke="#f4d35e" strokeWidth={2} dot={{ r: 3 }}>
          <LabelList dataKey="cantidad" position="top" formatter={numeroCorto} fill="#f4d35e" fontSize={10} />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function GraficaEstados({ datos }: { datos: { segmento: string; etiqueta: string; valor: number; cuentas: number; pedidos: number }[] }) {
  if (datos.length === 0) return <Vacio texto="Sin datos por estado." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<TooltipMoneda />} />
        <Bar dataKey="valor" name="Valor" radius={[4, 4, 0, 0]}>
          {datos.map((fila) => <Cell key={fila.segmento} fill={coloresEstado[fila.segmento] ?? "#e2b07f"} />)}
          {conEspacioParaEtiquetas(datos.length) ? <LabelList dataKey="valor" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={10} /> : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GraficaParcial({ datos }: { datos: { etiqueta: string; pagado: number; faltante: number }[] }) {
  const total = datos.reduce((acc, item) => acc + item.pagado + item.faltante, 0);
  if (total === 0) return <Vacio texto="Sin cuentas parcialmente pagadas." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} layout="vertical" margin={{ top: 24, right: 16, left: 12, bottom: 12 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" horizontal={false} />
        <XAxis type="number" tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={100} />
        <Tooltip content={<TooltipMoneda />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar dataKey="pagado" name="Pagado" stackId="parcial" fill="#58d68d" radius={[4, 0, 0, 4]}>
          <LabelList dataKey="pagado" formatter={monedaCorta} fill="#120d0a" fontSize={10} />
        </Bar>
        <Bar dataKey="faltante" name="Faltante" stackId="parcial" fill="#f4d35e" radius={[0, 4, 4, 0]}>
          <LabelList dataKey="faltante" formatter={monedaCorta} fill="#120d0a" fontSize={10} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GraficaEstadoDia({ datos, eje }: { datos: Record<string, string | number>[]; eje: EjeMoneda }) {
  if (datos.length === 0) return <Vacio texto="Sin ventas en el rango." />;
  const normalizados = datos.map((fila) => {
    const orden = ["cobradas", "pagada_parcial", "por_cobrar", "pendiente", "abiertas"] as const;
    const superior = [...orden].reverse().find((campo) => numero(fila[campo]) > 0);
    return {
      ...fila,
      label_cobradas: superior === "cobradas" ? numero(fila.total) : null,
      label_pagada_parcial: superior === "pagada_parcial" ? numero(fila.total) : null,
      label_por_cobrar: superior === "por_cobrar" ? numero(fila.total) : null,
      label_pendiente: superior === "pendiente" ? numero(fila.total) : null,
      label_abiertas: superior === "abiertas" ? numero(fila.total) : null,
    };
  });
  const mostrarLabels = conEspacioParaEtiquetas(datos.length, 5);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={normalizados} margin={{ top: 30, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis domain={eje.domain} ticks={eje.ticks} tickFormatter={monedaEje} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
        <Tooltip content={<TooltipEstadoDia />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar dataKey="cobradas" name="Cobradas" stackId="ventas" fill={coloresEstado.cobradas}>
          {mostrarLabels ? <LabelList dataKey="cobradas" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_cobradas" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
        <Bar dataKey="pagada_parcial" name="Parcial" stackId="ventas" fill={coloresEstado.pagada_parcial}>
          {mostrarLabels ? <LabelList dataKey="pagada_parcial" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_pagada_parcial" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
        <Bar dataKey="por_cobrar" name="Por cobrar" stackId="ventas" fill={coloresEstado.por_cobrar}>
          {mostrarLabels ? <LabelList dataKey="por_cobrar" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_por_cobrar" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
        <Bar dataKey="pendiente" name="Pendiente" stackId="ventas" fill={coloresEstado.pendiente}>
          {mostrarLabels ? <LabelList dataKey="pendiente" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_pendiente" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
        <Bar dataKey="abiertas" name="Abiertas" stackId="ventas" fill={coloresEstado.abiertas}>
          {mostrarLabels ? <LabelList dataKey="abiertas" formatter={monedaCorta} fill="#120d0a" fontSize={10} /> : null}
          <LabelList dataKey="label_abiertas" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GraficaAnulados({ datos }: { datos: AnuladoDia[] }) {
  if (datos.length === 0) return <Vacio texto="Sin anulados en el rango." />;
  const normalizados = datos.map((fila) => ({ ...fila, etiqueta: fechaCorta(fila.dia_negocio) }));
  const mostrarLabels = conEspacioParaEtiquetas(normalizados.length, 2);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={normalizados} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="monto" tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={58} />
        <YAxis yAxisId="cantidad" orientation="right" allowDecimals={false} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
        <Tooltip content={<TooltipMixto />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Line yAxisId="monto" type="monotone" dataKey="monto_anulado" name="Monto" stroke="#ff8b8b" strokeWidth={2} dot={{ r: 3 }}>
          {mostrarLabels ? <LabelList dataKey="monto_anulado" position="top" formatter={monedaCorta} fill="#ff8b8b" fontSize={10} /> : null}
        </Line>
        <Line yAxisId="cantidad" type="monotone" dataKey="pedidos_anulados" name="Pedidos" stroke="#f4d35e" strokeWidth={2} dot={{ r: 3 }}>
          {mostrarLabels ? <LabelList dataKey="pedidos_anulados" position="top" formatter={numeroCorto} fill="#f4d35e" fontSize={10} /> : null}
        </Line>
        <Line yAxisId="cantidad" type="monotone" dataKey="cuentas_anuladas" name="Cuentas" stroke="#7db7ff" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function GraficaDesglose({ datos }: { datos: PuntoDesglose[] }) {
  if (datos.length === 0) return <Vacio texto="Sin datos para este filtro." />;
  const normalizados = datos.map((fila) => ({ ...fila, etiquetaCorta: fechaCorta(fila.etiqueta) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={normalizados} margin={{ top: 28, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiquetaCorta" interval={0} tick={{ fill: "#bda88f", fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={monedaEje} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
        <Tooltip content={<TooltipMoneda />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar dataKey="ventas" name="Ventas" fill="#e2b07f" radius={[3, 3, 0, 0]}>
          <LabelList dataKey="ventas" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={10} />
        </Bar>
        <Bar dataKey="costo" name="Costo" fill="#ff8b8b" radius={[3, 3, 0, 0]}>
          {conEspacioParaEtiquetas(datos.length, 2) ? <LabelList dataKey="costo" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={10} /> : null}
        </Bar>
        <Bar dataKey="margen" name="Ganancia" fill="#58d68d" radius={[3, 3, 0, 0]}>
          {conEspacioParaEtiquetas(datos.length, 2) ? <LabelList dataKey="margen" position="top" formatter={monedaCorta} fill="#e0d1be" fontSize={10} /> : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EtiquetaSegmentoJornada({ viewBox, value }: any) {
  if (!viewBox || Math.abs(numero(viewBox.height)) < 15 || !numero(value)) return null;
  return <text x={numero(viewBox.x) + numero(viewBox.width) / 2} y={numero(viewBox.y) + numero(viewBox.height) / 2} textAnchor="middle" dominantBaseline="central" fill="#120d0a" fontSize={11} fontWeight={700}>{monedaCorta(value)}</text>;
}

function GraficaReparticionJornada({ datos }: { datos: PuntoDesglose[] }) {
  if (datos.length === 0) return <Vacio texto="Sin jornadas con registros para este filtro en el intervalo." />;
  const normalizados = datos.map((fila) => ({ ...fila, etiquetaCorta: fechaCorta(fila.etiqueta) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={normalizados} stackOffset="sign" margin={{ top: 32, right: 20, left: 0, bottom: 4 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiquetaCorta" interval={0} tick={{ fill: "#bda88f", fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={monedaEje} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={64} padding={{ top: 20 }} />
        <Tooltip content={<TooltipMoneda />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar dataKey="costo" name="Costo" stackId="jornada" fill="#ff8b8b" maxBarSize={64}>
          <LabelList dataKey="costo" content={<EtiquetaSegmentoJornada />} />
        </Bar>
        <Bar dataKey="margen" name="Ganancia" stackId="jornada" fill="#58d68d" maxBarSize={64}>
          <LabelList dataKey="margen" content={<EtiquetaSegmentoJornada />} />
        </Bar>
        <Line dataKey="ventas" name="Ventas" type="linear" stroke="#e2b07f" strokeWidth={2} dot={{ r: 3 }}>
          <LabelList dataKey="ventas" position="top" offset={10} formatter={monedaCorta} fill="#e0d1be" fontSize={11} fontWeight={700} />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function TooltipProductoEstrella({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const punto = payload[0].payload as ProductoEstrella;
  return (
    <div className="max-w-[260px] rounded-md border border-antiguo/20 bg-carbon p-2 text-xs text-crema shadow-suave">
      <p className="font-bold">{punto.item_nombre}</p>
      <p className="text-antiguo/65">{punto.categoria} / {etiquetaCuadrante(punto.cuadrante)}</p>
      <p className="mt-1 text-dorado">Score: {numero(punto.score_estrella).toFixed(1)}%</p>
      <p>Unidades: {numero(punto.unidades_vendidas).toLocaleString("es-CO")}</p>
      <p>Venta: {formatoCOP(punto.venta_bruta)}</p>
      <p>Ganancia: {formatoCOP(punto.ganancia_bruta)}</p>
      <p>Margen: {numero(punto.margen_pct).toFixed(1)}%</p>
    </div>
  );
}

function GraficaMatrizEstrella({ datos, promedioUnidades, promedioGanancia }: { datos: ProductoEstrella[]; promedioUnidades: number; promedioGanancia: number }) {
  if (datos.length === 0) return <Vacio texto="Sin productos vendidos en el rango." />;
  const mostrarLabels = datos.length <= 12;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 14, right: 18, left: 0, bottom: 10 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" />
        <XAxis
          type="number"
          dataKey="unidades_vendidas"
          name="Unidades"
          tick={{ fill: "#bda88f", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="number"
          dataKey="ganancia_bruta"
          name="Ganancia"
          tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`}
          tick={{ fill: "#bda88f", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={58}
        />
        <ZAxis type="number" dataKey="venta_bruta" range={[70, 520]} />
        <Tooltip content={<TooltipProductoEstrella />} />
        <ReferenceLine x={promedioUnidades} stroke="rgba(224,209,190,0.35)" strokeDasharray="4 4" />
        <ReferenceLine y={promedioGanancia} stroke="rgba(224,209,190,0.35)" strokeDasharray="4 4" />
        <Scatter data={datos} name="Productos">
          {datos.map((punto) => <Cell key={`${punto.item_nombre}-${punto.categoria}`} fill={coloresCuadrante[punto.cuadrante] ?? "#bda88f"} />)}
          {mostrarLabels ? <LabelList dataKey="score_estrella" formatter={(value: unknown) => `${numero(value).toFixed(0)}%`} fill="#e0d1be" fontSize={10} /> : null}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function GraficaTopProductos({ datos, campo, nombre, color, moneda = false }: { datos: ProductoEstrella[]; campo: keyof ProductoEstrella; nombre: string; color: string; moneda?: boolean }) {
  if (datos.length === 0) return <Vacio texto="Sin productos para rankear." />;
  const normalizados = [...datos].reverse().map((item) => ({
    ...item,
    etiqueta: item.item_nombre.length > 22 ? `${item.item_nombre.slice(0, 21)}...` : item.item_nombre,
    valor: numero(item[campo]),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={normalizados} layout="vertical" margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" horizontal={false} />
        <XAxis type="number" tickFormatter={(value) => moneda ? `$${Math.round(Number(value) / 1000)}k` : Number(value).toLocaleString("es-CO")} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={128} />
        <Tooltip content={<TooltipTopProducto nombre={nombre} moneda={moneda} />} />
        <Bar dataKey="valor" name={nombre} fill={color} radius={[0, 4, 4, 0]}>
          <LabelList dataKey="valor" position="right" formatter={moneda ? monedaCorta : numeroCorto} fill="#e0d1be" fontSize={10} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TooltipTopProducto({ active, payload, nombre, moneda }: any) {
  if (!active || !payload?.length) return null;
  const punto = payload[0].payload as ProductoEstrella & { valor: number };
  return (
    <div className="rounded-md border border-antiguo/20 bg-carbon p-2 text-xs text-crema shadow-suave">
      <p className="font-bold">{punto.item_nombre}</p>
      <p>{nombre}: {moneda ? formatoCOP(punto.valor) : punto.valor.toLocaleString("es-CO")}</p>
      <p>Ganancia: {formatoCOP(punto.ganancia_bruta)}</p>
      <p>Unidades: {numero(punto.unidades_vendidas).toLocaleString("es-CO")}</p>
      <p>Margen: {numero(punto.margen_pct).toFixed(1)}%</p>
    </div>
  );
}

function TablaEstrella({ filas }: { filas: ProductoEstrella[] }) {
  return (
    <section className="rounded-md border border-antiguo/10 bg-espresso p-3">
      <h3 className="font-black text-crema">Top 10 score estrella</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead>
            <tr className="border-b border-antiguo/15 text-antiguo/60">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Producto</th>
              <th className="py-2 pr-3">Unid.</th>
              <th className="py-2 pr-3">Ganancia</th>
              <th className="py-2 pr-3">Margen</th>
              <th className="py-2 pr-3">Score</th>
              <th className="py-2 pr-3">Lectura</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, index) => (
              <tr key={`${fila.item_nombre}-${fila.categoria}`} className="border-b border-antiguo/10">
                <td className="py-2 pr-3 text-antiguo/80">{index + 1}</td>
                <td className="py-2 pr-3">
                  <p className="font-bold text-crema">{fila.item_nombre}</p>
                  <p className="text-antiguo/50">{fila.categoria}</p>
                </td>
                <td className="py-2 pr-3 text-antiguo/85">{numero(fila.unidades_vendidas).toLocaleString("es-CO")}</td>
                <td className="py-2 pr-3 text-antiguo/85">{formatoCOP(fila.ganancia_bruta)}</td>
                <td className="py-2 pr-3 text-antiguo/85">{numero(fila.margen_pct).toFixed(1)}%</td>
                <td className="py-2 pr-3 font-black text-dorado">{numero(fila.score_estrella).toFixed(1)}%</td>
                <td className="py-2 pr-3 text-antiguo/85">{etiquetaCuadrante(fila.cuadrante)}</td>
              </tr>
            ))}
            {filas.length === 0 ? <tr><td colSpan={7} className="py-4 text-center text-antiguo/50">Sin datos.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Vacio({ texto }: { texto: string }) {
  return <p className="flex h-full items-center justify-center rounded-md border border-antiguo/10 bg-espresso p-4 text-center text-sm text-antiguo/60">{texto}</p>;
}

function Tabla({ titulo, columnas, filas, onCsv, onXls, onSql }: { titulo: string; columnas: string[]; filas: (string | number)[][]; onCsv: () => void; onXls: () => void; onSql?: () => void }) {
  return (
    <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-black text-crema">{titulo}</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={onCsv} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">CSV</button>
          <button onClick={onXls} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">Excel</button>
          {onSql ? <button onClick={onSql} className="rounded-md border border-oro/30 px-2 py-1 text-xs font-bold text-dorado">SQL CSV</button> : null}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-antiguo/15 text-antiguo/60">
              {columnas.map((columna) => <th key={columna} className="py-2 pr-3">{columna}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, index) => (
              <tr key={index} className="border-b border-antiguo/10">
                {fila.map((valor, celda) => <td key={celda} className="py-2 pr-3 text-antiguo/85">{valor}</td>)}
              </tr>
            ))}
            {filas.length === 0 ? <tr><td colSpan={columnas.length} className="py-4 text-center text-antiguo/50">Sin datos.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
