import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const standalone = existsSync("server.js");
const server = spawn(process.execPath, standalone ? ["server.js"] : ["node_modules/next/dist/bin/next", "start", ...process.argv.slice(2)], { stdio: "inherit" });
let worker;
let reinicio;
let deteniendo = false;

function iniciarCorte() {
  if (deteniendo) return;
  worker = spawn(process.execPath, [fileURLToPath(new URL("./corte-jornada.mjs", import.meta.url))], { stdio: "inherit" });
  worker.on("exit", () => {
    if (!deteniendo) {
      console.error("[jornada] Trabajador detenido. Se reiniciara en un minuto.");
      reinicio = setTimeout(iniciarCorte, 60000);
    }
  });
}

if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) iniciarCorte();
else console.warn("[jornada] Trabajador sin configurar. Se requiere service_role en el servidor o pg_cron en la base.");

function detener(signal = "SIGTERM") {
  deteniendo = true;
  clearTimeout(reinicio);
  worker?.kill(signal);
  server.kill(signal);
}
process.on("SIGTERM", () => detener());
process.on("SIGINT", () => detener("SIGINT"));
server.on("error", () => { detener(); process.exitCode = 1; });
server.on("exit", (code) => { detener(); process.exitCode = code ?? 1; });
