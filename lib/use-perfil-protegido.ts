"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Perfil, RolUsuario } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function usePerfilProtegido(roles: RolUsuario[]) {
  const router = useRouter();
  const rolesClave = roles.join("|");
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      setCargando(true);
      setError(null);
      const supabase = supabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;

      if (!userId) {
        router.replace("/login");
        return;
      }

      const { data, error: perfilError } = await supabase
        .from("perfiles")
        .select("id, auth_user_id, nombre, usuario_login, rol, activo, created_at")
        .eq("auth_user_id", userId)
        .eq("activo", true)
        .single<Perfil>();

      const rolesPermitidos = rolesClave.split("|") as RolUsuario[];
      if (perfilError || !data || !rolesPermitidos.includes(data.rol)) {
        await supabase.auth.signOut();
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
