import { reenviarRestSupabase } from "@/lib/supabase-rest-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reenviar(request: Request) {
  return reenviarRestSupabase(request, {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export { reenviar as GET, reenviar as HEAD, reenviar as POST, reenviar as PATCH, reenviar as PUT, reenviar as DELETE };
