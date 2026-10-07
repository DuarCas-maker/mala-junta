// PostgreSQL WASM aislado: ejecuta las migraciones reales, sin acceder a produccion.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgtap } from "@electric-sql/pglite-pgtap";

const db = new PGlite({ extensions: { pgcrypto, citext, pgtap } });
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create schema extensions;
    create table auth.users (
      id uuid primary key, instance_id uuid, aud text, role text, email text,
      encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz,
      updated_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean
    );
    create table auth.identities (
      id uuid primary key, user_id uuid, identity_data jsonb, provider text, provider_id text,
      last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, unique(provider, provider_id)
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  const files = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (file.startsWith("058_")) {
      await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
      // Datos previos al cambio: una cuenta historica cerrada con saldo y total desactualizado.
      await db.exec(`
        insert into public.productos(id, nombre, precio_venta, imagen_url, activo, stock_actual)
        values ('f9000000-0000-0000-0000-000000000001', 'Producto pruebas jornada', 10000, 'https://example.test/producto.png', true, 1000);
        insert into public.cuentas(id, mesa_id, estado, dia_negocio, abierta_por, total_cuenta)
        values ('f9000000-0000-0000-0000-000000000002', (select id from mesas where activa order by nombre desc limit 1),
          'cerrada', public.dia_negocio(now()) - 2, '10000000-0000-0000-0000-000000000011', 0);
        insert into public.pedidos(id, cuenta_id, mesero_id, enviado_at)
        values ('f9000000-0000-0000-0000-000000000003', 'f9000000-0000-0000-0000-000000000002',
          '10000000-0000-0000-0000-000000000011', now() - interval '2 days');
        insert into public.pedido_items(pedido_id, producto_id, cantidad, precio_unitario_capturado)
        values ('f9000000-0000-0000-0000-000000000003', 'f9000000-0000-0000-0000-000000000001', 1, 10000);
        insert into public.pagos(cuenta_id, medio, monto, usuario_id)
        values ('f9000000-0000-0000-0000-000000000002', 'efectivo', 1000, '10000000-0000-0000-0000-000000000002');
      `);
    }
    try { await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")).replace(/^\uFEFF/, "")); }
    catch (error) { throw new Error(`Migracion ${file}: ${error.message} (${error.code}, posicion ${error.position})`); }
  }
  const historica = (await db.query("select * from cuentas where id = 'f9000000-0000-0000-0000-000000000002'")).rows[0];
  assert.equal(historica.estado, "pendiente");
  assert.equal(Number(historica.total_cuenta), 10000);
  assert.ok(historica.mesa_id && historica.mesa_liberada_at);
  assert.equal(historica.motivo_liberacion, "migracion");
  assert.equal(Number((await db.query("select sum(monto) as pagado from pagos where cuenta_id = $1", [historica.id])).rows[0].pagado), 1000);
  console.info("Migracion de cuenta historica mal cerrada: conserva deuda, abono y mesa.");
  await db.exec("set search_path = public, extensions;");
  for (const file of ["f8_reconciliar_cuenta_pagada.sql", "f9_pendientes_jornada.sql"]) {
    let results;
    try { results = await db.exec(await readFile(new URL(`./rls/${file}`, import.meta.url), "utf8")); }
    catch (error) { throw new Error(`${file}: ${error.message} (${error.code}, ${error.where ?? error.position})`); }
    const lines = results.flatMap((result) => result.rows.flatMap((row) => Object.values(row))).filter((value) => typeof value === "string" && /^(?:ok |not ok |1\.\.|#)/.test(value));
    for (const line of lines) console.info(line);
    assert.ok(lines.some((line) => /^1\.\./.test(line)), `${file}: debe existir plan de pgTAP`);
    assert.ok(!lines.some((line) => /not ok |Looks like you|planned \d+ tests but ran/.test(line)), `${file}: pruebas pgTAP fallidas`);
    console.info(`${file}: verificado`);
  }
  console.info(`Las ${files.length} migraciones y las pruebas de jornada pasaron en PostgreSQL aislado.`);
} finally {
  await db.close();
}
