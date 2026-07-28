"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { Perfil } from "@/lib/roles";

type Motivo = { id: string; texto: string };
type ResumenCaja = {
  requiere_apertura: boolean;
  cierre_abierto: any | null;
  efectivo_pagos?: number;
  retiros_total?: number;
  efectivo_esperado?: number;
  pagos_por_medio?: Record<string, number>;
  propinas_total?: number;
  retiros?: any[];
  cuentas?: { abiertas?: number; pendientes?: number; pagadas_turno?: number };
};

const medios: Record<string, string> = {
  efectivo: "Efectivo",
  datafono: "Datafono",
  nequi_daviplata: "Nequi/Daviplata",
  transferencia: "Transferencia",
};

export function CierreCajaPanel({ perfil }: { perfil: Perfil }) {
  const [resumen, setResumen] = useState<ResumenCaja | null>(null);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [baseInicial, setBaseInicial] = useState("");
  const [retiroMonto, setRetiroMonto] = useState("");
  const [retiroMotivoId, setRetiroMotivoId] = useState("");
  const [retiroObservacion, setRetiroObservacion] = useState("");
  const [retiroFactura, setRetiroFactura] = useState("");
  const [efectivoContado, setEfectivoContado] = useState("");
  const [justificacion, setJustificacion] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const cargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [{ data, error }, { data: motivosData, error: motivosError }] = await Promise.all([
      supabase.rpc("resumen_caja_actual"),
      supabase.from("motivos").select("id,texto").eq("tipo", "retiro_caja").eq("activo", true).order("texto"),
    ]);

    if (error) {
      setMensaje(error.message);
      return;
    }
    if (motivosError) setMensaje(motivosError.message);
    setResumen(data as ResumenCaja);
    setMotivos((motivosData ?? []) as Motivo[]);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function abrirCaja(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcesando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.rpc("abrir_caja", { p_base_inicial: Number(baseInicial) });
    if (error) setMensaje(error.message);
    else {
      setMensaje("Caja abierta.");
      setBaseInicial("");
      await cargar();
    }
    setProcesando(false);
  }

  async function registrarRetiro(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcesando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.rpc("registrar_retiro_caja", {
      p_monto: Number(retiroMonto),
      p_motivo_id: retiroMotivoId || null,
      p_observacion: retiroObservacion || null,
      p_numero_factura: retiroFactura || null,
    });
    if (error) setMensaje(error.message);
    else {
      setMensaje("Retiro registrado.");
      setRetiroMonto("");
      setRetiroMotivoId("");
      setRetiroObservacion("");
      setRetiroFactura("");
      await cargar();
    }
    setProcesando(false);
  }

  async function cerrarCaja(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcesando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("cerrar_caja", {
      p_efectivo_contado: Number(efectivoContado),
      p_justificacion: justificacion || null,
    });
    if (error) setMensaje(error.message);
    else {
      setMensaje(`Caja cerrada. Diferencia: ${formatoCOP(data?.diferencia ?? 0)}.`);
      setEfectivoContado("");
      setJustificacion("");
      await cargar();
    }
    setProcesando(false);
  }

  if (!resumen) {
    return <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 text-sm text-antiguo/70">Cargando cierre de caja...</section>;
  }

  if (resumen.requiere_apertura) {
    return (
      <section className="rounded-lg border border-oro/25 bg-espresso p-4 shadow-suave">
        <h2 className="text-xl font-black text-crema">Apertura de caja</h2>
        <p className="mt-1 text-sm text-antiguo/70">Debes registrar base inicial antes de cobrar o registrar retiros.</p>
        {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm">{mensaje}</p> : null}
        <form onSubmit={abrirCaja} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input value={baseInicial} onChange={(event) => setBaseInicial(event.target.value)} type="number" min="0" inputMode="numeric" placeholder="Base inicial" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <button disabled={procesando || baseInicial === ""} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Abrir caja</button>
        </form>
      </section>
    );
  }

  const cierre = resumen.cierre_abierto;
  const pagosPorMedio = resumen.pagos_por_medio ?? {};

  return (
    <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">Cierre de Caja</p>
          <h2 className="text-xl font-black text-crema">Turno abierto</h2>
          <p className="text-sm text-antiguo/70">Dia de negocio: {cierre?.dia_negocio}</p>
        </div>
        <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-sm font-bold">Actualizar</button>
      </div>

      {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm">{mensaje}</p> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-antiguo/10 bg-carbon p-3">
          <p className="text-xs text-antiguo/60">Base</p>
          <p className="text-lg font-black text-crema">{formatoCOP(cierre?.base_inicial)}</p>
        </div>
        <div className="rounded-md border border-antiguo/10 bg-carbon p-3">
          <p className="text-xs text-antiguo/60">Efectivo pagos</p>
          <p className="text-lg font-black text-crema">{formatoCOP(resumen.efectivo_pagos)}</p>
        </div>
        <div className="rounded-md border border-antiguo/10 bg-carbon p-3">
          <p className="text-xs text-antiguo/60">Retiros</p>
          <p className="text-lg font-black text-crema">{formatoCOP(resumen.retiros_total)}</p>
        </div>
        <div className="rounded-md border border-oro/25 bg-carbon p-3">
          <p className="text-xs text-antiguo/60">Efectivo esperado</p>
          <p className="text-lg font-black text-dorado">{formatoCOP(resumen.efectivo_esperado)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
          <p className="text-sm font-bold text-dorado">Medios de pago</p>
          <ul className="mt-2 space-y-1 text-sm text-antiguo/80">
            {Object.keys(medios).map((medio) => <li key={medio} className="flex justify-between"><span>{medios[medio]}</span><span>{formatoCOP(pagosPorMedio[medio] ?? 0)}</span></li>)}
            <li className="flex justify-between border-t border-antiguo/10 pt-2"><span>Propinas</span><span>{formatoCOP(resumen.propinas_total)}</span></li>
          </ul>
        </section>

        <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
          <p className="text-sm font-bold text-dorado">Cuentas</p>
          <ul className="mt-2 space-y-1 text-sm text-antiguo/80">
            <li className="flex justify-between"><span>Abiertas/por cobrar</span><span>{resumen.cuentas?.abiertas ?? 0}</span></li>
            <li className="flex justify-between"><span>Pendientes</span><span>{resumen.cuentas?.pendientes ?? 0}</span></li>
            <li className="flex justify-between"><span>Pagadas turno</span><span>{resumen.cuentas?.pagadas_turno ?? 0}</span></li>
          </ul>
        </section>

        <form onSubmit={cerrarCaja} className="rounded-md border border-oro/20 bg-carbon p-3">
          <p className="text-sm font-bold text-dorado">Cerrar turno</p>
          <input value={efectivoContado} onChange={(event) => setEfectivoContado(event.target.value)} type="number" min="0" inputMode="numeric" placeholder="Efectivo contado" className="tap-target mt-2 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
          <input value={justificacion} onChange={(event) => setJustificacion(event.target.value)} placeholder="Justificacion si descuadra" className="tap-target mt-2 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50" />
          <p className="mt-2 text-xs text-antiguo/60">Si descuadra, solo admin puede aprobar el cierre.</p>
          <button disabled={procesando || efectivoContado === ""} className="tap-target mt-3 w-full rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Cerrar caja</button>
        </form>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form onSubmit={registrarRetiro} className="rounded-md border border-antiguo/10 bg-carbon p-3">
          <p className="text-sm font-bold text-dorado">Registrar retiro</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input value={retiroMonto} onChange={(event) => setRetiroMonto(event.target.value)} type="number" min="0" inputMode="numeric" placeholder="Monto" className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
            <select value={retiroMotivoId} onChange={(event) => setRetiroMotivoId(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
              <option value="">Motivo opcional</option>
              {motivos.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.texto}</option>)}
            </select>
          </div>
          <input value={retiroObservacion} onChange={(event) => setRetiroObservacion(event.target.value)} placeholder="Observacion" className="tap-target mt-2 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50" />
          <input value={retiroFactura} onChange={(event) => setRetiroFactura(event.target.value)} placeholder="Factura opcional" className="tap-target mt-2 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50" />
          <button disabled={procesando || retiroMonto === ""} className="tap-target mt-3 w-full rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">Registrar retiro</button>
        </form>

        <section className="rounded-md border border-antiguo/10 bg-carbon p-3">
          <p className="text-sm font-bold text-dorado">Retiros del turno</p>
          <ul className="mt-2 max-h-48 space-y-2 overflow-auto text-sm text-antiguo/80">
            {(resumen.retiros ?? []).map((retiro) => (
              <li key={retiro.id} className="border-t border-antiguo/10 pt-2">
                <div className="flex justify-between gap-3"><span>{retiro.motivo ?? retiro.observacion ?? "Retiro"}</span><span>{formatoCOP(retiro.monto)}</span></div>
                {retiro.numero_factura ? <p className="text-xs text-antiguo/50">Factura: {retiro.numero_factura}</p> : null}
              </li>
            ))}
            {(resumen.retiros ?? []).length === 0 ? <li className="text-antiguo/50">Sin retiros registrados.</li> : null}
          </ul>
        </section>
      </div>
    </section>
  );
}
