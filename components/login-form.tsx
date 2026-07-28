"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { emailMesero, rutaPorRol, type Perfil } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ModoLogin = "equipo" | "mesero";
type TipoMensaje = "info" | "error" | "ok";

export function LoginForm() {
  const router = useRouter();
  const [modo, setModo] = useState<ModoLogin>("equipo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usuario, setUsuario] = useState("");
  const [pin, setPin] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [tipoMensaje, setTipoMensaje] = useState<TipoMensaje>("info");
  const [cargando, setCargando] = useState(false);

  async function iniciarSesion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensaje("Validando acceso...");
    setTipoMensaje("info");
    setCargando(true);

    try {
      const supabase = supabaseBrowser();

      if (modo === "equipo" && (!email.trim() || !password)) {
        throw new Error("Escribe correo y contraseña.");
      }

      if (modo === "mesero" && (!usuario.trim() || pin.length !== 4)) {
        throw new Error("Escribe usuario y PIN de 4 dígitos.");
      }

      const credenciales = modo === "mesero"
        ? { email: emailMesero(usuario), password: pin }
        : { email: email.trim(), password };

      const loginPromise = supabase.auth.signInWithPassword(credenciales);
      const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error("Supabase no respondió en 12 segundos. Revisa conexión o URL del proyecto.")),
          12000,
        );
      });
      const { data: authData, error: authError } = await Promise.race([loginPromise, timeoutPromise]);

      if (authError || !authData.user) {
        throw new Error(`Auth: ${authError?.message ?? "credenciales inválidas"}`);
      }

      setMensaje("Validando perfil activo...");

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

      setMensaje("Acceso correcto. Entrando...");
      setTipoMensaje("ok");
      router.push(rutaPorRol(perfil.rol));
      router.refresh();
    } catch (error) {
      setTipoMensaje("error");
      setMensaje(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setCargando(false);
    }
  }

  const mensajeClase = tipoMensaje === "error"
    ? "border-red-300/30 bg-red-950/40 text-red-100"
    : tipoMensaje === "ok"
      ? "border-emerald-300/30 bg-emerald-950/30 text-emerald-100"
      : "border-antiguo/20 bg-carbon text-champana";

  return (
    <form onSubmit={iniciarSesion} className="w-full rounded-lg border border-antiguo/20 bg-espresso/92 p-5 shadow-suave backdrop-blur">
      <div className="mb-5 grid grid-cols-2 rounded-md border border-antiguo/15 bg-carbon p-1 text-sm font-semibold">
        <button
          type="button"
          className={`tap-target rounded px-3 ${modo === "equipo" ? "bg-oro text-carbon" : "text-champana"}`}
          onClick={() => {
            setModo("equipo");
            setMensaje(null);
          }}
        >
          Admin / Caja
        </button>
        <button
          type="button"
          className={`tap-target rounded px-3 ${modo === "mesero" ? "bg-oro text-carbon" : "text-champana"}`}
          onClick={() => {
            setModo("mesero");
            setMensaje(null);
          }}
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
              onChange={(event) => setUsuario(event.target.value.trim().toLowerCase())}
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

      {mensaje ? <p className={`mt-4 rounded-md border p-3 text-sm ${mensajeClase}`}>{mensaje}</p> : null}

      <button
        type="submit"
        className="tap-target mt-5 w-full rounded-md bg-oro px-4 font-bold text-carbon disabled:cursor-not-allowed disabled:opacity-60"
        disabled={cargando}
      >
        {cargando ? "Validando..." : "Entrar"}
      </button>
    </form>
  );
}
