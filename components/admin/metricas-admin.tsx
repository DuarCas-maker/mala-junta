"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
};

type ProductoMargen = { item_nombre: string; categoria: string; unidades_vendidas: number; ventas: number; costo_estimado: number; margen_estimado: number; margen_pct: number | null };
type VentaMesero = { dia_negocio: string; mesero: string; cuentas: number; pedidos: number; ventas_brutas: number; ventas_pendientes: number | null };
type CierreCaja = { dia_negocio: string; cerrado_por: string | null; efectivo_esperado: number | null; efectivo_contado: number | null; diferencia: number | null; estado: string };
type Rotacion = { producto: string; categoria: string | null; stock_actual: number; stock_minimo: number; unidades_vendidas_30d: number; dias_stock_estimado: number | null };
type TiempoPrep = { dia_negocio: string; mesero: string; minutos_preparacion: number; items: number };
type DiaMargen = { dia_negocio: string; ventas: number; costo_estimado: number; margen_estimado: number; margen_pct: number | null };
type LineaVenta = { dia_negocio: string; item_nombre: string; categoria: string; cantidad: number; ingreso: number; costo_estimado: number; margen_estimado: number };
type PuntoGrafica = { etiqueta: string; ventas: number; margen: number; costo: number; unidades?: number };
type ModoDesglose = "categoria" | "item";

const hoy = new Date().toISOString().slice(0, 10);
const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

function agruparLineasPorDia(lineas: LineaVenta[], modo: ModoDesglose, valor: string) {
  const filtradas = valor ? lineas.filter((linea) => (modo === "categoria" ? linea.categoria : linea.item_nombre) === valor) : lineas;
  const mapa = new Map<string, PuntoGrafica>();
  filtradas.forEach((linea) => {
    const actual = mapa.get(linea.dia_negocio) ?? { etiqueta: linea.dia_negocio, ventas: 0, margen: 0, costo: 0, unidades: 0 };
    actual.ventas += Number(linea.ingreso ?? 0);
    actual.margen += Number(linea.margen_estimado ?? 0);
    actual.costo += Number(linea.costo_estimado ?? 0);
    actual.unidades = Number(actual.unidades ?? 0) + Number(linea.cantidad ?? 0);
    mapa.set(linea.dia_negocio, actual);
  });
  return [...mapa.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
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
  const [modoDesglose, setModoDesglose] = useState<ModoDesglose>("categoria");
  const [filtroDesglose, setFiltroDesglose] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const [resumenRes, productosRes, meserosRes, cierresRes, rotacionRes, tiemposRes, diasRes, lineasRes] = await Promise.all([
      supabase.rpc("resumen_metricas_admin", { p_desde: desde, p_hasta: hasta }),
      supabase.rpc("metricas_margen_producto_admin", { p_desde: desde, p_hasta: hasta }),
      supabase.from("v_metricas_ventas_mesero").select("dia_negocio,mesero,cuentas,pedidos,ventas_brutas,ventas_pendientes").gte("dia_negocio", desde).lte("dia_negocio", hasta).limit(40),
      supabase.from("v_metricas_cierres_caja").select("dia_negocio,cerrado_por,efectivo_esperado,efectivo_contado,diferencia,estado").gte("dia_negocio", desde).lte("dia_negocio", hasta).limit(20),
      supabase.from("v_metricas_rotacion_stock").select("producto,categoria,stock_actual,stock_minimo,unidades_vendidas_30d,dias_stock_estimado").limit(12),
      supabase.from("v_metricas_tiempos_preparacion").select("dia_negocio,mesero,minutos_preparacion,items").gte("dia_negocio", desde).lte("dia_negocio", hasta).limit(30),
      supabase.from("v_metricas_margen_global_dia").select("dia_negocio,ventas,costo_estimado,margen_estimado,margen_pct").gte("dia_negocio", desde).lte("dia_negocio", hasta).order("dia_negocio", { ascending: true }),
      supabase.from("v_metricas_lineas_venta").select("dia_negocio,item_nombre,categoria,cantidad,ingreso,costo_estimado,margen_estimado").gte("dia_negocio", desde).lte("dia_negocio", hasta).limit(2000),
    ]);

    const errores = [resumenRes.error, productosRes.error, meserosRes.error, cierresRes.error, rotacionRes.error, tiemposRes.error, diasRes.error, lineasRes.error].filter(Boolean);
    if (errores.length > 0) {
      setMensaje(errores[0]?.message ?? "No se pudieron cargar metricas.");
      setCargando(false);
      return;
    }

    setResumen(resumenRes.data as ResumenMetricas);
    setProductos((productosRes.data ?? []) as ProductoMargen[]);
    setVentasMesero((meserosRes.data ?? []) as VentaMesero[]);
    setCierres((cierresRes.data ?? []) as CierreCaja[]);
    setRotacion((rotacionRes.data ?? []) as Rotacion[]);
    setTiempos((tiemposRes.data ?? []) as TiempoPrep[]);
    setDias((diasRes.data ?? []) as DiaMargen[]);
    setLineasVenta((lineasRes.data ?? []) as LineaVenta[]);
    setCargando(false);
  }, [desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const opcionesDesglose = useMemo(() => {
    const valores = new Set(lineasVenta.map((linea) => modoDesglose === "categoria" ? linea.categoria : linea.item_nombre).filter(Boolean));
    return [...valores].sort((a, b) => a.localeCompare(b, "es"));
  }, [lineasVenta, modoDesglose]);

  useEffect(() => {
    setFiltroDesglose("");
  }, [modoDesglose]);

  const puntosGenerales = useMemo<PuntoGrafica[]>(() => dias.map((dia) => ({ etiqueta: dia.dia_negocio, ventas: Number(dia.ventas ?? 0), costo: Number(dia.costo_estimado ?? 0), margen: Number(dia.margen_estimado ?? 0) })), [dias]);
  const puntosDesglose = useMemo(() => agruparLineasPorDia(lineasVenta, modoDesglose, filtroDesglose), [lineasVenta, modoDesglose, filtroDesglose]);
  const totalDesglose = useMemo(() => puntosDesglose.reduce((acc, punto) => ({ ventas: acc.ventas + punto.ventas, margen: acc.margen + punto.margen, unidades: acc.unidades + Number(punto.unidades ?? 0) }), { ventas: 0, margen: 0, unidades: 0 }), [puntosDesglose]);

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
      setMensaje(error.message);
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
  return (
    <section className="grid gap-5 rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
      <div className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">Metricas</p>
          <h2 className="text-2xl font-black text-crema">Ventas y ganancias</h2>
          <p className="mt-1 text-sm text-antiguo/70">Las capturas aprobadas usan la fecha de venta digitada y el precio real vendido.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-[auto_auto_150px_150px_auto]">
          <button onClick={aplicarUltimos30} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">30 dias</button>
          <button onClick={aplicarSemana} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">Semana</button>
          <button onClick={aplicarMes} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">Mes</button>
          <input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <div className="grid gap-2 sm:grid-cols-[150px_auto]">
            <input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <button onClick={cargar} disabled={cargando} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Actualizar</button>
          </div>
        </div>
      </div>

      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-carbon p-3 text-sm">{mensaje}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi titulo="Ventas" valor={formatoCOP(resumen?.ventas)} />
        <Kpi titulo="Costo" valor={formatoCOP(resumen?.costo_estimado)} />
        <Kpi titulo="Ganancia" valor={formatoCOP(resumen?.margen_estimado)} detalle={`${resumen?.margen_pct ?? 0}%`} destacado />
        <Kpi titulo="Compras" valor={formatoCOP(resumen?.compras)} />
        <Kpi titulo="Propinas" valor={formatoCOP(resumen?.propinas)} />
        <Kpi titulo="Prep. prom." valor={`${resumen?.tiempo_preparacion_promedio_min ?? 0} min`} />
      </div>

      <GraficaBarras
        titulo="Ventas totales por dia"
        subtitulo="Ventas, costo y ganancia del rango seleccionado"
        puntos={puntosGenerales}
        altura="h-[360px]"
        vacio="Sin ventas aprobadas en este rango."
      />

      <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="font-black text-crema">Detalle por {modoDesglose === "categoria" ? "categoria" : "item"}</h3>
            <p className="text-sm text-antiguo/60">Filtra para revisar ventas y ganancias de un producto, combo o categoria.</p>
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
        <div className="mt-4">
          <GraficaBarras titulo="" subtitulo="" puntos={puntosDesglose} altura="h-[260px]" vacio="Sin datos para este filtro." compacta />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Tabla titulo="Margen por producto/combo" filas={productos.map((p) => [p.item_nombre, p.categoria, p.unidades_vendidas, formatoCOP(p.ventas), formatoCOP(p.margen_estimado), `${p.margen_pct ?? 0}%`])} columnas={["Item", "Categoria", "Unid.", "Ventas", "Ganancia", "%"]} onCsv={() => exportarLocal("productos", "csv")} onXls={() => exportarLocal("productos", "xls")} onSql={() => exportarSql("productos")} />
        <Tabla titulo="Ventas por dia" filas={dias.map((d) => [d.dia_negocio, formatoCOP(d.ventas), formatoCOP(d.costo_estimado), formatoCOP(d.margen_estimado), `${d.margen_pct ?? 0}%`])} columnas={["Dia", "Ventas", "Costo", "Ganancia", "%"]} onCsv={() => exportarLocal("ventas_dia", "csv")} onXls={() => exportarLocal("ventas_dia", "xls")} />
        <Tabla titulo="Ventas por mesero" filas={ventasMesero.map((v) => [v.dia_negocio, v.mesero, v.cuentas, v.pedidos, formatoCOP(v.ventas_brutas), formatoCOP(v.ventas_pendientes)])} columnas={["Dia", "Mesero", "Cuentas", "Pedidos", "Ventas", "Pendiente"]} onCsv={() => exportarLocal("ventas_mesero", "csv")} onXls={() => exportarLocal("ventas_mesero", "xls")} onSql={() => exportarSql("ventas_mesero")} />
        <Tabla titulo="Cierres de caja" filas={cierres.map((c) => [c.dia_negocio, c.cerrado_por ?? "-", formatoCOP(c.efectivo_esperado), formatoCOP(c.efectivo_contado), formatoCOP(c.diferencia), c.estado])} columnas={["Dia", "Cajero", "Esperado", "Contado", "Dif.", "Estado"]} onCsv={() => exportarLocal("cierres", "csv")} onXls={() => exportarLocal("cierres", "xls")} onSql={() => exportarSql("cierres")} />
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

function GraficaBarras({ titulo, subtitulo, puntos, altura, vacio, compacta = false }: { titulo: string; subtitulo: string; puntos: PuntoGrafica[]; altura: string; vacio: string; compacta?: boolean }) {
  const maximo = Math.max(1, ...puntos.flatMap((punto) => [punto.ventas, punto.costo, Math.max(0, punto.margen)]));
  return (
    <section className={compacta ? "" : "rounded-md border border-antiguo/10 bg-carbon p-3"}>
      {titulo ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-black text-crema">{titulo}</h3>
            <p className="text-sm text-antiguo/60">{subtitulo}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs font-bold text-antiguo/70">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-oro" />Ventas</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-300" />Costo</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-green-300" />Ganancia</span>
          </div>
        </div>
      ) : null}
      {puntos.length === 0 ? <p className="mt-3 rounded-md border border-antiguo/10 bg-espresso p-4 text-center text-sm text-antiguo/60">{vacio}</p> : null}
      {puntos.length > 0 ? (
        <div className={`mt-4 flex ${altura} items-end gap-2 overflow-x-auto rounded-md border border-antiguo/10 bg-espresso p-3`}>
          {puntos.map((punto) => {
            const ventasH = Math.max(3, (punto.ventas / maximo) * 100);
            const costoH = Math.max(3, (punto.costo / maximo) * 100);
            const margenH = Math.max(3, (Math.max(0, punto.margen) / maximo) * 100);
            return (
              <div key={punto.etiqueta} className="flex h-full min-w-[54px] flex-1 flex-col justify-end gap-2 text-center text-[10px] text-antiguo/60">
                <div className="flex min-h-0 flex-1 items-end justify-center gap-1">
                  <span title={`Ventas ${formatoCOP(punto.ventas)}`} className="w-3 rounded-t-sm bg-oro" style={{ height: `${ventasH}%` }} />
                  <span title={`Costo ${formatoCOP(punto.costo)}`} className="w-3 rounded-t-sm bg-red-300" style={{ height: `${costoH}%` }} />
                  <span title={`Ganancia ${formatoCOP(punto.margen)}`} className="w-3 rounded-t-sm bg-green-300" style={{ height: `${margenH}%` }} />
                </div>
                <span className="block truncate">{fechaCorta(punto.etiqueta)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
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