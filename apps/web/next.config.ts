import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";
const realtimeWs = realtimeUrl.replace(/^http/, "ws");
// Object storage S3-compatible (frame custom, P05): signed URL baca/tulis langsung ke origin storage.
// Kosong = storage lokal yang disajikan service realtime.
const storageOrigin = process.env.NEXT_PUBLIC_STORAGE_ORIGIN?.trim() ?? "";

/**
 * CSP awal (15 §6). script-src memakai 'unsafe-inline' karena Next menyisipkan skrip inline;
 * upgrade ke nonce/hash lewat middleware dicatat sebagai risiko terbuka di handoff.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${realtimeUrl}${storageOrigin ? ` ${storageOrigin}` : ""}`,
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src 'self' ${realtimeUrl} ${realtimeWs}${storageOrigin ? ` ${storageOrigin}` : ""}${isDev ? " ws://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@longroll/shared"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Mikrofon dinonaktifkan selama DEC-076 OPEN.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/fonts/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
