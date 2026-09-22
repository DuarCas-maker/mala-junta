"use client";

import { useEffect } from "react";

export type TipoAviso = "exito" | "error" | "advertencia" | "info";

export type AccionAviso = {
  etiqueta: string;
  ejecutar: () => void;
};

export function AvisoFlotante({
  mensaje,
  tipo = "info",
  accion,
  onCerrar,
}: {
  mensaje: string | null;
  tipo?: TipoAviso;
  accion?: AccionAviso | null;
  onCerrar: () => void;
}) {
  useEffect(() => {
    if (!mensaje || accion || tipo === "error" || tipo === "advertencia") return;
    const timeout = window.setTimeout(onCerrar, 5000);
    return () => window.clearTimeout(timeout);
  }, [accion, mensaje, onCerrar, tipo]);

  if (!mensaje) return null;

  const clases = tipo === "exito"
    ? "border-emerald-300/60 bg-emerald-950 text-emerald-50"
    : tipo === "error"
      ? "border-red-300/60 bg-red-950 text-red-50"
      : tipo === "advertencia"
        ? "border-oro/60 bg-cafe text-crema"
        : "border-antiguo/35 bg-espresso text-crema";

  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[100] flex justify-center sm:inset-x-auto sm:right-5 sm:top-5 sm:w-[min(440px,calc(100vw-2.5rem))]" role={tipo === "error" ? "alert" : "status"} aria-live={tipo === "error" ? "assertive" : "polite"}>
      <div className={`pointer-events-auto flex w-full items-start gap-3 rounded-lg border p-3 shadow-2xl ${clases}`}>
        <p className="min-w-0 flex-1 text-sm font-bold">{mensaje}</p>
        {accion ? (
          <button type="button" onClick={accion.ejecutar} className="shrink-0 rounded-md border border-current/40 px-3 py-1 text-xs font-black">
            {accion.etiqueta}
          </button>
        ) : null}
        <button type="button" onClick={onCerrar} className="shrink-0 rounded px-1 text-lg font-black leading-none opacity-80 hover:opacity-100" aria-label="Cerrar aviso">×</button>
      </div>
    </div>
  );
}
