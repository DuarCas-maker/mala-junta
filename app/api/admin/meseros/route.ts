import { NextRequest, NextResponse } from "next/server";
import { contextoAdmin } from "@/lib/admin-context";
import { emailMesero } from "@/lib/roles";

function normalizarUsuario(usuario: string) {
  return usuario.trim().toLowerCase().replace(/\s+/g, "");
}

export async function POST(request: NextRequest) {
  const contexto = await contextoAdmin(request);
  if ("error" in contexto) return contexto.error;

  const body = await request.json().catch(() => null) as { nombre?: string; usuario_login?: string; pin?: string } | null;
  const nombre = body?.nombre?.trim();
  const usuarioLogin = normalizarUsuario(body?.usuario_login ?? "");
  const pin = body?.pin ?? "";

  if (!nombre || nombre.length < 2) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }

  if (!usuarioLogin || usuarioLogin.length < 3) {
    return NextResponse.json({ error: "Usuario mínimo de 3 caracteres" }, { status: 400 });
  }

  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "PIN debe tener 4 dígitos" }, { status: 400 });
  }

  const email = emailMesero(usuarioLogin);
  const { data: authData, error: authError } = await contexto.service.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
    user_metadata: { nombre, rol: "mesero", usuario_login: usuarioLogin },
  });

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message ?? "No se pudo crear el usuario Auth" }, { status: 400 });
  }

  const { data: perfil, error: rpcError } = await contexto.userClient.rpc("crear_mesero", {
    p_nombre: nombre,
    p_pin: pin,
    p_usuario_login: usuarioLogin,
    p_auth_user_id: authData.user.id,
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  return NextResponse.json({ perfil }, { status: 201 });
}
