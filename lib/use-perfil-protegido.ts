"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Perfil, RolUsuario } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

async function conTimeout<T>(promesa: PromiseLike<T>, ms: number, mensaje: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promesa),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(mensaje)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function usePerfilProtegido(roles: RolUsuario[]) {
  const router = useRouter();
  const rolesClave = roles.join("|");
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      if (activo) {
        setCargando(true);
        setError(null);
      }

      const supabase = supabaseBrowser();
      const { data: sessionData, error: sessionError } = await conTimeout(
        supabase.auth.getSession(),
        12000,
        "No se pudo leer la sesión en 12 segundos. Recarga e inicia sesión de nuevo.",
      );

      if (sessionError) throw sessionError;

      const userId = sessionData.session?.user.id;

      if (!userId) {
        if (activo) {
          setError("No hay sesión activa. Volviendo al login...");
          setCargando(false);
        }
        router.replace("/login");
        return;
      }

      const { data, error: perfilError } = await conTimeout(
        supabase
          .from("perfiles")
          .select("id, auth_user_id, nombre, usuario_login, rol, activo, created_at")
          .eq("auth_user_id", userId)
          .eq("activo", true)
          .single<Perfil>(),
        12000,
        "No se pudo cargar el perfil activo en 12 segundos. Revisa RLS o la conexión con Supabase.",
      );

      const rolesPermitidos = rolesClave.split("|") as RolUsuario[];
      if (perfilError || !data) {
        await supabase.auth.signOut();
        if (activo) {
          setError(`Perfil no activo o no enlazado. UID Auth: ${userId}`);
          setCargando(false);
        }
        router.replace("/login");
        return;
      }

      if (!rolesPermitidos.includes(data.rol)) {
        await supabase.auth.signOut();
        if (activo) {
          setError(`El rol ${data.rol} no tiene acceso a esta pantalla.`);
          setCargando(false);
        }
        router.replace("/login");
        return;
      }

      if (activo) {
        setPerfil(data);
        setCargando(false);
      }
    }

    cargar().catch((err) => {
      if (activo) {
        setError(err instanceof Error ? err.message : "No se pudo cargar la sesión.");
        setCargando(false);
      }
    });

    return () => {
      activo = false;
    };
  }, [router, rolesClave]);

  async function salir() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return { perfil, cargando, error, salir };
}
