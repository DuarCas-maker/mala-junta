import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mala Junta POS",
  description: "POS y gestión operativa para Mala Junta",
  applicationName: "Mala Junta",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mala Junta",
  },
};

export const viewport: Viewport = {
  themeColor: "#101317",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  );
}
