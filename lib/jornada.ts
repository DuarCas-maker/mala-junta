const zona = "America/Bogota";

/** Jornada de las 10:00 de Colombia hasta las 09:59 del dia siguiente. */
export function diaJornada(fecha: Date | string = new Date()): string {
  const instante = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(instante.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(instante);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  const fechaLocal = `${parte("year")}-${parte("month")}-${parte("day")}`;
  if (Number(parte("hour")) >= 10) return fechaLocal;
  const anterior = new Date(`${fechaLocal}T12:00:00Z`);
  anterior.setUTCDate(anterior.getUTCDate() - 1);
  return anterior.toISOString().slice(0, 10);
}

export function esCuentaPendiente(cuenta: { mesa_liberada_at?: string | null; estado?: string; saldo?: number; total_cuenta?: number; total_pagado?: number }): boolean {
  const saldo = Number(cuenta.saldo ?? (Number(cuenta.total_cuenta ?? 0) - Number(cuenta.total_pagado ?? 0)));
  return cuenta.estado !== "anulada" && saldo > 0 && Boolean(cuenta.mesa_liberada_at || cuenta.estado === "pendiente");
}
