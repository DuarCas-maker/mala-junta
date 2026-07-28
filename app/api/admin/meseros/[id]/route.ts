import { NextRequest, NextResponse } from "next/server";
import { contextoAdmin } from "@/lib/admin-context";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const contexto = await contextoAdmin(request);
  if ("error" in contexto) return contexto.error;

  const { data: perfil, error } = await contexto.userClient.rpc("desactivar_usuario", {
    p_perfil_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ perfil });
}
