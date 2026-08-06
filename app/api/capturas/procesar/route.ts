import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import type { Perfil } from "@/lib/roles";
import { supabaseConToken, supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

const BUCKET = "capturas-ventas";
const DEFAULT_MODEL = "gpt-5";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIME_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const DIFERENCIA_TOLERANCIA = 0;

type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";

type CatalogoItem = {
  id: string;
  tipo: "producto" | "combo";
  nombre: string;
  precio_venta: number;
  codigo_interno?: string | null;
  categoria?: string | null;
  presentacion?: string | null;
  componentes?: string[];
  normalizado: string;
};

type AliasOperativo = {
  tipo: "producto" | "combo" | "medio_pago" | "cuenta_pago";
  alias: string;
  alias_normalizado: string;
  producto_id: string | null;
  combo_id: string | null;
  medio_normalizado: MedioPago | null;
  cuenta_destino: string | null;
};

type ProductoIA = {
  texto_original: string;
  item_detectado: string;
  cantidad: number;
  valor_unitario: number;
  subtotal: number;
  confianza: number;
};

type PagoIA = {
  texto_original: string;
  medio_detectado: string;
  cuenta_detectada: string;
  monto: number;
  confianza: number;
};

type VentaIA = {
  texto_original: string;
  productos: ProductoIA[];
  total_leido: number;
  pagos: PagoIA[];
  confianza: number;
  observaciones: string[];
};

type ResultadoIA = {
  ventas: VentaIA[];
  total_detectado: number | null;
  observaciones: string[];
};

type ProductoPreparado = {
  orden: number;
  texto_original: string | null;
  item_nombre_detectado: string | null;
  tipo_item: "producto" | "combo" | "desconocido";
  producto_id: string | null;
  combo_id: string | null;
  cantidad: number;
  valor_unitario: number;
  subtotal: number;
  precio_catalogo: number;
  subtotal_esperado: number;
  confianza_ia: number;
  puntaje_match: number;
  requiere_revision: boolean;
};

type PagoPreparado = {
  orden: number;
  medio_detectado: string | null;
  medio_normalizado: MedioPago | null;
  cuenta_destino: string | null;
  monto: number;
  confianza_ia: number;
  requiere_revision: boolean;
};

type VentaPreparada = {
  orden: number;
  texto_original: string | null;
  total_leido: number;
  total_esperado: number;
  diferencia: number;
  tipo_diferencia: "positiva" | "negativa" | "cero";
  confianza_ia: number;
  requiere_revision: boolean;
  observacion: string | null;
  productos: ProductoPreparado[];
  pagos: PagoPreparado[];
};

const capturaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ventas", "total_detectado", "observaciones"],
  properties: {
    ventas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["texto_original", "productos", "total_leido", "pagos", "confianza", "observaciones"],
        properties: {
          texto_original: { type: "string" },
          productos: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["texto_original", "item_detectado", "cantidad", "valor_unitario", "subtotal", "confianza"],
              properties: {
                texto_original: { type: "string" },
                item_detectado: { type: "string" },
                cantidad: { type: "number" },
                valor_unitario: { type: "number" },
                subtotal: { type: "number" },
                confianza: { type: "number" },
              },
            },
          },
          total_leido: { type: "number" },
          pagos: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["texto_original", "medio_detectado", "cuenta_detectada", "monto", "confianza"],
              properties: {
                texto_original: { type: "string" },
                medio_detectado: { type: "string" },
                cuenta_detectada: { type: "string" },
                monto: { type: "number" },
                confianza: { type: "number" },
              },
            },
          },
          confianza: { type: "number" },
          observaciones: { type: "array", items: { type: "string" } },
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

function redondearCOP(valor: number) {
  if (!Number.isFinite(valor)) return 0;
  return Math.max(0, Math.round(valor));
}

function limitarConfianza(valor: number) {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

function tipoDiferencia(diferencia: number): "positiva" | "negativa" | "cero" {
  if (diferencia > DIFERENCIA_TOLERANCIA) return "positiva";
  if (diferencia < -DIFERENCIA_TOLERANCIA) return "negativa";
  return "cero";
}

function puntuarMatch(entrada: string, item: CatalogoItem) {
  const consulta = normalizar(entrada);
  if (!consulta) return 0;
  if (consulta === item.normalizado) return 1;
  if (item.codigo_interno && normalizar(item.codigo_interno) === consulta) return 1;
  if (item.tipo === "combo" && consulta !== item.normalizado) return 0;
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

function buscarAliasItem(entrada: string, catalogo: CatalogoItem[], alias: AliasOperativo[]) {
  const normal = normalizar(entrada);
  const encontrado = alias.find((item) => ["producto", "combo"].includes(item.tipo) && item.alias_normalizado === normal);
  if (!encontrado) return null;
  const item = catalogo.find((actual) => actual.id === encontrado.producto_id || actual.id === encontrado.combo_id);
  return item ? { item, puntaje: 1 } : null;
}

function buscarMatch(entrada: string, catalogo: CatalogoItem[], alias: AliasOperativo[]) {
  const aliasMatch = buscarAliasItem(entrada, catalogo, alias);
  if (aliasMatch) return aliasMatch;

  let mejor: { item: CatalogoItem; puntaje: number } | null = null;
  for (const item of catalogo) {
    const puntaje = puntuarMatch(entrada, item);
    if (!mejor || puntaje > mejor.puntaje) mejor = { item, puntaje };
  }

  if (!mejor || mejor.puntaje < 0.42) return { item: null, puntaje: 0 };
  return mejor;
}

function dividirProductoCompuesto(producto: ProductoIA, catalogo: CatalogoItem[], alias: AliasOperativo[]) {
  const exacto = buscarMatch(producto.item_detectado || producto.texto_original, catalogo, alias);
  if (exacto.item?.tipo === "combo" && exacto.puntaje >= 1) return [producto];
  if (!/[+&]|\sy\s|\sand\s/i.test(producto.item_detectado)) return [producto];

  const partes = producto.item_detectado
    .split(/\s*(?:\+|&|\by\b|\band\b)\s*/i)
    .map((parte) => parte.trim())
    .filter(Boolean);

  if (partes.length <= 1) return [producto];

  return partes.map((parte, index) => {
    const cantidadMatch = parte.match(/^(\d+)\s+(.+)$/);
    const cantidad = cantidadMatch ? Number(cantidadMatch[1]) : 1;
    const itemDetectado = cantidadMatch ? cantidadMatch[2] : parte;
    return {
      texto_original: parte,
      item_detectado: itemDetectado,
      cantidad,
      valor_unitario: 0,
      subtotal: 0,
      confianza: Math.max(0, Number(producto.confianza ?? 0) - (index === 0 ? 0.05 : 0.1)),
    };
  });
}

function normalizarMedioPago(medio: string, cuenta: string, alias: AliasOperativo[]) {
  const combinado = normalizar(`${medio} ${cuenta}`);
  const cuentaAlias = alias.find((item) => item.tipo === "cuenta_pago" && combinado.split(" ").includes(item.alias_normalizado));
  const medioAlias = alias.find((item) => item.tipo === "medio_pago" && combinado.split(" ").includes(item.alias_normalizado));

  if (cuentaAlias) {
    return { medio: cuentaAlias.medio_normalizado, cuentaDestino: cuentaAlias.cuenta_destino };
  }

  if (medioAlias) return { medio: medioAlias.medio_normalizado, cuentaDestino: cuenta || null };

  if (combinado.includes("efect") || combinado.includes("cash")) return { medio: "efectivo" as const, cuentaDestino: cuenta || null };
  if (combinado.includes("data") || combinado.includes("tarj") || combinado.includes("card") || combinado.includes("debito") || combinado.includes("credito")) return { medio: "datafono" as const, cuentaDestino: cuenta || null };
  if (combinado.includes("nequi") || combinado.includes("neq") || combinado.includes("davi") || combinado.includes("sebas") || combinado.includes("nico")) {
    const cuentaDestino = combinado.includes("nico") ? "Nico" : combinado.includes("seb") ? "Sebas" : cuenta || null;
    return { medio: "nequi_daviplata" as const, cuentaDestino };
  }
  if (combinado.includes("trans") || combinado.includes("banco")) return { medio: "transferencia" as const, cuentaDestino: cuenta || null };
  return { medio: null, cuentaDestino: cuenta || null };
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

async function contextoCajaAdmin(request: NextRequest) {
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

  if (perfilError || !perfil || !["admin", "caja"].includes(perfil.rol)) {
    return { error: jsonError("Solo caja o administrador", 403) } as const;
  }

  return { service, perfil } as const;
}

async function cargarContexto(service: ReturnType<typeof supabaseService>) {
  const [{ data: productos, error: productosError }, { data: combos, error: combosError }, { data: aliasData }] = await Promise.all([
    service
      .from("productos")
      .select("id,nombre,precio_venta,codigo_interno,presentacion_compra,categorias(nombre)")
      .eq("activo", true)
      .order("nombre"),
    service
      .from("combos")
      .select("id,nombre,precio_venta,combo_items(cantidad,activo,productos(nombre,presentacion_compra))")
      .eq("activo", true)
      .order("nombre"),
    service
      .from("alias_operativos")
      .select("tipo,alias,alias_normalizado,producto_id,combo_id,medio_normalizado,cuenta_destino")
      .eq("activo", true),
  ]);

  if (productosError) throw new Error(productosError.message);
  if (combosError) throw new Error(combosError.message);

  const productosItems = ((productos ?? []) as any[]).map((producto) => {
    const categoria = Array.isArray(producto.categorias) ? producto.categorias[0] : producto.categorias;
    const presentacion = producto.presentacion_compra ?? "unidad";
    return {
      id: producto.id,
      tipo: "producto" as const,
      nombre: producto.nombre,
      precio_venta: Number(producto.precio_venta ?? 0),
      codigo_interno: producto.codigo_interno,
      categoria: categoria?.nombre ?? null,
      presentacion,
      componentes: [],
      normalizado: normalizar([producto.nombre, presentacion, producto.codigo_interno, categoria?.nombre].filter(Boolean).join(" ")),
    };
  });

  const combosItems = ((combos ?? []) as any[]).map((combo) => {
    const componentes = (combo.combo_items ?? [])
      .filter((item: any) => item.activo !== false && item.productos)
      .map((item: any) => {
        const producto = Array.isArray(item.productos) ? item.productos[0] : item.productos;
        return `${item.cantidad} x ${producto?.nombre ?? "Producto"}${producto?.presentacion_compra ? ` - ${producto.presentacion_compra}` : ""}`;
      });

    return {
      id: combo.id,
      tipo: "combo" as const,
      nombre: combo.nombre,
      precio_venta: Number(combo.precio_venta ?? 0),
      codigo_interno: null,
      categoria: "Combo",
      presentacion: null,
      componentes,
      normalizado: normalizar(combo.nombre),
    };
  });

  return {
    catalogo: [...productosItems, ...combosItems],
    alias: ((aliasData ?? []) as AliasOperativo[]),
  };
}

function crearPrompt(catalogo: CatalogoItem[], alias: AliasOperativo[]) {
  const productosTexto = catalogo
    .filter((item) => item.tipo === "producto")
    .map((item) => `- producto: ${item.nombre}${item.presentacion ? ` - ${item.presentacion}` : ""} | precio ${item.precio_venta} | codigo ${item.codigo_interno ?? "sin codigo"}`)
    .join("\n");
  const combosTexto = catalogo
    .filter((item) => item.tipo === "combo")
    .map((item) => `- combo oficial exacto: ${item.nombre} | precio ${item.precio_venta} | componentes ${item.componentes?.join(", ") || "sin componentes"}`)
    .join("\n");
  const aliasTexto = alias
    .filter((item) => item.tipo === "producto" || item.tipo === "combo")
    .map((item) => `- ${item.alias} -> ${item.tipo}`)
    .join("\n") || "- sin alias de productos/combos todavia";

  return `Lee una foto real de una hoja de ventas de Mala Junta. La hoja suele tener columnas: cantidad a la izquierda, producto al centro, valor a la derecha y metodo de pago aun mas a la derecha.\n\nReglas criticas:\n- Devuelve solo el JSON solicitado.\n- El objeto principal es ventas[]. Cada venta puede tener uno o varios productos y uno o varios pagos.\n- Cada renglon horizontal suele ser una venta independiente. Si ves flechas, signos >, llaves o trazos que agrupan varios renglones hacia un unico valor/pago, esos renglones pertenecen a una sola venta.\n- Si varios productos comparten un unico valor escrito al final del grupo, pon valor_unitario=0 y subtotal=0 en cada producto, y pon ese valor en total_leido de la venta.\n- Si un texto dice \"Poker + 1 Corona\", separalo como productos distintos salvo que coincida exactamente con un combo oficial o alias de combo.\n- Solo uses tipo combo cuando el texto coincide exactamente con un combo oficial o alias. Si no, separa productos.\n- Si el pago dice \"200 nequi and 10 eff\", crea dos pagos en la misma venta.\n- Si hay dos metodos sin montos claros, crea los dos pagos con monto 0 y baja la confianza.\n- E, efec, efect, efectivo significan efectivo.\n- N, neq, nequi significan nequi_daviplata.\n- Seb, Sebas, Nico son cuentas destino de Nequi/Daviplata; si aparece solo el nombre, asume nequi_daviplata.\n- Tarj o tarjeta significa datafono. Transf significa transferencia.\n- Valores monetarios en pesos colombianos, sin decimales.\n- Conserva el texto leido original en cada venta, producto y pago.\n\nProductos activos:\n${productosTexto}\n\nCombos oficiales:\n${combosTexto}\n\nAlias operativos conocidos:\n${aliasTexto}`;
}

async function procesarConOpenAI(file: File, catalogo: CatalogoItem[], alias: AliasOperativo[], bytes: ArrayBuffer) {
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
            { type: "input_text", text: crearPrompt(catalogo, alias) },
            { type: "input_image", image_url: dataUrl, detail: "high" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "captura_venta",
          strict: true,
          schema: capturaSchema,
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

  return { modelo, resultado: JSON.parse(texto) as ResultadoIA, respuesta: cuerpo };
}

function prepararProductos(venta: VentaIA, catalogo: CatalogoItem[], alias: AliasOperativo[]) {
  const productosIA = (venta.productos ?? []).flatMap((producto) => dividirProductoCompuesto(producto, catalogo, alias));

  return productosIA.map((producto, index) => {
    const cantidad = Math.max(1, Math.round(Number(producto.cantidad ?? 1)));
    const entrada = [producto.item_detectado, producto.texto_original].filter(Boolean).join(" ");
    const match = buscarMatch(entrada, catalogo, alias);
    const confianza = limitarConfianza(Number(producto.confianza ?? 0));
    const valorUnitario = redondearCOP(Number(producto.valor_unitario ?? 0));
    const subtotal = redondearCOP(Number(producto.subtotal ?? cantidad * valorUnitario));
    const precioCatalogo = match.item ? redondearCOP(match.item.precio_venta) : 0;
    const subtotalEsperado = precioCatalogo * cantidad;
    const requiereRevision = !match.item || match.puntaje < 0.62 || confianza < 0.72;

    return {
      orden: index + 1,
      texto_original: producto.texto_original || null,
      item_nombre_detectado: producto.item_detectado || null,
      tipo_item: match.item?.tipo ?? "desconocido",
      producto_id: match.item?.tipo === "producto" ? match.item.id : null,
      combo_id: match.item?.tipo === "combo" ? match.item.id : null,
      cantidad,
      valor_unitario: valorUnitario,
      subtotal,
      precio_catalogo: precioCatalogo,
      subtotal_esperado: subtotalEsperado,
      confianza_ia: confianza,
      puntaje_match: limitarConfianza(match.puntaje),
      requiere_revision: requiereRevision,
    } satisfies ProductoPreparado;
  });
}

function prepararPagos(venta: VentaIA, alias: AliasOperativo[]) {
  const pagos = venta.pagos ?? [];
  const pagosSinMontoClaro = pagos.length > 1 && pagos.some((pago) => redondearCOP(Number(pago.monto ?? 0)) === 0);

  return pagos.map((pago, index) => {
    const normalizado = normalizarMedioPago(pago.medio_detectado ?? "", pago.cuenta_detectada ?? "", alias);
    const confianza = limitarConfianza(Number(pago.confianza ?? 0));
    const monto = redondearCOP(Number(pago.monto ?? 0));
    return {
      orden: index + 1,
      medio_detectado: pago.texto_original || pago.medio_detectado || null,
      medio_normalizado: normalizado.medio,
      cuenta_destino: normalizado.cuentaDestino,
      monto,
      confianza_ia: confianza,
      requiere_revision: !normalizado.medio || confianza < 0.75 || pagosSinMontoClaro || monto === 0,
    } satisfies PagoPreparado;
  });
}

function prepararVentas(resultado: ResultadoIA, catalogo: CatalogoItem[], alias: AliasOperativo[]) {
  return (resultado.ventas ?? []).map((venta, index) => {
    const productos = prepararProductos(venta, catalogo, alias);
    const pagos = prepararPagos(venta, alias);
    const totalLeido = redondearCOP(Number(venta.total_leido ?? 0));
    const totalEsperado = productos.reduce((sum, producto) => sum + producto.subtotal_esperado, 0);
    const diferencia = totalLeido - totalEsperado;
    const sumaPagos = pagos.reduce((sum, pago) => sum + pago.monto, 0);
    const tipo = tipoDiferencia(diferencia);
    const observaciones = [...(venta.observaciones ?? [])];

    if (tipo === "negativa") observaciones.push(`Falto cobrar ${Math.abs(diferencia)}`);
    if (tipo === "positiva") observaciones.push(`Diferencia positiva ${diferencia}`);
    if (sumaPagos !== totalLeido) observaciones.push(`Pagos no coinciden con total leido: pagos ${sumaPagos}, total ${totalLeido}`);
    if (productos.length === 0) observaciones.push("Venta sin productos detectados");

    const requiereRevision =
      productos.some((producto) => producto.requiere_revision) ||
      pagos.some((pago) => pago.requiere_revision) ||
      tipo !== "cero" ||
      sumaPagos !== totalLeido ||
      productos.length === 0 ||
      limitarConfianza(Number(venta.confianza ?? 0)) < 0.72;

    return {
      orden: index + 1,
      texto_original: venta.texto_original || null,
      total_leido: totalLeido,
      total_esperado: totalEsperado,
      diferencia,
      tipo_diferencia: tipo,
      confianza_ia: limitarConfianza(Number(venta.confianza ?? 0)),
      requiere_revision: requiereRevision,
      observacion: observaciones.length > 0 ? observaciones.join(" | ") : null,
      productos,
      pagos,
    } satisfies VentaPreparada;
  });
}

export async function POST(request: NextRequest) {
  const contexto = await contextoCajaAdmin(request);
  if ("error" in contexto) return contexto.error;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("foto");
  if (!(file instanceof File)) return jsonError("Selecciona una foto para procesar.");
  if (!MIME_PERMITIDOS.has(file.type)) return jsonError("Formato no soportado. Usa JPG, PNG, WEBP o HEIC.");
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return jsonError("La foto debe pesar maximo 10 MB.");

  const bytes = await file.arrayBuffer();
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const storagePath = `${contexto.perfil.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const upload = await contexto.service.storage.from(BUCKET).upload(storagePath, Buffer.from(bytes), {
    contentType: file.type,
    upsert: false,
  });

  if (upload.error) return jsonError(upload.error.message, 400);

  const { data: captura, error: capturaError } = await contexto.service
    .from("capturas_venta")
    .insert({
      usuario_id: contexto.perfil.id,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      nombre_archivo: file.name,
      mime_type: file.type,
      tamano_bytes: file.size,
      estado: "procesando",
    })
    .select("*")
    .single();

  if (capturaError || !captura) return jsonError(capturaError?.message ?? "No se pudo crear la captura.", 400);

  try {
    const { catalogo, alias } = await cargarContexto(contexto.service);
    const { modelo, resultado, respuesta } = await procesarConOpenAI(file, catalogo, alias, bytes);
    const ventas = prepararVentas(resultado, catalogo, alias);
    const requiereRevision = ventas.some((venta) => venta.requiere_revision) || ventas.length === 0;
    const advertencias = [
      ...(resultado.observaciones ?? []),
      ...(ventas.length === 0 ? ["No se detectaron ventas."] : []),
    ];

    const gruposPayload = ventas.map((venta) => ({
      captura_id: captura.id,
      orden: venta.orden,
      texto_original: venta.texto_original,
      total_leido: venta.total_leido,
      total_esperado: venta.total_esperado,
      diferencia: venta.diferencia,
      tipo_diferencia: venta.tipo_diferencia,
      ingreso_adicional: venta.tipo_diferencia === "positiva",
      confianza_ia: venta.confianza_ia,
      requiere_revision: venta.requiere_revision,
      observacion: venta.observacion,
    }));

    const { data: gruposInsertados, error: gruposError } = gruposPayload.length > 0
      ? await contexto.service.from("captura_venta_grupos").insert(gruposPayload).select("*")
      : { data: [], error: null };
    if (gruposError) throw new Error(gruposError.message);

    const gruposPorOrden = new Map((gruposInsertados ?? []).map((grupo: any) => [Number(grupo.orden), grupo]));
    const lineasPayload = ventas.flatMap((venta) => {
      const grupo = gruposPorOrden.get(venta.orden);
      return venta.productos.map((producto) => ({
        ...producto,
        captura_id: captura.id,
        grupo_id: grupo?.id ?? null,
      }));
    });
    const pagosPayload = ventas.flatMap((venta) => {
      const grupo = gruposPorOrden.get(venta.orden);
      return venta.pagos.map((pago) => ({
        ...pago,
        captura_id: captura.id,
        grupo_id: grupo?.id ?? null,
      }));
    });

    const [lineasRes, pagosRes] = await Promise.all([
      lineasPayload.length > 0
        ? contexto.service.from("captura_venta_lineas").insert(lineasPayload).select("*, productos(nombre,precio_venta), combos(nombre,precio_venta)")
        : Promise.resolve({ data: [], error: null }),
      pagosPayload.length > 0
        ? contexto.service.from("captura_venta_pagos").insert(pagosPayload).select("*")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (lineasRes.error) throw new Error(lineasRes.error.message);
    if (pagosRes.error) throw new Error(pagosRes.error.message);

    const { data: capturaActualizada, error: updateError } = await contexto.service
      .from("capturas_venta")
      .update({
        estado: requiereRevision ? "requiere_revision" : "procesada",
        modelo_ia: modelo,
        resultado_ia: { ...resultado, raw_response_id: (respuesta as { id?: string }).id ?? null },
        advertencias,
      })
      .eq("id", captura.id)
      .select("*")
      .single();

    if (updateError || !capturaActualizada) throw new Error(updateError?.message ?? "No se pudo actualizar la captura.");

    const grupos = (gruposInsertados ?? []).map((grupo: any) => ({
      ...grupo,
      lineas: (lineasRes.data ?? []).filter((linea: any) => linea.grupo_id === grupo.id),
      pagos: (pagosRes.data ?? []).filter((pago: any) => pago.grupo_id === grupo.id),
    }));

    return NextResponse.json({
      captura: capturaActualizada,
      grupos,
      lineas: lineasRes.data ?? [],
      pagos: pagosRes.data ?? [],
    });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "No se pudo procesar la foto.";
    await contexto.service
      .from("capturas_venta")
      .update({ estado: "error", error_procesamiento: mensaje })
      .eq("id", captura.id);

    return jsonError(mensaje, 500, { captura_id: captura.id });
  }
}
