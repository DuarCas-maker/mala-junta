import assert from "node:assert/strict";
import test from "node:test";
import { diaJornada, esCuentaPendiente } from "../lib/jornada.ts";

test("el corte ocurre a las 10:00 de Colombia, sin importar la zona del equipo", () => {
  assert.equal(diaJornada("2026-10-07T14:59:59Z"), "2026-10-06");
  assert.equal(diaJornada("2026-10-07T15:00:00Z"), "2026-10-07");
  assert.equal(diaJornada("2026-10-07T05:00:00Z"), "2026-10-06");
});
test("el corte conserva la jornada al cruzar mes, anio y dia bisiesto", () => {
  assert.equal(diaJornada("2027-01-01T08:00:00Z"), "2026-12-31");
  assert.equal(diaJornada("2028-03-01T08:00:00Z"), "2028-02-29");
  assert.equal(diaJornada("invalida"), "");
});
test("una deuda liberada sigue pendiente aunque tenga abonos o cambie el estado operativo", () => {
  for (const estado of ["abierta", "por_cobrar", "pagada_parcial", "pendiente"]) {
    assert.equal(esCuentaPendiente({ estado, mesa_liberada_at: "2026-10-07T15:00:00Z", total_cuenta: 10000, total_pagado: 4000 }), true);
  }
  assert.equal(esCuentaPendiente({ estado: "abierta", total_cuenta: 10000, total_pagado: 4000 }), false);
});
test("cuentas cubiertas o anuladas no aparecen como deudas", () => {
  assert.equal(esCuentaPendiente({ estado: "pendiente", saldo: 0, mesa_liberada_at: "2026-10-07T15:00:00Z" }), false);
  assert.equal(esCuentaPendiente({ estado: "anulada", saldo: 5000, mesa_liberada_at: "2026-10-07T15:00:00Z" }), false);
});
