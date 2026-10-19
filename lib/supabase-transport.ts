// Mantiene Auth, Storage y Realtime en su endpoint original. Solo PostgREST
// pasa por Next.js para que el navegador no dependa del CORS del VPS.
export function crearFetchSupabaseMismoOrigen(supabaseUrl: string, appOrigin: string, fetchImpl: typeof fetch = fetch): typeof fetch {
  const rest = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/`);

  return (input, init) => {
    const original = new URL(input instanceof Request ? input.url : String(input), appOrigin);
    if (original.origin !== rest.origin || !original.pathname.startsWith(rest.pathname)) {
      return fetchImpl(input, init);
    }

    const destino = new URL(`/api/supabase/rest/${original.pathname.slice(rest.pathname.length)}`, appOrigin);
    destino.search = original.search;
    return fetchImpl(input instanceof Request ? new Request(destino, input) : destino, init);
  };
}
