import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { contextoAdmin } from "@/lib/admin-context";

export const runtime = "nodejs";

const BUCKET = "catalogo-imagenes";
const LIMITE_BYTES = 10 * 1024 * 1024;
const extensionesPorMime: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
const mimePorExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

function rutaDesdeUrlPublica(url?: string | null) {
  if (!url) return null;
  const marca = `/storage/v1/object/public/${BUCKET}/`;
  const indice = url.indexOf(marca);
  if (indice < 0) return null;
  return decodeURIComponent(url.slice(indice + marca.length).split("?")[0]);
}

export async function POST(request: NextRequest) {
  const contexto = await contextoAdmin(request);
  if ("error" in contexto) return contexto.error;

  const formData = await request.formData().catch(() => null);
  const tipo = formData?.get("tipo");
  const itemId = formData?.get("item_id");
  const archivo = formData?.get("archivo");
  const activar = formData?.get("activar") === "true";

  if ((tipo !== "producto" && tipo !== "combo") || typeof itemId !== "string" || !itemId) {
    return NextResponse.json({ error: "Item de catálogo inválido." }, { status: 400 });
  }

  if (!(archivo instanceof File) || archivo.size <= 0) {
    return NextResponse.json({ error: "Selecciona una imagen válida." }, { status: 400 });
  }

  if (archivo.size > LIMITE_BYTES) {
    return NextResponse.json({ error: "La imagen supera el límite de 10 MB." }, { status: 413 });
  }

  const extensionNombre = archivo.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeEntrada = archivo.type.toLowerCase();
  const mimeNormalizado = mimeEntrada === "image/jpg" ? "image/jpeg" : extensionesPorMime[mimeEntrada] ? mimeEntrada : mimePorExtension[extensionNombre];
  const extension = mimeNormalizado ? extensionesPorMime[mimeNormalizado] : null;
  if (!extension) {
    return NextResponse.json({ error: "Formato no permitido. Usa JPG, PNG, WebP, HEIC o HEIF." }, { status: 415 });
  }

  const tabla = tipo === "producto" ? "productos" : "combos";
  const { data: item, error: itemError } = await contexto.service
    .from(tabla)
    .select("id,imagen_url")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError || !item) {
    return NextResponse.json({ error: itemError?.message ?? "Item no encontrado." }, { status: 404 });
  }

  const ruta = `${tipo}/${itemId}/${Date.now()}-${randomUUID()}.${extension}`;
  const bytes = Buffer.from(await archivo.arrayBuffer());
  const { error: uploadError } = await contexto.service.storage.from(BUCKET).upload(ruta, bytes, {
    contentType: mimeNormalizado,
    cacheControl: "31536000",
    upsert: false,
  });

  if (uploadError) {
    return NextResponse.json({ error: `No se pudo subir la imagen: ${uploadError.message}` }, { status: 400 });
  }

  const { data: urlData } = contexto.service.storage.from(BUCKET).getPublicUrl(ruta);
  const { data: resultado, error: asociarError } = await contexto.userClient.rpc("completar_imagen_catalogo", {
    p_tipo: tipo,
    p_item_id: itemId,
    p_imagen_url: urlData.publicUrl,
    p_activar: activar,
  });

  if (asociarError) {
    await contexto.service.storage.from(BUCKET).remove([ruta]);
    return NextResponse.json({ error: `La imagen subió pero no pudo asociarse: ${asociarError.message}` }, { status: 400 });
  }

  const rutaAnterior = rutaDesdeUrlPublica((item as { imagen_url?: string | null }).imagen_url);
  if (rutaAnterior && rutaAnterior !== ruta) {
    await contexto.service.storage.from(BUCKET).remove([rutaAnterior]);
  }

  return NextResponse.json({ imagen_url: urlData.publicUrl, item: resultado }, { status: 200 });
}
