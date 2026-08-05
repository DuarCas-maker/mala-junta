import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mala Junta POS",
    short_name: "Mala Junta",
    description: "PWA operativa para pedidos, caja y administracion.",
    start_url: "/login",
    display: "standalone",
    background_color: "#f7f6f2",
    theme_color: "#101317",
    lang: "es-CO",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}

