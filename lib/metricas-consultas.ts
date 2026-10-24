import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnuladoDia, LineaDesglose } from "./metricas-presentacion";

// Todas estas RPC son STABLE y solo leen datos. GET usa Accept-Profile,
// permitido por el CORS del VPS, en vez de Content-Profile de POST.
export function consultasMetricasAdmin(supabase: SupabaseClient, desde: string, hasta: string) {
  const args = { p_desde: desde, p_hasta: hasta };
  const lectura = { get: true } as const;

  return {
    resumen: supabase.rpc("resumen_metricas_admin", args, lectura),
    productos: supabase.rpc("metricas_margen_producto_admin", args, lectura),
    meseros: supabase.rpc("metricas_ventas_mesero_admin", args, lectura).limit(40),
    cierres: supabase.rpc("metricas_cierres_caja_admin", args, lectura).limit(40),
    rotacion: supabase.rpc("metricas_rotacion_stock_admin", {}, lectura).limit(12),
    tiempos: supabase.rpc("metricas_tiempos_preparacion_admin", args, lectura).limit(40),
    dias: supabase.rpc("metricas_margen_global_dia_admin", args, lectura),
    lineas: cargarLineasMetricas(supabase, desde, hasta),
    estados: supabase.rpc("metricas_estado_cuentas_admin", args, lectura),
    estadosDia: supabase.rpc("metricas_estado_dia_admin", args, lectura),
    anulados: cargarAnuladosMetricas(supabase, desde, hasta),
    estrellas: supabase.rpc("metricas_productos_estrella_admin", args, lectura),
    ingresosMedio: supabase.rpc("metricas_ingresos_medios_pago_admin", args, lectura),
    consumoHoras: supabase.rpc("metricas_consumo_horas_admin", args, lectura),
    consumoDiasJornada: supabase.rpc("metricas_consumo_dias_jornada_admin", args, lectura),
  };
}

// Sin intervalo explicito, incluye todo el historial de la aplicacion.
// Paginar las jornadas evita promedios incompletos por el limite de PostgREST.
export async function cargarAnuladosMetricas(supabase: SupabaseClient, desde = "0001-01-01", hasta = "9999-12-31") {
  const filas: AnuladoDia[] = [];
  const tamano = 500;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.rpc("metricas_anulados_admin", { p_desde: desde, p_hasta: hasta }, { get: true })
      .order("dia_negocio", { ascending: true }).range(offset, offset + tamano - 1);
    if (error) return { data: null, error };
    const pagina = (data ?? []) as AnuladoDia[];
    filas.push(...pagina);
    if (pagina.length < tamano) return { data: filas, error: null };
    offset += pagina.length;
  }
}

// PostgREST limita cada respuesta. Paginar evita que un rango largo pierda
// sus ultimas jornadas y permite totalizar todo el intervalo seleccionado.
export async function cargarLineasMetricas(supabase: SupabaseClient, desde: string, hasta: string) {
  const filas: LineaDesglose[] = [];
  const tamano = 500;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.rpc("metricas_lineas_venta_admin", { p_desde: desde, p_hasta: hasta }, { get: true })
      .eq("anulado", false).order("dia_negocio", { ascending: false }).order("pedido_item_id", { ascending: false })
      .range(offset, offset + tamano - 1);
    if (error) return { data: null, error };
    const pagina = (data ?? []) as LineaDesglose[];
    filas.push(...pagina);
    if (pagina.length < tamano) return { data: filas, error: null };
    offset += pagina.length;
  }
}

export function consultaExportarMetricas(supabase: SupabaseClient, reporte: string, desde: string, hasta: string) {
  return supabase.rpc("exportar_metricas_csv", { p_reporte: reporte, p_desde: desde, p_hasta: hasta }, { get: true });
}
