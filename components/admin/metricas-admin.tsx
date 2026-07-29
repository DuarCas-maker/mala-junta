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

const hoy = new Date().toISOString().slice(0, 10);
const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

export function MetricasAdminPanel() {
  const [desde, setDesde] = useState(hace30);
  const [hasta, setHasta] = useState(hoy);
  const [resumen, setResumen] = useState<ResumenMetricas | null>(null);
  const [productos, setProductos] = useState<ProductoMargen[]>([]);
  const [ventasMesero, setVentasMesero] = useState<VentaMesero[]>([]);
  const [cierres, setCierres] = useState<CierreCaja[]>([]);
  const [rotacion, setRotacion] = useState<Rotacion[]>([]);
  const [tiempos, setTiempos] = useState<TiempoPrep[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const [resumenRes, productosRes, meserosRes, cierresRes, rotacionRes, tiemposRes] = await Promise.all([
      supabase.rpc("resumen_metricas_admin", { p_desde: desde, p_hasta: hasta }),
      supabase.rpc("metricas_margen_producto_admin", { p_desde: desde, p_hasta: hasta }),
      supabase.from("v_metricas_ventas_mesero").select("dia_negocio,mesero,cuentas,pedidos,ventas_brutas,ventas_pendientes").gte("dia_negocio", desde).lte("dia_negocio", hasta).limit(20),
      supabase.from("v_metricas_cierres_caja").select("dia_negocio,cerrado_por,efectivo_esperado,efectivo_contado,diferencia,estado").gte("dia_negocio", desde).lte("dia_negocio", hasta).limit(12),
      supabase.from("v_metricas_rotacion_stock").select("producto,categoria,stock_actual,stock_minimo,unidades_vendidas_30d,dias_stock_estimado").limit(12),
      supabase.from("v_metricas_tiempos_preparacion").select("dia_negocio,mesero,minutos_preparacion,items").gte("dia_negocio", desde).lte("dia_negocio", hasta).limit(20),
    ]);

    const errores = [resumenRes.error, productosRes.error, meserosRes.error, cierresRes.error, rotacionRes.error, tiemposRes.error].filter(Boolean);
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
    setCargando(false);
  }, [desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const exportables = useMemo(() => ({
    productos: productos as unknown as Record<string, unknown>[],
    ventas_mesero: ventasMesero as unknown as Record<string, unknown>[],
    cierres: cierres as unknown as Record<string, unknown>[],
    rotacion: rotacion as unknown as Record<string, unknown>[],
    tiempos: tiempos as unknown as Record<string, unknown>[],
  }), [productos, ventasMesero, cierres, rotacion, tiempos]);

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

  return (
    <section className="grid gap-5 rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
      <div className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">F5 Metricas</p>
          <h2 className="text-2xl font-black text-crema">Reportes administrativos</h2>
          <p className="mt-1 text-sm text-antiguo/70">Rentabilidad, inventario, caja, personal y operacion.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[150px_150px_auto]">
          <input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <button onClick={cargar} disabled={cargando} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Actualizar</button>
        </div>
      </div>

      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-carbon p-3 text-sm">{mensaje}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-md border border-antiguo/10 bg-carbon p-3"><p className="text-xs text-antiguo/60">Ventas</p><p className="text-xl font-black text-crema">{formatoCOP(resumen?.ventas)}</p></div>
        <div className="rounded-md border border-antiguo/10 bg-carbon p-3"><p className="text-xs text-antiguo/60">Costo</p><p className="text-xl font-black text-crema">{formatoCOP(resumen?.costo_estimado)}</p></div>
        <div className="rounded-md border border-oro/20 bg-carbon p-3"><p className="text-xs text-antiguo/60">Margen</p><p className="text-xl font-black text-dorado">{formatoCOP(resumen?.margen_estimado)}</p><p className="text-xs text-antiguo/55">{resumen?.margen_pct ?? 0}%</p></div>
        <div className="rounded-md border border-antiguo/10 bg-carbon p-3"><p className="text-xs text-antiguo/60">Compras</p><p className="text-xl font-black text-crema">{formatoCOP(resumen?.compras)}</p></div>
        <div className="rounded-md border border-antiguo/10 bg-carbon p-3"><p className="text-xs text-antiguo/60">Propinas</p><p className="text-xl font-black text-crema">{formatoCOP(resumen?.propinas)}</p></div>
        <div className="rounded-md border border-antiguo/10 bg-carbon p-3"><p className="text-xs text-antiguo/60">Prep. prom.</p><p className="text-xl font-black text-crema">{resumen?.tiempo_preparacion_promedio_min ?? 0} min</p></div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Tabla titulo="Margen por producto/combo" filas={productos.map((p) => [p.item_nombre, p.categoria, p.unidades_vendidas, formatoCOP(p.ventas), formatoCOP(p.margen_estimado), `${p.margen_pct ?? 0}%`])} columnas={["Item", "Categoria", "Unid.", "Ventas", "Margen", "%"]} onCsv={() => exportarLocal("productos", "csv")} onXls={() => exportarLocal("productos", "xls")} onSql={() => exportarSql("productos")} />
        <Tabla titulo="Ventas por mesero" filas={ventasMesero.map((v) => [v.dia_negocio, v.mesero, v.cuentas, v.pedidos, formatoCOP(v.ventas_brutas), formatoCOP(v.ventas_pendientes)])} columnas={["Dia", "Mesero", "Cuentas", "Pedidos", "Ventas", "Pendiente"]} onCsv={() => exportarLocal("ventas_mesero", "csv")} onXls={() => exportarLocal("ventas_mesero", "xls")} onSql={() => exportarSql("ventas_mesero")} />
        <Tabla titulo="Cierres de caja" filas={cierres.map((c) => [c.dia_negocio, c.cerrado_por ?? "-", formatoCOP(c.efectivo_esperado), formatoCOP(c.efectivo_contado), formatoCOP(c.diferencia), c.estado])} columnas={["Dia", "Cajero", "Esperado", "Contado", "Dif.", "Estado"]} onCsv={() => exportarLocal("cierres", "csv")} onXls={() => exportarLocal("cierres", "xls")} onSql={() => exportarSql("cierres")} />
        <Tabla titulo="Rotacion y dias de stock" filas={rotacion.map((r) => [r.producto, r.categoria ?? "-", r.stock_actual, r.stock_minimo, r.unidades_vendidas_30d, r.dias_stock_estimado ?? "-"])} columnas={["Producto", "Categoria", "Stock", "Min", "Venta 30d", "Dias"]} onCsv={() => exportarLocal("rotacion", "csv")} onXls={() => exportarLocal("rotacion", "xls")} />
        <Tabla titulo="Tiempos de preparacion" filas={tiempos.map((t) => [t.dia_negocio, t.mesero, t.minutos_preparacion, t.items])} columnas={["Dia", "Mesero", "Min", "Items"]} onCsv={() => exportarLocal("tiempos", "csv")} onXls={() => exportarLocal("tiempos", "xls")} />
      </div>
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
