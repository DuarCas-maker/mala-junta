"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { estadoPedidoTexto, formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ModalMotivo, type MotivoAccion } from "@/components/pedidos/modal-motivo";

type PeriodoPagados = "dia" | "semana" | "mes";
type ModoPagados = "caja" | "admin";
type PedidoItemPagado = {
  id: string;
  cantidad: number;
  precio_unitario_capturado: number;
  estado: string;
  productos?: { nombre: string } | null;
  combos?: { nombre: string } | null;
};
type PedidoPagado = {
  id: string;
  estado: string;
  enviado_at: string;
  notas?: string | null;
  total: number;
  mesero?: { nombre: string } | null;
  pedido_items: PedidoItemPagado[];
};
type CuentaPagada = {
  id: string;
  estado: "pagada" | "pagada_parcial" | "cerrada";
  grupo_estado?: "pagada" | "pagada_parcial";
  dia_negocio: string;
  created_at: string;
  ultimo_pedido_at: string;
  total_cuenta: number;
  total_vendido: number;
  total_pagado: number;
  saldo_pendiente: number;
  responsable_pendiente?: string | null;
  nickname?: string | null;
  mesas?: { nombre: string; zona: string } | null;
  pedidos: PedidoPagado[];
};
type ResumenPagados = {
  total_vendido: number;
  total_pagado: number;
  saldo_pendiente: number;
  cuentas_pagadas: number;
  cuentas_parciales: number;
};
type DatosPagados = {
  fecha_base: string | null;
  desde: string | null;
  hasta: string | null;
  periodo: PeriodoPagados;
  resumen: ResumenPagados;
  pagadas: CuentaPagada[];
  parciales: CuentaPagada[];
};
type AccionAdmin = { tipo: "reversar" | "anular"; cuenta: CuentaPagada };

const datosVacios: DatosPagados = {
  fecha_base: null,
  desde: null,
  hasta: null,
  periodo: "dia",
  resumen: {
    total_vendido: 0,
    total_pagado: 0,
    saldo_pendiente: 0,
    cuentas_pagadas: 0,
    cuentas_parciales: 0,
  },
  pagadas: [],
  parciales: [],
};

function fechaLocalISO(fecha?: Date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha ?? new Date());
}

function fechaPedidoGrande(fecha?: string | null) {
  if (!fecha) return "Sin fecha";
  return new Date(fecha).toLocaleString("es-CO", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fechaRango(datos: DatosPagados) {
  if (!datos.desde || !datos.hasta) return "Sin ventas pagadas";
  if (datos.desde === datos.hasta) return datos.desde;
  return `${datos.desde} a ${datos.hasta}`;
}

function nombreCuenta(cuenta: CuentaPagada) {
  const base = cuenta.mesas ? `${cuenta.mesas.nombre} - ${cuenta.mesas.zona}` : "Pedido directo";
  const nickname = String(cuenta.nickname ?? "").trim();
  return nickname ? `${base} - ${nickname}` : base;
}

function estadoCuentaTexto(estado: string) {
  if (estado === "pagada") return "Pagada";
  if (estado === "cerrada") return "Pagada";
  if (estado === "pagada_parcial") return "Pago parcial";
  return estado;
}

function estadoVisualCuenta(cuenta: CuentaPagada) {
  return estadoCuentaTexto(cuenta.grupo_estado ?? cuenta.estado);
}

function nombreItem(item: PedidoItemPagado) {
  return item.productos?.nombre ?? item.combos?.nombre ?? "Item";
}

export function PedidosPagadosPanel({ modo }: { modo: ModoPagados }) {
  const [fechaSeleccionada, setFechaSeleccionada] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoPagados>("dia");
  const [datos, setDatos] = useState<DatosPagados>(datosVacios);
  const [motivos, setMotivos] = useState<MotivoAccion[]>([]);
  const [expandidas, setExpandidas] = useState<Record<string, boolean>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [accionAdmin, setAccionAdmin] = useState<AccionAdmin | null>(null);

  const cargarUltimoDia = useCallback(async () => {
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("ultimo_dia_pedidos_pagados");
    if (error) {
      setMensaje(error.message);
      setFechaSeleccionada(fechaLocalISO());
      return;
    }
    setFechaSeleccionada((data as string | null) ?? fechaLocalISO());
  }, []);

  const cargar = useCallback(async () => {
    if (!fechaSeleccionada) return;

    setCargando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("pedidos_pagados_caja", {
      p_fecha: fechaSeleccionada,
      p_periodo: periodo,
    });

    if (error) {
      setMensaje(error.message);
      setDatos(datosVacios);
    } else {
      setDatos((data as DatosPagados | null) ?? datosVacios);
    }
    setCargando(false);
  }, [fechaSeleccionada, periodo]);

  useEffect(() => {
    cargarUltimoDia();
  }, [cargarUltimoDia]);

  useEffect(() => {
    if (!fechaSeleccionada) return;
    cargar();
  }, [fechaSeleccionada, periodo, cargar]);

  useEffect(() => {
    if (modo !== "admin") return;
    const supabase = supabaseBrowser();
    supabase
      .from("motivos")
      .select("id,texto")
      .eq("tipo", "anulacion")
      .eq("activo", true)
      .order("texto")
      .then(({ data, error }) => {
        if (error) setMensaje(error.message);
        else setMotivos((data ?? []) as MotivoAccion[]);
      });
  }, [modo]);

  useEffect(() => {
    if (!fechaSeleccionada) return;
    const supabase = supabaseBrowser();
    const canal = supabase
      .channel(`pedidos-pagados-${modo}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cuentas" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_items" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, cargar)
      .subscribe();
    const timer = window.setInterval(cargar, 15000);

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(canal);
    };
  }, [fechaSeleccionada, modo, cargar]);

  const totalCuentas = useMemo(() => datos.pagadas.length + datos.parciales.length, [datos.pagadas.length, datos.parciales.length]);

  async function confirmarAccionAdmin(motivoId: string, observacion: string) {
    if (!accionAdmin) return;

    setProcesando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const rpc = accionAdmin.tipo === "reversar" ? "reversar_cuenta_pagada_admin" : "anular_cuenta_pagada_admin";
    const { error } = await supabase.rpc(rpc, {
      p_cuenta_id: accionAdmin.cuenta.id,
      p_motivo_id: motivoId,
      p_observacion: observacion || null,
    });

    if (error) {
      setMensaje(error.message);
    } else {
      setMensaje(accionAdmin.tipo === "reversar" ? "Cuenta reversada y enviada a cobro." : "Cuenta anulada con pagos e inventario reversados.");
      setAccionAdmin(null);
      await cargar();
    }
    setProcesando(false);
  }

  return (
    <section className="grid gap-5">
      <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Pedidos pagados</p>
            <h2 className="text-xl font-black text-crema">Resumen de ventas cobradas</h2>
            <p className="mt-1 text-sm text-antiguo/70">Rango: {fechaRango(datos)}</p>
          </div>
          <div className="grid gap-2 md:grid-cols-[auto_auto_auto_160px_auto_auto]">
            {(["dia", "semana", "mes"] as PeriodoPagados[]).map((opcion) => (
              <button key={opcion} type="button" onClick={() => setPeriodo(opcion)} className={periodo === opcion ? "tap-target rounded-md bg-oro px-3 text-sm font-black capitalize text-carbon" : "tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-sm font-bold capitalize text-crema"}>
                {opcion}
              </button>
            ))}
            <input type="date" value={fechaSeleccionada} onChange={(event) => setFechaSeleccionada(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <button type="button" onClick={cargarUltimoDia} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-sm font-bold">Ultimo dia</button>
            <button type="button" onClick={cargar} disabled={cargando} className="tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon disabled:opacity-50">{cargando ? "Cargando..." : "Actualizar"}</button>
          </div>
        </div>

        {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm font-bold">{mensaje}</p> : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi titulo="Total vendido" valor={formatoCOP(datos.resumen.total_vendido)} destacado />
          <Kpi titulo="Total pagado" valor={formatoCOP(datos.resumen.total_pagado)} />
          <Kpi titulo="Saldo pendiente" valor={formatoCOP(datos.resumen.saldo_pendiente)} />
          <Kpi titulo="Cuentas pagadas" valor={datos.resumen.cuentas_pagadas} />
          <Kpi titulo="Cuentas parciales" valor={datos.resumen.cuentas_parciales} />
        </div>
      </section>

      <GrupoCuentasPagadas
        titulo="Pagadas"
        cuentas={datos.pagadas}
        expandidas={expandidas}
        setExpandidas={setExpandidas}
        modo={modo}
        abrirAccion={setAccionAdmin}
      />
      <GrupoCuentasPagadas
        titulo="Pago parcial"
        cuentas={datos.parciales}
        expandidas={expandidas}
        setExpandidas={setExpandidas}
        modo={modo}
        abrirAccion={setAccionAdmin}
      />

      {totalCuentas === 0 ? <p className="rounded-lg border border-antiguo/15 bg-espresso p-6 text-center text-sm text-antiguo/70">No hay pedidos pagados en este rango.</p> : null}

      <ModalMotivo
        abierto={Boolean(accionAdmin)}
        titulo={accionAdmin?.tipo === "reversar" ? "Reversar cuenta pagada" : "Anular cuenta pagada"}
        descripcion={accionAdmin?.tipo === "reversar" ? "Se anularan los pagos activos y la cuenta volvera a Por cobrar." : "Se anularan pagos, pedidos e items; el inventario se devolvera y quedara auditoria."}
        textoConfirmar={accionAdmin?.tipo === "reversar" ? "Reversar" : "Anular"}
        motivos={motivos}
        procesando={procesando}
        onCerrar={() => setAccionAdmin(null)}
        onConfirmar={confirmarAccionAdmin}
      />
    </section>
  );
}

function Kpi({ titulo, valor, destacado = false }: { titulo: string; valor: string | number; destacado?: boolean }) {
  return (
    <div className={destacado ? "rounded-md border border-oro/25 bg-carbon p-3" : "rounded-md border border-antiguo/10 bg-carbon p-3"}>
      <p className="text-xs text-antiguo/60">{titulo}</p>
      <p className={destacado ? "text-xl font-black text-dorado" : "text-xl font-black text-crema"}>{valor}</p>
    </div>
  );
}

function GrupoCuentasPagadas({
  titulo,
  cuentas,
  expandidas,
  setExpandidas,
  modo,
  abrirAccion,
}: {
  titulo: string;
  cuentas: CuentaPagada[];
  expandidas: Record<string, boolean>;
  setExpandidas: (actualizar: (actual: Record<string, boolean>) => Record<string, boolean>) => void;
  modo: ModoPagados;
  abrirAccion: (accion: AccionAdmin) => void;
}) {
  return (
    <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
      <div className="flex flex-col gap-1 border-b border-antiguo/10 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xl font-black text-crema">{titulo}</h3>
        <p className="text-sm font-bold text-antiguo/60">{cuentas.length} cuenta(s)</p>
      </div>

      <div className="mt-3 grid gap-3">
        {cuentas.map((cuenta) => {
          const abierta = Boolean(expandidas[cuenta.id]);
          return (
            <article key={cuenta.id} className="rounded-md border border-antiguo/10 bg-carbon">
              <button type="button" onClick={() => setExpandidas((actual) => ({ ...actual, [cuenta.id]: !abierta }))} className="block w-full p-3 text-left">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,auto)] lg:items-start">
                  <div className="min-w-0">
                    <p className="text-lg font-black text-dorado">{fechaPedidoGrande(cuenta.ultimo_pedido_at)}</p>
                    <p className="text-sm font-bold text-oro">{nombreCuenta(cuenta)}</p>
                    <h4 className="text-lg font-black text-crema">{estadoVisualCuenta(cuenta)}</h4>
                    {cuenta.responsable_pendiente ? <p className="text-xs font-bold text-dorado">Pendiente: {cuenta.responsable_pendiente}</p> : null}
                  </div>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-3">
                    <ValorCuenta titulo="Total cuenta" valor={formatoCOP(cuenta.total_vendido)} destacado />
                    <ValorCuenta titulo="Pagado" valor={formatoCOP(cuenta.total_pagado)} />
                    <ValorCuenta titulo="Saldo" valor={formatoCOP(cuenta.saldo_pendiente)} alerta={cuenta.saldo_pendiente > 0} />
                  </div>
                </div>
              </button>

              {abierta ? (
                <div className="border-t border-antiguo/10 p-3">
                  {modo === "admin" ? (
                    <div className="mb-3 grid gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => abrirAccion({ tipo: "reversar", cuenta })} className="tap-target rounded-md border border-oro/30 px-3 text-sm font-bold text-dorado">Reversar a cobro</button>
                      <button type="button" onClick={() => abrirAccion({ tipo: "anular", cuenta })} className="tap-target rounded-md border border-red-300/30 bg-red-950/30 px-3 text-sm font-bold text-red-100">Anular cuenta</button>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {cuenta.pedidos.map((pedido) => (
                      <section key={pedido.id} className="rounded-md border border-antiguo/10 bg-espresso p-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-black text-crema">{fechaPedidoGrande(pedido.enviado_at)}</p>
                            <p className="text-xs font-bold uppercase tracking-wide text-oro">{estadoPedidoTexto(pedido.estado)} - Mesero: {pedido.mesero?.nombre ?? "-"}</p>
                          </div>
                          <p className="font-black text-dorado">{formatoCOP(pedido.total)}</p>
                        </div>
                        {pedido.notas ? <p className="mt-2 text-sm text-antiguo/75">{pedido.notas}</p> : null}
                        <ul className="mt-2 space-y-1 text-sm">
                          {pedido.pedido_items.map((item) => (
                            <li key={item.id} className="flex justify-between gap-3 border-t border-antiguo/10 pt-2">
                              <span>{item.cantidad} x {nombreItem(item)}</span>
                              <span className="font-bold text-dorado">{formatoCOP(Number(item.cantidad) * Number(item.precio_unitario_capturado))}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {cuentas.length === 0 ? <p className="mt-3 rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">Sin cuentas en este grupo.</p> : null}
    </section>
  );
}

function ValorCuenta({ titulo, valor, destacado = false, alerta = false }: { titulo: string; valor: string; destacado?: boolean; alerta?: boolean }) {
  return (
    <div className={destacado ? "rounded-md border border-oro/25 bg-espresso px-3 py-2" : "rounded-md border border-antiguo/10 bg-espresso px-3 py-2"}>
      <p className="text-xs font-bold uppercase text-antiguo/60">{titulo}</p>
      <p className={alerta ? "text-lg font-black text-red-100" : destacado ? "text-lg font-black text-dorado" : "text-lg font-black text-crema"}>{valor}</p>
    </div>
  );
}
