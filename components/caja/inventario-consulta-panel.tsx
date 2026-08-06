"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ItemStock = {
  orden_tipo: number;
  tipo_item: "producto" | "combo";
  item_id: string;
  nombre: string;
  categoria: string | null;
  precio_venta: number;
  stock_disponible: number | null;
  stock_minimo: number | null;
  presentacion_compra: string | null;
  factor_compra: number | null;
  activo: boolean;
  componentes: { producto_id: string; producto: string; cantidad: number; stock_actual: number }[] | null;
};

type FiltroStock = "todos" | "en_cero" | "bajo" | "disponible";
type OrdenStock = "prioridad" | "stock_asc" | "stock_desc" | "nombre" | "precio_asc" | "precio_desc";

function normalizarTexto(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function estadoStock(item: ItemStock) {
  const stock = Number(item.stock_disponible ?? 0);
  const minimo = Number(item.stock_minimo ?? 0);

  if (stock <= 0) return { texto: "Sin stock", clase: "border-red-400/30 bg-red-950/25 text-red-100", prioridad: 1 };
  if (item.tipo_item === "producto" && stock <= minimo) return { texto: "Stock bajo", clase: "border-oro/30 bg-oro/10 text-dorado", prioridad: 2 };
  return { texto: "Disponible", clase: "border-green-400/25 bg-green-950/20 text-green-100", prioridad: 3 };
}

function detalleItem(item: ItemStock) {
  if (item.tipo_item === "producto") return `${item.presentacion_compra ?? "unidad"} x${item.factor_compra ?? 1}`;
  const componentes = item.componentes ?? [];
  return componentes.length > 0 ? componentes.map((componente) => `${componente.cantidad} x ${componente.producto}`).join(", ") : "Sin componentes";
}

export function InventarioConsultaPanel() {
  const [items, setItems] = useState<ItemStock[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [stockFiltro, setStockFiltro] = useState<FiltroStock>("todos");
  const [orden, setOrden] = useState<OrdenStock>("prioridad");

  const cargar = useCallback(async () => {
    setCargando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("v_catalogo_items_stock")
      .select("orden_tipo,tipo_item,item_id,nombre,categoria,precio_venta,stock_disponible,stock_minimo,presentacion_compra,factor_compra,activo,componentes")
      .eq("activo", true)
      .order("orden_tipo")
      .order("nombre");

    if (error) {
      setMensaje(error.message);
      setItems([]);
    } else {
      setItems((data ?? []) as ItemStock[]);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const categorias = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.categoria ?? "Sin categoria"))).sort((a, b) => a.localeCompare(b, "es"));
  }, [items]);

  const itemsFiltrados = useMemo(() => {
    const termino = normalizarTexto(busqueda.trim());

    return items
      .filter((item) => {
        const categoria = item.categoria ?? "Sin categoria";
        const stock = Number(item.stock_disponible ?? 0);
        const minimo = Number(item.stock_minimo ?? 0);
        const coincideCategoria = !categoriaFiltro || categoria === categoriaFiltro;
        const coincideBusqueda = !termino || normalizarTexto(`${item.nombre} ${detalleItem(item)} ${categoria}`).includes(termino);
        const coincideStock =
          stockFiltro === "todos" ||
          (stockFiltro === "en_cero" && stock <= 0) ||
          (stockFiltro === "bajo" && item.tipo_item === "producto" && stock > 0 && stock <= minimo) ||
          (stockFiltro === "disponible" && stock > 0 && (item.tipo_item === "combo" || stock > minimo));

        return coincideCategoria && coincideBusqueda && coincideStock;
      })
      .sort((a, b) => {
        if (orden === "stock_asc") return Number(a.stock_disponible ?? 0) - Number(b.stock_disponible ?? 0);
        if (orden === "stock_desc") return Number(b.stock_disponible ?? 0) - Number(a.stock_disponible ?? 0);
        if (orden === "precio_asc") return Number(a.precio_venta ?? 0) - Number(b.precio_venta ?? 0);
        if (orden === "precio_desc") return Number(b.precio_venta ?? 0) - Number(a.precio_venta ?? 0);
        if (orden === "nombre") return a.nombre.localeCompare(b.nombre, "es");

        const prioridad = estadoStock(a).prioridad - estadoStock(b).prioridad;
        return prioridad || a.orden_tipo - b.orden_tipo || a.nombre.localeCompare(b.nombre, "es");
      });
  }, [busqueda, categoriaFiltro, items, orden, stockFiltro]);

  const resumen = useMemo(() => {
    return {
      total: items.length,
      sinStock: items.filter((item) => Number(item.stock_disponible ?? 0) <= 0).length,
      bajo: items.filter((item) => item.tipo_item === "producto" && Number(item.stock_disponible ?? 0) > 0 && Number(item.stock_disponible ?? 0) <= Number(item.stock_minimo ?? 0)).length,
      combos: items.filter((item) => item.tipo_item === "combo").length,
    };
  }, [items]);

  return (
    <section className="grid gap-4">
      <div className="flex flex-col gap-2 border-b border-antiguo/15 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">Inventario</p>
          <h2 className="text-2xl font-black text-crema">Consulta de stock</h2>
          <p className="text-sm text-antiguo/70">Vista solo lectura para caja.</p>
        </div>
        <button type="button" onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Refrescar</button>
      </div>

      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm font-semibold">{mensaje}</p> : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-antiguo/10 bg-espresso p-3"><p className="text-xs text-antiguo/60">Items activos</p><p className="text-xl font-black text-dorado">{resumen.total}</p></div>
        <div className="rounded-md border border-red-400/20 bg-red-950/20 p-3"><p className="text-xs text-antiguo/60">Sin stock</p><p className="text-xl font-black text-red-100">{resumen.sinStock}</p></div>
        <div className="rounded-md border border-oro/20 bg-oro/10 p-3"><p className="text-xs text-antiguo/60">Stock bajo</p><p className="text-xl font-black text-dorado">{resumen.bajo}</p></div>
        <div className="rounded-md border border-antiguo/10 bg-espresso p-3"><p className="text-xs text-antiguo/60">Combos activos</p><p className="text-xl font-black text-dorado">{resumen.combos}</p></div>
      </div>

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_200px_180px_190px]">
          <input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar item" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
          <select value={categoriaFiltro} onChange={(event) => setCategoriaFiltro(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="">Todas las categorias</option>
            {categorias.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}
          </select>
          <select value={stockFiltro} onChange={(event) => setStockFiltro(event.target.value as FiltroStock)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="todos">Todo el stock</option>
            <option value="en_cero">Stock en cero</option>
            <option value="bajo">Stock bajo</option>
            <option value="disponible">Disponible</option>
          </select>
          <select value={orden} onChange={(event) => setOrden(event.target.value as OrdenStock)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
            <option value="prioridad">Prioridad stock</option>
            <option value="stock_asc">Stock menor primero</option>
            <option value="stock_desc">Stock mayor primero</option>
            <option value="nombre">Nombre</option>
            <option value="precio_asc">Precio menor primero</option>
            <option value="precio_desc">Precio mayor primero</option>
          </select>
        </div>

        <div className="mt-3 grid gap-3 md:hidden">
          {itemsFiltrados.map((item) => {
            const estado = estadoStock(item);
            return (
              <article key={`${item.tipo_item}-${item.item_id}`} className="rounded-md border border-antiguo/10 bg-carbon p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-oro">{item.tipo_item === "producto" ? "Producto" : "Combo"}</p>
                    <h3 className="break-words text-base font-black text-crema">{item.nombre}</h3>
                    <p className="text-xs text-antiguo/65">{item.categoria ?? "Sin categoria"}</p>
                  </div>
                  <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-bold ${estado.clase}`}>{estado.texto}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-md border border-antiguo/10 bg-espresso p-2"><p className="text-xs text-antiguo/60">Stock</p><p className="font-black text-crema">{item.stock_disponible ?? "-"}</p></div>
                  <div className="rounded-md border border-antiguo/10 bg-espresso p-2"><p className="text-xs text-antiguo/60">Minimo</p><p className="font-bold text-crema">{item.stock_minimo ?? "-"}</p></div>
                  <div className="rounded-md border border-antiguo/10 bg-espresso p-2"><p className="text-xs text-antiguo/60">Precio</p><p className="font-black text-dorado">{formatoCOP(item.precio_venta)}</p></div>
                </div>
                <p className="mt-3 break-words text-xs text-antiguo/75">{detalleItem(item)}</p>
              </article>
            );
          })}
          {cargando ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">Cargando inventario...</p> : null}
          {!cargando && itemsFiltrados.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">No hay items para ese filtro.</p> : null}
        </div>

        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-antiguo/70">
              <tr className="border-b border-antiguo/15">
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Categoria</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Minimo</th>
                <th className="py-2 pr-3">Precio venta</th>
                <th className="py-2 pr-3">Detalle</th>
                <th className="py-2 pr-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {itemsFiltrados.map((item) => {
                const estado = estadoStock(item);
                return (
                  <tr key={`${item.tipo_item}-${item.item_id}`} className="border-b border-antiguo/10 align-top">
                    <td className="py-3 pr-3 font-bold text-dorado">{item.tipo_item === "producto" ? "Producto" : "Combo"}</td>
                    <td className="py-3 pr-3 font-bold text-crema">{item.nombre}</td>
                    <td className="py-3 pr-3">{item.categoria ?? "-"}</td>
                    <td className="py-3 pr-3 font-black text-crema">{item.stock_disponible ?? "-"}</td>
                    <td className="py-3 pr-3">{item.stock_minimo ?? "-"}</td>
                    <td className="py-3 pr-3 font-bold text-dorado">{formatoCOP(item.precio_venta)}</td>
                    <td className="max-w-[320px] py-3 pr-3 text-xs text-antiguo/75">{detalleItem(item)}</td>
                    <td className="py-3 pr-3"><span className={`inline-flex rounded-md border px-2 py-1 text-xs font-bold ${estado.clase}`}>{estado.texto}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cargando ? <p className="p-4 text-center text-sm text-antiguo/70">Cargando inventario...</p> : null}
          {!cargando && itemsFiltrados.length === 0 ? <p className="p-4 text-center text-sm text-antiguo/70">No hay items para ese filtro.</p> : null}
        </div>
      </section>
    </section>
  );
}