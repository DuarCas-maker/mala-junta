"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { estadoPedidoTexto, formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePerfilProtegido } from "@/lib/use-perfil-protegido";

type Mesa = { id: string; nombre: string; zona: string; es_vip: boolean };
type ItemVenta = {
  clave: string;
  id: string;
  tipo: "producto" | "combo";
  nombre: string;
  precio_venta: number;
  stock_actual?: number;
  categorias?: { nombre: string } | { nombre: string }[] | null;
};
type Cantidades = Record<string, number>;
type PedidoItemPayload = { producto_id?: string; combo_id?: string; cantidad: number };
type PedidoPendiente = { id: string; mesaId: string; items: PedidoItemPayload[]; notas: string; creado: string };
type PedidoHistorial = any;

const STORAGE_KEY = "mala-junta-pedidos-pendientes";

function nombreCategoria(item: ItemVenta) {
  if (item.tipo === "combo") return "Combo";
  const categoria = Array.isArray(item.categorias) ? item.categorias[0] : item.categorias;
  return categoria?.nombre ?? "Producto";
}

function leerPendientes(): PedidoPendiente[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as PedidoPendiente[];
  } catch {
    return [];
  }
}

function guardarPendientes(pedidos: PedidoPendiente[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pedidos));
}

function totalPedido(pedido: PedidoHistorial) {
  return (pedido.pedido_items ?? []).reduce((sum: number, item: any) => sum + Number(item.cantidad ?? 0) * Number(item.precio_unitario_capturado ?? 0), 0);
}

function nombreCuentaPedido(pedido: PedidoHistorial) {
  const cuenta = Array.isArray(pedido.cuentas) ? pedido.cuentas[0] : pedido.cuentas;
  const mesa = Array.isArray(cuenta?.mesas) ? cuenta.mesas[0] : cuenta?.mesas;
  return mesa ? `${mesa.nombre} - ${mesa.zona}` : "Barra";
}

function fechaPedido(fecha?: string) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function MeseroOperativo() {
  const { perfil, cargando, error, salir } = usePerfilProtegido(["mesero", "admin"]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [itemsVenta, setItemsVenta] = useState<ItemVenta[]>([]);
  const [mesaId, setMesaId] = useState<string>("");
  const [cantidades, setCantidades] = useState<Cantidades>({});
  const [notas, setNotas] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pendientes, setPendientes] = useState<PedidoPendiente[]>([]);
  const [historial, setHistorial] = useState<PedidoHistorial[]>([]);

  useEffect(() => {
    setPendientes(leerPendientes());
  }, []);

  useEffect(() => {
    let activo = true;

    async function cargarDatos() {
      setMensaje("Cargando mesas, productos y combos...");
      const supabase = supabaseBrowser();
      const [{ data: mesasData, error: mesasError }, { data: productosData, error: productosError }, { data: combosData, error: combosError }, { data: historialData, error: historialError }] = await Promise.all([
        supabase.from("mesas").select("id,nombre,zona,es_vip").eq("activa", true).order("nombre"),
        supabase.from("productos").select("id,nombre,precio_venta,stock_actual,categorias(nombre)").eq("activo", true).order("nombre"),
        supabase.from("combos").select("id,nombre,precio_venta").eq("activo", true).order("nombre"),
        supabase
          .from("pedidos")
          .select("id,estado,enviado_at,notas,cuentas(estado,total_cuenta,mesas(nombre,zona)),pedido_items(id,cantidad,precio_unitario_capturado,productos(nombre),combos(nombre))")
          .order("enviado_at", { ascending: false })
          .limit(12),
      ]);

      if (mesasError) throw mesasError;
      if (productosError) throw productosError;
      if (combosError) throw combosError;
      if (historialError) throw historialError;

      const productos = ((productosData ?? []) as any[]).map((producto) => ({
        clave: `producto:${producto.id}`,
        id: producto.id,
        tipo: "producto" as const,
        nombre: producto.nombre,
        precio_venta: Number(producto.precio_venta),
        stock_actual: Number(producto.stock_actual ?? 0),
        categorias: producto.categorias,
      }));
      const combos = ((combosData ?? []) as any[]).map((combo) => ({
        clave: `combo:${combo.id}`,
        id: combo.id,
        tipo: "combo" as const,
        nombre: combo.nombre,
        precio_venta: Number(combo.precio_venta),
      }));

      if (activo) {
        setMesas((mesasData ?? []) as Mesa[]);
        setItemsVenta([...productos, ...combos]);
        setHistorial((historialData ?? []) as PedidoHistorial[]);
        setMensaje(null);
      }
    }

    if (perfil) {
      cargarDatos().catch((err) => {
        if (activo) setMensaje(err instanceof Error ? err.message : "No se pudieron cargar mesas, productos y combos.");
      });
    }

    return () => {
      activo = false;
    };
  }, [perfil]);

  const total = useMemo(() => {
    return itemsVenta.reduce((sum, item) => sum + (cantidades[item.clave] ?? 0) * Number(item.precio_venta), 0);
  }, [cantidades, itemsVenta]);

  function cambiarCantidad(clave: string, delta: number) {
    setCantidades((actual) => {
      const siguiente = Math.max(0, (actual[clave] ?? 0) + delta);
      return { ...actual, [clave]: siguiente };
    });
  }

  async function cargarHistorial() {
    const supabase = supabaseBrowser();
    const { data, error: historialError } = await supabase
      .from("pedidos")
      .select("id,estado,enviado_at,notas,cuentas(estado,total_cuenta,mesas(nombre,zona)),pedido_items(id,cantidad,precio_unitario_capturado,productos(nombre),combos(nombre))")
      .order("enviado_at", { ascending: false })
      .limit(12);

    if (historialError) {
      setMensaje(historialError.message);
      return;
    }

    setHistorial((data ?? []) as PedidoHistorial[]);
  }

  async function enviarPayload(payload: { mesaId: string; items: PedidoItemPayload[]; notas: string }) {
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("crear_pedido_rapido", {
      p_mesa_id: payload.mesaId || null,
      p_items: payload.items,
      p_notas: payload.notas || null,
    });
    if (rpcError) throw new Error(rpcError.message);
  }

  function guardarComoPendiente(payload: { mesaId: string; items: PedidoItemPayload[]; notas: string }) {
    const nuevo: PedidoPendiente = { id: crypto.randomUUID(), ...payload, creado: new Date().toISOString() };
    const siguientes = [nuevo, ...leerPendientes()];
    guardarPendientes(siguientes);
    setPendientes(siguientes);
  }

  async function enviarPedido(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensaje(null);
    setEnviando(true);

    const items = Object.entries(cantidades)
      .filter(([, cantidad]) => cantidad > 0)
      .map(([clave, cantidad]) => {
        const item = itemsVenta.find((actual) => actual.clave === clave);
        if (!item) return null;
        return item.tipo === "combo" ? { combo_id: item.id, cantidad } : { producto_id: item.id, cantidad };
      })
      .filter(Boolean) as PedidoItemPayload[];

    try {
      if (items.length === 0) throw new Error("Agrega al menos un producto o combo.");
      const payload = { mesaId, items, notas };
      await enviarPayload(payload);
      setMensaje("Pedido enviado a caja y barra.");
      setCantidades({});
      setNotas("");
      await cargarHistorial();
    } catch (err) {
      if (items.length > 0) {
        guardarComoPendiente({ mesaId, items, notas });
        setMensaje("No se pudo sincronizar. Guarde el pedido para reintentar.");
        setCantidades({});
        setNotas("");
      } else {
        setMensaje(err instanceof Error ? err.message : "No se pudo enviar el pedido.");
      }
    } finally {
      setEnviando(false);
    }
  }

  async function reintentarPendiente(pendiente: PedidoPendiente) {
    setEnviando(true);
    setMensaje("Reintentando pedido pendiente...");
    try {
      await enviarPayload(pendiente);
      const restantes = leerPendientes().filter((item) => item.id !== pendiente.id);
      guardarPendientes(restantes);
      setPendientes(restantes);
      setMensaje("Pedido pendiente sincronizado.");
      await cargarHistorial();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo sincronizar el pendiente.");
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) return <main className="min-h-screen p-5 text-champana">Cargando...</main>;
  if (error) return <main className="min-h-screen p-5 text-champana">{error}</main>;

  return (
    <main className="min-h-screen px-3 py-4 text-champana sm:px-4 sm:py-5">
      <section className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Mesero</p>
            <h1 className="text-2xl font-black text-crema sm:text-3xl">Nuevo pedido</h1>
            <p className="text-sm text-antiguo/70">{perfil?.nombre}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {perfil?.rol === "admin" ? <Link href="/admin" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Admin</Link> : null}
            <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold">Salir</button>
          </div>
        </header>

        {pendientes.length > 0 ? (
          <section className="rounded-lg border border-dorado/30 bg-carbon p-3">
            <p className="text-sm font-bold text-dorado">Pedidos pendientes por sincronizar: {pendientes.length}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {pendientes.map((pendiente) => (
                <button key={pendiente.id} onClick={() => reintentarPendiente(pendiente)} className="tap-target rounded-md border border-antiguo/20 px-3 text-sm font-bold" disabled={enviando}>
                  Reintentar {pendiente.items.length} items
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <form onSubmit={enviarPedido} className="grid gap-4 lg:grid-cols-[280px_1fr] lg:gap-5">
          <aside className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
            <label className="block text-sm font-bold text-champana">
              Mesa o zona
              <select value={mesaId} onChange={(event) => setMesaId(event.target.value)} className="tap-target mt-2 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Barra directa</option>
                {mesas.map((mesa) => (
                  <option key={mesa.id} value={mesa.id}>{mesa.nombre} - {mesa.zona}</option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-sm font-bold text-champana">
              Notas
              <textarea value={notas} onChange={(event) => setNotas(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-antiguo/20 bg-carbon p-3 text-crema" />
            </label>
            <div className="mt-5 rounded-md border border-oro/25 bg-carbon p-4">
              <p className="text-sm text-antiguo/70">Total pedido</p>
              <p className="mt-1 text-2xl font-black text-dorado">{formatoCOP(total)}</p>
            </div>
            {mensaje ? <p className="mt-4 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm">{mensaje}</p> : null}
            <button disabled={enviando || total === 0} className="tap-target mt-4 w-full rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">
              {enviando ? "Enviando..." : "Enviar pedido"}
            </button>
          </aside>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {itemsVenta.map((item) => {
              const cantidad = cantidades[item.clave] ?? 0;
              return (
                <article key={item.clave} className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-oro">{nombreCategoria(item)}</p>
                  <h2 className="mt-2 text-lg font-black text-crema">{item.nombre}</h2>
                  <p className="mt-1 text-sm text-antiguo/70">{formatoCOP(item.precio_venta)}</p>
                  {item.tipo === "producto" ? <p className="mt-1 text-xs text-antiguo/50">Stock: {item.stock_actual ?? 0}</p> : null}
                  <div className="mt-4 grid grid-cols-[44px_1fr_44px] items-center gap-2">
                    <button type="button" onClick={() => cambiarCantidad(item.clave, -1)} className="tap-target rounded-md border border-antiguo/20 bg-carbon text-xl">-</button>
                    <p className="text-center text-2xl font-black text-dorado">{cantidad}</p>
                    <button type="button" onClick={() => cambiarCantidad(item.clave, 1)} className="tap-target rounded-md border border-antiguo/20 bg-carbon text-xl">+</button>
                  </div>
                </article>
              );
            })}
          </div>
        </form>

        <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-oro">Historial</p>
              <h2 className="text-xl font-black text-crema">Pedidos recientes</h2>
            </div>
            <button onClick={cargarHistorial} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 text-sm font-bold">Actualizar</button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {historial.map((pedido) => (
              <article key={pedido.id} className="rounded-md border border-antiguo/10 bg-carbon p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-crema">{nombreCuentaPedido(pedido)}</p>
                    <p className="text-xs text-antiguo/60">{fechaPedido(pedido.enviado_at)}</p>
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
      </section>
    </main>
  );
}
