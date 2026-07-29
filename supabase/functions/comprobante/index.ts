// F4 stub: comprobante interno no fiscal. No transmite a DIAN.
// TODO F6: reemplazar simulacion por generacion PDF/HTML persistida en Storage y envio real.

type Payload = {
  documento_id?: string;
  canal?: "correo" | "whatsapp";
  destino?: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Metodo no permitido" }, { status: 405 });
  }

  const payload = (await req.json().catch(() => ({}))) as Payload;

  if (!payload.documento_id) {
    return Response.json({ error: "documento_id requerido" }, { status: 400 });
  }

  return Response.json({
    documento_id: payload.documento_id,
    canal: payload.canal ?? "correo",
    destino: payload.destino ?? null,
    estado: "simulado",
    etiqueta: "COMPROBANTE INTERNO - DOCUMENTO NO FISCAL - NO TRANSMITIDO A LA DIAN",
    mensaje: "F4 solo registra la solicitud. Envio real queda para configuracion SMTP/WhatsApp futura.",
  });
});
