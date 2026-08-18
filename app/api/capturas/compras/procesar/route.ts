import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import type { Perfil } from "@/lib/roles";
import { supabaseConToken, supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

const BUCKET = "capturas-compras";
const DEFAULT_MODEL = "gpt-5";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIME_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

type ModoCompra = "unidades" | "presentacion";

type CatalogoProducto = {
  id: string;
  nombre: string;
  precio_venta: number;
  costo_unitario_actual: number;
  codigo_interno: string | null;
  categoria: string | null;
  presentacion_compra: string;
  factor_compra: number;
  stock_actual: number;
  normalizado: string;
};

type AliasProducto = {
  tipo: "producto" | "combo" | "medio_pago" | "cuenta_pago";
  alias: string;
  alias_normalizado: string;
  producto_id: string | null;
};

type CompraItemIA = {
  texto_original: string;
  producto_detectado: string;
  cantidad: number;
  presentacion_detectada: string;
  modo_sugerido: ModoCompra;
  confianza: number;
};

type ResultadoCompraIA = {
  proveedor_detectado: string;
  numero_factura: string;
  items: CompraItemIA[];
  total_detectado: number | null;
  observaciones: string[];
};

type LineaPreparada = {
  captura_id: string;
  orden: number;
  texto_original: string | null;
  producto_nombre_detectado: string | null;
  producto_id: string | null;
  modo: ModoCompra;
  cantidad_ingresada: number;
  factor_aplicado: number;
  unidades_resultantes: number;
  costo_unitario_catalogo: number;
  precio_venta_catalogo: number;
  subtotal_costo: number;
  stock_actual_snapshot: number | null;
  stock_proyectado: number | null;
  confianza_ia: number;
  puntaje_match: number;
  requiere_revision: boolean;
  precio_catalogo_confirmado: boolean;
  estado: "borrador" | "requiere_revision" | "lista";
  observacion: string | null;
};

const compraSchema = {
  type: "object",
  additionalProperties: false,
  required: ["proveedor_detectado", "numero_factura", "items", "total_detectado", "observaciones"],
  properties: {
    proveedor_detectado: { type: "string" },
    numero_factura: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["texto_original", "producto_detectado", "cantidad", "presentacion_detectada", "modo_sugerido", "confianza"],
        properties: {
          texto_original: { type: "string" },
          producto_detectado: { type: "string" },
          cantidad: { type: "number" },
          presentacion_detectada: { type: "string" },
          modo_sugerido: { type: "string", enum: ["unidades", "presentacion"] },
          confianza: { type: "number" },
        },
      },
    },
    total_detectado: { type: ["number", "null"] },
    observaciones: { type: "array", items: { type: "string" } },
  },
};

function jsonError(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

function fechaValida(fecha: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(new Date(`${fecha}T12:00:00`).getTime());
}

function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(texto: string) {
  return new Set(normalizar(texto).split(/\s+/).filter((token) => token.length >= 2));
}

function redondear(valor: number) {
  if (!Number.isFinite(valor)) return 0;
  return Math.max(0, Math.round(valor));
}

function limitarConfianza(valor: number) {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

function extraerTextoRespuesta(respuesta: unknown) {
  const directa = (respuesta as { output_text?: unknown }).output_text;
  if (typeof directa === "string") return directa;

  const partes: string[] = [];
  const output = (respuesta as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const bloque of content) {
        const texto = (bloque as { text?: unknown }).text;
        if (typeof texto === "string") partes.push(texto);
      }
    }
  }
  return partes.join("\n");
}

async function contextoAdmin(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: jsonError("Sesion requerida", 401) } as const;

  const userClient = supabaseConToken(token);
  const service = supabaseService();
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return { error: jsonError("Sesion invalida", 401) } as const;

  const { data: perfil, error: perfilError } = await service
    .from("perfiles")
    .select("id, auth_user_id, nombre, usuario_login, rol, activo, created_at")
    .eq("auth_user_id", userData.user.id)
    .eq("activo", true)
    .single<Perfil>();

  if (perfilError || !perfil || perfil.rol !== "admin") {
    return { error: jsonError("Solo administrador", 403) } as const;
  }

  return { service, perfil } as const;
}

async function cargarContexto(service: ReturnType<typeof supabaseService>) {
  const [{ data: productos, error: productosError }, { data: aliasData }] = await Promise.all([
    service
      .from("productos")
      .select("id,nombre,precio_venta,costo_unitario_actual,codigo_interno,presentacion_compra,factor_compra,stock_actual,categorias(nombre)")
      .eq("activo", true)
      .order("nombre"),
    service
      .from("alias_operativos")
      .select("tipo,alias,alias_normalizado,producto_id")
      .eq("activo", true)
      .eq("tipo", "producto"),
  ]);

  if (productosError) throw new Error(productosError.message);

  const catalogo = ((productos ?? []) as any[]).map((producto) => {
    const categoria = Array.isArray(producto.categorias) ? producto.categorias[0] : producto.categorias;
    const presentacion = producto.presentacion_compra ?? "unidad";
    return {
      id: producto.id,
      nombre: producto.nombre,
      precio_venta: Number(producto.precio_venta ?? 0),
      costo_unitario_actual: Number(producto.costo_unitario_actual ?? 0),
      codigo_interno: producto.codigo_interno ?? null,
      categoria: categoria?.nombre ?? null,
      presentacion_compra: presentacion,
      factor_compra: Math.max(1, Math.round(Number(producto.factor_compra ?? 1))),
      stock_actual: Math.max(0, Math.round(Number(producto.stock_actual ?? 0))),
      normalizado: normalizar([producto.nombre, presentacion, producto.codigo_interno, categoria?.nombre].filter(Boolean).join(" ")),
    } satisfies CatalogoProducto;
  });

  return {
    catalogo,
    alias: ((aliasData ?? []) as AliasProducto[]),
  };
}

function puntuarMatch(entrada: string, item: CatalogoProducto) {
  const consulta = normalizar(entrada);
  if (!consulta) return 0;
  if (consulta === item.normalizado) return 1;
  if (item.codigo_interno && normalizar(item.codigo_interno) === consulta) return 1;
  if (item.normalizado.includes(consulta) || consulta.includes(item.normalizado)) return 0.86;

  const consultaTokens = tokens(consulta);
  const itemTokens = tokens(item.normalizado);
  if (consultaTokens.size === 0 || itemTokens.size === 0) return 0;

  let comunes = 0;
  consultaTokens.forEach((token) => {
    if (itemTokens.has(token)) comunes += 1;
  });

  const coberturaConsulta = comunes / consultaTokens.size;
  const coberturaItem = comunes / itemTokens.size;
  return Math.min(0.84, coberturaConsulta * 0.58 + coberturaItem * 0.42);
}

function buscarAliasProducto(entrada: string, catalogo: CatalogoProducto[], alias: AliasProducto[]) {
  const normal = normalizar(entrada);
  const encontrado = alias.find((item) => item.tipo === "producto" && item.alias_normalizado === normal);
  if (!encontrado?.producto_id) return null;
  const item = catalogo.find((producto) => producto.id === encontrado.producto_id);
  return item ? { item, puntaje: 1 } : null;
}

function buscarMatch(entrada: string, catalogo: CatalogoProducto[], alias: AliasProducto[]) {
  const aliasMatch = buscarAliasProducto(entrada, catalogo, alias);
  if (aliasMatch) return aliasMatch;

  let mejor: { item: CatalogoProducto; puntaje: number } | null = null;
  for (const item of catalogo) {
    const puntaje = puntuarMatch(entrada, item);
    if (!mejor || puntaje > mejor.puntaje) mejor = { item, puntaje };
  }

  if (!mejor || mejor.puntaje < 0.42) return { item: null, puntaje: 0 };
  return mejor;
}

function crearPrompt(catalogo: CatalogoProducto[], proveedorNombre: string) {
  const productosTexto = catalogo
    .map((item) => `- ${item.nombre} | presentacion ${item.presentacion_compra} | factor ${item.factor_compra} | codigo ${item.codigo_interno ?? "sin codigo"} | categoria ${item.categoria ?? "sin categoria"}`)
    .join("\n");

  return `Lee una foto real de una factura, recibo POS, remision o pedido recibido para entrada de inventario de Mala Junta.

Proveedor esperado seleccionado por el admin: ${proveedorNombre}

Objetivo:
- Extrae solo los productos comprados y sus cantidades.
- No inventes costos ni precios: esos valores salen de la base de datos, no de la factura.
- Si ves valores monetarios, puedes usarlos solo para total_detectado u observaciones.
- Esta captura es de inventario comprado. No la trates como venta al cliente, pedido de mesa, pago de caja ni cierre de caja.

Reglas criticas:
- Devuelve solo el JSON solicitado.
- Cada renglon de producto debe ser un item independiente.
- producto_detectado debe ser el nombre leido o la mejor descripcion visible.
- cantidad debe ser la cantidad comprada del renglon, tomada de columnas como Cant, Cantidad, C, CJ, UN, U, Cajas, Unidades o de texto cercano al producto.
- modo_sugerido debe ser "presentacion" si el renglon habla de caja, paquete, paca, canasta, display, six pack, docena, botella/caja, caja x24, lata x6, cj, cajas u otra presentacion de compra completa.
- modo_sugerido debe ser "unidades" si el renglon habla de unidades sueltas.
- Si no estas seguro del modo, usa "unidades" y baja la confianza.
- presentacion_detectada debe conservar el texto de presentacion visible, o "" si no aparece.
- Conserva el texto original de cada renglon.
- Las fotos pueden estar rotadas, inclinadas, cortadas o ser recibos largos; lee la tabla aunque el documento este de lado.
- Ignora NIT, datos del cliente, forma de pago, efectivo, cambio, domicilio, impuestos, IVA, INC, subtotal, QR, CUFE, codigo de barras, resoluciones DIAN, texto legal y totales que no sean productos.
- En facturas con columnas Cant / Descripcion / Precio unitario / IVA / Total, solo extrae filas de productos.
- En recibos termicos, no confundas "Valor a pagar", "Total", "Efectivo", "Cambio" o "Forma de pago" con productos.
- Si una linea describe un producto y abajo aparece su cantidad/precio, combina esa informacion en un solo item.

Productos activos de la base de datos:
${productosTexto}`;
}

async function procesarConOpenAI(file: File, catalogo: CatalogoProducto[], proveedorNombre: string, bytes: ArrayBuffer) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY en el servidor.");

  const modelo = process.env.OPENAI_VISION_MODEL ?? DEFAULT_MODEL;
  const dataUrl = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;

  const respuesta = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelo,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: crearPrompt(catalogo, proveedorNombre) },
            { type: "input_image", image_url: dataUrl, detail: "high" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "captura_compra",
          strict: true,
          schema: compraSchema,
        },
      },
    }),
  });

  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const detalle = cuerpo?.error?.message ?? `OpenAI respondio ${respuesta.status}`;
    throw new Error(detalle);
  }

  const texto = extraerTextoRespuesta(cuerpo);
  if (!texto) throw new Error("OpenAI no devolvio texto estructurado.");

  return { modelo, resultado: JSON.parse(texto) as ResultadoCompraIA, respuesta: cuerpo };
}

function modoCompra(itemIA: CompraItemIA, producto: CatalogoProducto | null): ModoCompra {
  if (!producto) return "unidades";
  const presentacionDetectada = normalizar(itemIA.presentacion_detectada ?? "");
  const presentacionCatalogo = normalizar(producto.presentacion_compra ?? "");
  if (itemIA.modo_sugerido === "presentacion") return "presentacion";
  if (presentacionDetectada && presentacionCatalogo && (presentacionDetectada.includes(presentacionCatalogo) || presentacionCatalogo.includes(presentacionDetectada))) {
    return "presentacion";
  }
  return "unidades";
}

function prepararLineas(capturaId: string, resultado: ResultadoCompraIA, catalogo: CatalogoProducto[], alias: AliasProducto[]) {
  return (resultado.items ?? []).map((itemIA, index) => {
    const cantidad = Math.max(1, Math.round(Number(itemIA.cantidad ?? 1)));
    const entrada = [itemIA.producto_detectado, itemIA.texto_original, itemIA.presentacion_detectada].filter(Boolean).join(" ");
    const match = buscarMatch(entrada, catalogo, alias);
    const producto = match.item;
    const modo = modoCompra(itemIA, producto);
    const factor = producto && modo === "presentacion" ? producto.factor_compra : 1;
    const unidades = cantidad * factor;
    const costo = producto ? redondear(producto.costo_unitario_actual) : 0;
    const precio = producto ? redondear(producto.precio_venta) : 0;
    const stockActual = producto ? producto.stock_actual : null;
    const stockProyectado = stockActual === null ? null : stockActual + unidades;
    const confianza = limitarConfianza(Number(itemIA.confianza ?? 0));
    const puntaje = limitarConfianza(match.puntaje);

    const problemas: string[] = [];
    if (!producto) problemas.push("Producto no encontrado en catalogo");
    if (producto && costo <= 0) problemas.push("Producto sin costo de compra configurado");
    if (producto && precio <= 0) problemas.push("Producto sin precio de venta configurado");
    if (producto && puntaje < 0.62) problemas.push("Match bajo");
    if (confianza < 0.72) problemas.push("Confianza OCR baja");

    const requiereRevision = problemas.length > 0;

    return {
      captura_id: capturaId,
      orden: index + 1,
      texto_original: itemIA.texto_original || null,
      producto_nombre_detectado: itemIA.producto_detectado || null,
      producto_id: producto?.id ?? null,
      modo,
      cantidad_ingresada: cantidad,
      factor_aplicado: factor,
      unidades_resultantes: unidades,
      costo_unitario_catalogo: costo,
      precio_venta_catalogo: precio,
      subtotal_costo: unidades * costo,
      stock_actual_snapshot: stockActual,
      stock_proyectado: stockProyectado,
      confianza_ia: confianza,
      puntaje_match: puntaje,
      requiere_revision: requiereRevision,
      precio_catalogo_confirmado: false,
      estado: requiereRevision ? "requiere_revision" : "borrador",
      observacion: problemas.length > 0 ? problemas.join(" | ") : null,
    } satisfies LineaPreparada;
  });
}

export async function POST(request: NextRequest) {
  const contexto = await contextoAdmin(request);
  if ("error" in contexto) return contexto.error;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("foto");
  const proveedorId = String(formData?.get("proveedor_id") ?? "");
  const fechaIngreso = String(formData?.get("fecha_ingreso") ?? "");
  const observacion = String(formData?.get("observacion") ?? "").trim();

  if (!(file instanceof File)) return jsonError("Selecciona una factura para procesar.");
  if (!MIME_PERMITIDOS.has(file.type)) return jsonError("Formato no soportado. Usa JPG, PNG, WEBP o HEIC.");
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return jsonError("La factura debe pesar maximo 10 MB.");
  if (!proveedorId) return jsonError("Selecciona el proveedor de la compra.");
  if (!fechaValida(fechaIngreso)) return jsonError("Selecciona una fecha de ingreso valida.");

  const { data: proveedor, error: proveedorError } = await contexto.service
    .from("proveedores")
    .select("id,nombre,activo")
    .eq("id", proveedorId)
    .eq("activo", true)
    .maybeSingle();

  if (proveedorError) return jsonError(proveedorError.message, 400);
  if (!proveedor) return jsonError("Proveedor invalido o inactivo.");

  const bytes = await file.arrayBuffer();
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const storagePath = `${contexto.perfil.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const upload = await contexto.service.storage.from(BUCKET).upload(storagePath, Buffer.from(bytes), {
    contentType: file.type,
    upsert: false,
  });

  if (upload.error) return jsonError(upload.error.message, 400);

  const { data: captura, error: capturaError } = await contexto.service
    .from("capturas_compra")
    .insert({
      usuario_id: contexto.perfil.id,
      proveedor_id: proveedorId,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      nombre_archivo: file.name,
      mime_type: file.type,
      tamano_bytes: file.size,
      estado: "procesando",
      fecha_ingreso: fechaIngreso,
      observacion: observacion || null,
    })
    .select("*")
    .single();

  if (capturaError || !captura) return jsonError(capturaError?.message ?? "No se pudo crear la captura de compra.", 400);

  try {
    const { catalogo, alias } = await cargarContexto(contexto.service);
    const { modelo, resultado, respuesta } = await procesarConOpenAI(file, catalogo, proveedor.nombre, bytes);
    const lineas = prepararLineas(captura.id, resultado, catalogo, alias);
    const requiereRevision = lineas.some((linea) => linea.requiere_revision) || lineas.length === 0;
    const advertencias = [
      ...(resultado.observaciones ?? []),
      ...(lineas.length === 0 ? ["No se detectaron productos de compra."] : []),
    ];

    const { data: lineasInsertadas, error: lineasError } = lineas.length > 0
      ? await contexto.service
          .from("captura_compra_lineas")
          .insert(lineas)
          .select("*, productos(nombre,precio_venta,costo_unitario_actual,presentacion_compra,factor_compra,stock_actual)")
      : { data: [], error: null };

    if (lineasError) throw new Error(lineasError.message);

    const { data: capturaActualizada, error: updateError } = await contexto.service
      .from("capturas_compra")
      .update({
        estado: requiereRevision ? "requiere_revision" : "procesada",
        modelo_ia: modelo,
        resultado_ia: { ...resultado, raw_response_id: (respuesta as { id?: string }).id ?? null },
        advertencias,
      })
      .eq("id", captura.id)
      .select("*")
      .single();

    if (updateError || !capturaActualizada) throw new Error(updateError?.message ?? "No se pudo actualizar la captura de compra.");

    await contexto.service.from("log_auditoria").insert({
      usuario_id: contexto.perfil.id,
      accion: "procesar_captura_compra_ocr",
      entidad: "capturas_compra",
      entidad_id: captura.id,
      detalle: {
        proveedor_id: proveedorId,
        fecha_ingreso: fechaIngreso,
        items_detectados: lineas.length,
        requiere_revision: requiereRevision,
        modelo,
      },
    });

    return NextResponse.json({
      captura: capturaActualizada,
      lineas: lineasInsertadas ?? [],
    });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "No se pudo procesar la factura.";
    await contexto.service
      .from("capturas_compra")
      .update({ estado: "error", error_procesamiento: mensaje })
      .eq("id", captura.id);

    return jsonError(mensaje, 500, { captura_id: captura.id });
  }
}
