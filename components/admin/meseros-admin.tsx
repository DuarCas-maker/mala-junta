"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Perfil } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Estado = "idle" | "cargando" | "guardando";

export function MeserosAdmin() {
  const router = useRouter();
  const [perfilAdmin, setPerfilAdmin] = useState<Perfil | null>(null);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [nombre, setNombre] = useState("Mesero 1");
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

      if (!token) throw new Error("SesiÃ³n requerida.");

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
      setNombre("Mesero 1");
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

      if (!token) throw new Error("SesiÃ³n requerida.");

      const response = await fetch(`/api/admin/meseros/${perfil.id}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
        },
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
    <main className="min-h-screen px-4 py-5 sm:px-8">
      <section className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-black/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-acento">Mala Junta</p>
            <h1 className="text-3xl font-black text-tinta">AdministraciÃ³n</h1>
            <p className="mt-1 text-sm text-black/65">Fundaciones F0: usuarios, roles base y acceso.</p>
          </div>
          <button onClick={salir} className="tap-target rounded-md border border-black/15 bg-white px-4 font-bold text-tinta">
            Salir
          </button>
        </header>

        {mensaje ? <p className="rounded-md bg-white p-3 text-sm font-semibold text-tinta shadow-suave">{mensaje}</p> : null}

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form onSubmit={crearMesero} className="rounded-lg border border-black/10 bg-white p-4 shadow-suave">
            <h2 className="text-xl font-black text-tinta">Crear mesero</h2>
            <p className="mt-1 text-sm text-black/60">Nombre + usuario + PIN de 4 dÃ­gitos.</p>
            <label className="mt-4 block text-sm font-bold text-tinta">
              Nombre
              <input className="tap-target mt-1 w-full rounded-md border border-black/15 px-3" value={nombre} onChange={(event) => setNombre(event.target.value)} />
            </label>
            <label className="mt-3 block text-sm font-bold text-tinta">
              Usuario
              <input className="tap-target mt-1 w-full rounded-md border border-black/15 px-3" value={usuario} onChange={(event) => setUsuario(event.target.value.toLowerCase().replace(/\s/g, ""))} />
            </label>
            <label className="mt-3 block text-sm font-bold text-tinta">
              PIN
              <input className="tap-target mt-1 w-full rounded-md border border-black/15 px-3 text-xl tracking-widest" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" />
            </label>
            <button disabled={estado !== "idle" || pin.length !== 4} className="tap-target mt-5 w-full rounded-md bg-acento px-4 font-black text-white disabled:opacity-60">
              {estado === "guardando" ? "Guardando..." : "Crear en menos de 10 s"}
            </button>
          </form>

          <section className="rounded-lg border border-black/10 bg-white p-4 shadow-suave">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-tinta">Usuarios</h2>
              <p className="text-sm text-black/55">Admin activo: {perfilAdmin?.nombre ?? "..."}</p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/55">
                    <th className="py-2 pr-3">Nombre</th>
                    <th className="py-2 pr-3">Rol</th>
                    <th className="py-2 pr-3">Usuario</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2 pr-3">AcciÃ³n</th>
                  </tr>
                </thead>
                <tbody>
                  {perfiles.map((perfil) => (
                    <tr key={perfil.id} className="border-b border-black/5">
                      <td className="py-3 pr-3 font-bold text-tinta">{perfil.nombre}</td>
                      <td className="py-3 pr-3">{perfil.rol}</td>
                      <td className="py-3 pr-3">{perfil.usuario_login ?? "correo"}</td>
                      <td className="py-3 pr-3">{perfil.activo ? "Activo" : "Inactivo"}</td>
                      <td className="py-3 pr-3">
                        {perfil.rol === "mesero" && perfil.activo ? (
                          <button onClick={() => desactivar(perfil)} className="tap-target rounded-md border border-red-200 px-3 font-bold text-red-700">
                            Desactivar
                          </button>
                        ) : (
                          <span className="text-black/40">-</span>
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
