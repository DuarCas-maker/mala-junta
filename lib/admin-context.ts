import { NextRequest, NextResponse } from "next/server";
import type { Perfil } from "@/lib/roles";
import { supabaseConToken, supabaseService } from "@/lib/supabase-server";

export async function contextoAdmin(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return { error: NextResponse.json({ error: "Sesión requerida" }, { status: 401 }) } as const;
  }

  const userClient = supabaseConToken(token);
  const service = supabaseService();
  const { data: userData, error: userError } = await userClient.auth.getUser(token);

  if (userError || !userData.user) {
    return { error: NextResponse.json({ error: "Sesión inválida" }, { status: 401 }) } as const;
  }

  const { data: perfil, error: perfilError } = await service
    .from("perfiles")
    .select("id, auth_user_id, nombre, usuario_login, rol, activo, created_at")
    .eq("auth_user_id", userData.user.id)
    .eq("activo", true)
    .single<Perfil>();

  if (perfilError || perfil?.rol !== "admin") {
    return { error: NextResponse.json({ error: "Solo administrador" }, { status: 403 }) } as const;
  }

  return { userClient, service, perfil } as const;
}
