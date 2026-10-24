export type LineaDesglose = { dia_negocio: string; item_nombre: string; categoria: string; cantidad: number; ingreso: number; costo_estimado: number; margen_estimado: number; anulado?: boolean };
export type PuntoDesglose = { etiqueta: string; ventas: number; margen: number; costo: number; unidades: number };
export type EstadoMetrica = { segmento: string; cuentas: number; venta_bruta: number; pagado: number; faltante: number };
export type AnuladoDia = { dia_negocio: string; pedidos_anulados: number; cuentas_anuladas: number; monto_anulado: number };

// La RPC devuelve una fila por jornada con anulaciones, no dias calendario.
export function promediarAnulados(filas: AnuladoDia[]) {
  const jornadas = filas.length;
  const total = filas.reduce((acc, fila) => ({
    monto: acc.monto + Number(fila.monto_anulado ?? 0),
    cuentas: acc.cuentas + Number(fila.cuentas_anuladas ?? 0),
    pedidos: acc.pedidos + Number(fila.pedidos_anulados ?? 0),
  }), { monto: 0, cuentas: 0, pedidos: 0 });
  return { jornadas, monto: jornadas ? total.monto / jornadas : 0, cuentas: jornadas ? total.cuentas / jornadas : 0, pedidos: jornadas ? total.pedidos / jornadas : 0 };
}

export function agruparLineasPorDia(lineas: LineaDesglose[], modo: "categoria" | "item", valor: string, desde: string, hasta: string) {
  const mapa = new Map<string, PuntoDesglose>();
  for (const linea of lineas) {
    if (linea.anulado || linea.dia_negocio < desde || linea.dia_negocio > hasta || (valor && (modo === "categoria" ? linea.categoria : linea.item_nombre) !== valor)) continue;
    const actual = mapa.get(linea.dia_negocio) ?? { etiqueta: linea.dia_negocio, ventas: 0, margen: 0, costo: 0, unidades: 0 };
    actual.ventas += Number(linea.ingreso ?? 0);
    actual.margen += Number(linea.margen_estimado ?? 0);
    actual.costo += Number(linea.costo_estimado ?? 0);
    actual.unidades += Number(linea.cantidad ?? 0);
    mapa.set(linea.dia_negocio, actual);
  }
  return [...mapa.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
}

export function ultimas15JornadasConRegistros(puntos: PuntoDesglose[], desde: string, hasta: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) return [];
  return puntos.filter((punto) => punto.etiqueta >= desde && punto.etiqueta <= hasta)
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)).slice(-15);
}

export function totalizarDesglose(puntos: PuntoDesglose[]) {
  return puntos.reduce((acc, punto) => ({ ventas: acc.ventas + punto.ventas, margen: acc.margen + punto.margen, costo: acc.costo + punto.costo, unidades: acc.unidades + punto.unidades }), { ventas: 0, margen: 0, costo: 0, unidades: 0 });
}

export function cuentasPorEstado(filas: EstadoMetrica[], segmento?: string) {
  return filas.filter((fila) => segmento ? fila.segmento === segmento : fila.segmento !== "anulada")
    .reduce((total, fila) => total + Number(fila.cuentas ?? 0), 0);
}

export function agruparEstadosPorDia(filas: (EstadoMetrica & { dia_negocio: string })[]) {
  const mapa = new Map<string, Record<string, string | number>>();
  for (const fila of filas) {
    const actual = mapa.get(fila.dia_negocio) ?? { dia: fila.dia_negocio, total: 0, cuentas_total: 0 };
    const valor = Number((fila.segmento === "cobradas" ? fila.pagado : fila.venta_bruta) ?? 0);
    actual[fila.segmento] = Number(actual[fila.segmento] ?? 0) + valor;
    actual[`cuentas_${fila.segmento}`] = Number(actual[`cuentas_${fila.segmento}`] ?? 0) + Number(fila.cuentas ?? 0);
    actual.total = Number(actual.total) + valor;
    actual.cuentas_total = Number(actual.cuentas_total) + Number(fila.cuentas ?? 0);
    mapa.set(fila.dia_negocio, actual);
  }
  return [...mapa.values()].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
}
