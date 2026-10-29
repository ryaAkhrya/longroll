import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "LONGROLL — Photobooth bareng, dari mana aja", template: "%s · LONGROLL" },
  description:
    "Photobooth online buat sampai 4 orang. Satu room, empat kamera, tanpa akun dan tanpa host. Room sementara: foto dan datanya dihapus setelah room kedaluwarsa.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F6F3EE",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // CSP bernonce (proxy.ts): membaca headers() membuat seluruh halaman dirender dinamis per-request sehingga Next
  // dapat memasang nonce pada skrip inline-nya. Nilainya sendiri dibaca Next dari header CSP.
  await headers();
  return (
    <html lang="id" data-scroll-behavior="smooth">
      <head>
        {/* Preload font halaman pertama (Bricolage + Figtree). Instrument Serif dimuat saat dipakai. */}
        <link rel="preload" href="/fonts/bricolage-grotesque-wdth.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/figtree-wght.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
