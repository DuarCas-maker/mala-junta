"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePerfilProtegido } from "@/lib/use-perfil-protegido";

type Mesa = { id: string; nombre: string; zona: string; es_vip: boolean };
type Producto = { id: string; nombre: string; precio_venta: number; stock_actual: number; categorias?: { nombre: string } | { nombre: string }[] | null };

type Cantidades = Record<string, number>;

function nombreCategoria(producto: Producto) {
  const categoria = Array.isArray(producto.categorias) ? producto.categorias[0] : producto.categorias;
  return categoria?.nombre ?? "Producto";
}

export function MeseroOperativo() {
  const { perfil, cargando, error, salir } = usePerfilProtegido(["mesero"]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [mesaId, setMesaId] = useState<string>("");
  const [cantidades, setCantidades] = useState<Cantidades>({});
  const [notas, setNotas] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    async function cargarDatos() {
      const supabase = supabaseBrowser();
      const [{ data: mesasData }, { data: productosData }] = await Promise.all([
        supabase.from("mesas").select("id,nombre,zona,es_vip").eq("activa", true).order("nombre"),
        supabase.from("productos").select("id,nombre,precio_venta,stock_actual,categorias(nombre)").eq("activo", true).order("nombre"),
      ]);
      setMesas((mesasData ?? []) as Mesa[]);
      setProductos((productosData ?? []) as unknown as Producto[]);
    }
    if (perfil) cargarDatos();
  }, [perfil]);

  const total = useMemo(() => {
    return productos.reduce((sum, producto) => sum + (cantidades[producto.id] ?? 0) * Number(producto.precio_venta), 0);
  }, [cantidades, productos]);

  function cambiarCantidad(productoId: string, delta: number) {
    setCantidades((actual) => {
      const siguiente = Math.max(0, (actual[productoId] ?? 0) + delta);
      return { ...actual, [productoId]: siguiente };
    });
  }

  async function enviarPedido(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensaje(null);
    setEnviando(true);

    try {
      const items = Object.entries(cantidades)
        .filter(([, cantidad]) => cantidad > 0)
        .map(([producto_id, cantidad]) => ({ producto_id, cantidad }));

      if (items.length === 0) throw new Error("Agrega al menos un producto.");

      const supabase = supabaseBrowser();
      const { error: rpcError } = await supabase.rpc("crear_pedido_rapido", {
        p_mesa_id: mesaId || null,
        p_items: items,
        p_notas: notas || null,
      });

      if (rpcError) throw new Error(rpcError.message);

      setMensaje("Pedido enviado a caja y barra.");
      setCantidades({});
      setNotas("");
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo enviar el pedido.");
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) return <main className="min-h-screen p-5 text-champana">Cargando...</main>;
  if (error) return <main className="min-h-screen p-5 text-champana">{error}</main>;

  return (
    <main className="min-h-screen px-4 py-5 text-champana">
      <section className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex items-center justify-between border-b border-antiguo/15 pb-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Mesero</p>
            <h1 className="text-3xl font-black text-crema">Nuevo pedido</h1>
            <p className="text-sm text-antiguo/70">{perfil?.nombre}</p>
          </div>
          <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold">Salir</button>
        </header>

        <form onSubmit={enviarPedido} className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
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
            {productos.map((producto) => {
              const cantidad = cantidades[producto.id] ?? 0;
              return (
                <article key={producto.id} className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
                  <p className="text-xs font-bold uppercase tracking-wide text-oro">{nombreCategoria(producto)}</p>
                  <h2 className="mt-2 text-lg font-black text-crema">{producto.nombre}</h2>
                  <p className="mt-1 text-sm text-antiguo/70">{formatoCOP(producto.precio_venta)}</p>
                  <div className="mt-4 grid grid-cols-[44px_1fr_44px] items-center gap-2">
                    <button type="button" onClick={() => cambiarCantidad(producto.id, -1)} className="tap-target rounded-md border border-antiguo/20 bg-carbon text-xl">-</button>
                    <p className="text-center text-2xl font-black text-dorado">{cantidad}</p>
                    <button type="button" onClick={() => cambiarCantidad(producto.id, 1)} className="tap-target rounded-md border border-antiguo/20 bg-carbon text-xl">+</button>
                  </div>
                </article>
              );
            })}
          </div>
        </form>
      </section>
    </main>
  );
}
