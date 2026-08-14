"use client";

import Link from "next/link";
import { InventarioConsultaPanel } from "@/components/caja/inventario-consulta-panel";
import { CapturasVentaPanel } from "@/components/caja/capturas-venta-panel";
import { CierreCajaPanel } from "@/components/caja/cierre-caja-panel";
import { PedidoRapidoPanel } from "@/components/pedidos/pedido-rapido-panel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { estadoPedidoTexto, formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePerfilProtegido } from "@/lib/use-perfil-protegido";

type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";
type Motivo = { id: string; texto: string };
type Cuenta = any;
type PedidoHistorial = any;
type ModuloCaja = "cobros" | "pedidos" | "inventario";

const mediosPago: { id: MedioPago; nombre: string }[] = [
  { id: "efectivo", nombre: "Efectivo" },
  { id: "datafono", nombre: "Datafono" },
  { id: "nequi_daviplata", nombre: "Nequi/Daviplata" },
  { id: "transferencia", nombre: "Transferencia" },
];

function normalizarCuentasCaja(data: unknown): Cuenta[] {
  let cuentas: Cuenta[] = [];

  if (Array.isArray(data)) cuentas = data;
  else if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      cuentas = Array.isArray(parsed) ? parsed : [];
    } catch {
      cuentas = [];
    }
  }

  return [...cuentas].sort((a, b) => {
    const prioridadA = Number(a.prioridad_cobro ?? 99);
    const prioridadB = Number(b.prioridad_cobro ?? 99);
    if (prioridadA !== prioridadB) return prioridadA - prioridadB;

    const pedidoA = Number(a.pedido_estado_prioridad ?? 99);
    const pedidoB = Number(b.pedido_estado_prioridad ?? 99);
    if (pedidoA !== pedidoB) return pedidoA - pedidoB;

    const fechaA = new Date(a.ultimo_pedido_at ?? a.created_at ?? 0).getTime();
    const fechaB = new Date(b.ultimo_pedido_at ?? b.created_at ?? 0).getTime();
    return fechaB - fechaA;
  });
}

function relacionUno<T = any>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

function estadoCobroDesdePedido(cuenta: Cuenta, pedidos: PedidoHistorial[]) {
  if (cuenta.estado === "pendiente") return "Pendiente";
  if (cuenta.estado === "pagada_parcial") return "Pago parcial";
  if (cuenta.estado === "por_cobrar") return "Por cobrar";
  if (pedidos.some((pedido) => pedido.estado === "en_preparacion")) return "En preparacion";
  if (pedidos.some((pedido) => pedido.estado === "enviado")) return "Enviado";
  if (pedidos.length > 0) return "Por cobrar";
  return "Abierta";
}

function completarCuentasConHistorial(cuentasRpc: Cuenta[], pedidos: PedidoHistorial[]) {
  const cuentasPorId = new Map<string, Cuenta>();

  cuentasRpc.forEach((cuenta) => {
    if (cuenta?.id) cuentasPorId.set(cuenta.id, cuenta);
  });

  pedidos.forEach((pedido) => {
    if (pedido.estado === "anulado") return;

    const cuentaPedido = relacionUno<Cuenta>(pedido.cuentas);
    if (!cuentaPedido?.id || ["pagada", "cerrada", "anulada"].includes(cuentaPedido.estado)) return;

    const cuentaActual = cuentasPorId.get(cuentaPedido.id);
    const pedidosActuales = Array.isArray(cuentaActual?.pedidos) ? cuentaActual.pedidos : [];

    if (cuentaActual) {
      if (!pedidosActuales.some((actual: PedidoHistorial) => actual.id === pedido.id)) {
        cuentaActual.pedidos = [...pedidosActuales, pedido].sort((a: PedidoHistorial, b: PedidoHistorial) => new Date(b.enviado_at ?? 0).getTime() - new Date(a.enviado_at ?? 0).getTime());
      }
      return;
    }

    cuentasPorId.set(cuentaPedido.id, {
      ...cuentaPedido,
      estado_cobro: estadoCobroDesdePedido(cuentaPedido, [pedido]),
      prioridad_cobro: pedido.estado === "en_preparacion" ? 2 : pedido.estado === "enviado" ? 3 : 1,
      pedido_estado_prioridad: pedido.estado === "entregado" ? 1 : pedido.estado === "en_preparacion" ? 2 : pedido.estado === "enviado" ? 3 : 9,
      ultimo_pedido_at: pedido.enviado_at,
      total_pagado: 0,
      saldo: Number(cuentaPedido.total_cuenta ?? 0),
      perfiles: { nombre: "-" },
      documentos: [],
      pagos: [],
      pedidos: [pedido],
    });
  });

  return normalizarCuentasCaja([...cuentasPorId.values()]);
}

function estadoCobroCuenta(cuenta: Cuenta) {
  return cuenta.estado_cobro ?? cuenta.estado ?? "Abierta";
}
function totalPagado(cuenta: Cuenta) {
  return (cuenta.pagos ?? []).reduce((sum: number, pago: any) => sum + Number(pago.monto ?? 0), 0);
}

function nombreMesa(cuenta: Cuenta) {
  const mesa = Array.isArray(cuenta.mesas) ? cuenta.mesas[0] : cuenta.mesas;
  return mesa ? `${mesa.nombre} - ${mesa.zona}` : "Pedido directo";
}

function meseroPedido(pedido: any) {
  const perfil = Array.isArray(pedido.perfiles) ? pedido.perfiles[0] : pedido.perfiles;
  return perfil?.nombre ?? "-";
}

function nombreMedio(medio: string) {
  return mediosPago.find((item) => item.id === medio)?.nombre ?? medio;
}

function totalPedido(pedido: PedidoHistorial) {
  return (pedido.pedido_items ?? []).reduce((sum: number, item: any) => sum + Number(item.cantidad ?? 0) * Number(item.precio_unitario_capturado ?? 0), 0);
}

function cuentaPedido(pedido: PedidoHistorial) {
  const cuenta = Array.isArray(pedido.cuentas) ? pedido.cuentas[0] : pedido.cuentas;
  const mesa = Array.isArray(cuenta?.mesas) ? cuenta.mesas[0] : cuenta?.mesas;
  return mesa ? `${mesa.nombre} - ${mesa.zona}` : "Pedido directo";
}

function fechaPedido(fecha?: string) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function CajaOperativa() {
  const { perfil, cargando, error, salir } = usePerfilProtegido(["caja", "admin"]);
  const [moduloActivo, setModuloActivo] = useState<ModuloCaja>("cobros");
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [historial, setHistorial] = useState<PedidoHistorial[]>([]);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [actualizadoAt, setActualizadoAt] = useState<string | null>(null);
  const [montosPago, setMontosPago] = useState<Record<string, string>>({});
  const [mediosSeleccionados, setMediosSeleccionados] = useState<Record<string, MedioPago>>({});
  const [propinas, setPropinas] = useState<Record<string, string>>({});
  const [pendiente, setPendiente] = useState<Record<string, boolean>>({});
  const [responsables, setResponsables] = useState<Record<string, string>>({});
  const [adquirientes, setAdquirientes] = useState<Record<string, { razon_social: string; tipo_id: string; numero_id: string; correo: string; telefono: string }>>({});
  const [envioCanales, setEnvioCanales] = useState<Record<string, "correo" | "whatsapp">>({});
  const [envioDestinos, setEnvioDestinos] = useState<Record<string, string>>({});
  const [motivoPorPedido, setMotivoPorPedido] = useState<Record<string, string>>({});
  const [observacionPorPedido, setObservacionPorPedido] = useState<Record<string, string>>({});
  const [requiereAperturaCaja, setRequiereAperturaCaja] = useState(false);

  const manejarResumenCaja = useCallback((resumenCaja: { requiere_apertura?: boolean }) => {
    setRequiereAperturaCaja(Boolean(resumenCaja.requiere_apertura));
  }, []);

  const cargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [cuentasRes, historialRes] = await Promise.all([
      supabase.rpc("cuentas_activas_caja"),
      supabase
        .from("pedidos")
        .select("id,estado,enviado_at,notas,perfiles(nombre),cuentas(id,estado,total_cuenta,responsable_pendiente,mesas(nombre,zona)),pedido_items(id,cantidad,precio_unitario_capturado,productos(nombre),combos(nombre))")
        .neq("estado", "anulado")
        .order("enviado_at", { ascending: false })
        .limit(80),
    ]);

    if (cuentasRes.error) {
      setMensaje(`No se pudieron cargar cuentas: ${cuentasRes.error.message}`);
      setCuentas([]);
      return;
    }

    if (historialRes.error) {
      setMensaje(`No se pudo cargar historial: ${historialRes.error.message}`);
      setHistorial([]);
      return;
    }

    const pedidosHistorial = (historialRes.data ?? []) as PedidoHistorial[];
    setCuentas(completarCuentasConHistorial(normalizarCuentasCaja(cuentasRes.data), pedidosHistorial));
    setHistorial(pedidosHistorial.slice(0, 16));
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
    setAdquirientes((actual) => ({ ...actual, [cuentaId]: { razon_social: "", tipo_id: "CC", numero_id: "", correo: "", telefono: "" } }));
    setEnvioCanales((actual) => ({ ...actual, [cuentaId]: "correo" }));
    setEnvioDestinos((actual) => ({ ...actual, [cuentaId]: "" }));
  }

  async function cambiarEstado(pedidoId: string, estado: string) {
    setMensaje(null);
    setProcesando(pedidoId);
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("cambiar_estado_pedido", { p_pedido_id: pedidoId, p_estado: estado });
    if (rpcError) setMensaje(rpcError.message === "caja_no_abierta" ? "Debes abrir caja antes de registrar pagos." : rpcError.message);
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

    if (rpcError) setMensaje(rpcError.message === "caja_no_abierta" ? "Debes abrir caja antes de registrar pagos." : rpcError.message);
    else setMensaje("Pedido anulado con motivo.");
    setProcesando(null);
    await cargar();
  }

  async function registrarPago(cuenta: Cuenta) {
    if (requiereAperturaCaja) {
      setMensaje("Debes abrir caja antes de registrar pagos.");
      return;
    }

    const cuentaId = cuenta.id as string;
    const monto = Number(montosPago[cuentaId] ?? 0);
    const medio = mediosSeleccionados[cuentaId] ?? "efectivo";
    const dejaPendiente = Boolean(pendiente[cuentaId]);
    const responsable = responsables[cuentaId]?.trim() ?? "";
    const pagos = monto > 0 ? [{ medio, monto }] : [];
    const adquiriente = adquirientes[cuentaId];
    const adquirientePayload = adquiriente && (adquiriente.razon_social || adquiriente.numero_id || adquiriente.correo || adquiriente.telefono)
      ? {
          razon_social: adquiriente.razon_social,
          tipo_id: adquiriente.tipo_id || "CC",
          numero_id: adquiriente.numero_id,
          correo: adquiriente.correo || null,
          telefono: adquiriente.telefono || null,
        }
      : null;
    const envioPayload = envioDestinos[cuentaId]
      ? { canal: envioCanales[cuentaId] ?? "correo", destino: envioDestinos[cuentaId] }
      : null;

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
    const { data: pagoData, error: rpcError } = await supabase.rpc("registrar_pagos_cuenta_dian", {
      p_cuenta_id: cuentaId,
      p_pagos: pagos,
      p_propina: Number(propinas[cuentaId] ?? 0),
      p_dejar_pendiente: dejaPendiente,
      p_responsable_pendiente: responsable || null,
      p_adquiriente: adquirientePayload,
      p_envio: envioPayload,
    });

    if (rpcError) setMensaje(rpcError.message === "caja_no_abierta" ? "Debes abrir caja antes de registrar pagos." : rpcError.message);
    else {
      setMensaje(pagoData?.documento ? `Pago registrado. Documento ${pagoData.documento.numero} generado como comprobante interno no fiscal.` : "Pago registrado. Si cubrio el saldo, la cuenta sale de esta vista y queda en public.pagos.");
      limpiarPago(cuentaId);
    }
    setProcesando(null);
    await cargar();
  }

  if (cargando) return <main className="min-h-screen p-5 text-champana">Cargando...</main>;
  if (error) return <main className="min-h-screen p-5 text-champana">{error}</main>;

  return (
    <main className="min-h-screen px-3 py-4 text-champana sm:px-6 sm:py-5 lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-antiguo/15 bg-cafe/95 p-3 shadow-suave lg:sticky lg:top-5 lg:h-[calc(100vh-2.5rem)]">
          <p className="text-xs font-black uppercase tracking-wide text-oro">Caja</p>
          <nav className="mt-3 grid gap-2" aria-label="Modulos de caja">
            <button type="button" onClick={() => setModuloActivo("cobros")} className={moduloActivo === "cobros" ? "tap-target rounded-md bg-oro px-3 py-2 text-left font-black text-carbon" : "tap-target rounded-md border border-antiguo/20 bg-carbon px-3 py-2 text-left font-bold text-crema"}>Cobros</button>
            <button type="button" onClick={() => setModuloActivo("pedidos")} className={moduloActivo === "pedidos" ? "tap-target rounded-md bg-oro px-3 py-2 text-left font-black text-carbon" : "tap-target rounded-md border border-antiguo/20 bg-carbon px-3 py-2 text-left font-bold text-crema"}>Pedidos</button>
            <button type="button" onClick={() => setModuloActivo("inventario")} className={moduloActivo === "inventario" ? "tap-target rounded-md bg-oro px-3 py-2 text-left font-black text-carbon" : "tap-target rounded-md border border-antiguo/20 bg-carbon px-3 py-2 text-left font-bold text-crema"}>Inventario</button>
          </nav>
        </aside>
        <section className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Centro de Mando</p>
            <h1 className="text-2xl font-black text-crema sm:text-3xl">{moduloActivo === "inventario" ? "Inventario" : moduloActivo === "pedidos" ? "Pedidos" : "Cuentas y cobros"}</h1>
            <p className="text-sm text-antiguo/70">{perfil?.nombre}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {perfil?.rol === "admin" ? <Link href="/admin" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Admin</Link> : null}
            <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Refrescar</button>
            <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold">Salir</button>
          </div>
        </header>

        {moduloActivo === "inventario" ? (
          <InventarioConsultaPanel />
        ) : moduloActivo === "pedidos" ? (
          <PedidoRapidoPanel
            perfil={perfil!}
            etiqueta="Caja"
            titulo="Nuevo pedido"
            className="flex flex-col gap-5"
            onPedidoEnviado={cargar}
          />
        ) : (
          <>
            <CierreCajaPanel perfil={perfil!} onResumenChange={manejarResumenCaja} />

        {actualizadoAt ? <p className="text-xs font-bold uppercase tracking-wide text-antiguo/55">Actualizado {actualizadoAt}</p> : null}
        {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm">{mensaje}</p> : null}

        <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-oro">Cobros</p>
              <h2 className="text-xl font-black text-crema">Pedidos por cobrar</h2>
            </div>
            <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 text-sm font-bold">Actualizar</button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-md border border-antiguo/15 bg-carbon p-4">
              <p className="text-sm text-antiguo/70">Cuentas activas</p>
              <p className="text-2xl font-black text-crema">{cuentas.length}</p>
            </div>
            <div className="rounded-md border border-antiguo/15 bg-carbon p-4">
              <p className="text-sm text-antiguo/70">Total abierto</p>
              <p className="text-2xl font-black text-dorado">{formatoCOP(resumen.totalAbierto)}</p>
            </div>
            <div className="rounded-md border border-antiguo/15 bg-carbon p-4">
              <p className="text-sm text-antiguo/70">Abonos visibles</p>
              <p className="text-2xl font-black text-dorado">{formatoCOP(resumen.totalRecibido)}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {cuentas.map((cuenta) => {
            const total = Number(cuenta.total_cuenta ?? 0);
            const pagado = totalPagado(cuenta);
            const saldo = Math.max(total - pagado, 0);
            const pedidos = cuenta.pedidos ?? [];
            const pagosCuenta = cuenta.pagos ?? [];
            const bloqueada = procesando === cuenta.id;

            return (
              <article key={cuenta.id} className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
                <div className="flex flex-col gap-2 border-b border-antiguo/10 pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-oro">{nombreMesa(cuenta)}</p>
                    <h2 className="text-xl font-black text-crema">{estadoCobroCuenta(cuenta)}</h2>
                    <p className="text-xs text-antiguo/60">Estado cuenta: {cuenta.estado}</p>
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
                          <li key={item.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-antiguo/10 pt-2">
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

                {(cuenta.documentos ?? []).length > 0 ? (
                  <section className="mt-4 rounded-md border border-oro/20 bg-carbon p-3">
                    <p className="text-sm font-bold text-dorado">Comprobantes internos</p>
                    <ul className="mt-2 space-y-1 text-sm text-antiguo/80">
                      {(cuenta.documentos ?? []).map((documento: any) => (
                        <li key={documento.id} className="rounded-md border border-antiguo/10 bg-espresso p-2">
                          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span>{documento.numero} - {documento.tipo}</span><span>{formatoCOP(documento.total)}</span></div>
                          <p className="text-xs text-antiguo/55">{documento.etiqueta_no_fiscal}</p>
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

                  <div className="mt-3 rounded-md border border-antiguo/10 bg-espresso p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-oro">Datos DIAN-ready</p>
                    <p className="mt-1 text-xs text-antiguo/60">Si la venta supera 5 UVT, la base exige nombre/razon social y documento. El comprobante es interno, no fiscal.</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_110px_150px]">
                      <input value={adquirientes[cuenta.id]?.razon_social ?? ""} onChange={(event) => setAdquirientes((actual) => ({ ...actual, [cuenta.id]: { ...(actual[cuenta.id] ?? { tipo_id: "CC", numero_id: "", correo: "", telefono: "" }), razon_social: event.target.value } }))} placeholder="Nombre o razon social" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                      <select value={adquirientes[cuenta.id]?.tipo_id ?? "CC"} onChange={(event) => setAdquirientes((actual) => ({ ...actual, [cuenta.id]: { ...(actual[cuenta.id] ?? { razon_social: "", numero_id: "", correo: "", telefono: "" }), tipo_id: event.target.value } }))} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                        <option value="CC">CC</option>
                        <option value="NIT">NIT</option>
                        <option value="CE">CE</option>
                        <option value="PAS">PAS</option>
                      </select>
                      <input value={adquirientes[cuenta.id]?.numero_id ?? ""} onChange={(event) => setAdquirientes((actual) => ({ ...actual, [cuenta.id]: { ...(actual[cuenta.id] ?? { razon_social: "", tipo_id: "CC", correo: "", telefono: "" }), numero_id: event.target.value } }))} placeholder="Cedula/NIT" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_130px_1fr]">
                      <input value={adquirientes[cuenta.id]?.correo ?? ""} onChange={(event) => setAdquirientes((actual) => ({ ...actual, [cuenta.id]: { ...(actual[cuenta.id] ?? { razon_social: "", tipo_id: "CC", numero_id: "", telefono: "" }), correo: event.target.value } }))} placeholder="Correo opcional" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                      <select value={envioCanales[cuenta.id] ?? "correo"} onChange={(event) => setEnvioCanales((actual) => ({ ...actual, [cuenta.id]: event.target.value as "correo" | "whatsapp" }))} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                        <option value="correo">Correo</option>
                        <option value="whatsapp">WhatsApp</option>
                      </select>
                      <input value={envioDestinos[cuenta.id] ?? ""} onChange={(event) => setEnvioDestinos((actual) => ({ ...actual, [cuenta.id]: event.target.value }))} placeholder="Destino comprobante opcional" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setMontosPago((actual) => ({ ...actual, [cuenta.id]: String(saldo) }))} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold">Valor exacto</button>
                    <button type="button" disabled={bloqueada || requiereAperturaCaja} onClick={() => registrarPago(cuenta)} className="tap-target rounded-md bg-oro px-3 text-sm font-black text-carbon disabled:opacity-50">{requiereAperturaCaja ? "Abre caja primero" : "Registrar pago"}</button>
                  </div>
                </section>
              </article>
            );
          })}
        </div>

          {cuentas.length === 0 ? <p className="mt-4 rounded-md border border-antiguo/15 bg-carbon p-6 text-center text-antiguo/70">No hay cuentas activas.</p> : null}
        </section>

        <CapturasVentaPanel colapsable defaultExpandido={false} />

        <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-oro">Historial</p>
              <h2 className="text-xl font-black text-crema">Pedidos recientes</h2>
            </div>
            <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 text-sm font-bold">Actualizar</button>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {historial.map((pedido) => (
              <article key={pedido.id} className="rounded-md border border-antiguo/10 bg-carbon p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-crema">{cuentaPedido(pedido)}</p>
                    <p className="text-xs text-antiguo/60">{fechaPedido(pedido.enviado_at)} - Mesero: {meseroPedido(pedido)}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs font-bold uppercase tracking-wide text-oro">{estadoPedidoTexto(pedido.estado)}</p>
                    <p className="text-sm font-black text-dorado">{formatoCOP(totalPedido(pedido))}</p>
                  </div>
                </div>
                {pedido.notas ? <p className="mt-2 text-sm text-antiguo/75">{pedido.notas}</p> : null}
                <ul className="mt-3 space-y-2 text-sm">
                  {(pedido.pedido_items ?? []).map((item: any) => (
                    <li key={item.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-antiguo/10 pt-2">
                      <span>{item.cantidad} x {item.productos?.nombre ?? item.combos?.nombre}</span>
                      <span className="font-bold text-dorado">{formatoCOP(Number(item.cantidad) * Number(item.precio_unitario_capturado))}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {historial.length === 0 ? <p className="mt-3 rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">Todavia no hay pedidos registrados.</p> : null}
        </section>
          </>
        )}
      </section>
      </div>
    </main>
  );
}
