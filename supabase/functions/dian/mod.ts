export type DianDocumento = {
  documento_id: string;
  tipo: "pos" | "factura_venta" | "nota_credito" | "nota_debito";
};

export function generarXML(_documento: DianDocumento) {
  return {
    estado: "stub",
    xml: null,
    TODO: "F6: generar UBL 2.1 segun anexo tecnico DIAN vigente y datos reales del emisor.",
  };
}

export function firmar(_xml: string) {
  return {
    estado: "bloqueado_f4",
    firmado: null,
    TODO: "F6: firma XAdES con certificado digital del facturador electronico.",
  };
}

export function transmitir(_xmlFirmado: string) {
  return {
    estado: "bloqueado_f4",
    respuesta_dian: null,
    TODO: "F6: transmision a servicios DIAN solo tras habilitacion, set de pruebas y rangos autorizados.",
  };
}

export function validar(_respuesta: unknown) {
  return {
    estado: "bloqueado_f4",
    validado: false,
    TODO: "F6: validacion CUFE/CUDE y respuesta real DIAN.",
  };
}
