export type RolUsuario = "admin" | "caja" | "mesero";

export type Perfil = {
  id: string;
  auth_user_id: string | null;
  nombre: string;
  usuario_login: string | null;
  rol: RolUsuario;
  activo: boolean;
  created_at: string;
};

export function rutaPorRol(rol: RolUsuario) {
  if (rol === "admin") return "/admin";
  if (rol === "caja") return "/caja";
  return "/mesero";
}

export function emailMesero(usuario: string) {
  const dominio = process.env.NEXT_PUBLIC_MESERO_AUTH_DOMAIN ?? "mesero.malajunta.local";
  return `${usuario.trim().toLowerCase()}@${dominio}`;
}
