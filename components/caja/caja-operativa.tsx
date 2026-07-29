"use client";

import Link from "next/link";
import { CierreCajaPanel } from "@/components/caja/cierre-caja-panel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { estadoPedidoTexto, formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePerfilProtegido } from "@/lib/use-perfil-protegido";

type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";
type Motivo = { id: string; texto: string };
type Cuenta = any;

const mediosPago: { id: MedioPago; nombre: string }[] = [
  { id: "efectivo", nombre: "Efectivo" },
  { id: "datafono", nombre: "Datafono" },
  { id: "nequi_daviplata", nombre: "Nequi/Daviplata" },
  { id: "transferencia", nombre: "Transferencia" },
];

function totalPagado(cuenta: Cuenta) {
  return (cuenta.pagos ?? []).reduce((sum: number, pago: any) => sum + Number(pago.monto ?? 0), 0);
}

function nombreMesa(cuenta: Cuenta) {
  const mesa = Array.isArray(cuenta.mesas) ? cuenta.mesas[0] : cuenta.mesas;
  return mesa ? `${mesa.nombre} - ${mesa.zona}` : "Barra";
}

function meseroPedido(pedido: any) {
  const perfil = Array.isArray(pedido.perfiles) ? pedido.perfiles[0] : pedido.perfiles;
  return perfil?.nombre ?? "-";
}

function nombreMedio(medio: string) {
  return mediosPago.find((item) => item.id === medio)?.nombre ?? medio;
}

export function CajaOperativa() {
  const { perfil, cargando, error, salir } = usePerfilProtegido(["caja", "admin"]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [actualizadoAt, setActualizadoAt] = useState<string | null>(null);
  const [montosPago, setMontosPago] = useState<Record<string, string>>({});
  const [mediosSeleccionados, setMediosSeleccionados] = useState<Record<string, MedioPago>>({});
  const [propinas, setPropinas] = useState<Record<string, string>>({});
  const [pendiente, setPendiente] = useState<Record<string, boolean>>({});
  const [responsables, setResponsables] = useState<Record<string, string>>({});
  const [motivoPorPedido, setMotivoPorPedido] = useState<Record<string, string>>({});
  const [observacionPorPedido, setObservacionPorPedido] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data, error: queryError } = await supabase.rpc("cuentas_activas_caja");

    if (queryError) {
      setMensaje(`No se pudieron cargar cuentas: ${queryError.message}`);
      setCuentas([]);
      return;
    }

    setCuentas(Array.isArray(data) ? data : []);
    setActualizadoAt(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }, []);

  useEffect(() => {
    if (!perfil) return;

    const supabase = supabaseBrowser();
    cargar();

    supabase
      .from("motivos")
      .select("id,texto")
      .eq("tipo", "anulacion")
      .eq("activo", true)
      .order("texto")
      .then(({ data, error: motivosError }) => {
        if (motivosError) setMensaje(motivosError.message);
        else setMotivos((data ?? []) as Motivo[]);
      });

    const canal = supabase
      .channel("caja-operativa")
      .on("postgres_changes", { event: "*", schema: "public", table: "cuentas" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_items" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, cargar)
      .subscribe();

    const timer = window.setInterval(cargar, 10000);

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(canal);
    };
  }, [perfil, cargar]);

  const resumen = useMemo(() => {
    const totalAbierto = cuentas.reduce((sum, cuenta) => sum + Number(cuenta.total_cuenta ?? 0), 0);
    const totalRecibido = cuentas.reduce((sum, cuenta) => sum + totalPagado(cuenta), 0);
    return { totalAbierto, totalRecibido };
  }, [cuentas]);

  function limpiarPago(cuentaId: string) {
    setMontosPago((actual) => ({ ...actual, [cuentaId]: "" }));
    setMediosSeleccionados((actual) => ({ ...actual, [cuentaId]: "efectivo" }));
    setPropinas((actual) => ({ ...actual, [cuentaId]: "" }));
    setPendiente((actual) => ({ ...actual, [cuentaId]: false }));
    setResponsables((actual) => ({ ...actual, [cuentaId]: "" }));
  }

  async function cambiarEstado(pedidoId: string, estado: string) {
    setMensaje(null);
    setProcesando(pedidoId);
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("cambiar_estado_pedido", { p_pedido_id: pedidoId, p_estado: estado });
    if (rpcError) setMensaje(rpcError.message);
    else setMensaje("Estado actualizado.");
    setProcesando(null);
    await cargar();
  }

  async function anularPedido(pedidoId: string) {
    const motivoId = motivoPorPedido[pedidoId];
    if (!motivoId) {
      setMensaje("Selecciona un motivo de anulacion.");
      return;
    }

    setMensaje(null);
    setProcesando(pedidoId);
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("anular_pedido", {
      p_pedido_id: pedidoId,
      p_motivo_id: motivoId,
      p_observacion: observacionPorPedido[pedidoId] || null,
    });

    if (rpcError) setMensaje(rpcError.message);
    else setMensaje("Pedido anulado con motivo.");
    setProcesando(null);
    await cargar();
  }

  async function registrarPago(cuenta: Cuenta) {
    const cuentaId = cuenta.id as string;
    const monto = Number(montosPago[cuentaId] ?? 0);
    const medio = mediosSeleccionados[cuentaId] ?? "efectivo";
    const dejaPendiente = Boolean(pendiente[cuentaId]);
    const responsable = responsables[cuentaId]?.trim() ?? "";
    const pagos = monto > 0 ? [{ medio, monto }] : [];

    if (pagos.length === 0 && !dejaPendiente) {
      setMensaje("Ingresa un valor de pago o marca la cuenta como pendiente.");
      return;
    }

    if (dejaPendiente && responsable.length === 0) {
      setMensaje("Escribe quien queda responsable del pendiente.");
      return;
    }

    setMensaje(null);
    setProcesando(cuentaId);
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("registrar_pagos_cuenta", {
      p_cuenta_id: cuentaId,
      p_pagos: pagos,
      p_propina: Number(propinas[cuentaId] ?? 0),
      p_dejar_pendiente: dejaPendiente,
      p_responsable_pendiente: responsable || null,
    });

    if (rpcError) setMensaje(rpcError.message);
    else {
      setMensaje("Pago registrado. Si cubrio el saldo, la cuenta sale de esta vista y queda en public.pagos.");
      limpiarPago(cuentaId);
    }
    setProcesando(null);
    await cargar();
  }

  if (cargando) return <main className="min-h-screen p-5 text-champana">Cargando...</main>;
  if (error) return <main className="min-h-screen p-5 text-champana">{error}</main>;

  return (
    <main className="min-h-screen px-4 py-5 text-champana sm:px-8">
      <section className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Centro de Mando</p>
            <h1 className="text-3xl font-black text-crema">Cuentas y cobros</h1>
            <p className="text-sm text-antiguo/70">{perfil?.nombre}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {perfil?.rol === "admin" ? <Link href="/admin" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Admin</Link> : null}
            <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Refrescar</button>
            <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold">Salir</button>
          </div>
        </header>

        <CierreCajaPanel perfil={perfil!} />

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-antiguo/15 bg-espresso p-4">
            <p className="text-sm text-antiguo/70">Cuentas activas</p>
            <p className="text-2xl font-black text-crema">{cuentas.length}</p>
          </div>
          <div className="rounded-lg border border-antiguo/15 bg-espresso p-4">
            <p className="text-sm text-antiguo/70">Total abierto</p>
            <p className="text-2xl font-black text-dorado">{formatoCOP(resumen.totalAbierto)}</p>
          </div>
          <div className="rounded-lg border border-antiguo/15 bg-espresso p-4">
            <p className="text-sm text-antiguo/70">Abonos visibles</p>
            <p className="text-2xl font-black text-dorado">{formatoCOP(resumen.totalRecibido)}</p>
          </div>
        </div>

        {actualizadoAt ? <p className="text-xs font-bold uppercase tracking-wide text-antiguo/55">Actualizado {actualizadoAt}</p> : null}
        {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm">{mensaje}</p> : null}

        <div className="grid gap-4 xl:grid-cols-2">
          {cuentas.map((cuenta) => {
            const total = Number(cuenta.total_cuenta ?? 0);
            const pagado = totalPagado(cuenta);
            const saldo = Math.max(total - pagado, 0);
            const pedidos = cuenta.pedidos ?? [];
            const pagosCuenta = cuenta.pagos ?? [];
            const bloqueada = procesando === cuenta.id;

            return (
              <article key={cuenta.id} className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
                <div className="flex flex-col gap-2 border-b border-antiguo/10 pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-oro">{nombreMesa(cuenta)}</p>
                    <h2 className="text-xl font-black text-crema">{cuenta.estado}</h2>
                    {cuenta.responsable_pendiente ? <p className="text-sm text-dorado">Pendiente: {cuenta.responsable_pendiente}</p> : null}
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm text-antiguo/70">Saldo</p>
                    <p className="text-2xl font-black text-dorado">{formatoCOP(saldo)}</p>
                    <p className="text-xs text-antiguo/60">Total {formatoCOP(total)} / pagado {formatoCOP(pagado)}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  {pedidos.map((pedido: any) => (
                    <section key={pedido.id} className="rounded-md border border-antiguo/10 bg-carbon p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-bold text-crema">{estadoPedidoTexto(pedido.estado)}</p>
                          <p className="text-xs text-antiguo/60">Mesero: {meseroPedido(pedido)}</p>
                          {pedido.notas ? <p className="mt-1 text-sm text-antiguo/80">{pedido.notas}</p> : null}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button disabled={procesando === pedido.id || pedido.estado === "anulado"} onClick={() => cambiarEstado(pedido.id, "en_preparacion")} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold disabled:opacity-50">Preparar</button>
                          <button disabled={procesando === pedido.id || pedido.estado === "anulado"} onClick={() => cambiarEstado(pedido.id, "entregado")} className="tap-target rounded-md bg-oro px-3 text-sm font-black text-carbon disabled:opacity-50">Entregar</button>
                        </div>
                      </div>

                      <ul className="mt-3 space-y-2 text-sm">
                        {(pedido.pedido_items ?? []).map((item: any) => (
                          <li key={item.id} className="flex justify-between gap-3 border-t border-antiguo/10 pt-2">
                            <span>{item.cantidad} x {item.productos?.nombre ?? item.combos?.nombre}</span>
                            <span>{formatoCOP(Number(item.cantidad) * Number(item.precio_unitario_capturado))}</span>
                          </li>
                        ))}
                      </ul>

                      {pedido.estado !== "anulado" ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                          <select value={motivoPorPedido[pedido.id] ?? ""} onChange={(event) => setMotivoPorPedido((actual) => ({ ...actual, [pedido.id]: event.target.value }))} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                            <option value="">Motivo anulacion</option>
                            {motivos.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.texto}</option>)}
                          </select>
                          <input value={observacionPorPedido[pedido.id] ?? ""} onChange={(event) => setObservacionPorPedido((actual) => ({ ...actual, [pedido.id]: event.target.value }))} placeholder="Observacion" className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50" />
                          <button disabled={procesando === pedido.id} onClick={() => anularPedido(pedido.id)} className="tap-target rounded-md border border-red-300/30 bg-red-950/30 px-3 text-sm font-bold text-red-100 disabled:opacity-50">Anular</button>
                        </div>
                      ) : null}
                    </section>
                  ))}
                </div>

                {pagosCuenta.length > 0 ? (
                  <section className="mt-4 rounded-md border border-antiguo/10 bg-carbon p-3">
                    <p className="text-sm font-bold text-dorado">Pagos registrados</p>
                    <ul className="mt-2 space-y-1 text-sm text-antiguo/80">
                      {pagosCuenta.map((pago: any) => (
                        <li key={pago.id} className="flex justify-between gap-3">
                          <span>{nombreMedio(pago.medio)}</span>
                          <span>{formatoCOP(pago.monto)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="mt-4 rounded-md border border-oro/20 bg-carbon p-3">
                  <p className="text-sm font-bold text-dorado">Cobro</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px]">
                    <label className="text-xs font-bold text-antiguo/80">
                      Valor
                      <input type="number" min="0" inputMode="numeric" value={montosPago[cuenta.id] ?? ""} onChange={(event) => setMontosPago((actual) => ({ ...actual, [cuenta.id]: event.target.value }))} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                    </label>
                    <label className="text-xs font-bold text-antiguo/80">
                      Medio
                      <select value={mediosSeleccionados[cuenta.id] ?? "efectivo"} onChange={(event) => setMediosSeleccionados((actual) => ({ ...actual, [cuenta.id]: event.target.value as MedioPago }))} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                        {mediosPago.map((medio) => <option key={medio.id} value={medio.id}>{medio.nombre}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs font-bold text-antiguo/80">
                      Propina opcional
                      <input type="number" min="0" inputMode="numeric" value={propinas[cuenta.id] ?? ""} onChange={(event) => setPropinas((actual) => ({ ...actual, [cuenta.id]: event.target.value }))} className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                    </label>
                    <label className="flex items-center gap-2 rounded-md border border-antiguo/15 bg-espresso px-3 text-sm font-bold">
                      <input type="checkbox" checked={Boolean(pendiente[cuenta.id])} onChange={(event) => setPendiente((actual) => ({ ...actual, [cuenta.id]: event.target.checked }))} />
                      Dejar pendiente
                    </label>
                    <input value={responsables[cuenta.id] ?? ""} onChange={(event) => setResponsables((actual) => ({ ...actual, [cuenta.id]: event.target.value }))} placeholder="Responsable" className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema placeholder:text-antiguo/50" />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setMontosPago((actual) => ({ ...actual, [cuenta.id]: String(saldo) }))} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">Valor exacto</button>
                    <button type="button" disabled={bloqueada} onClick={() => registrarPago(cuenta)} className="tap-target rounded-md bg-oro px-3 text-sm font-black text-carbon disabled:opacity-50">Registrar pago</button>
                  </div>
                </section>
              </article>
            );
          })}
        </div>

        {cuentas.length === 0 ? <p className="rounded-md border border-antiguo/15 bg-espresso p-6 text-center text-antiguo/70">No hay cuentas activas.</p> : null}
      </section>
    </main>
  );
}
