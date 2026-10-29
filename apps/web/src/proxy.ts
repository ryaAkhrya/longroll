import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildCsp, cspEnvFromProcess, makeNonce } from "@/security/csp";

/**
 * CSP dengan nonce per-request (15 §6, TH-03). Next.js membaca nonce dari header CSP request dan menerapkannya
 * pada skrip/gaya inline miliknya sendiri. Konsekuensi: semua halaman dirender dinamis (layout membaca headers()).
 */
export function proxy(request: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp(nonce, cspEnvFromProcess());
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  // Katalog komponen hanya untuk development. Dijawab di sini (sebelum streaming) supaya statusnya benar-benar 404,
  // bukan 200 dengan halaman not-found (notFound() di dalam page sudah terlambat setelah shell loading.tsx terkirim).
  const hidden = process.env.NODE_ENV === "production" && (request.nextUrl.pathname === "/dev" || request.nextUrl.pathname.startsWith("/dev/"));
  const response = hidden
    ? NextResponse.rewrite(new URL("/__tidak-ada", request.url), { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|fonts|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
