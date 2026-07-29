# DIAN - Integracion futura F6

Este documento queda como checklist para una fase futura. F4 no transmite documentos a la DIAN.

## Fuentes oficiales consultadas

- Sistema de Factura Electronica DIAN: https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/
- Documento Equivalente Electronico DIAN: https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documento-equivalente-electronico/
- Numeracion de facturacion DIAN: https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/numeracion-autorizacion/

## Pendiente administrativo

- Confirmar RUT y responsabilidad como facturador electronico.
- Obtener o confirmar firma electronica/certificado digital.
- Definir si se usara proveedor tecnologico o desarrollo propio.
- Solicitar rangos oficiales de numeracion.
- Completar set de pruebas DIAN.
- Confirmar datos legales del emisor: NIT, razon social, direccion, municipio, responsabilidades fiscales.
- Validar tarifas IVA/INC/impoconsumo por producto con contador.

## Pendiente tecnico F6

- Generar XML UBL 2.1 real segun anexo tecnico vigente.
- Implementar firma XAdES.
- Transmitir a servicios DIAN.
- Persistir CUFE/CUDE real, XML, PDF y respuesta DIAN.
- Implementar notas credito/debito reales.
- Implementar contingencia y reintentos.
- Reemplazar estados `*_futuro` por estados operativos reales.

## Politica actual F4

- `documentos.estado_dian` permanece `no_transmitido`.
- Los comprobantes se rotulan como internos y no fiscales.
- `supabase/functions/dian` contiene stubs bloqueados para firmar/transmitir/validar.
