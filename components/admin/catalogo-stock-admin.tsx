"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Categoria = { id: string; nombre: string };
type Producto = {
  id: string;
  nombre: string;
  categoria_id: string | null;
  precio_venta: number;
  costo_unitario_actual: number;
  codigo_interno: string | null;
  stock_actual: number;
  stock_minimo: number;
  presentacion_compra: string;
  factor_compra: number;
  activo: boolean;
};
type Proveedor = {
  id: string;
  nombre: string;
  nit: string | null;
  contacto: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  observacion: string | null;
  activo: boolean;
};
type Motivo = { id: string; texto: string };
type ComboItem = { producto_id: string; cantidad: number; activo?: boolean; productos?: { nombre?: string } | null };
type Combo = { id: string; nombre: string; precio_venta: number; activo: boolean; combo_items?: ComboItem[] };
type ItemStock = {
  orden_tipo: number;
  tipo_item: "producto" | "combo";
  item_id: string;
  nombre: string;
  categoria: string | null;
  precio_venta: number;
  costo_estimado: number | null;
  stock_disponible: number | null;
  stock_minimo: number | null;
  presentacion_compra: string | null;
  factor_compra: number | null;
  activo: boolean;
  componentes: { producto_id: string; producto: string; cantidad: number; stock_actual: number }[] | null;
};

type ProductoForm = { id: string | null; nombre: string; categoriaId: string; precio: string; costo: string; codigo: string; minimo: string; presentacion: string; factor: string; activo: boolean };
type ComboForm = { id: string | null; nombre: string; precio: string; producto1: string; cantidad1: string; producto2: string; cantidad2: string; activo: boolean };
type ProveedorForm = { id: string | null; nombre: string; nit: string; contacto: string; telefono: string; correo: string; direccion: string; observacion: string; activo: boolean };

const productoInicial: ProductoForm = { id: null, nombre: "", categoriaId: "", precio: "", costo: "", codigo: "", minimo: "0", presentacion: "unidad", factor: "1", activo: true };
const comboInicial: ComboForm = { id: null, nombre: "", precio: "", producto1: "", cantidad1: "1", producto2: "", cantidad2: "1", activo: true };
const proveedorInicial: ProveedorForm = { id: null, nombre: "", nit: "", contacto: "", telefono: "", correo: "", direccion: "", observacion: "", activo: true };

function comboItems(combo: Combo) {
  return (combo.combo_items ?? [])
    .filter((item) => item.activo !== false)
    .map((item) => ({ producto_id: item.producto_id, cantidad: Number(item.cantidad) }))
    .filter((item) => item.producto_id && item.cantidad > 0);
}

function proveedorAForm(proveedor: Proveedor): ProveedorForm {
  return {
    id: proveedor.id,
    nombre: proveedor.nombre,
    nit: proveedor.nit ?? "",
    contacto: proveedor.contacto ?? "",
    telefono: proveedor.telefono ?? "",
    correo: proveedor.correo ?? "",
    direccion: proveedor.direccion ?? "",
    observacion: proveedor.observacion ?? "",
    activo: proveedor.activo,
  };
}

export function CatalogoStockAdminPanel() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [itemsStock, setItemsStock] = useState<ItemStock[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [categoriaNueva, setCategoriaNueva] = useState("");
  const [productoForm, setProductoForm] = useState<ProductoForm>(productoInicial);
  const [comboForm, setComboForm] = useState<ComboForm>(comboInicial);
  const [proveedorForm, setProveedorForm] = useState<ProveedorForm>(proveedorInicial);
  const [compraProveedor, setCompraProveedor] = useState("");
  const [compraProducto, setCompraProducto] = useState("");
  const [compraModo, setCompraModo] = useState<"unidades" | "presentacion">("unidades");
  const [compraCantidad, setCompraCantidad] = useState("");
  const [compraCosto, setCompraCosto] = useState("");
  const [ajusteProducto, setAjusteProducto] = useState("");
  const [ajusteCantidad, setAjusteCantidad] = useState("");
  const [ajusteMotivo, setAjusteMotivo] = useState("");
  const cargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [productosRes, categoriasRes, proveedoresRes, motivosRes, combosRes, itemsStockRes] = await Promise.all([
      supabase.from("productos").select("id,nombre,categoria_id,precio_venta,costo_unitario_actual,codigo_interno,stock_actual,stock_minimo,presentacion_compra,factor_compra,activo").order("nombre"),
      supabase.from("categorias").select("id,nombre").eq("activa", true).order("nombre"),
      supabase.from("proveedores").select("id,nombre,nit,contacto,telefono,correo,direccion,observacion,activo").order("nombre"),
      supabase.from("motivos").select("id,texto").eq("tipo", "ajuste_inventario").eq("activo", true).order("texto"),
      supabase.from("combos").select("id,nombre,precio_venta,activo,combo_items(id,producto_id,cantidad,activo,productos(nombre))").order("nombre"),
      supabase.from("v_catalogo_items_stock").select("*").order("orden_tipo").order("nombre"),
    ]);

    const errores = [productosRes.error, categoriasRes.error, proveedoresRes.error, motivosRes.error, combosRes.error, itemsStockRes.error].filter(Boolean);
    if (errores.length > 0) {
      setMensaje(errores[0]?.message ?? "No se pudo cargar catalogo y stock.");
      return;
    }

    setProductos((productosRes.data ?? []) as Producto[]);
    setCategorias((categoriasRes.data ?? []) as Categoria[]);
    setProveedores((proveedoresRes.data ?? []) as Proveedor[]);
    setMotivos((motivosRes.data ?? []) as Motivo[]);
    setCombos((combosRes.data ?? []) as unknown as Combo[]);
    setItemsStock((itemsStockRes.data ?? []) as ItemStock[]);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const productosActivos = productos.filter((producto) => producto.activo);
  const proveedoresActivos = proveedores.filter((proveedor) => proveedor.activo);

  async function ejecutar(accion: () => any, exito: string) {
    setGuardando(true);
    setMensaje(null);
    const { error } = await accion();
    if (error) setMensaje(error.message);
    else {
      setMensaje(exito);
      await cargar();
    }
    setGuardando(false);
  }

  async function crearCategoria(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(() => supabase.rpc("crear_categoria_catalogo", { p_nombre: categoriaNueva }), "Categoria guardada.");
    setCategoriaNueva("");
  }

  async function guardarProducto(event?: FormEvent<HTMLFormElement>, form = productoForm) {
    event?.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("guardar_producto_catalogo", {
        p_producto_id: form.id,
        p_nombre: form.nombre,
        p_categoria_id: form.categoriaId || null,
        p_precio_venta: Number(form.precio),
        p_costo_unitario: Number(form.costo),
        p_codigo_interno: form.codigo || null,
        p_stock_minimo: Number(form.minimo),
        p_presentacion_compra: form.presentacion,
        p_factor_compra: Number(form.factor),
        p_activo: form.activo,
      }),
      form.activo ? "Producto guardado." : "Producto eliminado del catalogo.",
    );
    setProductoForm(productoInicial);
  }

  function editarProducto(producto: Producto) {
    setProductoForm({
      id: producto.id,
      nombre: producto.nombre,
      categoriaId: producto.categoria_id ?? "",
      precio: String(producto.precio_venta),
      costo: String(producto.costo_unitario_actual),
      codigo: producto.codigo_interno ?? "",
      minimo: String(producto.stock_minimo),
      presentacion: producto.presentacion_compra,
      factor: String(producto.factor_compra),
      activo: producto.activo,
    });
  }

  async function desactivarProducto(producto: Producto) {
    await guardarProducto(undefined, {
      id: producto.id,
      nombre: producto.nombre,
      categoriaId: producto.categoria_id ?? "",
      precio: String(producto.precio_venta),
      costo: String(producto.costo_unitario_actual),
      codigo: producto.codigo_interno ?? "",
      minimo: String(producto.stock_minimo),
      presentacion: producto.presentacion_compra,
      factor: String(producto.factor_compra),
      activo: false,
    });
  }

  async function registrarCompra(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const producto = productos.find((item) => item.id === compraProducto);
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("registrar_compra", {
        p_proveedor_id: compraProveedor,
        p_items: [{
          producto_id: compraProducto,
          modo: compraModo,
          cantidad_ingresada: Number(compraCantidad),
          factor_aplicado: compraModo === "presentacion" ? Number(producto?.factor_compra ?? 1) : 1,
          costo_unitario: Number(compraCosto),
        }],
        p_fecha: new Date().toISOString().slice(0, 10),
        p_observacion: null,
      }),
      "Compra registrada y stock actualizado.",
    );
    setCompraCantidad("");
    setCompraCosto("");
  }
  async function guardarCombo(event?: FormEvent<HTMLFormElement>, form = comboForm) {
    event?.preventDefault();
    const items = [
      form.producto1 ? { producto_id: form.producto1, cantidad: Number(form.cantidad1) } : null,
      form.producto2 ? { producto_id: form.producto2, cantidad: Number(form.cantidad2) } : null,
    ].filter(Boolean);
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("crear_combo_catalogo", {
        p_combo_id: form.id,
        p_nombre: form.nombre,
        p_precio_venta: Number(form.precio),
        p_items: items,
        p_activo: form.activo,
      }),
      form.activo ? "Combo guardado." : "Combo eliminado del catalogo.",
    );
    setComboForm(comboInicial);
  }

  function editarCombo(combo: Combo) {
    const items = comboItems(combo);
    setComboForm({
      id: combo.id,
      nombre: combo.nombre,
      precio: String(combo.precio_venta),
      producto1: items[0]?.producto_id ?? "",
      cantidad1: String(items[0]?.cantidad ?? 1),
      producto2: items[1]?.producto_id ?? "",
      cantidad2: String(items[1]?.cantidad ?? 1),
      activo: combo.activo,
    });
  }

  async function cambiarEstadoCombo(combo: Combo, activo: boolean) {
    const items = comboItems(combo);
    await guardarCombo(undefined, {
      id: combo.id,
      nombre: combo.nombre,
      precio: String(combo.precio_venta),
      producto1: items[0]?.producto_id ?? "",
      cantidad1: String(items[0]?.cantidad ?? 1),
      producto2: items[1]?.producto_id ?? "",
      cantidad2: String(items[1]?.cantidad ?? 1),
      activo,
    });
  }

  async function guardarProveedor(event?: FormEvent<HTMLFormElement>, form = proveedorForm) {
    event?.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("guardar_proveedor_detalle", {
        p_proveedor_id: form.id,
        p_nombre: form.nombre,
        p_nit: form.nit || null,
        p_contacto: form.contacto || null,
        p_telefono: form.telefono || null,
        p_correo: form.correo || null,
        p_direccion: form.direccion || null,
        p_observacion: form.observacion || null,
        p_activo: form.activo,
      }),
      form.activo ? "Proveedor guardado." : "Proveedor eliminado del catalogo.",
    );
    setProveedorForm(proveedorInicial);
  }

  async function cambiarEstadoProveedor(proveedor: Proveedor, activo: boolean) {
    await guardarProveedor(undefined, { ...proveedorAForm(proveedor), activo });
  }

  async function registrarAjuste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("registrar_movimiento_inventario", {
        p_producto_id: ajusteProducto,
        p_tipo: "ajuste",
        p_cantidad: Number(ajusteCantidad),
        p_motivo_id: ajusteMotivo,
        p_observacion: "Ajuste manual desde admin",
      }),
      "Ajuste registrado en kardex.",
    );
    setAjusteCantidad("");
  }

  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-2 border-b border-antiguo/15 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">F3 Inventario</p>
          <h2 className="text-2xl font-black text-crema">Catalogo, compras y stock</h2>
        </div>
        <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Refrescar</button>
      </div>

      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm font-semibold">{mensaje}</p> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Producto</h3>
          <form onSubmit={crearCategoria} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input value={categoriaNueva} onChange={(event) => setCategoriaNueva(event.target.value)} placeholder="Nueva categoria" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <button disabled={guardando || categoriaNueva.length < 2} className="tap-target rounded-md border border-oro/30 px-3 font-bold text-dorado disabled:opacity-50">Crear</button>
          </form>
          <form onSubmit={(event) => guardarProducto(event)} className="mt-4 grid gap-2">
            <input value={productoForm.nombre} onChange={(event) => setProductoForm((actual) => ({ ...actual, nombre: event.target.value }))} placeholder="Nombre" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <select value={productoForm.categoriaId} onChange={(event) => setProductoForm((actual) => ({ ...actual, categoriaId: event.target.value }))} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Categoria</option>
              {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nombre}</option>)}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={productoForm.precio} onChange={(event) => setProductoForm((actual) => ({ ...actual, precio: event.target.value }))} type="number" placeholder="Precio venta" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoForm.costo} onChange={(event) => setProductoForm((actual) => ({ ...actual, costo: event.target.value }))} type="number" placeholder="Costo unidad" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={productoForm.codigo} onChange={(event) => setProductoForm((actual) => ({ ...actual, codigo: event.target.value }))} placeholder="Codigo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoForm.minimo} onChange={(event) => setProductoForm((actual) => ({ ...actual, minimo: event.target.value }))} type="number" placeholder="Stock minimo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={productoForm.presentacion} onChange={(event) => setProductoForm((actual) => ({ ...actual, presentacion: event.target.value }))} placeholder="Presentacion compra" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoForm.factor} onChange={(event) => setProductoForm((actual) => ({ ...actual, factor: event.target.value }))} type="number" min="1" placeholder="Factor" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <label className="flex items-center gap-2 text-sm text-antiguo/80"><input checked={productoForm.activo} onChange={(event) => setProductoForm((actual) => ({ ...actual, activo: event.target.checked }))} type="checkbox" />Activo</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button disabled={guardando || productoForm.nombre.length < 2} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{productoForm.id ? "Actualizar producto" : "Guardar producto"}</button>
              {productoForm.id ? <button type="button" onClick={() => setProductoForm(productoInicial)} className="tap-target rounded-md border border-antiguo/20 px-4 font-bold">Cancelar</button> : null}
            </div>
          </form>
        </section>
        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Compra</h3>
          <form onSubmit={registrarCompra} className="mt-3 grid gap-2">
            <select value={compraProveedor} onChange={(event) => setCompraProveedor(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Proveedor obligatorio</option>
              {proveedoresActivos.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
            </select>
            <select value={compraProducto} onChange={(event) => setCompraProducto(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Producto</option>
              {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
            </select>
            <select value={compraModo} onChange={(event) => setCompraModo(event.target.value as "unidades" | "presentacion")} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="unidades">Unidades</option>
              <option value="presentacion">Presentacion de compra</option>
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={compraCantidad} onChange={(event) => setCompraCantidad(event.target.value)} type="number" min="1" placeholder="Cantidad" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={compraCosto} onChange={(event) => setCompraCosto(event.target.value)} type="number" min="0" placeholder="Costo unitario" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <button disabled={guardando || !compraProveedor || !compraProducto || !compraCantidad} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Registrar compra</button>
          </form>
        </section>

        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Combo y ajuste</h3>
          <form onSubmit={(event) => guardarCombo(event)} className="mt-3 grid gap-2">
            <input value={comboForm.nombre} onChange={(event) => setComboForm((actual) => ({ ...actual, nombre: event.target.value }))} placeholder="Nombre combo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <input value={comboForm.precio} onChange={(event) => setComboForm((actual) => ({ ...actual, precio: event.target.value }))} type="number" placeholder="Precio combo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_84px]">
              <select value={comboForm.producto1} onChange={(event) => setComboForm((actual) => ({ ...actual, producto1: event.target.value }))} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Producto 1</option>
                {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
              </select>
              <input value={comboForm.cantidad1} onChange={(event) => setComboForm((actual) => ({ ...actual, cantidad1: event.target.value }))} type="number" min="1" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_84px]">
              <select value={comboForm.producto2} onChange={(event) => setComboForm((actual) => ({ ...actual, producto2: event.target.value }))} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Producto 2 opcional</option>
                {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
              </select>
              <input value={comboForm.cantidad2} onChange={(event) => setComboForm((actual) => ({ ...actual, cantidad2: event.target.value }))} type="number" min="1" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <label className="flex items-center gap-2 text-sm text-antiguo/80"><input checked={comboForm.activo} onChange={(event) => setComboForm((actual) => ({ ...actual, activo: event.target.checked }))} type="checkbox" />Activo</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button disabled={guardando || !comboForm.nombre || !comboForm.producto1} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">{comboForm.id ? "Actualizar combo" : "Guardar combo"}</button>
              {comboForm.id ? <button type="button" onClick={() => setComboForm(comboInicial)} className="tap-target rounded-md border border-antiguo/20 px-4 font-bold">Cancelar</button> : null}
            </div>
          </form>

          <form onSubmit={registrarAjuste} className="mt-4 grid gap-2 border-t border-antiguo/10 pt-4">
            <select value={ajusteProducto} onChange={(event) => setAjusteProducto(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Producto ajuste</option>
              {productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
            </select>
            <input value={ajusteCantidad} onChange={(event) => setAjusteCantidad(event.target.value)} type="number" placeholder="+/- unidades" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <select value={ajusteMotivo} onChange={(event) => setAjusteMotivo(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Motivo</option>
              {motivos.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.texto}</option>)}
            </select>
            <button disabled={guardando || !ajusteProducto || !ajusteCantidad || !ajusteMotivo} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">Registrar ajuste</button>
          </form>
        </section>
      </div>
      <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
        <h3 className="text-lg font-black text-crema">Items y stock</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="text-antiguo/70">
              <tr className="border-b border-antiguo/15">
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Categoria</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Minimo</th>
                <th className="py-2 pr-3">Precio</th>
                <th className="py-2 pr-3">Costo</th>
                <th className="py-2 pr-3">Componentes/compra</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {itemsStock.map((item) => {
                const producto = item.tipo_item === "producto" ? productos.find((productoItem) => productoItem.id === item.item_id) : null;
                const combo = item.tipo_item === "combo" ? combos.find((comboItem) => comboItem.id === item.item_id) : null;
                return (
                  <tr key={`${item.tipo_item}-${item.item_id}`} className="border-b border-antiguo/10 align-top">
                    <td className="py-3 pr-3 font-bold text-dorado">{item.tipo_item === "producto" ? "Producto" : "Combo"}</td>
                    <td className="py-3 pr-3 font-bold text-crema">{item.nombre}</td>
                    <td className="py-3 pr-3">{item.categoria ?? "-"}</td>
                    <td className={Number(item.stock_disponible ?? 0) <= Number(item.stock_minimo ?? -1) ? "py-3 pr-3 font-black text-dorado" : "py-3 pr-3"}>{item.stock_disponible ?? "-"}</td>
                    <td className="py-3 pr-3">{item.stock_minimo ?? "-"}</td>
                    <td className="py-3 pr-3">{formatoCOP(item.precio_venta)}</td>
                    <td className="py-3 pr-3">{formatoCOP(item.costo_estimado)}</td>
                    <td className="max-w-[300px] py-3 pr-3 text-xs text-antiguo/75">
                      {item.tipo_item === "producto" ? `${item.presentacion_compra ?? "unidad"} x${item.factor_compra ?? 1}` : (item.componentes ?? []).map((componente) => `${componente.cantidad} x ${componente.producto}`).join(", ")}
                    </td>
                    <td className="py-3 pr-3">{item.activo ? "Activo" : "Inactivo"}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-2">
                        {producto ? <button onClick={() => editarProducto(producto)} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">Editar</button> : null}
                        {producto && producto.activo ? <button onClick={() => desactivarProducto(producto)} className="rounded-md border border-red-300/30 px-2 py-1 text-xs font-bold text-red-100">Eliminar</button> : null}
                        {combo ? <button onClick={() => editarCombo(combo)} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">Editar</button> : null}
                        {combo ? <button onClick={() => cambiarEstadoCombo(combo, !combo.activo)} className="rounded-md border border-red-300/30 px-2 py-1 text-xs font-bold text-red-100">{combo.activo ? "Eliminar" : "Reactivar"}</button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
        <h3 className="text-lg font-black text-crema">Proveedores</h3>
        <form onSubmit={(event) => guardarProveedor(event)} className="mt-3 grid gap-2 lg:grid-cols-4">
          <input value={proveedorForm.nombre} onChange={(event) => setProveedorForm((actual) => ({ ...actual, nombre: event.target.value }))} placeholder="Nombre" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.nit} onChange={(event) => setProveedorForm((actual) => ({ ...actual, nit: event.target.value }))} placeholder="NIT/CC" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.contacto} onChange={(event) => setProveedorForm((actual) => ({ ...actual, contacto: event.target.value }))} placeholder="Contacto" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.telefono} onChange={(event) => setProveedorForm((actual) => ({ ...actual, telefono: event.target.value }))} placeholder="Telefono" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.correo} onChange={(event) => setProveedorForm((actual) => ({ ...actual, correo: event.target.value }))} placeholder="Correo" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.direccion} onChange={(event) => setProveedorForm((actual) => ({ ...actual, direccion: event.target.value }))} placeholder="Direccion" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <input value={proveedorForm.observacion} onChange={(event) => setProveedorForm((actual) => ({ ...actual, observacion: event.target.value }))} placeholder="Observacion" className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
          <div className="grid gap-2 sm:grid-cols-2">
            <button disabled={guardando || proveedorForm.nombre.length < 2} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{proveedorForm.id ? "Actualizar" : "Guardar"}</button>
            {proveedorForm.id ? <button type="button" onClick={() => setProveedorForm(proveedorInicial)} className="tap-target rounded-md border border-antiguo/20 px-4 font-bold">Cancelar</button> : null}
          </div>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[940px] text-left text-sm">
            <thead className="text-antiguo/70">
              <tr className="border-b border-antiguo/15">
                <th className="py-2 pr-3">Nombre</th>
                <th className="py-2 pr-3">NIT/CC</th>
                <th className="py-2 pr-3">Contacto</th>
                <th className="py-2 pr-3">Telefono</th>
                <th className="py-2 pr-3">Correo</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((proveedor) => (
                <tr key={proveedor.id} className="border-b border-antiguo/10">
                  <td className="py-3 pr-3 font-bold text-crema">{proveedor.nombre}</td>
                  <td className="py-3 pr-3">{proveedor.nit ?? "-"}</td>
                  <td className="py-3 pr-3">{proveedor.contacto ?? "-"}</td>
                  <td className="py-3 pr-3">{proveedor.telefono ?? "-"}</td>
                  <td className="py-3 pr-3">{proveedor.correo ?? "-"}</td>
                  <td className="py-3 pr-3">{proveedor.activo ? "Activo" : "Inactivo"}</td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setProveedorForm(proveedorAForm(proveedor))} className="rounded-md border border-antiguo/20 px-2 py-1 text-xs font-bold">Editar</button>
                      <button onClick={() => cambiarEstadoProveedor(proveedor, !proveedor.activo)} className="rounded-md border border-red-300/30 px-2 py-1 text-xs font-bold text-red-100">{proveedor.activo ? "Eliminar" : "Reactivar"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
