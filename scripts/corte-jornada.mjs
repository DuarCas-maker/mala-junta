import { pathToFileURL } from "node:url";

/** No usa el reloj del navegador: la base determina la jornada en Colombia. */
export async function ejecutarCorte({ env = process.env, fetchImpl = fetch } = {}) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta configurar Supabase para el corte de jornada.");
  const endpoint = new URL("rest/v1/rpc/procesar_corte_jornada", `${url.replace(/\/$/, "")}/`);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && local)) {
    throw new Error("El corte de jornada requiere HTTPS o Supabase local.");
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Corte de jornada no disponible (HTTP ${response.status}). Verifica la migracion 058.`);
  const cantidad = await response.json();
  if (!Number.isInteger(cantidad) || cantidad < 0) throw new Error("Respuesta invalida del corte de jornada.");
  return cantidad;
}

function iniciarTrabajador() {
  let detenido = false;
  let timer;
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => { detenido = true; clearTimeout(timer); });
  }
  async function tick() {
    try {
      const cantidad = await ejecutarCorte();
      if (cantidad > 0) console.info(`[jornada] ${cantidad} cuentas liberadas.`);
    } catch (error) {
      // No imprimir respuestas, cabeceras ni credenciales del servidor.
      console.error(`[jornada] ${error instanceof Error ? error.message : "No se pudo ejecutar el corte."}`);
    }
    if (!detenido) timer = setTimeout(tick, 60000 - Date.now() % 60000 + 25);
  }
  void tick();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) iniciarTrabajador();
