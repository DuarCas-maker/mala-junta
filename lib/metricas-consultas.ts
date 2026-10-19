import type { SupabaseClient } from "@supabase/supabase-js";

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
    lineas: supabase.rpc("metricas_lineas_venta_admin", args, lectura).eq("anulado", false).limit(2000),
    estados: supabase.rpc("metricas_estado_cuentas_admin", args, lectura),
    estadosDia: supabase.rpc("metricas_estado_dia_admin", args, lectura),
    anulados: supabase.rpc("metricas_anulados_admin", args, lectura),
    estrellas: supabase.rpc("metricas_productos_estrella_admin", args, lectura),
    ingresosMedio: supabase.rpc("metricas_ingresos_medios_pago_admin", args, lectura),
    consumoHoras: supabase.rpc("metricas_consumo_horas_admin", args, lectura),
    consumoDiasJornada: supabase.rpc("metricas_consumo_dias_jornada_admin", args, lectura),
  };
}

export function consultaExportarMetricas(supabase: SupabaseClient, reporte: string, desde: string, hasta: string) {
  return supabase.rpc("exportar_metricas_csv", { p_reporte: reporte, p_desde: desde, p_hasta: hasta }, { get: true });
}
