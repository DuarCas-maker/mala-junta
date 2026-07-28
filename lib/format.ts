export function formatoCOP(valor: number | string | null | undefined) {
  const numero = Number(valor ?? 0);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(numero);
}

export function estadoPedidoTexto(estado: string) {
  const mapa: Record<string, string> = {
    enviado: "Enviado",
    en_preparacion: "En preparación",
    entregado: "Entregado",
    anulado: "Anulado",
  };
  return mapa[estado] ?? estado;
}
