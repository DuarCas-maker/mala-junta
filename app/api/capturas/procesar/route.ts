import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import type { Perfil } from "@/lib/roles";
import { supabaseConToken, supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

const BUCKET = "capturas-ventas";
const DEFAULT_MODEL = "gpt-5";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIME_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

type CatalogoItem = {
  id: string;
  tipo: "producto" | "combo";
  nombre: string;
  precio_venta: number;
  codigo_interno?: string | null;
  categoria?: string | null;
  normalizado: string;
};

type LineaIA = {
  texto_original: string;
  producto_detectado: string;
  cantidad: number;
  valor_unitario: number;
  subtotal: number;
  confianza: number;
};

type PagoIA = {
  medio_detectado: string;
  monto: number;
  confianza: number;
};

type ResultadoIA = {
  lineas: LineaIA[];
  pagos: PagoIA[];
  total_detectado: number | null;
  observaciones: string[];
};

type MedioPago = "efectivo" | "datafono" | "nequi_daviplata" | "transferencia";

const capturaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lineas", "pagos", "total_detectado", "observaciones"],
  properties: {
    lineas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["texto_original", "producto_detectado", "cantidad", "valor_unitario", "subtotal", "confianza"],
        properties: {
          texto_original: { type: "string" },
          producto_detectado: { type: "string" },
          cantidad: { type: "number" },
          valor_unitario: { type: "number" },
          subtotal: { type: "number" },
          confianza: { type: "number" },
        },
      },
    },
    pagos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["medio_detectado", "monto", "confianza"],
        properties: {
          medio_detectado: { type: "string" },
          monto: { type: "number" },
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

function puntuarMatch(entrada: string, item: CatalogoItem) {
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

function buscarMatch(linea: LineaIA, catalogo: CatalogoItem[]) {
  const entrada = [linea.producto_detectado, linea.texto_original].filter(Boolean).join(" ");
  let mejor: { item: CatalogoItem; puntaje: number } | null = null;

  for (const item of catalogo) {
    const puntaje = puntuarMatch(entrada, item);
    if (!mejor || puntaje > mejor.puntaje) mejor = { item, puntaje };
  }

  if (!mejor || mejor.puntaje < 0.42) return { item: null, puntaje: 0 };
  return mejor;
}

function normalizarMedioPago(medio: string): MedioPago | null {
  const normal = normalizar(medio);
  if (!normal) return null;
  if (normal.includes("efect") || normal.includes("cash")) return "efectivo";
  if (normal.includes("data") || normal.includes("tarjeta") || normal.includes("card") || normal.includes("debito") || normal.includes("credito")) return "datafono";
  if (normal.includes("nequi") || normal.includes("davi") || normal.includes("daviplata")) return "nequi_daviplata";
  if (normal.includes("trans") || normal.includes("banco")) return "transferencia";
  return null;
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

async function cargarCatalogo(service: ReturnType<typeof supabaseService>) {
  const [{ data: productos, error: productosError }, { data: combos, error: combosError }] = await Promise.all([
    service
      .from("productos")
      .select("id,nombre,precio_venta,codigo_interno,categorias(nombre)")
      .eq("activo", true)
      .order("nombre"),
    service
      .from("combos")
      .select("id,nombre,precio_venta")
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (productosError) throw new Error(productosError.message);
  if (combosError) throw new Error(combosError.message);

  const productosItems = ((productos ?? []) as any[]).map((producto) => {
    const categoria = Array.isArray(producto.categorias) ? producto.categorias[0] : producto.categorias;
    return {
      id: producto.id,
      tipo: "producto" as const,
      nombre: producto.nombre,
      precio_venta: Number(producto.precio_venta ?? 0),
      codigo_interno: producto.codigo_interno,
      categoria: categoria?.nombre ?? null,
      normalizado: normalizar([producto.nombre, producto.codigo_interno, categoria?.nombre].filter(Boolean).join(" ")),
    };
  });

  const combosItems = ((combos ?? []) as any[]).map((combo) => ({
    id: combo.id,
    tipo: "combo" as const,
    nombre: combo.nombre,
    precio_venta: Number(combo.precio_venta ?? 0),
    codigo_interno: null,
    categoria: "Combo",
    normalizado: normalizar(`combo ${combo.nombre}`),
  }));

  return [...productosItems, ...combosItems];
}

function crearPrompt(catalogo: CatalogoItem[]) {
  const catalogoTexto = catalogo
    .map((item) => `- ${item.tipo}: ${item.nombre} | precio ${item.precio_venta} | codigo ${item.codigo_interno ?? "sin codigo"}`)
    .join("\n");

  return `Lee una foto de anotaciones de ventas de Mala Junta. Extrae las lineas vendidas y pagos visibles.\n\nReglas:\n- Devuelve solo el JSON solicitado.\n- Si una cantidad, producto, precio o medio de pago no es claro, usa tu mejor lectura y baja la confianza.\n- No inventes productos fuera del catalogo; escribe el texto leido en producto_detectado para que el sistema haga match.\n- Valores monetarios en pesos colombianos, sin decimales.\n- Si aparece un total general, ponlo en total_detectado; si no, null.\n\nCatalogo activo:\n${catalogoTexto}`;
}

async function procesarConOpenAI(file: File, catalogo: CatalogoItem[], bytes: ArrayBuffer) {
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
            { type: "input_text", text: crearPrompt(catalogo) },
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

function prepararLineas(resultado: ResultadoIA, catalogo: CatalogoItem[]) {
  return (resultado.lineas ?? []).map((linea, index) => {
    const cantidad = Math.max(1, Math.round(Number(linea.cantidad ?? 1)));
    const valorUnitario = redondearCOP(Number(linea.valor_unitario ?? 0));
    const subtotal = redondearCOP(Number(linea.subtotal ?? cantidad * valorUnitario));
    const confianza = limitarConfianza(Number(linea.confianza ?? 0));
    const match = buscarMatch(linea, catalogo);
    const diferenciaSubtotal = Math.abs(subtotal - cantidad * valorUnitario);
    const subtotalDudoso = diferenciaSubtotal > Math.max(500, subtotal * 0.08);
    const requiereRevision = !match.item || match.puntaje < 0.62 || confianza < 0.75 || subtotalDudoso;

    return {
      orden: index + 1,
      texto_original: linea.texto_original || null,
      item_nombre_detectado: linea.producto_detectado || null,
      tipo_item: match.item?.tipo ?? "desconocido",
      producto_id: match.item?.tipo === "producto" ? match.item.id : null,
      combo_id: match.item?.tipo === "combo" ? match.item.id : null,
      cantidad,
      valor_unitario: valorUnitario,
      subtotal,
      confianza_ia: confianza,
      puntaje_match: limitarConfianza(match.puntaje),
      requiere_revision: requiereRevision,
    };
  });
}

function prepararPagos(resultado: ResultadoIA) {
  return (resultado.pagos ?? []).map((pago) => {
    const medio = normalizarMedioPago(pago.medio_detectado ?? "");
    const confianza = limitarConfianza(Number(pago.confianza ?? 0));
    return {
      medio_detectado: pago.medio_detectado || null,
      medio_normalizado: medio,
      monto: redondearCOP(Number(pago.monto ?? 0)),
      confianza_ia: confianza,
      requiere_revision: !medio || confianza < 0.75,
    };
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
    const catalogo = await cargarCatalogo(contexto.service);
    const { modelo, resultado, respuesta } = await procesarConOpenAI(file, catalogo, bytes);
    const lineas = prepararLineas(resultado, catalogo).map((linea) => ({ ...linea, captura_id: captura.id }));
    const pagos = prepararPagos(resultado).map((pago) => ({ ...pago, captura_id: captura.id }));
    const requiereRevision = lineas.some((linea) => linea.requiere_revision) || pagos.some((pago) => pago.requiere_revision) || lineas.length === 0;
    const advertencias = [
      ...(resultado.observaciones ?? []),
      ...(lineas.length === 0 ? ["No se detectaron lineas de venta."] : []),
    ];

    const [lineasRes, pagosRes] = await Promise.all([
      lineas.length > 0
        ? contexto.service.from("captura_venta_lineas").insert(lineas).select("*, productos(nombre,precio_venta), combos(nombre,precio_venta)")
        : Promise.resolve({ data: [], error: null }),
      pagos.length > 0
        ? contexto.service.from("captura_venta_pagos").insert(pagos).select("*")
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

    return NextResponse.json({
      captura: capturaActualizada,
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
