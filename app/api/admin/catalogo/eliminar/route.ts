import { NextRequest, NextResponse } from "next/server";
import { contextoAdmin } from "@/lib/admin-context";

const BUCKET = "catalogo-imagenes";

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

  const body = await request.json().catch(() => null) as { tipo?: string; item_id?: string } | null;
  const tipo = body?.tipo;
  const itemId = body?.item_id;

  if ((tipo !== "producto" && tipo !== "combo") || !itemId) {
    return NextResponse.json({ error: "Item de catálogo inválido." }, { status: 400 });
  }

  const { data: validacion, error: validacionError } = await contexto.userClient.rpc("puede_eliminar_item_catalogo", {
    p_tipo: tipo,
    p_item_id: itemId,
  });

  if (validacionError) {
    return NextResponse.json({ error: validacionError.message }, { status: 400 });
  }

  const detalle = validacion as { puede_eliminar?: boolean; razones?: string[]; imagen_url?: string | null } | null;
  if (!detalle?.puede_eliminar) {
    return NextResponse.json({
      error: "El item tiene historial o stock y no puede eliminarse definitivamente.",
      razones: detalle?.razones ?? [],
    }, { status: 409 });
  }

  const { data: eliminado, error: eliminarError } = await contexto.userClient.rpc("eliminar_item_catalogo", {
    p_tipo: tipo,
    p_item_id: itemId,
  });

  if (eliminarError) {
    return NextResponse.json({ error: eliminarError.message }, { status: 409 });
  }

  const ruta = rutaDesdeUrlPublica(detalle.imagen_url);
  let advertencia: string | null = null;
  if (ruta) {
    const { error: storageError } = await contexto.service.storage.from(BUCKET).remove([ruta]);
    if (storageError) advertencia = "El item fue eliminado, pero no se pudo limpiar su archivo de imagen.";
  }

  return NextResponse.json({ eliminado, advertencia }, { status: 200 });
}
