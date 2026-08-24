"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

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
type PuntoDesglose = { etiqueta: string; ventas: number; margen: number; costo: number; unidades: number };
type ModoDesglose = "categoria" | "item";
type Resultado<T> = { data: T; error: string | null };

const hoy = new Date().toISOString().slice(0, 10);
const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const coloresEstado: Record<string, string> = {
  cobradas: "#58d68d",
  pagada_parcial: "#f4d35e",
  por_cobrar: "#7db7ff",
  pendiente: "#d7a2ff",
  abiertas: "#e2b07f",
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

function numero(valor: unknown) {
  return Number(valor ?? 0);
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

function agruparLineasPorDia(lineas: LineaVenta[], modo: ModoDesglose, valor: string) {
  const filtradas = valor ? lineas.filter((linea) => (modo === "categoria" ? linea.categoria : linea.item_nombre) === valor) : lineas;
  const mapa = new Map<string, PuntoDesglose>();
  filtradas.forEach((linea) => {
    const actual = mapa.get(linea.dia_negocio) ?? { etiqueta: linea.dia_negocio, ventas: 0, margen: 0, costo: 0, unidades: 0 };
    actual.ventas += numero(linea.ingreso);
    actual.margen += numero(linea.margen_estimado);
    actual.costo += numero(linea.costo_estimado);
    actual.unidades += numero(linea.cantidad);
    mapa.set(linea.dia_negocio, actual);
  });
  return [...mapa.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
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
  const [modoDesglose, setModoDesglose] = useState<ModoDesglose>("categoria");
  const [filtroDesglose, setFiltroDesglose] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrores({});
    const supabase = supabaseBrowser();
    const args = { p_desde: desde, p_hasta: hasta };

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
    ] = await Promise.all([
      resolver<ResumenMetricas>(supabase.rpc("resumen_metricas_admin", args), null as unknown as ResumenMetricas),
      resolver<ProductoMargen[]>(supabase.rpc("metricas_margen_producto_admin", args), []),
      resolver<VentaMesero[]>(supabase.rpc("metricas_ventas_mesero_admin", args).limit(40), []),
      resolver<CierreCaja[]>(supabase.rpc("metricas_cierres_caja_admin", args).limit(40), []),
      resolver<Rotacion[]>(supabase.rpc("metricas_rotacion_stock_admin").limit(12), []),
      resolver<TiempoPrep[]>(supabase.rpc("metricas_tiempos_preparacion_admin", args).limit(40), []),
      resolver<DiaMargen[]>(supabase.rpc("metricas_margen_global_dia_admin", args), []),
      resolver<LineaVenta[]>(supabase.rpc("metricas_lineas_venta_admin", args).eq("anulado", false).limit(2000), []),
      resolver<EstadoCuenta[]>(supabase.rpc("metricas_estado_cuentas_admin", args), []),
      resolver<EstadoDia[]>(supabase.rpc("metricas_estado_dia_admin", args), []),
      resolver<AnuladoDia[]>(supabase.rpc("metricas_anulados_admin", args), []),
    ]);

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

  const puntosDesglose = useMemo(() => agruparLineasPorDia(lineasVenta, modoDesglose, filtroDesglose), [lineasVenta, modoDesglose, filtroDesglose]);
  const totalDesglose = useMemo(() => puntosDesglose.reduce((acc, punto) => ({ ventas: acc.ventas + punto.ventas, margen: acc.margen + punto.margen, unidades: acc.unidades + punto.unidades }), { ventas: 0, margen: 0, unidades: 0 }), [puntosDesglose]);

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

  const estadoDiaGrafica = useMemo(() => {
    const mapa = new Map<string, Record<string, string | number>>();
    estadosDia.forEach((fila) => {
      const actual = mapa.get(fila.dia_negocio) ?? { dia: fila.dia_negocio, etiqueta: fechaCorta(fila.dia_negocio) };
      const valor = fila.segmento === "cobradas" ? numero(fila.pagado) : numero(fila.venta_bruta);
      actual[fila.segmento] = numero(actual[fila.segmento]) + valor;
      mapa.set(fila.dia_negocio, actual);
    });
    return [...mapa.values()].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
  }, [estadosDia]);

  const exportables = useMemo(() => ({
    productos: productos as unknown as Record<string, unknown>[],
    ventas_mesero: ventasMesero as unknown as Record<string, unknown>[],
    cierres: cierres as unknown as Record<string, unknown>[],
    rotacion: rotacion as unknown as Record<string, unknown>[],
    tiempos: tiempos as unknown as Record<string, unknown>[],
    ventas_dia: dias as unknown as Record<string, unknown>[],
  }), [productos, ventasMesero, cierres, rotacion, tiempos, dias]);

  async function exportarSql(reporte: string) {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("exportar_metricas_csv", { p_reporte: reporte, p_desde: desde, p_hasta: hasta });
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
          <p className="mt-1 text-sm text-antiguo/70">Pedidos normales por fecha de envio; capturas por fecha de venta digitada.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-[auto_auto_auto_150px_minmax(150px,auto)]">
          <button onClick={aplicarUltimos30} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">30 dias</button>
          <button onClick={aplicarSemana} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">Semana</button>
          <button onClick={aplicarMes} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">Mes</button>
          <input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <div className="grid gap-2 sm:grid-cols-[150px_auto]">
            <input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi titulo="Ventas brutas" valor={formatoCOP(resumen?.ventas)} />
        <Kpi titulo="Cobradas" valor={formatoCOP(resumen?.cobradas)} detalle={`Pagadas ${formatoCOP(resumen?.cobradas_pagadas)} / Cerradas ${formatoCOP(resumen?.cobradas_cerradas)}`} destacado />
        <Kpi titulo="Ganancia" valor={formatoCOP(resumen?.margen_estimado)} detalle={`${resumen?.margen_pct ?? 0}%`} destacado />
        <Kpi titulo="Parcial" valor={formatoCOP(resumen?.parcial_pagado)} detalle={`Falta ${formatoCOP(resumen?.parcial_faltante)}`} />
        <Kpi titulo="Por cobrar" valor={formatoCOP(resumen?.por_cobrar)} />
        <Kpi titulo="Anulado" valor={formatoCOP(resumen?.anulado)} detalle={`${resumen?.pedidos_anulados ?? 0} pedidos`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <PanelGrafica titulo="Ventas por estado" subtitulo="Cobradas por pagos registrados; otros estados por venta bruta.">
          <GraficaEstados datos={datosEstado} />
        </PanelGrafica>
        <PanelGrafica titulo="Pagada parcial" subtitulo="Pagado y faltante apilados.">
          <GraficaParcial datos={parcial} />
        </PanelGrafica>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <PanelGrafica titulo="Ventas por dia" subtitulo="Segmentadas por estado financiero de la cuenta.">
          <GraficaEstadoDia datos={estadoDiaGrafica} />
        </PanelGrafica>
        <PanelGrafica titulo="Anulados por dia" subtitulo="Monto anulado y cantidad de pedidos/cuentas anuladas.">
          <GraficaAnulados datos={anulados} />
        </PanelGrafica>
      </div>

      <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="font-black text-crema">Detalle por {modoDesglose === "categoria" ? "categoria" : "item"}</h3>
            <p className="text-sm text-antiguo/60">Filtra ventas y ganancias de un producto, combo o categoria.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[150px_minmax(180px,280px)]">
            <select value={modoDesglose} onChange={(event) => setModoDesglose(event.target.value as ModoDesglose)} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
              <option value="categoria">Categoria</option>
              <option value="item">Item</option>
            </select>
            <select value={filtroDesglose} onChange={(event) => setFiltroDesglose(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
              <option value="">Todas</option>
              {opcionesDesglose.map((opcion) => <option key={opcion} value={opcion}>{opcion}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Kpi titulo="Ventas filtro" valor={formatoCOP(totalDesglose.ventas)} />
          <Kpi titulo="Ganancia filtro" valor={formatoCOP(totalDesglose.margen)} destacado />
          <Kpi titulo="Unidades" valor={totalDesglose.unidades.toLocaleString("es-CO")} />
        </div>
        <div className="mt-4 h-[260px]">
          <GraficaDesglose datos={puntosDesglose} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Tabla titulo="Margen por producto/combo" filas={productos.map((p) => [p.item_nombre, p.categoria, p.unidades_vendidas, formatoCOP(p.ventas), formatoCOP(p.margen_estimado), `${p.margen_pct ?? 0}%`])} columnas={["Item", "Categoria", "Unid.", "Ventas", "Ganancia", "%"]} onCsv={() => exportarLocal("productos", "csv")} onXls={() => exportarLocal("productos", "xls")} onSql={() => void exportarSql("productos")} />
        <Tabla titulo="Ventas por dia" filas={dias.map((d) => [d.dia_negocio, formatoCOP(d.ventas), formatoCOP(d.costo_estimado), formatoCOP(d.margen_estimado), `${d.margen_pct ?? 0}%`])} columnas={["Dia", "Ventas", "Costo", "Ganancia", "%"]} onCsv={() => exportarLocal("ventas_dia", "csv")} onXls={() => exportarLocal("ventas_dia", "xls")} />
        <Tabla titulo="Ventas por mesero" filas={ventasMesero.map((v) => [v.dia_negocio, v.mesero, v.cuentas, v.pedidos, formatoCOP(v.ventas_brutas), formatoCOP(v.ventas_pendientes)])} columnas={["Dia", "Mesero", "Cuentas", "Pedidos", "Ventas", "Pendiente"]} onCsv={() => exportarLocal("ventas_mesero", "csv")} onXls={() => exportarLocal("ventas_mesero", "xls")} onSql={() => void exportarSql("ventas_mesero")} />
        <Tabla titulo="Cierres de caja" filas={cierres.map((c) => [c.dia_negocio, c.cerrado_por ?? "-", formatoCOP(c.efectivo_esperado), formatoCOP(c.efectivo_contado), formatoCOP(c.diferencia), c.estado])} columnas={["Dia", "Cajero", "Esperado", "Contado", "Dif.", "Estado"]} onCsv={() => exportarLocal("cierres", "csv")} onXls={() => exportarLocal("cierres", "xls")} onSql={() => void exportarSql("cierres")} />
        <Tabla titulo="Rotacion y dias de stock" filas={rotacion.map((r) => [r.producto, r.categoria ?? "-", r.stock_actual, r.stock_minimo, r.unidades_vendidas_30d, r.dias_stock_estimado ?? "-"])} columnas={["Producto", "Categoria", "Stock", "Min", "Venta 30d", "Dias"]} onCsv={() => exportarLocal("rotacion", "csv")} onXls={() => exportarLocal("rotacion", "xls")} />
        <Tabla titulo="Tiempos de preparacion" filas={tiempos.map((t) => [t.dia_negocio, t.mesero, t.minutos_preparacion, t.items])} columnas={["Dia", "Mesero", "Min", "Items"]} onCsv={() => exportarLocal("tiempos", "csv")} onXls={() => exportarLocal("tiempos", "xls")} />
      </div>
    </section>
  );
}

function Kpi({ titulo, valor, detalle, destacado = false }: { titulo: string; valor: string | number; detalle?: string; destacado?: boolean }) {
  return (
    <div className={destacado ? "rounded-md border border-oro/20 bg-carbon p-3" : "rounded-md border border-antiguo/10 bg-carbon p-3"}>
      <p className="text-xs text-antiguo/60">{titulo}</p>
      <p className={destacado ? "text-xl font-black text-dorado" : "text-xl font-black text-crema"}>{valor}</p>
      {detalle ? <p className="text-xs text-antiguo/55">{detalle}</p> : null}
    </div>
  );
}

function PanelGrafica({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
      <h3 className="font-black text-crema">{titulo}</h3>
      <p className="text-sm text-antiguo/60">{subtitulo}</p>
      <div className="mt-3 h-[310px]">{children}</div>
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
        <Bar dataKey="pagado" name="Pagado" stackId="parcial" fill="#58d68d" radius={[4, 0, 0, 4]} />
        <Bar dataKey="faltante" name="Faltante" stackId="parcial" fill="#f4d35e" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function GraficaEstadoDia({ datos }: { datos: Record<string, string | number>[] }) {
  if (datos.length === 0) return <Vacio texto="Sin ventas en el rango." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<TooltipMoneda />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar dataKey="cobradas" name="Cobradas" stackId="ventas" fill={coloresEstado.cobradas} />
        <Bar dataKey="pagada_parcial" name="Parcial" stackId="ventas" fill={coloresEstado.pagada_parcial} />
        <Bar dataKey="por_cobrar" name="Por cobrar" stackId="ventas" fill={coloresEstado.por_cobrar} />
        <Bar dataKey="pendiente" name="Pendiente" stackId="ventas" fill={coloresEstado.pendiente} />
        <Bar dataKey="abiertas" name="Abiertas" stackId="ventas" fill={coloresEstado.abiertas} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function GraficaAnulados({ datos }: { datos: AnuladoDia[] }) {
  if (datos.length === 0) return <Vacio texto="Sin anulados en el rango." />;
  const normalizados = datos.map((fila) => ({ ...fila, etiqueta: fechaCorta(fila.dia_negocio) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={normalizados} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="monto" tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={58} />
        <YAxis yAxisId="cantidad" orientation="right" allowDecimals={false} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
        <Tooltip content={<TooltipMixto />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Line yAxisId="monto" type="monotone" dataKey="monto_anulado" name="Monto" stroke="#ff8b8b" strokeWidth={2} dot={{ r: 3 }} />
        <Line yAxisId="cantidad" type="monotone" dataKey="pedidos_anulados" name="Pedidos" stroke="#f4d35e" strokeWidth={2} dot={{ r: 3 }} />
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
      <BarChart data={normalizados} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(224,209,190,0.12)" vertical={false} />
        <XAxis dataKey="etiquetaCorta" tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: "#bda88f", fontSize: 11 }} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<TooltipMoneda />} />
        <Legend wrapperStyle={{ color: "#e0d1be", fontSize: 12 }} />
        <Bar dataKey="ventas" name="Ventas" fill="#e2b07f" radius={[3, 3, 0, 0]} />
        <Bar dataKey="costo" name="Costo" fill="#ff8b8b" radius={[3, 3, 0, 0]} />
        <Bar dataKey="margen" name="Ganancia" fill="#58d68d" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
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
