"use client";

import Link from "next/link";
import { CatalogoStockAdminPanel } from "@/components/admin/catalogo-stock-admin";
import { InventarioAdminPanel } from "@/components/admin/inventario-admin";
import { MetricasAdminPanel } from "@/components/admin/metricas-admin";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Perfil } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Estado = "idle" | "cargando" | "guardando";
type ModuloAdmin = "metricas" | "catalogo" | "auditoria" | "usuarios";

const modulosAdmin: { id: ModuloAdmin; titulo: string; detalle: string }[] = [
  { id: "metricas", titulo: "Metricas", detalle: "Ventas, margen y caja" },
  { id: "catalogo", titulo: "Catalogo y stock", detalle: "Productos, compras y combos" },
  { id: "auditoria", titulo: "Auditoria", detalle: "Conteos y diferencias" },
  { id: "usuarios", titulo: "Usuarios", detalle: "Perfiles y meseros PIN" },
];

const accesosOperacion = [
  { href: "/mesero", titulo: "Mesero" },
  { href: "/caja", titulo: "Caja" },
  { href: "/barra", titulo: "Barra" },
];

export function MeserosAdmin() {
  const router = useRouter();
  const [moduloActivo, setModuloActivo] = useState<ModuloAdmin>("metricas");
  const [perfilAdmin, setPerfilAdmin] = useState<Perfil | null>(null);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [nombre, setNombre] = useState("Mesero nuevo");
  const [usuario, setUsuario] = useState("mesero-nuevo");
  const [pin, setPin] = useState("4444");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("cargando");

  const moduloActual = useMemo(
    () => modulosAdmin.find((modulo) => modulo.id === moduloActivo) ?? modulosAdmin[0],
    [moduloActivo],
  );

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

      if (!token) throw new Error("Sesion requerida.");

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

      if (!token) throw new Error("Sesion requerida.");

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
    <main className="min-h-screen bg-carbon text-champana">
      <div className="mx-auto grid min-h-screen max-w-[1500px] gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-antiguo/15 bg-cafe/95 px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:px-5">
          <div className="flex items-start justify-between gap-3 lg:block">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-oro">Mala Junta</p>
              <h1 className="mt-1 text-2xl font-black text-crema">Admin</h1>
              <p className="mt-1 text-xs text-antiguo/65">{perfilAdmin?.nombre ?? "Cargando perfil"}</p>
            </div>
            <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 text-sm font-bold text-crema lg:mt-5 lg:w-full">
              Salir
            </button>
          </div>

          <nav className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-1" aria-label="Modulos de administracion">
            {modulosAdmin.map((modulo) => {
              const activo = modulo.id === moduloActivo;
              return (
                <button
                  key={modulo.id}
                  type="button"
                  onClick={() => setModuloActivo(modulo.id)}
                  className={[
                    "rounded-md border px-3 py-3 text-left transition",
                    activo
                      ? "border-oro bg-oro text-carbon shadow-suave"
                      : "border-antiguo/15 bg-espresso text-champana hover:border-oro/60",
                  ].join(" ")}
                  aria-current={activo ? "page" : undefined}
                >
                  <span className="block text-sm font-black">{modulo.titulo}</span>
                  <span className={activo ? "mt-1 block text-xs text-carbon/75" : "mt-1 block text-xs text-antiguo/55"}>{modulo.detalle}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-5 border-t border-antiguo/10 pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-antiguo/55">Operacion</p>
            <div className="mt-2 grid grid-cols-3 gap-2 lg:grid-cols-1">
              {accesosOperacion.map((acceso) => (
                <Link key={acceso.href} href={acceso.href} className="tap-target rounded-md border border-antiguo/15 bg-carbon px-3 py-2 text-center text-sm font-bold text-crema hover:border-oro/50 lg:text-left">
                  {acceso.titulo}
                </Link>
              ))}
            </div>
          </div>
        </aside>

        <section className="min-w-0 px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
          <header className="mb-5 border-b border-antiguo/15 pb-4">
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Modulo</p>
            <h2 className="text-2xl font-black text-crema sm:text-3xl">{moduloActual.titulo}</h2>
            <p className="mt-1 text-sm text-antiguo/70">{moduloActual.detalle}</p>
          </header>

          {mensaje ? <p className="mb-4 rounded-md border border-antiguo/15 bg-espresso p-3 text-sm font-semibold shadow-suave">{mensaje}</p> : null}

          {moduloActivo === "metricas" ? <MetricasAdminPanel /> : null}
          {moduloActivo === "catalogo" ? <CatalogoStockAdminPanel /> : null}
          {moduloActivo === "auditoria" ? <InventarioAdminPanel vista="auditoria" /> : null}
          {moduloActivo === "usuarios" ? (
            <UsuariosAdminPanel
              estado={estado}
              perfiles={perfiles}
              nombre={nombre}
              usuario={usuario}
              pin={pin}
              setNombre={setNombre}
              setUsuario={setUsuario}
              setPin={setPin}
              crearMesero={crearMesero}
              desactivar={desactivar}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function UsuariosAdminPanel({
  estado,
  perfiles,
  nombre,
  usuario,
  pin,
  setNombre,
  setUsuario,
  setPin,
  crearMesero,
  desactivar,
}: {
  estado: Estado;
  perfiles: Perfil[];
  nombre: string;
  usuario: string;
  pin: string;
  setNombre: (valor: string) => void;
  setUsuario: (valor: string) => void;
  setPin: (valor: string) => void;
  crearMesero: (event: FormEvent<HTMLFormElement>) => void;
  desactivar: (perfil: Perfil) => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <form onSubmit={crearMesero} className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <h3 className="text-xl font-black text-crema">Crear mesero</h3>
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

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <h3 className="text-xl font-black text-crema">Usuarios</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-antiguo/15 text-antiguo/70">
                <th className="py-2 pr-3">Nombre</th>
                <th className="py-2 pr-3">Rol</th>
                <th className="py-2 pr-3">Usuario</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Accion</th>
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
  );
}
