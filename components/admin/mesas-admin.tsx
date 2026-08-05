"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Mesa = { id: string; nombre: string; zona: string; es_vip: boolean; activa: boolean };
type Estado = "idle" | "cargando" | "guardando";

function numeroMesa(nombre: string) {
  const coincidencia = nombre.match(/^Mesa\s+(\d+)$/i);
  return coincidencia ? Number(coincidencia[1]) : Number.MAX_SAFE_INTEGER;
}

function ordenarMesas(a: Mesa, b: Mesa) {
  const diferencia = numeroMesa(a.nombre) - numeroMesa(b.nombre);
  return diferencia || a.nombre.localeCompare(b.nombre, "es");
}

export function MesasAdminPanel() {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [totalMesas, setTotalMesas] = useState("6");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("cargando");

  const totalActual = useMemo(() => mesas.filter((mesa) => mesa.activa).length, [mesas]);

  const cargar = useCallback(async () => {
    setEstado("cargando");
    setMensaje(null);

    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("mesas")
        .select("id,nombre,zona,es_vip,activa")
        .eq("activa", true);

      if (error) throw error;

      const mesasActivas = ((data ?? []) as Mesa[]).sort(ordenarMesas);
      setMesas(mesasActivas);
      setTotalMesas(String(mesasActivas.length || 1));
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudieron cargar las mesas.");
    } finally {
      setEstado("idle");
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const total = Number(totalMesas);
    if (!Number.isInteger(total) || total < 1 || total > 200) {
      setMensaje("Define un numero de mesas entre 1 y 200.");
      return;
    }

    setEstado("guardando");
    setMensaje(null);

    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("configurar_numero_mesas", { p_total: total });

      if (error) throw error;

      const mesasActualizadas = ((data ?? []) as Mesa[]).sort(ordenarMesas);
      setMesas(mesasActualizadas);
      setTotalMesas(String(total));
      setMensaje(`Mesas actualizadas: Mesa 1 a Mesa ${total}.`);
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : "No se pudo guardar la configuracion de mesas.");
    } finally {
      setEstado("idle");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <form onSubmit={guardar} className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <h3 className="text-xl font-black text-crema">Numero de mesas</h3>
        <label className="mt-4 block text-sm font-bold text-champana">
          Mesas activas
          <input
            value={totalMesas}
            onChange={(event) => setTotalMesas(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            min="1"
            max="200"
            type="number"
            className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema"
          />
        </label>
        <button disabled={estado !== "idle" || !totalMesas} className="tap-target mt-5 w-full rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-60">
          {estado === "guardando" ? "Guardando..." : "Guardar mesas"}
        </button>
        {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm font-semibold text-champana">{mensaje}</p> : null}
      </form>

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-crema">Mesas visibles</h3>
            <p className="mt-1 text-sm text-antiguo/70">Actualmente visibles en pedidos: {totalActual}</p>
          </div>
          <button type="button" onClick={cargar} disabled={estado !== "idle"} className="tap-target rounded-md border border-antiguo/20 px-4 text-sm font-bold text-crema disabled:opacity-50">
            Recargar
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {mesas.map((mesa) => (
            <div key={mesa.id} className="rounded-md border border-antiguo/15 bg-carbon px-3 py-2">
              <p className="font-black text-crema">{mesa.nombre}</p>
              <p className="text-xs text-antiguo/60">{mesa.zona}</p>
            </div>
          ))}
        </div>

        {estado === "cargando" ? <p className="mt-4 text-sm text-antiguo/70">Cargando mesas...</p> : null}
        {estado !== "cargando" && mesas.length === 0 ? <p className="mt-4 text-sm text-antiguo/70">No hay mesas activas.</p> : null}
      </section>
    </div>
  );
}
