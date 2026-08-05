"use client";

import Link from "next/link";
import { PedidoRapidoPanel } from "@/components/pedidos/pedido-rapido-panel";
import { usePerfilProtegido } from "@/lib/use-perfil-protegido";

export function MeseroOperativo() {
  const { perfil, cargando, error, salir } = usePerfilProtegido(["mesero", "admin"]);

  if (cargando) return <main className="min-h-screen p-5 text-champana">Cargando...</main>;
  if (error) return <main className="min-h-screen p-5 text-champana">{error}</main>;

  return (
    <main className="min-h-screen px-3 py-4 text-champana sm:px-4 sm:py-5">
      <PedidoRapidoPanel
        perfil={perfil!}
        headerActions={(
          <>
            {perfil?.rol === "admin" ? <Link href="/admin" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Admin</Link> : null}
            <button onClick={salir} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-4 font-bold">Salir</button>
          </>
        )}
      />
    </main>
  );
}
