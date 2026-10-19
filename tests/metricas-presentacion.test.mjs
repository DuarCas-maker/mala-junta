import assert from "node:assert/strict";
import test from "node:test";
import { agruparLineasPorDia, ultimas15JornadasConRegistros, totalizarDesglose, cuentasPorEstado, agruparEstadosPorDia } from "../lib/metricas-presentacion.ts";

const linea = (dia, ingreso, categoria = "Cervezas", extras = {}) => ({
  dia_negocio: dia, ingreso, categoria, item_nombre: "Aguila", cantidad: 1,
  costo_estimado: ingreso * 0.4, margen_estimado: ingreso * 0.6, ...extras,
});

test("omite dias vacios y conserva las jornadas con registros aunque sean anteriores a los ultimos 15 dias calendario", () => {
  const puntos = agruparLineasPorDia([linea("2026-08-01", 100), linea("2026-10-18", 200), linea("2026-10-19", 300)], "categoria", "", "2026-08-01", "2026-10-19");
  const diarios = ultimas15JornadasConRegistros(puntos, "2026-08-01", "2026-10-19");
  assert.deepEqual(diarios.map(({ etiqueta }) => etiqueta), ["2026-08-01", "2026-10-18", "2026-10-19"]);
  assert.equal(totalizarDesglose(diarios).ventas, 600);
  assert.deepEqual(totalizarDesglose(puntos), { ventas: 600, costo: 240, margen: 360, unidades: 3 });
});

test("categoria, item y rango general filtran los totales y el detalle diario juntos", () => {
  const filas = [linea("2026-07-31", 1000), linea("2026-08-01", 100), linea("2026-10-19", 200, "Cocteles", { item_nombre: "Mojito" }), linea("2026-10-20", 1000), linea("2026-10-19", 1000, "Cervezas", { anulado: true })];
  assert.equal(totalizarDesglose(agruparLineasPorDia(filas, "categoria", "Cervezas", "2026-08-01", "2026-10-19")).ventas, 100);
  assert.equal(totalizarDesglose(agruparLineasPorDia(filas, "item", "Mojito", "2026-08-01", "2026-10-19")).ventas, 200);
  assert.equal(totalizarDesglose(agruparLineasPorDia(filas, "categoria", "", "2026-08-01", "2026-10-19")).ventas, 300);
});

test("selecciona las 15 jornadas mas recientes en orden cronologico sin recortar los totales del intervalo", () => {
  const filas = Array.from({ length: 20 }, (_, i) => linea(`2026-09-${String(i + 1).padStart(2, "0")}`, 100));
  const puntos = agruparLineasPorDia(filas, "categoria", "", "2026-09-01", "2026-10-19");
  const copia = [...puntos];
  const recientes = ultimas15JornadasConRegistros([...puntos].reverse(), "2026-09-01", "2026-10-19");
  assert.equal(recientes.length, 15);
  assert.equal(recientes[0].etiqueta, "2026-09-06");
  assert.equal(recientes[14].etiqueta, "2026-09-20");
  assert.equal(totalizarDesglose(recientes).ventas, 1500);
  assert.equal(totalizarDesglose(puntos).ventas, 2000);
  assert.deepEqual(puntos, copia);
  assert.deepEqual(ultimas15JornadasConRegistros(puntos, "2026-10-01", "2026-10-19"), []);
  assert.deepEqual(ultimas15JornadasConRegistros(puntos, "2026-10-20", "2026-10-19"), []);
  assert.deepEqual(ultimas15JornadasConRegistros(puntos, "", ""), []);
});

test("las jornadas activas dependen del filtro de categoria y mantienen la suma diaria costo mas ganancia", () => {
  const filas = [linea("2026-09-21", 100), linea("2026-09-30", 200), linea("2026-10-16", 300, "Cocteles")];
  const puntos = agruparLineasPorDia(filas, "categoria", "Cervezas", "2026-09-01", "2026-10-19");
  const recientes = ultimas15JornadasConRegistros(puntos, "2026-09-01", "2026-10-19");
  assert.deepEqual(recientes.map(({ etiqueta }) => etiqueta), ["2026-09-21", "2026-09-30"]);
  for (const punto of puntos) assert.equal(punto.costo + punto.margen, punto.ventas);
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
