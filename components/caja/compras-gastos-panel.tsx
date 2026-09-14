"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatoCOP } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";
type ModoCompra = "unidades" | "presentacion";
type VistaModulo = "urgencia" | "inventario";

type Categoria = { id: string; nombre: string };
type Proveedor = { id: string; nombre: string };
type ProductoCompra = {
  id: string;
  nombre: string;
  categoria: string | null;
  precio_venta: number;
  costo_unitario_actual: number;
  stock_actual: number;
  stock_minimo: number;
  presentacion_compra: string | null;
  factor_compra: number | null;
};
type GastoTurno = {
  id: string;
  tipo: "urgencia" | "compra_inventario";
  medio: MedioPago;
  monto: number;
  observacion: string | null;
  numero_factura: string | null;
  timestamp: string;
  categoria: string | null;
  proveedor: string | null;
  usuario: string | null;
};
type DatosComprasGastos = {
  requiere_apertura: boolean;
  categorias_gasto: Categoria[];
  categorias_producto: Categoria[];
  proveedores: Proveedor[];
  productos: ProductoCompra[];
  gastos: GastoTurno[];
};
type LineaCompra = {
  localId: string;
  producto_id: string;
  modo: ModoCompra;
  cantidad_ingresada: number;
  costo_unitario: number;
};

const mediosPago: { id: MedioPago; nombre: string }[] = [
  { id: "efectivo", nombre: "Efectivo" },
  { id: "datafono", nombre: "Datafono" },
  { id: "nequi_daviplata", nombre: "Nequi/Daviplata" },
  { id: "transferencia", nombre: "Transferencia" },
];

const presentacionesCompra = ["Unidad", "50 ml", "200 ml", "350 ml", "375 ml", "700 ml", "750 ml", "1 Lt", "1,5 Lt", "2 Lt"];

const datosIniciales: DatosComprasGastos = {
  requiere_apertura: true,
  categorias_gasto: [],
  categorias_producto: [],
  proveedores: [],
  productos: [],
  gastos: [],
};

function fechaHora(fecha?: string | null) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function nombreMedio(medio: string) {
  return mediosPago.find((item) => item.id === medio)?.nombre ?? medio;
}

function uidLocal() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function etiquetaProducto(producto?: Pick<ProductoCompra, "nombre" | "presentacion_compra"> | null) {
  if (!producto) return "Producto";
  const presentacion = producto.presentacion_compra?.trim();
  return presentacion ? `${producto.nombre} - ${presentacion}` : producto.nombre;
}

export function ComprasGastosPanel() {
  const [datos, setDatos] = useState<DatosComprasGastos>(datosIniciales);
  const [vista, setVista] = useState<VistaModulo>("urgencia");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);

  const [gastoCategoriaId, setGastoCategoriaId] = useState("");
  const [gastoCategoriaNueva, setGastoCategoriaNueva] = useState("");
  const [gastoMonto, setGastoMonto] = useState("");
  const [gastoMedio, setGastoMedio] = useState<MedioPago>("efectivo");
  const [gastoFactura, setGastoFactura] = useState("");
  const [gastoObservacion, setGastoObservacion] = useState("");

  const [proveedorId, setProveedorId] = useState("");
  const [proveedorNuevo, setProveedorNuevo] = useState("");
  const [compraMedio, setCompraMedio] = useState<MedioPago>("efectivo");
  const [compraFactura, setCompraFactura] = useState("");
  const [compraObservacion, setCompraObservacion] = useState("");
  const [productoId, setProductoId] = useState("");
  const [modo, setModo] = useState<ModoCompra>("unidades");
  const [cantidad, setCantidad] = useState("1");
  const [costo, setCosto] = useState("");
  const [lineas, setLineas] = useState<LineaCompra[]>([]);

  const [nuevoProductoNombre, setNuevoProductoNombre] = useState("");
  const [nuevoProductoCategoriaId, setNuevoProductoCategoriaId] = useState("");
  const [nuevoProductoCategoria, setNuevoProductoCategoria] = useState("");
  const [nuevoProductoPrecio, setNuevoProductoPrecio] = useState("");
  const [nuevoProductoCosto, setNuevoProductoCosto] = useState("");
  const [nuevoProductoStockMinimo, setNuevoProductoStockMinimo] = useState("0");
  const [nuevoProductoPresentacion, setNuevoProductoPresentacion] = useState("Unidad");
  const [nuevoProductoFactor, setNuevoProductoFactor] = useState("1");

  const cargar = useCallback(async () => {
    setCargando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("datos_compras_gastos_caja");

    if (error) {
      setMensaje(error.message);
      setDatos(datosIniciales);
    } else {
      setDatos((data as DatosComprasGastos | null) ?? datosIniciales);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const productosPorId = useMemo(() => new Map(datos.productos.map((producto) => [producto.id, producto])), [datos.productos]);
  const productoSeleccionado = productoId ? productosPorId.get(productoId) ?? null : null;

  useEffect(() => {
    if (!productoSeleccionado) return;
    setCosto(String(Number(productoSeleccionado.costo_unitario_actual ?? 0) || ""));
    setModo("unidades");
  }, [productoSeleccionado]);

  const totalCompra = useMemo(() => {
    return lineas.reduce((suma, linea) => {
      const producto = productosPorId.get(linea.producto_id);
      const factor = linea.modo === "presentacion" ? Number(producto?.factor_compra ?? 1) : 1;
      return suma + Number(linea.cantidad_ingresada) * factor * Number(linea.costo_unitario);
    }, 0);
  }, [lineas, productosPorId]);

  async function registrarGastoUrgencia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcesando(true);
    setMensaje(null);

    const supabase = supabaseBrowser();
    const { error } = await supabase.rpc("registrar_gasto_urgencia_caja", {
      p_categoria_id: gastoCategoriaId || null,
      p_categoria_nombre: gastoCategoriaNueva || null,
      p_monto: Number(gastoMonto),
      p_medio: gastoMedio,
      p_observacion: gastoObservacion || null,
      p_numero_factura: gastoFactura || null,
    });

    if (error) setMensaje(error.message);
    else {
      setMensaje("Gasto de urgencia registrado.");
      setGastoCategoriaId("");
      setGastoCategoriaNueva("");
      setGastoMonto("");
      setGastoFactura("");
      setGastoObservacion("");
      await cargar();
    }
    setProcesando(false);
  }

  function agregarLineaCompra() {
    if (!productoId) {
      setMensaje("Selecciona un producto para agregar.");
      return;
    }
    const cantidadNumero = Number(cantidad);
    const costoNumero = Number(costo);
    if (!Number.isFinite(cantidadNumero) || cantidadNumero <= 0 || !Number.isFinite(costoNumero) || costoNumero <= 0) {
      setMensaje("Cantidad y costo deben ser mayores a cero.");
      return;
    }

    setLineas((actual) => [
      ...actual,
      {
        localId: uidLocal(),
        producto_id: productoId,
        modo,
        cantidad_ingresada: cantidadNumero,
        costo_unitario: costoNumero,
      },
    ]);
    setProductoId("");
    setCantidad("1");
    setCosto("");
    setModo("unidades");
    setMensaje(null);
  }

  async function registrarCompraInventario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lineas.length === 0) {
      setMensaje("Agrega al menos un producto a la compra.");
      return;
    }

    setProcesando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("registrar_compra_inventario_caja", {
      p_items: lineas.map(({ producto_id, modo: modoLinea, cantidad_ingresada, costo_unitario }) => ({ producto_id, modo: modoLinea, cantidad_ingresada, costo_unitario })),
      p_medio: compraMedio,
      p_proveedor_id: proveedorId || null,
      p_proveedor_nombre: proveedorNuevo || null,
      p_fecha: new Date().toISOString().slice(0, 10),
      p_observacion: compraObservacion || null,
      p_numero_factura: compraFactura || null,
    });

    if (error) setMensaje(error.message);
    else {
      const resultado = data as { total?: number; items?: number } | null;
      setMensaje(`Compra registrada. Items: ${resultado?.items ?? lineas.length}. Total: ${formatoCOP(resultado?.total ?? totalCompra)}.`);
      setProveedorId("");
      setProveedorNuevo("");
      setCompraFactura("");
      setCompraObservacion("");
      setLineas([]);
      await cargar();
    }
    setProcesando(false);
  }

  async function crearProducto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcesando(true);
    setMensaje(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("crear_producto_desde_caja", {
      p_nombre: nuevoProductoNombre,
      p_categoria_id: nuevoProductoCategoriaId || null,
      p_categoria_nombre: nuevoProductoCategoria || null,
      p_precio_venta: Number(nuevoProductoPrecio || 0),
      p_costo_unitario: Number(nuevoProductoCosto || 0),
      p_codigo_interno: null,
      p_stock_minimo: Number(nuevoProductoStockMinimo || 0),
      p_presentacion_compra: nuevoProductoPresentacion || "Unidad",
      p_factor_compra: Number(nuevoProductoFactor || 1),
    });

    if (error) setMensaje(error.message);
    else {
      const producto = data as ProductoCompra;
      setMensaje(`Producto creado: ${producto.nombre}. Ya puedes agregarlo a la compra.`);
      setNuevoProductoNombre("");
      setNuevoProductoCategoriaId("");
      setNuevoProductoCategoria("");
      setNuevoProductoPrecio("");
      setNuevoProductoCosto("");
      setNuevoProductoStockMinimo("0");
      setNuevoProductoPresentacion("Unidad");
      setNuevoProductoFactor("1");
      await cargar();
      setProductoId(producto.id);
    }
    setProcesando(false);
  }

  if (cargando) return <section className="rounded-lg border border-antiguo/15 bg-espresso p-4 text-sm text-antiguo/70">Cargando compras y gastos...</section>;

  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-3 border-b border-antiguo/15 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-oro">Compras y gastos</p>
          <h2 className="text-2xl font-black text-crema">Salidas e inventario</h2>
          <p className="text-sm text-antiguo/70">Solo las salidas en efectivo descuentan el efectivo esperado.</p>
        </div>
        <button type="button" onClick={cargar} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-4 font-bold">Refrescar</button>
      </div>

      {datos.requiere_apertura ? <p className="rounded-md border border-oro/25 bg-espresso p-3 text-sm font-bold text-dorado">Debes abrir caja antes de registrar compras o gastos.</p> : null}
      {mensaje ? <p className="rounded-md border border-antiguo/15 bg-espresso p-3 text-sm">{mensaje}</p> : null}

      <div className="grid grid-cols-2 rounded-md border border-antiguo/20 bg-carbon p-1 sm:max-w-md">
        <button type="button" onClick={() => setVista("urgencia")} className={vista === "urgencia" ? "tap-target rounded bg-oro px-3 text-sm font-black text-carbon" : "tap-target rounded px-3 text-sm font-bold text-crema"}>Gasto urgente</button>
        <button type="button" onClick={() => setVista("inventario")} className={vista === "inventario" ? "tap-target rounded bg-oro px-3 text-sm font-black text-carbon" : "tap-target rounded px-3 text-sm font-bold text-crema"}>Compra inventario</button>
      </div>

      {vista === "urgencia" ? (
        <form onSubmit={registrarGastoUrgencia} className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
          <h3 className="text-xl font-black text-crema">Registrar gasto urgente</h3>
          <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_150px_180px]">
            <select value={gastoCategoriaId} onChange={(event) => setGastoCategoriaId(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              <option value="">Categoria existente</option>
              {datos.categorias_gasto.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nombre}</option>)}
            </select>
            <input value={gastoCategoriaNueva} onChange={(event) => setGastoCategoriaNueva(event.target.value)} placeholder="Nueva categoria" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
            <input value={gastoMonto} onChange={(event) => setGastoMonto(event.target.value)} type="number" min="0" inputMode="numeric" placeholder="Monto" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
            <select value={gastoMedio} onChange={(event) => setGastoMedio(event.target.value as MedioPago)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
              {mediosPago.map((medioItem) => <option key={medioItem.id} value={medioItem.id}>{medioItem.nombre}</option>)}
            </select>
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-[180px_1fr]">
            <input value={gastoFactura} onChange={(event) => setGastoFactura(event.target.value)} placeholder="Factura opcional" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
            <input value={gastoObservacion} onChange={(event) => setGastoObservacion(event.target.value)} placeholder="Observacion" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
          </div>
          <button disabled={procesando || datos.requiere_apertura || gastoMonto === ""} className="tap-target mt-3 w-full rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{procesando ? "Registrando..." : "Registrar gasto"}</button>
        </form>
      ) : (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <form onSubmit={registrarCompraInventario} className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
            <h3 className="text-xl font-black text-crema">Registrar compra de inventario</h3>
            <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_170px]">
              <select value={proveedorId} onChange={(event) => setProveedorId(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Proveedor existente</option>
                {datos.proveedores.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
              </select>
              <input value={proveedorNuevo} onChange={(event) => setProveedorNuevo(event.target.value)} placeholder="Nuevo proveedor opcional" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
              <select value={compraMedio} onChange={(event) => setCompraMedio(event.target.value as MedioPago)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                {mediosPago.map((medioItem) => <option key={medioItem.id} value={medioItem.id}>{medioItem.nombre}</option>)}
              </select>
            </div>

            <div className="mt-3 rounded-md border border-antiguo/10 bg-carbon p-3">
              <p className="text-sm font-bold text-dorado">Agregar productos</p>
              <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_135px_110px_140px_auto]">
                <select value={productoId} onChange={(event) => setProductoId(event.target.value)} className="tap-target min-w-0 rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                  <option value="">Producto</option>
                  {datos.productos.map((producto) => <option key={producto.id} value={producto.id}>{etiquetaProducto(producto)}</option>)}
                </select>
                <select value={modo} onChange={(event) => setModo(event.target.value as ModoCompra)} className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema">
                  <option value="unidades">Unidades</option>
                  <option value="presentacion">Presentacion</option>
                </select>
                <input value={cantidad} onChange={(event) => setCantidad(event.target.value)} type="number" min="1" inputMode="numeric" placeholder="Cant." className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                <input value={costo} onChange={(event) => setCosto(event.target.value)} type="number" min="0" inputMode="numeric" placeholder="Costo unit." className="tap-target rounded-md border border-antiguo/20 bg-espresso px-3 text-crema" />
                <button type="button" onClick={agregarLineaCompra} className="tap-target rounded-md border border-oro/30 px-4 font-bold text-dorado">Agregar</button>
              </div>
              {productoSeleccionado ? <p className="mt-2 text-xs text-antiguo/60">Stock actual: {productoSeleccionado.stock_actual}. Presentacion: {productoSeleccionado.presentacion_compra ?? "unidad"} x{productoSeleccionado.factor_compra ?? 1}.</p> : null}

              <ul className="mt-3 space-y-2 text-sm">
                {lineas.map((linea) => {
                  const producto = productosPorId.get(linea.producto_id);
                  const factor = linea.modo === "presentacion" ? Number(producto?.factor_compra ?? 1) : 1;
                  const unidades = linea.cantidad_ingresada * factor;
                  const subtotal = unidades * linea.costo_unitario;
                  return (
                    <li key={linea.localId} className="grid gap-2 rounded-md border border-antiguo/10 bg-espresso p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                      <span className="font-bold text-crema">{etiquetaProducto(producto)} - {unidades} unidad(es)</span>
                      <span className="font-black text-dorado">{formatoCOP(subtotal)}</span>
                      <button type="button" onClick={() => setLineas((actual) => actual.filter((item) => item.localId !== linea.localId))} className="rounded-md border border-red-300/30 px-3 py-1 text-xs font-bold text-red-100">Quitar</button>
                    </li>
                  );
                })}
                {lineas.length === 0 ? <li className="rounded-md border border-antiguo/10 bg-espresso p-3 text-center text-antiguo/60">Sin productos agregados.</li> : null}
              </ul>
            </div>

            <div className="mt-3 grid gap-2 lg:grid-cols-[180px_1fr]">
              <input value={compraFactura} onChange={(event) => setCompraFactura(event.target.value)} placeholder="Factura opcional" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
              <input value={compraObservacion} onChange={(event) => setCompraObservacion(event.target.value)} placeholder="Observacion" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-lg font-black text-dorado">Total {formatoCOP(totalCompra)}</p>
              <button disabled={procesando || datos.requiere_apertura || lineas.length === 0} className="tap-target rounded-md bg-oro px-4 font-black text-carbon disabled:opacity-50">{procesando ? "Registrando..." : "Registrar compra"}</button>
            </div>
          </form>

          <form onSubmit={crearProducto} className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
            <h3 className="text-xl font-black text-crema">Crear producto</h3>
            <div className="mt-3 grid gap-2">
              <input value={nuevoProductoNombre} onChange={(event) => setNuevoProductoNombre(event.target.value)} placeholder="Nombre del producto" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
              <select value={nuevoProductoCategoriaId} onChange={(event) => setNuevoProductoCategoriaId(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                <option value="">Categoria existente</option>
                {datos.categorias_producto.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nombre}</option>)}
              </select>
              <input value={nuevoProductoCategoria} onChange={(event) => setNuevoProductoCategoria(event.target.value)} placeholder="Nueva categoria opcional" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={nuevoProductoPrecio} onChange={(event) => setNuevoProductoPrecio(event.target.value)} type="number" min="0" placeholder="Precio venta" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                <input value={nuevoProductoCosto} onChange={(event) => setNuevoProductoCosto(event.target.value)} type="number" min="0" placeholder="Costo base" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input value={nuevoProductoStockMinimo} onChange={(event) => setNuevoProductoStockMinimo(event.target.value)} type="number" min="0" placeholder="Minimo" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
                <select value={nuevoProductoPresentacion} onChange={(event) => setNuevoProductoPresentacion(event.target.value)} className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema">
                  {nuevoProductoPresentacion && !presentacionesCompra.includes(nuevoProductoPresentacion) ? <option value={nuevoProductoPresentacion}>{nuevoProductoPresentacion}</option> : null}
                  {presentacionesCompra.map((presentacion) => <option key={presentacion} value={presentacion}>{presentacion}</option>)}
                </select>
                <input value={nuevoProductoFactor} onChange={(event) => setNuevoProductoFactor(event.target.value)} type="number" min="1" placeholder="Factor" className="tap-target rounded-md border border-antiguo/20 bg-carbon px-3 text-crema placeholder:text-antiguo/50" />
              </div>
            </div>
            <button disabled={procesando || nuevoProductoNombre.trim().length < 2} className="tap-target mt-3 w-full rounded-md border border-oro/30 px-4 font-bold text-dorado disabled:opacity-50">{procesando ? "Creando..." : "Crear producto"}</button>
          </form>
        </section>
      )}

      <section className="rounded-lg border border-antiguo/15 bg-espresso p-3 shadow-suave sm:p-4">
        <div className="flex flex-col gap-1 border-b border-antiguo/10 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xl font-black text-crema">Movimientos del turno</h3>
          <p className="text-sm font-bold text-antiguo/60">{datos.gastos.length} registro(s)</p>
        </div>
        <div className="mt-3 grid gap-2">
          {datos.gastos.map((gasto) => (
            <article key={gasto.id} className="grid gap-2 rounded-md border border-antiguo/10 bg-carbon p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <div>
                <p className="text-sm font-black text-crema">{gasto.tipo === "compra_inventario" ? "Compra inventario" : "Gasto urgente"} - {nombreMedio(gasto.medio)}</p>
                <p className="text-xs text-antiguo/60">{fechaHora(gasto.timestamp)} {gasto.usuario ? `- ${gasto.usuario}` : ""}</p>
                <p className="text-sm text-antiguo/80">{gasto.categoria ?? gasto.proveedor ?? gasto.observacion ?? "Movimiento"}</p>
                {gasto.numero_factura ? <p className="text-xs text-antiguo/55">Factura: {gasto.numero_factura}</p> : null}
              </div>
              <p className="text-xl font-black text-dorado">{formatoCOP(gasto.monto)}</p>
            </article>
          ))}
          {datos.gastos.length === 0 ? <p className="rounded-md border border-antiguo/10 bg-carbon p-4 text-center text-sm text-antiguo/70">Sin compras ni gastos registrados en este turno.</p> : null}
        </div>
      </section>
    </section>
  );
}
