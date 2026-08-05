"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { rutaPorRol, type Perfil } from "@/lib/roles";
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
  const [mensaje, setMensaje] = useState<string>("Selecciona el tipo de acceso e ingresa tus datos.");
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

      let credenciales = { email: email.trim(), password };

      if (modo === "mesero") {
        const { data: emailAuth, error: emailError } = await supabase.rpc("email_login_mesero", {
          p_usuario_login: usuario,
          p_pin: pin,
        });

        if (emailError || !emailAuth) {
          throw new Error(`Mesero PIN: ${emailError?.message ?? "usuario o PIN inválido"}`);
        }

        credenciales = { email: String(emailAuth), password: pin };
      }

      const loginPromise = supabase.auth.signInWithPassword(credenciales);
      const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error("Supabase no respondió en 12 segundos. Revisa conexión o URL del proyecto.")),
          12000,
        );
      });
      const { data: authData, error: authError } = await Promise.race([loginPromise, timeoutPromise]);

      if (authError || !authData.user) {
        const detalle = authError?.message || authError?.name || JSON.stringify(authError ?? {});
        throw new Error(`Auth: ${detalle || "credenciales inválidas"}`);
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

  function seleccionarModo(siguiente: ModoLogin) {
    setModo(siguiente);
    setTipoMensaje("info");
    setMensaje(siguiente === "equipo" ? "Acceso seleccionado: Admin / Caja." : "Acceso seleccionado: Mesero PIN.");
  }

  const mensajeClase = tipoMensaje === "error"
    ? "border-red-300/40 bg-red-950/50 text-red-50"
    : tipoMensaje === "ok"
      ? "border-emerald-300/30 bg-emerald-950/35 text-emerald-100"
      : "border-oro/25 bg-carbon text-champana";

  const tabBase = "tap-target rounded-md border px-3 py-2 text-center transition";
  const tabActivo = "border-dorado bg-oro text-carbon shadow-[0_0_0_2px_rgba(226,176,127,0.25)]";
  const tabInactivo = "border-antiguo/15 bg-espresso text-antiguo hover:border-oro/50";

  return (
    <form onSubmit={iniciarSesion} className="w-full rounded-lg border border-antiguo/20 bg-espresso/92 p-4 shadow-suave backdrop-blur sm:p-5">
      <fieldset className="mb-5">
        <legend className="mb-2 text-xs font-black uppercase tracking-wide text-oro">Tipo de acceso</legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={modo === "equipo"}
            className={`${tabBase} ${modo === "equipo" ? tabActivo : tabInactivo}`}
            onClick={() => seleccionarModo("equipo")}
          >
            <span className="block text-sm font-black">Admin / Caja</span>
            <span className="mt-1 block text-[11px] font-bold uppercase tracking-wide opacity-80">
              {modo === "equipo" ? "Seleccionado" : "Correo"}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={modo === "mesero"}
            className={`${tabBase} ${modo === "mesero" ? tabActivo : tabInactivo}`}
            onClick={() => seleccionarModo("mesero")}
          >
            <span className="block text-sm font-black">Mesero PIN</span>
            <span className="mt-1 block text-[11px] font-bold uppercase tracking-wide opacity-80">
              {modo === "mesero" ? "Seleccionado" : "Usuario + PIN"}
            </span>
          </button>
        </div>
      </fieldset>

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

      <p className={`mt-4 rounded-md border p-3 text-sm ${mensajeClase}`}>{mensaje}</p>

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
