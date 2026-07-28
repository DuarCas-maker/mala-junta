"use client";

import { useCallback, useEffect, useState } from "react";
import { estadoPedidoTexto, formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePerfilProtegido } from "@/lib/use-perfil-protegido";

type Pedido = any;

export function CajaOperativa() {
  const { perfil, cargando, error, salir } = usePerfilProtegido(["caja", "admin"]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data, error: queryError } = await supabase
      .from("pedidos")
      .select("id,estado,enviado_at,notas,perfiles(nombre),cuentas(id,estado,total_cuenta,mesas(nombre,zona)),pedido_items(id,cantidad,precio_unitario_capturado,notas,productos(nombre))")
      .order("enviado_at", { ascending: false })
      .limit(40);

    if (queryError) {
      setMensaje(queryError.message);
      return;
    }
    setPedidos(data ?? []);
  }, []);

  useEffect(() => {
    if (!perfil) return;
    cargar();
    const timer = window.setInterval(cargar, 2500);
    return () => window.clearInterval(timer);
  }, [perfil, cargar]);

  async function cambiarEstado(id: string, estado: string) {
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("cambiar_estado_pedido", { p_pedido_id: id, p_estado: estado });
    if (rpcError) setMensaje(rpcError.message);
    await cargar();
  }

  async function cobrar(cuentaId: string, total: number) {
    const supabase = supabaseBrowser();
    const { error: rpcError } = await supabase.rpc("registrar_pago_cuenta", {
      p_cuenta_id: cuentaId,
      p_medio: "efectivo",
      p_monto: total,
      p_propina: 0,
    });
    if (rpcError) setMensaje(rpcError.message);
    else setMensaje("Pago registrado en efectivo.");
    await cargar();
  }

  if (cargando) return <main className="min-h-screen p-5 text-champana">Cargando...</main>;
  if (error) return <main className="min-h-screen p-5 text-champana">{error}</main>;

  return (
    <main className="min-h-screen px-4 py-5 text-champana sm:px-8">
      <section className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-antiguo/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-oro">Centro de Mando</p>
            <h1 className="text-3xl font-black text-crema">Pedidos y cuentas</h1>
            <p className="text-sm text-antiguo/70">{perfil?.nombre}</p>
          </div>
          <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold">Salir</button>
        </header>

        {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm">{mensaje}</p> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {pedidos.map((pedido) => {
            const cuenta = pedido.cuentas;
            const mesa = cuenta?.mesas?.nombre ?? "Barra";
            const total = Number(cuenta?.total_cuenta ?? 0);
            return (
              <article key={pedido.id} className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-oro">{mesa}</p>
                    <h2 className="text-xl font-black text-crema">{estadoPedidoTexto(pedido.estado)}</h2>
                    <p className="text-sm text-antiguo/70">Mesero: {pedido.perfiles?.nombre ?? "-"}</p>
                  </div>
                  <p className="text-right text-lg font-black text-dorado">{formatoCOP(total)}</p>
                </div>
                <ul className="mt-4 space-y-2 text-sm">
                  {(pedido.pedido_items ?? []).map((item: any) => (
                    <li key={item.id} className="flex justify-between gap-3 border-t border-antiguo/10 pt-2">
                      <span>{item.cantidad} x {item.productos?.nombre}</span>
                      <span>{formatoCOP(Number(item.cantidad) * Number(item.precio_unitario_capturado))}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <button onClick={() => cambiarEstado(pedido.id, "en_preparacion")} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-2 text-sm font-bold">Preparar</button>
                  <button onClick={() => cambiarEstado(pedido.id, "entregado")} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-2 text-sm font-bold">Entregar</button>
                  <button onClick={() => cobrar(cuenta.id, total)} className="tap-target rounded-md bg-oro px-2 text-sm font-black text-carbon">Cobrar</button>
                  <button onClick={() => cambiarEstado(pedido.id, "anulado")} className="tap-target rounded-md border border-red-300/30 bg-red-950/30 px-2 text-sm font-bold text-red-100">Anular</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
