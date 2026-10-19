import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { crearFetchSupabaseMismoOrigen } from "../lib/supabase-transport.ts";
import { reenviarRestSupabase } from "../lib/supabase-rest-proxy.ts";

const origin = "https://mala-junta.example.test";
const config = { url: "https://supabase.example.test", anonKey: "anon-test" };
const authorization = "Bearer sesion-caja-test";

function peticion(ruta, init = {}) {
  return new Request(`${origin}/api/supabase/rest/${ruta}`, {
    ...init, headers: { authorization, ...init.headers },
  });
}

test("cuentas pendientes y cierre usan POST con la sesion de caja a traves de Next.js", async () => {
  const cuentas = [{ id: "cuenta-1", estado: "pendiente", mesa_liberada_at: "2026-10-19T15:00:00Z", responsable_pendiente: "Cliente", total_cuenta: 20000, pagos: [{ monto: 5000 }] }];
  const resumen = { requiere_apertura: false, cuentas: { pendientes: 1 } };
  const llamadas = [];
  const transporte = crearFetchSupabaseMismoOrigen(config.url, origin, async (input, init) => {
    assert.ok(String(input).startsWith(`${origin}/api/supabase/rest/`));
    return reenviarRestSupabase(new Request(input, init), config, async (destino, options) => {
      llamadas.push(destino.pathname);
      assert.equal(options.method, "POST");
      assert.equal(options.headers.get("authorization"), authorization);
      assert.equal(options.headers.get("apikey"), "anon-test");
      assert.equal(options.headers.get("content-profile"), "public");
      assert.equal(new TextDecoder().decode(options.body), "{}");
      return Response.json(destino.pathname.endsWith("cuentas_activas_caja") ? cuentas : resumen);
    });
  });
  const cliente = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => "sesion-caja-test", global: { fetch: transporte },
  });
  const [cuentasRes, resumenRes] = await Promise.all([cliente.rpc("cuentas_activas_caja"), cliente.rpc("resumen_caja_actual")]);
  assert.equal(cuentasRes.error, null);
  assert.deepEqual(cuentasRes.data, cuentas);
  assert.equal(resumenRes.error, null);
  assert.deepEqual(resumenRes.data, resumen);
  assert.equal(llamadas.length, 2);
});

test("conserva cuerpo, token, esquema y metodo al escribir; no reenvia cookies ni claves del cliente", async () => {
  const body = JSON.stringify({ p_cuenta_id: "cuenta-1", p_responsable: "Cliente" });
  const request = peticion("rpc/actualizar_responsable_pendiente", { method: "POST", body, headers: {
    "content-type": "application/json", "content-profile": "public", prefer: "return=representation",
    cookie: "privada=1", apikey: "no-usar", "x-forwarded-host": "otro.example.test",
  } });
  const response = await reenviarRestSupabase(request, config, async (url, init) => {
    assert.equal(url.href, `${config.url}/rest/v1/rpc/actualizar_responsable_pendiente`);
    assert.equal(init.method, "POST");
    assert.equal(new TextDecoder().decode(init.body), body);
    assert.equal(init.headers.get("authorization"), authorization);
    assert.equal(init.headers.get("apikey"), config.anonKey);
    assert.equal(init.headers.get("content-profile"), "public");
    assert.equal(init.headers.get("prefer"), "return=representation");
    assert.equal(init.headers.has("cookie"), false);
    assert.equal(init.headers.has("x-forwarded-host"), false);
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "manual");
    return new Response(null, { status: 204 });
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("mantiene filtros, paginacion, conteos y respuestas de lectura", async () => {
  const request = peticion("cuentas?estado=eq.pendiente&select=id&limit=20", { headers: {
    "accept-profile": "public", range: "0-19", prefer: "count=exact",
  } });
  const response = await reenviarRestSupabase(request, config, async (url, init) => {
    assert.equal(url.searchParams.get("estado"), "eq.pendiente");
    assert.equal(url.searchParams.get("limit"), "20");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.headers.get("accept-profile"), "public");
    assert.equal(init.headers.get("range"), "0-19");
    return new Response('[{"id":"cuenta-1"}]', { status: 206, headers: {
      "content-type": "application/json", "content-range": "0-0/1", "set-cookie": "no-copiar=1",
    } });
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "0-0/1");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.deepEqual(await response.json(), [{ id: "cuenta-1" }]);
});

test("Auth, Storage y otros destinos conservan el transporte original", async () => {
  for (const url of [`${config.url}/auth/v1/token`, `${config.url}/storage/v1/object/foto`, "https://otro.example.test/rest/v1/cuentas"]) {
    const init = { method: "POST", body: "{}" };
    const fetchLocal = crearFetchSupabaseMismoOrigen(config.url, origin, async (input, options) => {
      assert.equal(input, url);
      assert.equal(options, init);
      return new Response("ok");
    });
    await fetchLocal(url, init);
  }
});

test("admite Request y conserva el cuerpo al cambiar el destino", async () => {
  const request = new Request(`${config.url}/rest/v1/rpc/cuentas_activas_caja`, { method: "POST", body: "{}", headers: { authorization } });
  const fetchLocal = crearFetchSupabaseMismoOrigen(config.url, origin, async (input) => {
    assert.equal(input.url, `${origin}/api/supabase/rest/rpc/cuentas_activas_caja`);
    assert.equal(input.method, "POST");
    assert.equal(input.headers.get("authorization"), authorization);
    assert.equal(await input.text(), "{}");
    return new Response("[]");
  });
  await fetchLocal(request);
});

test("rechaza peticiones sin token y rutas ajenas a tablas o RPC sin enviarlas", async () => {
  const noEnviar = async () => { assert.fail("No debe contactar Supabase"); };
  assert.equal((await reenviarRestSupabase(new Request(`${origin}/api/supabase/rest/cuentas`), config, noEnviar)).status, 401);
  for (const ruta of ["rpc/https://otro.example.test", "rpc/%2e%2e%2fauth", "cuentas/extra", "https://otro.example.test"]) {
    assert.equal((await reenviarRestSupabase(peticion(ruta), config, noEnviar)).status, 400);
  }
  assert.equal((await reenviarRestSupabase(peticion("cuentas"), {}, noEnviar)).status, 503);
});

test("conserva denegaciones RLS y errores de PostgreSQL", async () => {
  const error = { code: "42501", message: "solo_caja_o_admin_lee_cuentas" };
  const response = await reenviarRestSupabase(peticion("rpc/cuentas_activas_caja", { method: "POST", body: "{}" }), config,
    async () => Response.json(error, { status: 403 }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), error);
});

test("no sigue redirecciones ni reintenta automaticamente una escritura fallida", async () => {
  let llamadas = 0;
  const response = await reenviarRestSupabase(peticion("rpc/registrar_pagos_cuenta_dian", { method: "POST", body: "{}" }), config, async () => {
    llamadas++;
    return new Response(null, { status: 307, headers: { location: "https://otro.example.test" } });
  });
  assert.equal(response.status, 502);
  assert.equal(llamadas, 1);
});

test("las caidas y timeouts muestran un error sin exponer credenciales", async () => {
  for (const [error, status] of [[new Error("privado"), 502], [new DOMException("privado", "TimeoutError"), 504]]) {
    const response = await reenviarRestSupabase(peticion("cuentas"), config, async () => { throw error; });
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /privado|anon-test|sesion-caja-test/);
  }
});

test("HEAD conserva los encabezados y no envia un cuerpo", async () => {
  const response = await reenviarRestSupabase(peticion("cuentas", { method: "HEAD" }), config,
    async () => new Response(null, { headers: { "content-range": "*/3" } }));
  assert.equal(response.headers.get("content-range"), "*/3");
  assert.equal(await response.text(), "");
});
