import { firmar, generarXML, transmitir, validar } from "./mod.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Metodo no permitido" }, { status: 405 });
  }

  const payload = await req.json().catch(() => ({}));
  const accion = payload.accion ?? "estado";

  if (accion === "generar") return Response.json(generarXML(payload.documento));
  if (accion === "firmar") return Response.json(firmar(payload.xml ?? ""));
  if (accion === "transmitir") return Response.json(transmitir(payload.xml_firmado ?? ""));
  if (accion === "validar") return Response.json(validar(payload.respuesta));

  return Response.json({
    estado: "stub_f4",
    mensaje: "Modulo DIAN aislado. Firmar/transmitir/validar estan bloqueados hasta F6.",
  });
});
