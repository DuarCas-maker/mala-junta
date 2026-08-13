import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import type { Perfil } from "@/lib/roles";
import { supabaseConToken, supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

const BUCKET = "capturas-compras";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIME_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function jsonError(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
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

function fechaValida(fecha: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(new Date(`${fecha}T12:00:00`).getTime());
}

export async function POST(request: NextRequest) {
  const contexto = await contextoAdmin(request);
  if ("error" in contexto) return contexto.error;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("foto");
  const proveedorId = String(formData?.get("proveedor_id") ?? "");
  const fechaIngreso = String(formData?.get("fecha_ingreso") ?? "");
  const observacion = String(formData?.get("observacion") ?? "").trim();

  if (!(file instanceof File)) return jsonError("Selecciona una factura para registrar.");
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
      estado: "subida",
      fecha_ingreso: fechaIngreso,
      observacion: observacion || null,
      advertencias: ["OCR de compras pendiente de Sprint 2."],
    })
    .select("*, proveedores(nombre)")
    .single();

  if (capturaError || !captura) return jsonError(capturaError?.message ?? "No se pudo crear la captura de compra.", 400);

  await contexto.service.from("log_auditoria").insert({
    usuario_id: contexto.perfil.id,
    accion: "crear_captura_compra",
    entidad: "capturas_compra",
    entidad_id: captura.id,
    detalle: {
      proveedor_id: proveedorId,
      proveedor: proveedor.nombre,
      fecha_ingreso: fechaIngreso,
      storage_path: storagePath,
      nombre_archivo: file.name,
      fase: "sprint_1_sin_ocr",
    },
  });

  return NextResponse.json({ captura });
}
