const prefijo = "/api/supabase/rest/";
const encabezadosEntrada = [
  "authorization", "accept", "accept-profile", "content-profile", "content-type",
  "prefer", "range", "range-unit", "x-client-info", "x-supabase-api-version", "x-retry-count",
  "if-match", "if-none-match",
];
const encabezadosSalida = ["content-type", "content-range", "range-unit", "preference-applied", "etag"];

function errorJson(message: string, status: number) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function reenviarRestSupabase(
  request: Request,
  config: { url?: string; anonKey?: string },
  fetchImpl: typeof fetch = fetch,
) {
  if (!config.url || !config.anonKey) return errorJson("Falta configurar la conexion con Supabase en el servidor.", 503);
  if (!/^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "")) return errorJson("Sesion requerida.", 401);

  const entrada = new URL(request.url);
  const ruta = entrada.pathname.startsWith(prefijo) ? entrada.pathname.slice(prefijo.length) : "";
  // Solo tablas/vistas y RPC del endpoint configurado; nunca destinos del cliente.
  if (!/^(?:rpc\/)?[a-zA-Z_][a-zA-Z0-9_]*$/.test(ruta)) return errorJson("Ruta de datos invalida.", 400);

  const destino = new URL(`${config.url.replace(/\/$/, "")}/rest/v1/${ruta}`);
  destino.search = entrada.search;
  const headers = new Headers({ apikey: config.anonKey });
  for (const nombre of encabezadosEntrada) {
    const valor = request.headers.get(nombre);
    if (valor !== null) headers.set(nombre, valor);
  }

  try {
    const respuesta = await fetchImpl(destino, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
    });
    // No seguir redirecciones con el token del usuario ni repetir escrituras.
    if (respuesta.status >= 300 && respuesta.status < 400 && respuesta.status !== 304) {
      return errorJson("El endpoint de Supabase devolvio una redireccion inesperada.", 502);
    }
    const salida = new Headers({ "Cache-Control": "no-store" });
    for (const nombre of encabezadosSalida) {
      const valor = respuesta.headers.get(nombre);
      if (valor !== null) salida.set(nombre, valor);
    }
    return new Response(request.method === "HEAD" ? null : respuesta.body, { status: respuesta.status, headers: salida });
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    return errorJson(timeout ? "Supabase no respondio a tiempo. Actualiza para reintentar." : "No se pudo conectar con Supabase. Actualiza para reintentar.", timeout ? 504 : 502);
  }
}
