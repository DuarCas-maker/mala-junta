"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Perfil, RolUsuario } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Props = {
  rolEsperado: RolUsuario | "barra";
  titulo: string;
  descripcion: string;
};

export function PanelRol({ rolEsperado, titulo, descripcion }: Props) {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [mensaje, setMensaje] = useState("Cargando sesión...");

  useEffect(() => {
    let vivo = true;

    async function cargar() {
      try {
        const supabase = supabaseBrowser();
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user.id;

        if (!userId) {
          router.replace("/login");
          return;
        }

        const { data, error } = await supabase
          .from("perfiles")
          .select("id, auth_user_id, nombre, usuario_login, rol, activo, created_at")
          .eq("auth_user_id", userId)
          .eq("activo", true)
          .single<Perfil>();

        if (error || !data) {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        const puedeVer = rolEsperado === "barra"
          ? data.rol === "admin" || data.rol === "caja"
          : data.rol === rolEsperado;

        if (!puedeVer) {
          router.replace(data.rol === "admin" ? "/admin" : data.rol === "caja" ? "/caja" : "/mesero");
          return;
        }

        if (vivo) {
          setPerfil(data);
          setMensaje("");
        }
      } catch (error) {
        if (vivo) setMensaje(error instanceof Error ? error.message : "No se pudo cargar la sesión.");
      }
    }

    cargar();
    return () => {
      vivo = false;
    };
  }, [rolEsperado, router]);

  async function salir() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-8">
      <section className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-black/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-acento">Mala Junta</p>
            <h1 className="text-3xl font-black text-tinta">{titulo}</h1>
            <p className="mt-1 max-w-2xl text-sm text-black/65">{descripcion}</p>
          </div>
          <button onClick={salir} className="tap-target rounded-md border border-black/15 bg-white px-4 font-bold text-tinta">
            Salir
          </button>
        </header>

        {mensaje ? <p className="rounded-md bg-white p-4 shadow-suave">{mensaje}</p> : null}

        {perfil ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <article className="rounded-lg border border-black/10 bg-white p-4 shadow-suave">
              <p className="text-sm font-semibold text-black/55">Usuario activo</p>
              <h2 className="mt-2 text-xl font-black text-tinta">{perfil.nombre}</h2>
              <p className="mt-1 text-sm text-black/65">Rol: {perfil.rol}</p>
            </article>
            <article className="rounded-lg border border-black/10 bg-white p-4 shadow-suave sm:col-span-2">
              <p className="text-sm font-semibold text-black/55">Estado F0</p>
              <p className="mt-2 text-base text-tinta">
                Fundación lista para conectar los flujos de la siguiente fase sin mover reglas críticas al cliente.
              </p>
            </article>
          </div>
        ) : null}
      </section>
    </main>
  );
}
