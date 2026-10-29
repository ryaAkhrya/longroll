import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Header statis (15 §6). Content-Security-Policy TIDAK diatur di sini: CSP final memakai nonce per-request
 * sehingga dibangun di `src/proxy.ts` (builder murni: `src/security/csp.ts`).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@longroll/shared"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
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
