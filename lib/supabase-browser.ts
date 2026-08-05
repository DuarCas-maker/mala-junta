import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function assertLocalAuthUrlIsSafe(url: string) {
  if (typeof window === "undefined") return;

  let supabaseUrl: URL;
  try {
    supabaseUrl = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no es una URL valida");
  }

  const isLocalApp = localHosts.has(window.location.hostname);
  const isLocalSupabase = localHosts.has(supabaseUrl.hostname);

  if (isLocalApp && supabaseUrl.protocol === "http:" && !isLocalSupabase) {
    throw new Error(
      "El entorno local esta apuntando a un Supabase remoto por HTTP. Usa Supabase local en http://127.0.0.1:54321 o configura un endpoint HTTPS.",
    );
  }
}

export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  assertLocalAuthUrlIsSafe(url);

  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
