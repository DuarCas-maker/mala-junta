"use client";

import { useCallback, useEffect, useState } from "react";
import { estadoPedidoTexto } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePerfilProtegido } from "@/lib/use-perfil-protegido";

type Pedido = any;

function nombreMesa(pedido: Pedido) {
  const cuenta = Array.isArray(pedido.cuentas) ? pedido.cuentas[0] : pedido.cuentas;
  const mesa = Array.isArray(cuenta?.mesas) ? cuenta.mesas[0] : cuenta?.mesas;
  return mesa ? `${mesa.nombre} - ${mesa.zona}` : "Barra";
}

export function BarraOperativa() {
  const { perfil, cargando, error, salir } = usePerfilProtegido(["caja", "admin"]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data, error: queryError } = await supabase
      .from("pedidos")
      .select("id,estado,enviado_at,notas,cuentas(mesas(nombre,zona)),pedido_items(id,cantidad,notas,productos(nombre))")
      .in("estado", ["enviado", "en_preparacion"])
      .order("enviado_at", { ascending: true });

    if (queryError) {
      setMensaje(queryError.message);
      return;
    }
    setPedidos(data ?? []);
  }, []);

  useEffect(() => {
    if (!perfil) return;

    const supabase = supabaseBrowser();
    cargar();

    const canal = supabase
      .channel("barra-operativa")
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_items" }, cargar)
      .subscribe();

    const timer = window.setInterval(cargar, 10000);

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(canal);
    };
  }, [perfil, cargar]);

  async function cambiarEstado(id: string, estado: string) {
    setMensaje(null);
    setProcesando(id);
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("cambiar_estado_pedido", { p_pedido_id: id, p_estado: estado });
    if (rpcError) setMensaje(rpcError.message);
    else setMensaje("Comanda actualizada.");
    setProcesando(null);
    await cargar();
  }

  if (cargando) return <main className="min-h-screen p-5 text-champana">Cargando...</main>;
  if (error) return <main className="min-h-screen p-5 text-champana">{error}</main>;

  return (
    <main className="min-h-screen px-4 py-5 text-champana sm:px-8">
      <section className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex items-center justify-between border-b border-antiguo/15 pb-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Barra</p>
            <h1 className="text-3xl font-black text-crema">Comandas</h1>
            <p className="text-sm text-antiguo/70">{perfil?.nombre}</p>
          </div>
          <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold">Salir</button>
        </header>

        {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm">{mensaje}</p> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pedidos.map((pedido) => (
            <article key={pedido.id} className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-oro">{nombreMesa(pedido)}</p>
                  <h2 className="text-xl font-black text-crema">{estadoPedidoTexto(pedido.estado)}</h2>
                </div>
                <span className="rounded-md border border-antiguo/15 bg-carbon px-2 py-1 text-xs font-bold text-antiguo/80">{(pedido.pedido_items ?? []).length} items</span>
              </div>

              {pedido.notas ? <p className="mt-3 rounded-md border border-antiguo/10 bg-carbon p-2 text-sm text-antiguo/80">{pedido.notas}</p> : null}

              <ul className="mt-4 space-y-2">
                {(pedido.pedido_items ?? []).map((item: any) => (
                  <li key={item.id} className="border-t border-antiguo/10 pt-2 text-sm">
                    <span className="font-bold text-crema">{item.cantidad} x {item.productos?.nombre}</span>
                    {item.notas ? <p className="text-antiguo/70">{item.notas}</p> : null}
                  </li>
                ))}
              </ul>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button disabled={procesando === pedido.id || pedido.estado === "en_preparacion"} onClick={() => cambiarEstado(pedido.id, "en_preparacion")} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 font-bold disabled:opacity-50">Preparar</button>
                <button disabled={procesando === pedido.id} onClick={() => cambiarEstado(pedido.id, "entregado")} className="tap-target rounded-md bg-oro px-3 font-black text-carbon disabled:opacity-50">Entregar</button>
              </div>
            </article>
          ))}
        </div>

        {pedidos.length === 0 ? <p className="rounded-md border border-antiguo/15 bg-espresso p-6 text-center text-antiguo/70">No hay comandas pendientes.</p> : null}
      </section>
    </main>
  );
}
