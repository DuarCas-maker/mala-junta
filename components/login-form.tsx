"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { emailMesero, rutaPorRol, type Perfil } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ModoLogin = "equipo" | "mesero";

export function LoginForm() {
  const router = useRouter();
  const [modo, setModo] = useState<ModoLogin>("equipo");
  const [email, setEmail] = useState("admin@malajunta.local");
  const [password, setPassword] = useState("Admin1234!");
  const [usuario, setUsuario] = useState("mesero1");
  const [pin, setPin] = useState("1111");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function iniciarSesion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensaje(null);
    setCargando(true);

    try {
      const supabase = supabaseBrowser();
      const credenciales = modo === "mesero"
        ? { email: emailMesero(usuario), password: pin }
        : { email, password };

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword(credenciales);

      if (authError || !authData.user) {
        throw new Error(`Auth: ${authError?.message ?? "credenciales inválidas"}`);
      }

      const { data: perfil, error: perfilError } = await supabase
        .from("perfiles")
        .select("id, auth_user_id, nombre, usuario_login, rol, activo, created_at")
        .eq("auth_user_id", authData.user.id)
        .eq("activo", true)
        .single<Perfil>();

      if (perfilError || !perfil) {
        await supabase.auth.signOut();
        throw new Error(`Perfil no activo o no enlazado. UID Auth: ${authData.user.id}`);
      }

      router.push(rutaPorRol(perfil.rol));
      router.refresh();
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={iniciarSesion} className="w-full max-w-md rounded-lg border border-antiguo/20 bg-espresso/90 p-5 shadow-suave backdrop-blur">
      <div className="mb-5 grid grid-cols-2 rounded-md border border-antiguo/15 bg-carbon p-1 text-sm font-semibold">
        <button
          type="button"
          className={`tap-target rounded px-3 ${modo === "equipo" ? "bg-oro text-carbon" : "text-champana"}`}
          onClick={() => setModo("equipo")}
        >
          Admin / Caja
        </button>
        <button
          type="button"
          className={`tap-target rounded px-3 ${modo === "mesero" ? "bg-oro text-carbon" : "text-champana"}`}
          onClick={() => setModo("mesero")}
        >
          Mesero PIN
        </button>
      </div>

      {modo === "equipo" ? (
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-champana">
            Correo
            <input
              className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema outline-none focus:border-dorado"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="block text-sm font-semibold text-champana">
            Contraseña
            <input
              className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema outline-none focus:border-dorado"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-champana">
            Usuario
            <input
              className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema outline-none focus:border-dorado"
              value={usuario}
              onChange={(event) => setUsuario(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="block text-sm font-semibold text-champana">
            PIN de 4 dígitos
            <input
              className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-xl tracking-widest text-crema outline-none focus:border-dorado"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              type="password"
              autoComplete="current-password"
            />
          </label>
        </div>
      )}

      {mensaje ? <p className="mt-4 rounded-md border border-red-300/30 bg-red-950/40 p-3 text-sm text-red-100">{mensaje}</p> : null}

      <button
        className="tap-target mt-5 w-full rounded-md bg-oro px-4 font-bold text-carbon disabled:cursor-not-allowed disabled:opacity-60"
        disabled={cargando}
      >
        {cargando ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
