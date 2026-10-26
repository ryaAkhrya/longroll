import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Token URL bertanda tangan untuk adapter storage LOKAL (memori/folder) — meniru presigned URL S3:
 * key + metode + kedaluwarsa (+ Content-Type & batas byte untuk PUT) di-HMAC. Disajikan service
 * realtime di `/api/storage/{token}`. Rahasia acak per proses bila tidak dikonfigurasi (URL lama
 * otomatis tidak berlaku setelah restart — aman, TTL-nya memang pendek).
 */
export interface SignedClaims {
  k: string;
  m: "GET" | "PUT";
  e: number;
  ct?: string;
  max?: number;
}

export class LocalUrlSigner {
  private readonly secret: Buffer;

  constructor(
    /** Origin HTTP publik service realtime (bisa diset setelah listen, mis. port acak di tes). */
    public publicBaseUrl: string,
    secret?: string | null,
  ) {
    this.secret = secret ? Buffer.from(secret, "utf8") : randomBytes(32);
  }

  sign(claims: SignedClaims): string {
    const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const mac = createHmac("sha256", this.secret).update(body).digest("base64url");
    return `${this.publicBaseUrl.replace(/\/$/, "")}/api/storage/${body}.${mac}`;
  }

  /** Verifikasi token (bagian path setelah /api/storage/). null bila palsu/kedaluwarsa. */
  verify(token: string, nowMs = Date.now()): SignedClaims | null {
    const dot = token.indexOf(".");
    if (dot <= 0 || token.length > 2048) return null;
    const body = token.slice(0, dot);
    const mac = Buffer.from(token.slice(dot + 1), "base64url");
    const expect = createHmac("sha256", this.secret).update(body).digest();
    if (mac.length !== expect.length || !timingSafeEqual(mac, expect)) return null;
    try {
      const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedClaims;
      if (typeof c.k !== "string" || (c.m !== "GET" && c.m !== "PUT") || typeof c.e !== "number") return null;
      if (c.e * 1000 <= nowMs) return null;
      return c;
    } catch {
      return null;
    }
  }
}
