"use client";

import Link from "next/link";
import { InventarioAdminPanel } from "@/components/admin/inventario-admin";
import { MetricasAdminPanel } from "@/components/admin/metricas-admin";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Perfil } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Estado = "idle" | "cargando" | "guardando";

const modulos = [
  { href: "/mesero", titulo: "Mesero", detalle: "Toma de pedidos" },
  { href: "/caja", titulo: "Caja", detalle: "Centro de mando" },
  { href: "/barra", titulo: "Barra", detalle: "Comandas" },
];

export function MeserosAdmin() {
  const router = useRouter();
  const [perfilAdmin, setPerfilAdmin] = useState<Perfil | null>(null);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [nombre, setNombre] = useState("Mesero nuevo");
  const [usuario, setUsuario] = useState("mesero-nuevo");
  const [pin, setPin] = useState("4444");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("cargando");

  const cargar = useCallback(async function cargar() {
    setEstado("cargando");
    setMensaje(null);

    try {
      const supabase = supabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;

      if (!userId) {
        router.replace("/login");
        return;
      }

      const { data: perfil, error: perfilError } = await supabase
        .from("perfiles")
        .select("id, auth_user_id, nombre, usuario_login, rol, activo, created_at")
        .eq("auth_user_id", userId)
        .eq("activo", true)
        .single<Perfil>();

      if (perfilError || perfil?.rol !== "admin") {
        router.replace("/login");
        return;
      }

      const { data: lista, error: listaError } = await supabase
        .from("perfiles")
        .select("id, auth_user_id, nombre, usuario_login, rol, activo, created_at")
        .order("created_at", { ascending: true })
        .returns<Perfil[]>();

      if (listaError) throw listaError;
      setPerfilAdmin(perfil);
      setPerfiles(lista ?? []);
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudo cargar el panel.");
    } finally {
      setEstado("idle");
    }
  }, [router]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function crearMesero(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEstado("guardando");
    setMensaje(null);

    try {
      const supabase = supabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error("Sesión requerida.");

      const response = await fetch("/api/admin/meseros", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nombre, usuario_login: usuario, pin }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo crear el mesero.");

      setMensaje(`Mesero creado: ${payload.perfil.nombre}`);
      setNombre("Mesero nuevo");
      setUsuario(`mesero-${Date.now().toString().slice(-4)}`);
      setPin("4444");
      await cargar();
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudo crear el mesero.");
    } finally {
      setEstado("idle");
    }
  }

  async function desactivar(perfil: Perfil) {
    setEstado("guardando");
    setMensaje(null);

    try {
      const supabase = supabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error("Sesión requerida.");

      const response = await fetch(`/api/admin/meseros/${perfil.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}` },
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo desactivar el usuario.");

      setMensaje(`Usuario desactivado: ${payload.perfil.nombre}`);
      await cargar();
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudo desactivar el usuario.");
    } finally {
      setEstado("idle");
    }
  }

  async function salir() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="min-h-screen px-4 py-5 text-champana sm:px-8">
      <section className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Mala Junta</p>
            <h1 className="text-3xl font-black text-crema">Administración</h1>
            <p className="mt-1 text-sm text-antiguo/70">Admin activo: {perfilAdmin?.nombre ?? "..."}</p>
          </div>
          <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold">Salir</button>
        </header>

        {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm font-semibold shadow-suave">{mensaje}</p> : null}

        <div className="grid gap-3 sm:grid-cols-3">
          {modulos.map((modulo) => (
            <Link key={modulo.href} href={modulo.href} className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave transition hover:border-oro/60">
              <p className="text-sm font-bold text-oro">{modulo.titulo}</p>
              <p className="mt-2 text-xl font-black text-crema">{modulo.detalle}</p>
            </Link>
          ))}
        </div>

        <MetricasAdminPanel />

        <InventarioAdminPanel />

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form onSubmit={crearMesero} className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
            <h2 className="text-xl font-black text-crema">Crear mesero</h2>
            <label className="mt-4 block text-sm font-bold text-champana">
              Nombre
              <input className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" value={nombre} onChange={(event) => setNombre(event.target.value)} />
            </label>
            <label className="mt-3 block text-sm font-bold text-champana">
              Usuario
              <input className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" value={usuario} onChange={(event) => setUsuario(event.target.value.toLowerCase().replace(/\s/g, ""))} />
            </label>
            <label className="mt-3 block text-sm font-bold text-champana">
              PIN
              <input className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-xl tracking-widest text-crema" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" />
            </label>
            <button disabled={estado !== "idle" || pin.length !== 4} className="tap-target mt-5 w-full rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-60">
              {estado === "guardando" ? "Guardando..." : "Crear mesero"}
            </button>
          </form>

          <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
            <h2 className="text-xl font-black text-crema">Usuarios</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-antiguo/15 text-antiguo/70">
                    <th className="py-2 pr-3">Nombre</th>
                    <th className="py-2 pr-3">Rol</th>
                    <th className="py-2 pr-3">Usuario</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2 pr-3">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {perfiles.map((perfil) => (
                    <tr key={perfil.id} className="border-b border-antiguo/10">
                      <td className="py-3 pr-3 font-bold text-crema">{perfil.nombre}</td>
                      <td className="py-3 pr-3">{perfil.rol}</td>
                      <td className="py-3 pr-3">{perfil.usuario_login ?? "correo"}</td>
                      <td className="py-3 pr-3">{perfil.activo ? "Activo" : "Inactivo"}</td>
                      <td className="py-3 pr-3">
                        {perfil.rol === "mesero" && perfil.activo ? (
                          <button onClick={() => desactivar(perfil)} className="tap-target rounded-md border border-red-300/30 px-3 font-bold text-red-100">
                            Desactivar
                          </button>
                        ) : (
                          <span className="text-antiguo/40">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
