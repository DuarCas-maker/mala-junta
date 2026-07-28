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
    <main className="min-h-screen px-4 py-5 text-champana sm:px-8">
      <section className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Mala Junta</p>
            <h1 className="text-3xl font-black text-crema">{titulo}</h1>
            <p className="mt-1 max-w-2xl text-sm text-antiguo/70">{descripcion}</p>
          </div>
          <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold text-champana">
            Salir
          </button>
        </header>

        {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-4 shadow-suave">{mensaje}</p> : null}

        {perfil ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <article className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
              <p className="text-sm font-semibold text-antiguo/65">Usuario activo</p>
              <h2 className="mt-2 text-xl font-black text-crema">{perfil.nombre}</h2>
              <p className="mt-1 text-sm text-antiguo/70">Rol: {perfil.rol}</p>
            </article>
            <article className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave sm:col-span-2">
              <p className="text-sm font-semibold text-antiguo/65">Estado</p>
              <p className="mt-2 text-base text-champana">Sesión activa.</p>
            </article>
          </div>
        ) : null}
      </section>
    </main>
  );
}
