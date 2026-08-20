"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { estadoPedidoTexto, formatoCOP } from "@/lib/format";
import type { Perfil } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Mesa = { id: string; nombre: string; zona: string; es_vip: boolean; cuenta_id?: string | null; cuenta_estado?: string | null; nickname?: string | null; ultimo_pedido_at?: string | null };
type ComponenteVenta = { nombre: string; presentacion_compra: string | null; cantidad: number };
type ItemVenta = {
  clave: string;
  id: string;
  tipo: "producto" | "combo";
  nombre: string;
  precio_venta: number;
  imagen_url?: string | null;
  stock_actual?: number;
  presentacion_compra?: string | null;
  categorias?: { nombre: string } | { nombre: string }[] | null;
  categoria?: string | null;
  componentes?: ComponenteVenta[];
};
type Cantidades = Record<string, number>;
type PedidoItemPayload = { producto_id?: string; combo_id?: string; cantidad: number };
type PedidoPendiente = { id: string; mesaId: string; items: PedidoItemPayload[]; notas: string; nickname: string; creado: string };
type PedidoHistorial = any;

type Props = {
  perfil: Perfil;
  etiqueta?: string;
  titulo?: string;
  className?: string;
  headerActions?: ReactNode;
  onPedidoEnviado?: () => void | Promise<void>;
};

const STORAGE_KEY = "mala-junta-pedidos-pendientes";

function nombreCategoria(item: ItemVenta) {
  if (item.tipo === "combo") return "Combo";
  const categoria = Array.isArray(item.categorias) ? item.categorias[0] : item.categorias;
  return item.categoria ?? categoria?.nombre ?? "Producto";
}

function nombreVisibleItem(item: ItemVenta) {
  if (item.tipo === "combo") {
    const componentes = (item.componentes ?? []).map((componente) => `${componente.cantidad} x ${componente.nombre}${componente.presentacion_compra ? ` - ${componente.presentacion_compra}` : ""}`);
    return componentes.length > 0 ? `${item.nombre} - ${componentes.join(", ")}` : item.nombre;
  }

  return `${item.nombre} - ${item.presentacion_compra ?? "unidad"}`;
}

function normalizarTexto(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function numeroMesa(nombre: string) {
  const coincidencia = nombre.match(/^Mesa\s+(\d+)$/i);
  return coincidencia ? Number(coincidencia[1]) : Number.MAX_SAFE_INTEGER;
}

function ordenarMesas(a: Mesa, b: Mesa) {
  if (Boolean(a.cuenta_id) !== Boolean(b.cuenta_id)) return a.cuenta_id ? -1 : 1;
  const diferencia = numeroMesa(a.nombre) - numeroMesa(b.nombre);
  return diferencia || a.nombre.localeCompare(b.nombre, "es");
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

function itemsPedido(pedido: PedidoHistorial) {
  return Array.isArray(pedido.pedido_items) ? pedido.pedido_items.filter((item: any) => item.estado !== "anulado") : [];
}

function totalPedido(pedido: PedidoHistorial) {
  return itemsPedido(pedido).reduce((sum: number, item: any) => sum + Number(item.cantidad ?? 0) * Number(item.precio_unitario_capturado ?? 0), 0);
}

function nombreCuentaPedido(pedido: PedidoHistorial) {
  const cuenta = Array.isArray(pedido.cuentas) ? pedido.cuentas[0] : pedido.cuentas;
  const mesa = Array.isArray(cuenta?.mesas) ? cuenta.mesas[0] : cuenta?.mesas;
  const base = mesa ? `${mesa.nombre} - ${mesa.zona}` : "Pedido directo";
  const nickname = String(cuenta?.nickname ?? "").trim();
  return nickname ? `${base} - ${nickname}` : base;
}

function nombreMesaSelector(mesa: Mesa) {
  const base = `${mesa.nombre} - ${mesa.zona}`;
  const nickname = String(mesa.nickname ?? "").trim();
  if (nickname) return `${base} - ${nickname}`;
  return mesa.cuenta_id ? `${base} - cuenta abierta` : base;
}

async function cargarMesasParaPedidos(supabase: ReturnType<typeof supabaseBrowser>) {
  const mesasRpc = await supabase.rpc("mesas_para_pedidos");
  if (!mesasRpc.error) return ((mesasRpc.data ?? []) as Mesa[]).sort(ordenarMesas);

  const mesasBase = await supabase.from("mesas").select("id,nombre,zona,es_vip").eq("activa", true).order("nombre");
  if (mesasBase.error) throw mesasRpc.error;
  return ((mesasBase.data ?? []) as Mesa[]).sort(ordenarMesas);
}

function fechaPedido(fecha?: string) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function nombreHistorialItem(item: any) {
  const producto = Array.isArray(item.productos) ? item.productos[0] : item.productos;
  if (producto) return `${producto.nombre} - ${producto.presentacion_compra ?? "unidad"}`;

  const combo = Array.isArray(item.combos) ? item.combos[0] : item.combos;
  if (!combo) return "Item";

  const componentes = (combo.combo_items ?? [])
    .filter((componente: any) => componente.activo !== false && componente.productos)
    .map((componente: any) => {
      const componenteProducto = Array.isArray(componente.productos) ? componente.productos[0] : componente.productos;
      const presentacion = componenteProducto?.presentacion_compra ? ` - ${componenteProducto.presentacion_compra}` : "";
      return `${componente.cantidad} x ${componenteProducto?.nombre ?? "Producto"}${presentacion}`;
    });

  return componentes.length > 0 ? `${combo.nombre} - ${componentes.join(", ")}` : combo.nombre;
}

function ImagenItemVenta({ url, nombre }: { url?: string | null; nombre: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={nombre} className="h-full w-full object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.45)]" loading="lazy" />;
  }

  return (
    <div className="grid h-full w-full place-items-center rounded-md border border-antiguo/10 bg-[radial-gradient(circle_at_50%_30%,rgba(226,176,127,0.20),transparent_55%),#100D08] text-2xl font-black uppercase text-oro/80">
      {nombre.trim().slice(0, 2) || "MJ"}
    </div>
  );
}

export function PedidoRapidoPanel({
  perfil,
  etiqueta = "Mesero",
  titulo = "Nuevo pedido",
  className = "mx-auto flex max-w-5xl flex-col gap-5",
  headerActions,
  onPedidoEnviado,
}: Props) {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [itemsVenta, setItemsVenta] = useState<ItemVenta[]>([]);
  const [mesaId, setMesaId] = useState<string>("");
  const [nickname, setNickname] = useState("");
  const [cantidades, setCantidades] = useState<Cantidades>({});
  const [notas, setNotas] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pendientes, setPendientes] = useState<PedidoPendiente[]>([]);
  const [historial, setHistorial] = useState<PedidoHistorial[]>([]);
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAbierta, setBusquedaAbierta] = useState(false);
  const [itemActivo, setItemActivo] = useState<string | null>(null);

  useEffect(() => {
    setPendientes(leerPendientes());
  }, []);

  useEffect(() => {
    let activo = true;
    const supabase = supabaseBrowser();

    async function actualizarMesas() {
      try {
        const mesasActualizadas = await cargarMesasParaPedidos(supabase);
        if (activo) setMesas(mesasActualizadas);
      } catch {
        // La carga principal ya muestra errores; este refresco solo mantiene sincronizado el selector.
      }
    }

    const canal = supabase
      .channel("pedido-rapido-mesas")
      .on("postgres_changes", { event: "*", schema: "public", table: "cuentas" }, actualizarMesas)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, actualizarMesas)
      .subscribe();

    const timer = window.setInterval(actualizarMesas, 15000);

    return () => {
      activo = false;
      window.clearInterval(timer);
      void supabase.removeChannel(canal);
    };
  }, []);

  useEffect(() => {
    let activo = true;

    async function cargarDatos() {
      setMensaje("Cargando mesas, productos y combos...");
      const supabase = supabaseBrowser();
      const [mesasData, { data: productosData, error: productosError }, { data: combosData, error: combosError }, { data: historialData, error: historialError }] = await Promise.all([
        cargarMesasParaPedidos(supabase),
        supabase.from("v_productos_operativos").select("id,nombre,precio_venta,imagen_url,stock_actual,presentacion_compra,categoria").order("nombre"),
        supabase.from("combos").select("id,nombre,precio_venta,imagen_url,combo_items(id,cantidad,activo,productos(nombre,presentacion_compra))").eq("activo", true).order("nombre"),
        supabase
          .from("pedidos")
          .select("id,estado,enviado_at,notas,cuentas(estado,total_cuenta,nickname,mesas(nombre,zona)),pedido_items(id,cantidad,estado,precio_unitario_capturado,productos(nombre,presentacion_compra),combos(nombre,combo_items(cantidad,activo,productos(nombre,presentacion_compra))))")
          .order("enviado_at", { ascending: false })
          .limit(12),
      ]);

      if (productosError) throw productosError;
      if (combosError) throw combosError;
      if (historialError) throw historialError;

      const productos = ((productosData ?? []) as any[]).map((producto) => ({
        clave: `producto:${producto.id}`,
        id: producto.id,
        tipo: "producto" as const,
        nombre: producto.nombre,
        precio_venta: Number(producto.precio_venta),
        imagen_url: producto.imagen_url,
        stock_actual: Number(producto.stock_actual ?? 0),
        presentacion_compra: producto.presentacion_compra,
        categorias: null,
        categoria: producto.categoria,
      }));
      const combos = ((combosData ?? []) as any[]).map((combo) => ({
        clave: `combo:${combo.id}`,
        id: combo.id,
        tipo: "combo" as const,
        nombre: combo.nombre,
        precio_venta: Number(combo.precio_venta),
        imagen_url: combo.imagen_url,
        componentes: (combo.combo_items ?? [])
          .filter((item: any) => item.activo !== false && item.productos)
          .map((item: any) => {
            const producto = Array.isArray(item.productos) ? item.productos[0] : item.productos;
            return {
              nombre: producto?.nombre ?? "Producto",
              presentacion_compra: producto?.presentacion_compra ?? null,
              cantidad: Number(item.cantidad ?? 0),
            };
          })
          .filter((item: ComponenteVenta) => item.cantidad > 0),
      }));

      if (activo) {
        setMesas(mesasData);
        setItemsVenta([...productos, ...combos]);
        setHistorial((historialData ?? []) as PedidoHistorial[]);
        setMensaje(null);
      }
    }

    cargarDatos().catch((err) => {
      if (activo) setMensaje(err instanceof Error ? err.message : "No se pudieron cargar mesas, productos y combos.");
    });

    return () => {
      activo = false;
    };
  }, []);

  const categorias = useMemo(() => {
    return Array.from(new Set(itemsVenta.map(nombreCategoria))).sort((a, b) => a.localeCompare(b, "es"));
  }, [itemsVenta]);

  const itemsFiltrados = useMemo(() => {
    const termino = normalizarTexto(busqueda.trim());

    return itemsVenta.filter((item) => {
      const coincideCategoria = !categoriaFiltro || nombreCategoria(item) === categoriaFiltro;
      const coincideBusqueda = !termino || normalizarTexto(nombreVisibleItem(item)).includes(termino);
      return coincideCategoria && coincideBusqueda;
    });
  }, [busqueda, categoriaFiltro, itemsVenta]);

  const total = useMemo(() => {
    return itemsVenta.reduce((sum, item) => sum + (cantidades[item.clave] ?? 0) * Number(item.precio_venta), 0);
  }, [cantidades, itemsVenta]);

  const itemsSeleccionados = useMemo(() => {
    return itemsVenta
      .map((item) => ({ item, cantidad: cantidades[item.clave] ?? 0 }))
      .filter(({ cantidad }) => cantidad > 0);
  }, [cantidades, itemsVenta]);

  const cantidadItems = useMemo(() => {
    return itemsSeleccionados.reduce((sum, { cantidad }) => sum + cantidad, 0);
  }, [itemsSeleccionados]);

  const mesasAbiertas = useMemo(() => mesas.filter((mesa) => mesa.cuenta_id), [mesas]);
  const mesasDisponibles = useMemo(() => mesas.filter((mesa) => !mesa.cuenta_id), [mesas]);
  const mesaSeleccionada = useMemo(() => mesas.find((mesa) => mesa.id === mesaId) ?? null, [mesaId, mesas]);
  const nicknameBloqueado = Boolean(mesaSeleccionada?.cuenta_id);

  useEffect(() => {
    if (!mesaSeleccionada?.cuenta_id) return;
    setNickname(String(mesaSeleccionada.nickname ?? "").trim());
  }, [mesaSeleccionada]);

  function activarItem(clave: string) {
    setItemActivo(clave);
  }

  function cambiarCantidad(clave: string, delta: number) {
    setItemActivo(clave);
    setCantidades((actual) => {
      const siguiente = Math.max(0, (actual[clave] ?? 0) + delta);
      return { ...actual, [clave]: siguiente };
    });
  }

  async function cargarHistorial() {
    const supabase = supabaseBrowser();
    const [{ data, error: historialError }, mesasData] = await Promise.all([
      supabase
        .from("pedidos")
        .select("id,estado,enviado_at,notas,cuentas(estado,total_cuenta,nickname,mesas(nombre,zona)),pedido_items(id,cantidad,estado,precio_unitario_capturado,productos(nombre,presentacion_compra),combos(nombre,combo_items(cantidad,activo,productos(nombre,presentacion_compra))))")
        .order("enviado_at", { ascending: false })
        .limit(12),
      cargarMesasParaPedidos(supabase),
    ]);

    if (historialError) {
      setMensaje(historialError.message);
      return;
    }

    setHistorial((data ?? []) as PedidoHistorial[]);
    setMesas(mesasData);
  }

  async function enviarPayload(payload: { mesaId: string; items: PedidoItemPayload[]; notas: string; nickname: string }) {
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("crear_pedido_rapido", {
      p_mesa_id: payload.mesaId || null,
      p_items: payload.items,
      p_notas: payload.notas || null,
      p_nickname: payload.nickname || null,
    });
    if (rpcError) throw new Error(rpcError.message);
  }

  function guardarComoPendiente(payload: { mesaId: string; items: PedidoItemPayload[]; notas: string; nickname: string }) {
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
      const payload = { mesaId, items, notas, nickname: nickname.trim() };
      await enviarPayload(payload);
      setMensaje("Pedido sincronizado con la mesa.");
      setCantidades({});
      setItemActivo(null);
      setNotas("");
      setNickname("");
      await cargarHistorial();
      await onPedidoEnviado?.();
    } catch (err) {
      if (items.length > 0) {
        guardarComoPendiente({ mesaId, items, notas, nickname: nickname.trim() });
        setMensaje(`No se pudo sincronizar: ${err instanceof Error ? err.message : "error desconocido"}. Quedo guardado para reintentar.`);
        setCantidades({});
        setItemActivo(null);
        setNotas("");
        setNickname("");
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
      await onPedidoEnviado?.();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo sincronizar el pendiente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={className}>
      <header className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">{etiqueta}</p>
          <h1 className="text-2xl font-black text-crema sm:text-3xl">{titulo}</h1>
          <p className="text-sm text-antiguo/70">{perfil.nombre}</p>
        </div>
        {headerActions ? <div className="flex flex-wrap gap-2">{headerActions}</div> : null}
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

      <form onSubmit={enviarPedido} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <section className="min-w-0">
          <div className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
              <label className="block text-sm font-bold text-champana">
                Mesa o zona
                <select
                  value={mesaId}
                  onChange={(event) => {
                    const siguienteMesa = mesas.find((mesa) => mesa.id === event.target.value);
                    setMesaId(event.target.value);
                    setNickname(String(siguienteMesa?.nickname ?? "").trim());
                  }}
                  className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema"
                >
                  <option value="">Pedido directo</option>
                  {mesasAbiertas.length > 0 ? (
                    <optgroup label="Mesas abiertas">
                      {mesasAbiertas.map((mesa) => (
                        <option key={mesa.id} value={mesa.id}>{nombreMesaSelector(mesa)}</option>
                      ))}
                    </optgroup>
                  ) : null}
                  {mesasDisponibles.length > 0 ? (
                    <optgroup label="Mesas disponibles">
                      {mesasDisponibles.map((mesa) => (
                        <option key={mesa.id} value={mesa.id}>{nombreMesaSelector(mesa)}</option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              <button type="button" onClick={() => setBusquedaAbierta((actual) => !actual)} className={busquedaAbierta || busqueda ? "tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon" : "tap-target rounded-md border border-antiguo/20 bg-carbon px-4 text-sm font-bold text-crema"}>
                Buscar
              </button>
              <div className="rounded-md border border-oro/20 bg-carbon px-4 py-2 text-right">
                <p className="text-xs font-bold uppercase tracking-wide text-antiguo/60">{cantidadItems} items</p>
                <p className="text-lg font-black text-dorado">{formatoCOP(total)}</p>
              </div>
            </div>

            <label className="mt-3 block text-sm font-bold text-champana">
              Nickname opcional
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                disabled={nicknameBloqueado}
                maxLength={60}
                placeholder={nicknameBloqueado ? "Nickname de cuenta abierta" : "Ej: Carlos, cumple, familia Lopez"}
                className="tap-target mt-1 w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50 disabled:opacity-70"
              />
              {nicknameBloqueado ? <span className="mt-1 block text-xs text-antiguo/60">Esta mesa ya tiene cuenta abierta; los nuevos items se agregan a esa cuenta.</span> : null}
            </label>

            {busquedaAbierta ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
                <input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar producto" className="tap-target w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                <select value={categoriaFiltro} onChange={(event) => setCategoriaFiltro(event.target.value)} className="tap-target w-full rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                  <option value="">Todas las categorias</option>
                  {categorias.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}
                </select>
              </div>
            ) : null}
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-antiguo/15 bg-carbon p-2">
            <div className="flex min-w-max gap-2">
              <button type="button" onClick={() => setCategoriaFiltro("")} className={!categoriaFiltro ? "tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon" : "tap-target rounded-md border border-antiguo/15 bg-espresso px-4 text-sm font-bold text-crema"}>
                Todos
              </button>
              {categorias.map((categoria) => (
                <button key={categoria} type="button" onClick={() => setCategoriaFiltro(categoria)} className={categoriaFiltro === categoria ? "tap-target rounded-md bg-oro px-4 text-sm font-black text-carbon" : "tap-target rounded-md border border-antiguo/15 bg-espresso px-4 text-sm font-bold text-crema"}>
                  {categoria}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid content-start gap-3 grid-cols-2 md:grid-cols-3 2xl:grid-cols-4">
            {itemsFiltrados.map((item) => {
              const cantidad = cantidades[item.clave] ?? 0;
              const activo = itemActivo === item.clave || cantidad > 0;
              return (
                <article key={item.clave} className={activo ? "overflow-hidden rounded-lg border border-oro/45 bg-espresso shadow-suave" : "overflow-hidden rounded-lg border border-antiguo/15 bg-espresso shadow-suave"}>
                  <button type="button" onClick={() => activarItem(item.clave)} className="block w-full p-2 text-left">
                    <div className="aspect-[4/3] rounded-md bg-carbon p-2">
                      <ImagenItemVenta url={item.imagen_url} nombre={item.nombre} />
                    </div>
                    <div className="min-h-[98px] pt-2">
                      <p className="truncate text-[11px] font-bold uppercase tracking-wide text-oro">{nombreCategoria(item)}</p>
                      <h2 className="mt-1 line-clamp-2 text-sm font-black text-crema sm:text-base">{item.nombre}</h2>
                      <p className="mt-1 truncate text-xs text-antiguo/65">{item.tipo === "producto" ? item.presentacion_compra ?? "unidad" : "Combo"}</p>
                      <p className="mt-1 text-base font-black text-dorado">{formatoCOP(item.precio_venta)}</p>
                    </div>
                  </button>
                  {activo ? (
                    <div className="grid grid-cols-[42px_1fr_42px] items-center gap-1 border-t border-antiguo/10 p-2">
                      <button type="button" onClick={() => cambiarCantidad(item.clave, -1)} disabled={cantidad === 0} className="tap-target rounded-md border border-antiguo/20 bg-carbon text-xl disabled:opacity-40">-</button>
                      <p className="text-center text-xl font-black text-dorado">{cantidad}</p>
                      <button type="button" onClick={() => cambiarCantidad(item.clave, 1)} className="tap-target rounded-md border border-antiguo/20 bg-carbon text-xl">+</button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <aside className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave xl:sticky xl:top-4">
          <div className="flex items-center justify-between gap-3 border-b border-antiguo/15 pb-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-oro">Detalle</p>
              <h2 className="text-xl font-black text-crema">Pedido actual</h2>
            </div>
            {itemsSeleccionados.length > 0 ? (
              <button type="button" onClick={() => { setCantidades({}); setItemActivo(null); }} className="rounded-md border border-red-300/30 px-2 py-1 text-xs font-bold text-red-100">Vaciar</button>
            ) : null}
          </div>

          <div className="mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1 xl:max-h-[48vh]">
            {itemsSeleccionados.map(({ item, cantidad }) => (
              <article key={item.clave} className="grid grid-cols-[48px_1fr] gap-2 rounded-md border border-antiguo/10 bg-carbon p-2">
                <div className="h-12 w-12 rounded-md bg-espresso p-1">
                  <ImagenItemVenta url={item.imagen_url} nombre={item.nombre} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-bold text-crema">{item.nombre}</p>
                    <button type="button" onClick={() => setCantidades((actual) => ({ ...actual, [item.clave]: 0 }))} className="shrink-0 rounded-md px-2 text-red-100">x</button>
                  </div>
                  <p className="text-xs text-antiguo/60">{formatoCOP(item.precio_venta)} c/u</p>
                  <div className="mt-2 grid grid-cols-[36px_1fr_36px_auto] items-center gap-1">
                    <button type="button" onClick={() => cambiarCantidad(item.clave, -1)} className="h-9 rounded-md border border-antiguo/20 bg-espresso text-lg">-</button>
                    <p className="text-center font-black text-dorado">{cantidad}</p>
                    <button type="button" onClick={() => cambiarCantidad(item.clave, 1)} className="h-9 rounded-md border border-antiguo/20 bg-espresso text-lg">+</button>
                    <p className="pl-2 text-right text-sm font-black text-crema">{formatoCOP(cantidad * item.precio_venta)}</p>
                  </div>
                </div>
              </article>
            ))}
            {itemsSeleccionados.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-5 text-center text-sm text-antiguo/70">Selecciona un producto para activar cantidades.</p> : null}
          </div>

          <label className="mt-3 block text-sm font-bold text-champana">
            Notas
            <textarea value={notas} onChange={(event) => setNotas(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-antiguo/20 bg-carbon p-3 text-crema" />
          </label>

          <div className="mt-3 space-y-2 rounded-md border border-oro/20 bg-carbon p-3">
            <div className="flex justify-between gap-3 text-sm text-antiguo/75">
              <span>Items</span>
              <span>{cantidadItems}</span>
            </div>
            <div className="flex justify-between gap-3 border-t border-antiguo/10 pt-2">
              <span className="text-lg font-black text-crema">Total</span>
              <span className="text-2xl font-black text-dorado">{formatoCOP(total)}</span>
            </div>
          </div>

          {mensaje ? <p className="mt-3 rounded-md border border-antiguo/15 bg-carbon p-3 text-sm">{mensaje}</p> : null}
          <button disabled={enviando || total === 0} className="tap-target mt-3 w-full rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">
            {enviando ? "Enviando..." : "Enviar pedido"}
          </button>
        </aside>
      </form>

      {itemsFiltrados.length === 0 ? <p className="rounded-md border border-antiguo/15 bg-espresso p-6 text-center text-sm text-antiguo/70">No hay productos para ese filtro.</p> : null}

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
                {itemsPedido(pedido).map((item: any) => (
                  <li key={item.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-antiguo/10 pt-2">
                    <span>{item.cantidad} x {nombreHistorialItem(item)}</span>
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
  );
}
