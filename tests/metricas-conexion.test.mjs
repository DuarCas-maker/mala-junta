import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { consultasMetricasAdmin, consultaExportarMetricas, cargarLineasMetricas } from "../lib/metricas-consultas.ts";

// Reproduce los encabezados permitidos por Kong en el VPS. El navegador
// rechaza Content-Profile antes de enviar una RPC POST, aunque el servidor funcione.
const encabezadosPermitidos = new Set(["accept", "accept-profile", "apikey", "authorization", "content-type", "x-client-info"]);

function clienteConCors(responder = () => new Response("[]")) {
  const peticiones = [];
  const cliente = createClient("https://supabase.example.test", "anon-test", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => "sesion-admin-test",
    global: {
      fetch: async (input, init) => {
        const headers = new Headers(init.headers);
        for (const nombre of headers.keys()) {
          if (!encabezadosPermitidos.has(nombre)) throw new TypeError("Failed to fetch");
        }
        const peticion = { url: new URL(input), ...init, headers };
        peticiones.push(peticion);
        return responder(peticion);
      },
    },
  });
  return { cliente, peticiones };
}

test("reproduce el bloqueo CORS de las RPC POST con el SDK instalado", async () => {
  const { cliente, peticiones } = clienteConCors();
  const resultado = await cliente.rpc("resumen_metricas_admin", { p_desde: "2026-09-19", p_hasta: "2026-10-19" });
  assert.match(resultado.error.message, /Failed to fetch/);
  assert.equal(peticiones.length, 0);
});

test("los 15 bloques cargan con el CORS del VPS y conservan la sesion, fechas y filtros", async () => {
  const { cliente, peticiones } = clienteConCors();
  const resultados = await Promise.all(Object.values(consultasMetricasAdmin(cliente, "2026-09-19", "2026-10-19")));
  assert.equal(resultados.length, 15);
  assert.ok(resultados.every(({ error }) => error === null));
  assert.equal(peticiones.length, 15);
  for (const peticion of peticiones) {
    assert.equal(peticion.method, "GET");
    assert.equal(peticion.body, undefined);
    assert.equal(peticion.headers.get("authorization"), "Bearer sesion-admin-test");
    assert.equal(peticion.headers.get("apikey"), "anon-test");
    assert.equal(peticion.headers.get("accept-profile"), "public");
    if (!peticion.url.pathname.endsWith("metricas_rotacion_stock_admin")) {
      assert.equal(peticion.url.searchParams.get("p_desde"), "2026-09-19");
      assert.equal(peticion.url.searchParams.get("p_hasta"), "2026-10-19");
    }
  }
  const porRpc = (rpc) => peticiones.find(({ url }) => url.pathname.endsWith(rpc)).url.searchParams;
  for (const rpc of ["metricas_ventas_mesero_admin", "metricas_cierres_caja_admin", "metricas_tiempos_preparacion_admin"]) {
    assert.equal(porRpc(rpc).get("limit"), "40");
  }
  assert.equal(porRpc("metricas_rotacion_stock_admin").get("limit"), "12");
  assert.equal(porRpc("metricas_lineas_venta_admin").get("limit"), "500");
  assert.equal(porRpc("metricas_lineas_venta_admin").get("order"), "dia_negocio.desc,pedido_item_id.desc");
  assert.equal(porRpc("metricas_lineas_venta_admin").get("anulado"), "eq.false");
});

test("el detalle incluye mas de 2000 lineas y todas las paginas del intervalo", async () => {
  const filas = Array.from({ length: 2301 }, (_, id) => ({ pedido_item_id: String(id), ingreso: id + 1 }));
  const { cliente, peticiones } = clienteConCors(({ url }) => {
    assert.equal(url.searchParams.get("p_desde"), "2026-08-01");
    assert.equal(url.searchParams.get("p_hasta"), "2026-10-19");
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    return Response.json(filas.slice(offset, offset + limit));
  });
  const { data, error } = await cargarLineasMetricas(cliente, "2026-08-01", "2026-10-19");
  assert.equal(error, null);
  assert.deepEqual(data, filas);
  assert.deepEqual(peticiones.map(({ url }) => Number(url.searchParams.get("offset"))), [0, 500, 1000, 1500, 2000]);
});

test("una pagina fallida no presenta un total parcial como si fuera completo", async () => {
  const { cliente } = clienteConCors(({ url }) => Number(url.searchParams.get("offset")) === 0
    ? Response.json(Array.from({ length: 500 }, () => ({ ingreso: 1000 })))
    : Response.json({ code: "42501", message: "sin_permiso" }, { status: 403 }));
  const { data, error } = await cargarLineasMetricas(cliente, "2026-08-01", "2026-10-19");
  assert.equal(data, null);
  assert.equal(error.code, "42501");
});

test("la exportacion SQL funciona con el mismo CORS y devuelve el CSV", async () => {
  const csv = "mesero,ventas\nMesero,10000";
  const { cliente, peticiones } = clienteConCors(() => new Response(JSON.stringify(csv)));
  const { data, error } = await consultaExportarMetricas(cliente, "ventas_mesero", "2026-09-19", "2026-10-19");
  assert.equal(error, null);
  assert.equal(data, csv);
  assert.equal(peticiones[0].method, "GET");
  assert.equal(peticiones[0].url.searchParams.get("p_reporte"), "ventas_mesero");
});

test("mantiene los errores de permisos de la base de datos", async () => {
  const { cliente } = clienteConCors(() => new Response(JSON.stringify({ code: "42501", message: "solo_admin_lee_metricas" }), { status: 403 }));
  const { error, data } = await consultasMetricasAdmin(cliente, "2026-09-19", "2026-10-19").resumen;
  assert.equal(error.code, "42501");
  assert.equal(error.message, "solo_admin_lee_metricas");
  assert.equal(data, null);
});
