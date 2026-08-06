"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Categoria = { id: string; nombre: string };
type Producto = {
  id: string;
  nombre: string;
  precio_venta: number;
  codigo_interno: string | null;
  stock_actual: number;
  stock_minimo: number;
  presentacion_compra: string;
  factor_compra: number;
  activo: boolean;
  categorias?: { nombre: string } | { nombre: string }[] | null;
};
type Proveedor = { id: string; nombre: string };
type Motivo = { id: string; texto: string };
type Combo = { id: string; nombre: string; precio_venta: number; activo: boolean; combo_items?: any[] };
type Auditoria = { id: string; estado: string; created_at: string; auditoria_items?: any[] };

function categoriaProducto(producto: Producto) {
  const categoria = Array.isArray(producto.categorias) ? producto.categorias[0] : producto.categorias;
  return categoria?.nombre ?? "Sin categoria";
}

export function InventarioAdminPanel({ vista = "todo" }: { vista?: "catalogo" | "auditoria" | "todo" }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [alertas, setAlertas] = useState<any[]>([]);
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [auditorias, setAuditorias] = useState<Auditoria[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [categoriaNueva, setCategoriaNueva] = useState("");
  const [productoNombre, setProductoNombre] = useState("");
  const [productoCategoria, setProductoCategoria] = useState("");
  const [productoPrecio, setProductoPrecio] = useState("");
  const [productoCosto, setProductoCosto] = useState("");
  const [productoCodigo, setProductoCodigo] = useState("");
  const [productoMinimo, setProductoMinimo] = useState("0");
  const [productoPresentacion, setProductoPresentacion] = useState("unidad");
  const [productoFactor, setProductoFactor] = useState("1");

  const [proveedorNombre, setProveedorNombre] = useState("");
  const [compraProveedor, setCompraProveedor] = useState("");
  const [compraProducto, setCompraProducto] = useState("");
  const [compraModo, setCompraModo] = useState<"unidades" | "presentacion">("unidades");
  const [compraCantidad, setCompraCantidad] = useState("");
  const [compraCosto, setCompraCosto] = useState("");

  const [comboNombre, setComboNombre] = useState("");
  const [comboPrecio, setComboPrecio] = useState("");
  const [comboProducto1, setComboProducto1] = useState("");
  const [comboCantidad1, setComboCantidad1] = useState("1");
  const [comboProducto2, setComboProducto2] = useState("");
  const [comboCantidad2, setComboCantidad2] = useState("1");

  const [ajusteProducto, setAjusteProducto] = useState("");
  const [ajusteCantidad, setAjusteCantidad] = useState("");
  const [ajusteMotivo, setAjusteMotivo] = useState("");
  const [conteos, setConteos] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [
      productosRes,
      categoriasRes,
      proveedoresRes,
      motivosRes,
      combosRes,
      alertasRes,
      candidatosRes,
      auditoriasRes,
    ] = await Promise.all([
      supabase.from("productos").select("id,nombre,precio_venta,codigo_interno,stock_actual,stock_minimo,presentacion_compra,factor_compra,activo,categorias(nombre)").order("nombre"),
      supabase.from("categorias").select("id,nombre").eq("activa", true).order("nombre"),
      supabase.from("proveedores").select("id,nombre").eq("activo", true).order("nombre"),
      supabase.from("motivos").select("id,texto").eq("tipo", "ajuste_inventario").eq("activo", true).order("texto"),
      supabase.from("combos").select("id,nombre,precio_venta,activo,combo_items(id,cantidad,activo,productos(nombre))").order("nombre"),
      supabase.from("v_alertas_stock_bajo").select("*").limit(10),
      supabase.from("v_candidatos_auditoria").select("*").limit(8),
      supabase.from("auditorias_inventario").select("id,estado,created_at,auditoria_items(id,producto_id,teorico,contado,diferencia,productos(nombre))").order("created_at", { ascending: false }).limit(3),
    ]);

    const errores = [productosRes.error, categoriasRes.error, proveedoresRes.error, motivosRes.error, combosRes.error, alertasRes.error, candidatosRes.error, auditoriasRes.error].filter(Boolean);
    if (errores.length > 0) {
      setMensaje(errores[0]?.message ?? "No se pudo cargar inventario.");
      return;
    }

    setProductos((productosRes.data ?? []) as unknown as Producto[]);
    setCategorias((categoriasRes.data ?? []) as Categoria[]);
    setProveedores((proveedoresRes.data ?? []) as Proveedor[]);
    setMotivos((motivosRes.data ?? []) as Motivo[]);
    setCombos((combosRes.data ?? []) as Combo[]);
    setAlertas(alertasRes.data ?? []);
    setCandidatos(candidatosRes.data ?? []);
    setAuditorias((auditoriasRes.data ?? []) as Auditoria[]);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const auditoriaActiva = useMemo(() => auditorias.find((auditoria) => auditoria.estado === "en_curso"), [auditorias]);
  const mostrarCatalogo = vista === "todo" || vista === "catalogo";
  const mostrarAuditoria = vista === "todo" || vista === "auditoria";

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

  async function guardarProducto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("guardar_producto_catalogo", {
        p_producto_id: null,
        p_nombre: productoNombre,
        p_categoria_id: productoCategoria || null,
        p_precio_venta: Number(productoPrecio),
        p_costo_unitario: Number(productoCosto),
        p_codigo_interno: productoCodigo || null,
        p_stock_minimo: Number(productoMinimo),
        p_presentacion_compra: productoPresentacion,
        p_factor_compra: Number(productoFactor),
        p_activo: true,
      }),
      "Producto guardado. Registra compra o ajuste para cargar stock.",
    );
    setProductoNombre("");
    setProductoPrecio("");
    setProductoCosto("");
    setProductoCodigo("");
  }

  async function guardarProveedor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = supabaseBrowser();
    await ejecutar(() => supabase.rpc("guardar_proveedor", { p_proveedor_id: null, p_nombre: proveedorNombre, p_nit: null, p_contacto: null, p_activo: true }), "Proveedor guardado.");
    setProveedorNombre("");
  }

  async function registrarCompra(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const producto = productos.find((item) => item.id === compraProducto);
    const supabase = supabaseBrowser();
    await ejecutar(
      () => supabase.rpc("registrar_compra", {
        p_proveedor_id: compraProveedor || null,
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

  async function crearCombo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = [
      comboProducto1 ? { producto_id: comboProducto1, cantidad: Number(comboCantidad1) } : null,
      comboProducto2 ? { producto_id: comboProducto2, cantidad: Number(comboCantidad2) } : null,
    ].filter(Boolean);
    const supabase = supabaseBrowser();
    await ejecutar(() => supabase.rpc("crear_combo_catalogo", { p_combo_id: null, p_nombre: comboNombre, p_precio_venta: Number(comboPrecio), p_items: items, p_activo: true }), "Combo guardado.");
    setComboNombre("");
    setComboPrecio("");
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

  async function crearAuditoriaSugerida() {
    const ids = candidatos.slice(0, 5).map((item) => item.id);
    const supabase = supabaseBrowser();
    await ejecutar(() => supabase.rpc("crear_auditoria_inventario", { p_producto_ids: ids, p_observacion: "Auditoria corta sugerida" }), "Auditoria creada con candidatos sugeridos.");
  }

  async function guardarConteos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auditoriaActiva) return;
    const items = (auditoriaActiva.auditoria_items ?? []).map((item) => ({ producto_id: item.producto_id, contado: Number(conteos[item.producto_id] ?? item.contado ?? item.teorico) }));
    const supabase = supabaseBrowser();
    await ejecutar(() => supabase.rpc("registrar_conteo_auditoria", { p_auditoria_id: auditoriaActiva.id, p_items: items }), "Conteos guardados.");
  }

  async function cerrarAuditoria() {
    if (!auditoriaActiva) return;
    const motivo = ajusteMotivo || motivos[0]?.id;
    const resoluciones = (auditoriaActiva.auditoria_items ?? [])
      .filter((item) => Number(item.diferencia ?? 0) !== 0)
      .map((item) => ({ producto_id: item.producto_id, tipo: "ajuste", motivo_id: motivo }));
    const supabase = supabaseBrowser();
    await ejecutar(() => supabase.rpc("cerrar_auditoria_inventario", { p_auditoria_id: auditoriaActiva.id, p_resoluciones: resoluciones }), "Auditoria cerrada y diferencias ajustadas.");
  }

  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-2 border-b border-antiguo/15 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">F3 Inventario</p>
          <h2 className="text-2xl font-black text-crema">{vista === "auditoria" ? "Auditoria de inventario" : "Catalogo, compras y stock"}</h2>
        </div>
        <button onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Refrescar</button>
      </div>

      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm font-semibold">{mensaje}</p> : null}

      {mostrarCatalogo ? (
        <>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Producto</h3>
          <form onSubmit={crearCategoria} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input value={categoriaNueva} onChange={(event) => setCategoriaNueva(event.target.value)} placeholder="Nueva categoria" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <button disabled={guardando || categoriaNueva.length < 2} className="tap-target rounded-md border border-oro/30 px-3 font-bold text-dorado disabled:opacity-50">Crear</button>
          </form>
          <form onSubmit={guardarProducto} className="mt-4 grid gap-2">
            <input value={productoNombre} onChange={(event) => setProductoNombre(event.target.value)} placeholder="Nombre" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <select value={productoCategoria} onChange={(event) => setProductoCategoria(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Categoria</option>
              {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nombre}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input value={productoPrecio} onChange={(event) => setProductoPrecio(event.target.value)} type="number" placeholder="Precio venta" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoCosto} onChange={(event) => setProductoCosto(event.target.value)} type="number" placeholder="Costo unidad" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={productoCodigo} onChange={(event) => setProductoCodigo(event.target.value)} placeholder="Codigo" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoMinimo} onChange={(event) => setProductoMinimo(event.target.value)} type="number" placeholder="Stock minimo" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={productoPresentacion} onChange={(event) => setProductoPresentacion(event.target.value)} placeholder="Presentacion compra" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={productoFactor} onChange={(event) => setProductoFactor(event.target.value)} type="number" min="1" placeholder="Factor" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <button disabled={guardando || productoNombre.length < 2} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Guardar producto</button>
          </form>
        </section>

        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Compra</h3>
          <form onSubmit={guardarProveedor} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input value={proveedorNombre} onChange={(event) => setProveedorNombre(event.target.value)} placeholder="Nuevo proveedor" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <button disabled={guardando || proveedorNombre.length < 2} className="tap-target rounded-md border border-oro/30 px-3 font-bold text-dorado disabled:opacity-50">Crear</button>
          </form>
          <form onSubmit={registrarCompra} className="mt-4 grid gap-2">
            <select value={compraProveedor} onChange={(event) => setCompraProveedor(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Proveedor opcional</option>
              {proveedores.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
            </select>
            <select value={compraProducto} onChange={(event) => setCompraProducto(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Producto</option>
              {productos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
            </select>
            <select value={compraModo} onChange={(event) => setCompraModo(event.target.value as "unidades" | "presentacion")} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="unidades">Unidades</option>
              <option value="presentacion">Presentacion de compra</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input value={compraCantidad} onChange={(event) => setCompraCantidad(event.target.value)} type="number" min="1" placeholder="Cantidad" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <input value={compraCosto} onChange={(event) => setCompraCosto(event.target.value)} type="number" min="0" placeholder="Costo unitario" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <button disabled={guardando || !compraProducto || !compraCantidad} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Registrar compra</button>
          </form>
        </section>

        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Combo y ajuste</h3>
          <form onSubmit={crearCombo} className="mt-3 grid gap-2">
            <input value={comboNombre} onChange={(event) => setComboNombre(event.target.value)} placeholder="Nombre combo" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <input value={comboPrecio} onChange={(event) => setComboPrecio(event.target.value)} type="number" placeholder="Precio combo" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            <div className="grid grid-cols-[1fr_72px] gap-2">
              <select value={comboProducto1} onChange={(event) => setComboProducto1(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Producto 1</option>
                {productos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
              </select>
              <input value={comboCantidad1} onChange={(event) => setComboCantidad1(event.target.value)} type="number" min="1" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <div className="grid grid-cols-[1fr_72px] gap-2">
              <select value={comboProducto2} onChange={(event) => setComboProducto2(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Producto 2 opcional</option>
                {productos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
              </select>
              <input value={comboCantidad2} onChange={(event) => setComboCantidad2(event.target.value)} type="number" min="1" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
            </div>
            <button disabled={guardando || !comboNombre || !comboProducto1} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">Guardar combo</button>
          </form>

          <form onSubmit={registrarAjuste} className="mt-4 grid gap-2 border-t border-antiguo/10 pt-4">
            <select value={ajusteProducto} onChange={(event) => setAjusteProducto(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Producto ajuste</option>
              {productos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input value={ajusteCantidad} onChange={(event) => setAjusteCantidad(event.target.value)} type="number" placeholder="+/- unidades" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema" />
              <select value={ajusteMotivo} onChange={(event) => setAjusteMotivo(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Motivo</option>
                {motivos.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.texto}</option>)}
              </select>
            </div>
            <button disabled={guardando || !ajusteProducto || !ajusteCantidad || !ajusteMotivo} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">Registrar ajuste</button>
          </form>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Stock</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-antiguo/70">
                <tr className="border-b border-antiguo/15">
                  <th className="py-2 pr-3">Producto</th>
                  <th className="py-2 pr-3">Categoria</th>
                  <th className="py-2 pr-3">Stock</th>
                  <th className="py-2 pr-3">Minimo</th>
                  <th className="py-2 pr-3">Precio</th>
                  <th className="py-2 pr-3">Compra</th>
                </tr>
              </thead>
              <tbody>
                {productos.map((producto) => (
                  <tr key={producto.id} className="border-b border-antiguo/10">
                    <td className="py-3 pr-3 font-bold text-crema">{producto.nombre}</td>
                    <td className="py-3 pr-3">{categoriaProducto(producto)}</td>
                    <td className={producto.stock_actual <= producto.stock_minimo ? "py-3 pr-3 font-black text-dorado" : "py-3 pr-3"}>{producto.stock_actual}</td>
                    <td className="py-3 pr-3">{producto.stock_minimo}</td>
                    <td className="py-3 pr-3">{formatoCOP(producto.precio_venta)}</td>
                    <td className="py-3 pr-3">{producto.presentacion_compra} x{producto.factor_compra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
          <h3 className="text-lg font-black text-crema">Alertas y combos</h3>
          <div className="mt-3 space-y-2">
            {alertas.map((alerta) => (
              <div key={alerta.id} className="rounded-md border border-oro/20 bg-carbon p-3 text-sm">
                <p className="font-bold text-dorado">{alerta.nombre}</p>
                <p className="text-antiguo/70">Stock {alerta.stock_actual} / minimo {alerta.stock_minimo}</p>
              </div>
            ))}
            {alertas.length === 0 ? <p className="text-sm text-antiguo/60">Sin alertas de stock bajo.</p> : null}
          </div>
          <div className="mt-4 space-y-2 border-t border-antiguo/10 pt-4">
            {combos.map((combo) => (
              <div key={combo.id} className="rounded-md border border-antiguo/10 bg-carbon p-3 text-sm">
                <p className="font-bold text-crema">{combo.nombre} - {formatoCOP(combo.precio_venta)}</p>
                <p className="text-antiguo/70">{(combo.combo_items ?? []).filter((item) => item.activo).map((item) => `${item.cantidad} x ${item.productos?.nombre}`).join(", ")}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
        </>
      ) : null}

      {mostrarAuditoria ? (
      <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 shadow-suave">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-crema">Auditoria corta</h3>
            <p className="text-sm text-antiguo/70">Candidatos sugeridos por valor y rotacion.</p>
          </div>
          <button onClick={crearAuditoriaSugerida} disabled={guardando || Boolean(auditoriaActiva) || candidatos.length === 0} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Crear auditoria sugerida</button>
        </div>

        {auditoriaActiva ? (
          <form onSubmit={guardarConteos} className="mt-4 grid gap-3">
            {(auditoriaActiva.auditoria_items ?? []).map((item) => (
              <label key={item.id} className="grid gap-2 rounded-md border border-antiguo/10 bg-carbon p-3 text-sm sm:grid-cols-[1fr_120px] sm:items-center">
                <span><strong className="text-crema">{item.productos?.nombre}</strong> - teorico {item.teorico} - diferencia {item.diferencia ?? "-"}</span>
                <input value={conteos[item.producto_id] ?? item.contado ?? ""} onChange={(event) => setConteos((actual) => ({ ...actual, [item.producto_id]: event.target.value }))} type="number" min="0" placeholder="Contado" className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
              </label>
            ))}
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <select value={ajusteMotivo} onChange={(event) => setAjusteMotivo(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Motivo de ajuste</option>
                {motivos.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.texto}</option>)}
              </select>
              <button disabled={guardando} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">Guardar conteos</button>
              <button type="button" onClick={cerrarAuditoria} disabled={guardando || motivos.length === 0} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">Cerrar auditoria</button>
            </div>
          </form>
        ) : (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {candidatos.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-md border border-antiguo/10 bg-carbon p-3 text-sm">
                <p className="font-bold text-crema">{item.nombre}</p>
                <p className="text-antiguo/70">Stock {item.stock_actual} - valor {formatoCOP(item.valor_inventario)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      ) : null}
    </section>
  );
}
