import assert from "node:assert/strict";
import test from "node:test";
import { agruparLineasPorDia, ultimos15Dias, totalizarDesglose, cuentasPorEstado, agruparEstadosPorDia } from "../lib/metricas-presentacion.ts";

const linea = (dia, ingreso, categoria = "Cervezas", extras = {}) => ({
  dia_negocio: dia, ingreso, categoria, item_nombre: "Aguila", cantidad: 1,
  costo_estimado: ingreso * 0.4, margen_estimado: ingreso * 0.6, ...extras,
});

test("al 19 de octubre muestra del 5 al 19 inclusive y conserva dias sin ventas", () => {
  const puntos = agruparLineasPorDia([linea("2026-08-01", 100), linea("2026-10-18", 200), linea("2026-10-19", 300)], "categoria", "", "2026-08-01", "2026-10-19");
  const diarios = ultimos15Dias(puntos, "2026-08-01", "2026-10-19");
  assert.equal(diarios.length, 15);
  assert.equal(diarios[0].etiqueta, "2026-10-05");
  assert.equal(diarios[13].etiqueta, "2026-10-18");
  assert.equal(diarios[14].etiqueta, "2026-10-19");
  assert.equal(diarios[0].ventas, 0);
  assert.equal(totalizarDesglose(diarios).ventas, 500);
  assert.deepEqual(totalizarDesglose(puntos), { ventas: 600, costo: 240, margen: 360, unidades: 3 });
});

test("categoria, item y rango general filtran los totales y el detalle diario juntos", () => {
  const filas = [linea("2026-07-31", 1000), linea("2026-08-01", 100), linea("2026-10-19", 200, "Cocteles", { item_nombre: "Mojito" }), linea("2026-10-20", 1000), linea("2026-10-19", 1000, "Cervezas", { anulado: true })];
  assert.equal(totalizarDesglose(agruparLineasPorDia(filas, "categoria", "Cervezas", "2026-08-01", "2026-10-19")).ventas, 100);
  assert.equal(totalizarDesglose(agruparLineasPorDia(filas, "item", "Mojito", "2026-08-01", "2026-10-19")).ventas, 200);
  assert.equal(totalizarDesglose(agruparLineasPorDia(filas, "categoria", "", "2026-08-01", "2026-10-19")).ventas, 300);
});

test("rangos cortos e historicos terminan en la fecha seleccionada", () => {
  assert.deepEqual(ultimos15Dias([], "2026-08-01", "2026-08-03").map(({ etiqueta }) => etiqueta), ["2026-08-01", "2026-08-02", "2026-08-03"]);
  const cruce = ultimos15Dias([], "2025-12-01", "2026-01-05");
  assert.equal(cruce[0].etiqueta, "2025-12-22");
  assert.equal(cruce[14].etiqueta, "2026-01-05");
  assert.deepEqual(ultimos15Dias([], "2026-10-20", "2026-10-19"), []);
  assert.deepEqual(ultimos15Dias([], "", ""), []);
});

test("las cuentas cobradas suman pagadas y cerradas y los pendientes conservan su conteo", () => {
  const filas = [
    { segmento: "cobradas", cuentas: 3, venta_bruta: 300, pagado: 300, faltante: 0 },
    { segmento: "cobradas", cuentas: 2, venta_bruta: 200, pagado: 200, faltante: 0 },
    { segmento: "pendiente", cuentas: 5, venta_bruta: 997000, pagado: 0, faltante: 0 },
  ];
  assert.equal(cuentasPorEstado(filas, "cobradas"), 5);
  assert.equal(cuentasPorEstado(filas, "pendiente"), 5);
  assert.equal(cuentasPorEstado(filas, "por_cobrar"), 0);
  assert.equal(cuentasPorEstado(filas), 10);
  const [dia] = agruparEstadosPorDia(filas.map((fila) => ({ ...fila, dia_negocio: "2026-10-19" })));
  assert.equal(dia.cobradas, 500);
  assert.equal(dia.cuentas_cobradas, 5);
  assert.equal(dia.pendiente, 997000);
  assert.equal(dia.cuentas_pendiente, 5);
  assert.equal(dia.cuentas_total, 10);
});

test("costo mas ganancia coincide con ventas y conserva las perdidas", () => {
  const puntos = agruparLineasPorDia([linea("2026-10-19", 100, "Cervezas", { costo_estimado: 120, margen_estimado: -20 })], "categoria", "", "2026-10-01", "2026-10-19");
  const total = totalizarDesglose(puntos);
  assert.equal(total.costo + total.margen, total.ventas);
  assert.equal(total.margen, -20);
});
