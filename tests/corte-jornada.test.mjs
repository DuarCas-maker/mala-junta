import assert from "node:assert/strict";
import test from "node:test";
import { ejecutarCorte } from "../scripts/corte-jornada.mjs";

const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only-key" };
test("el trabajador invoca la RPC con credenciales de servidor y timeout", async () => {
  const cantidad = await ejecutarCorte({ env, fetchImpl: async (url, options) => {
    assert.equal(url.href, "https://example.test/rest/v1/rpc/procesar_corte_jornada");
    assert.equal(options.method, "POST");
    assert.equal(options.body, "{}");
    assert.equal(options.headers.Authorization, "Bearer test-only-key");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response("3", { status: 200 });
  } });
  assert.equal(cantidad, 3);
});
test("rechaza credenciales ausentes y transporte HTTP remoto antes de enviar", async () => {
  const fetchImpl = async () => { throw new Error("No debe enviar"); };
  await assert.rejects(ejecutarCorte({ env: {}, fetchImpl }), /Falta configurar/);
  await assert.rejects(ejecutarCorte({ env: { ...env, NEXT_PUBLIC_SUPABASE_URL: "http://example.test" }, fetchImpl }), /requiere HTTPS/);
});
test("permite Supabase local y un corte sin cuentas", async () => {
  assert.equal(await ejecutarCorte({ env: { ...env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, fetchImpl: async () => new Response("0") }), 0);
});
test("reporta RPC no instalada sin exponer respuesta o credenciales", async () => {
  await assert.rejects(ejecutarCorte({ env, fetchImpl: async () => new Response("contenido privado", { status: 404 }) }), /HTTP 404.*migracion 058/);
  await assert.rejects(ejecutarCorte({ env, fetchImpl: async () => new Response('"incorrecto"') }), /Respuesta invalida/);
});
