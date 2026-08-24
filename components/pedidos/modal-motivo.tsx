"use client";

import { FormEvent, useEffect, useState } from "react";

export type MotivoAccion = { id: string; texto: string };

type Props = {
  abierto: boolean;
  titulo: string;
  descripcion: string;
  textoConfirmar: string;
  motivos: MotivoAccion[];
  procesando?: boolean;
  onCerrar: () => void;
  onConfirmar: (motivoId: string, observacion: string) => Promise<void> | void;
};

export function ModalMotivo({ abierto, titulo, descripcion, textoConfirmar, motivos, procesando = false, onCerrar, onConfirmar }: Props) {
  const [motivoId, setMotivoId] = useState("");
  const [observacion, setObservacion] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setMotivoId("");
    setObservacion("");
    setMensaje(null);
  }, [abierto]);

  if (!abierto) return null;

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!motivoId) {
      setMensaje("Selecciona un motivo.");
      return;
    }

    setMensaje(null);
    await onConfirmar(motivoId, observacion.trim());
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-3 py-6">
      <form onSubmit={enviar} className="w-full max-w-lg rounded-lg border border-antiguo/15 bg-espresso p-4 text-champana shadow-suave">
        <div className="border-b border-antiguo/10 pb-3">
          <p className="text-sm font-bold uppercase tracking-wide text-oro">Confirmacion</p>
          <h2 className="mt-1 text-xl font-black text-crema">{titulo}</h2>
          <p className="mt-1 text-sm text-antiguo/70">{descripcion}</p>
        </div>

        <label className="mt-4 block text-sm font-bold text-champana">
          Motivo
          <select value={motivoId} onChange={(event) => setMotivoId(event.target.value)} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="">Selecciona motivo</option>
            {motivos.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.texto}</option>)}
          </select>
        </label>

        <label className="mt-3 block text-sm font-bold text-champana">
          Observacion opcional
          <textarea value={observacion} onChange={(event) => setObservacion(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-antiguo/20 bg-carbon p-3 text-crema" />
        </label>

        {mensaje ? <p className="mt-3 rounded-md border border-red-300/30 bg-red-950/30 p-3 text-sm font-bold text-red-100">{mensaje}</p> : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCerrar} disabled={procesando} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 text-sm font-bold disabled:opacity-50">Cancelar</button>
          <button disabled={procesando || motivos.length === 0} className="tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">{procesando ? "Procesando..." : textoConfirmar}</button>
        </div>
      </form>
    </div>
  );
}
