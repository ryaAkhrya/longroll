import { LIMITS } from "@longroll/shared";
import { ApiError } from "./api";

/** Copy error 03 F-02/F-03 & 07 §4. Selalu: apa yang salah + apa yang bisa dilakukan. */
export function errorMessage(err: unknown, ctx: { code?: string; action?: "create" | "join" } = {}): string {
  if (!(err instanceof ApiError)) return "Ada yang error. Coba lagi.";
  switch (err.code) {
    case "NETWORK":
      return "Gagal terhubung ke server. Cek koneksi, lalu coba lagi.";
    case "ROOM_NOT_FOUND":
    case "ROOM_EXPIRED":
      return `Room ${ctx.code ?? ""} gak ketemu. Mungkin salah ketik, atau room-nya udah bubar.`.replace("  ", " ");
    case "ROOM_FULL":
      return err.body?.reason === "HOLD"
        ? "Room penuh. Ada yang lagi nyambung lagi, coba sebentar lagi."
        : `Udah ${LIMITS.maxParticipants} orang di dalem.`;
    case "NAME_INVALID":
      if (err.body?.reason === "NAME_TOO_LONG") return `Maksimal ${LIMITS.displayNameMax} karakter.`;
      if (err.body?.reason === "NAME_CHARS") return "Pakai huruf, angka, spasi, atau emoji aja.";
      return "Isi nama panggilan dulu.";
    case "RATE_LIMITED":
      return ctx.action === "create"
        ? "Terlalu banyak room dibuat dari jaringan ini. Coba lagi sebentar lagi."
        : "Kebanyakan percobaan. Tunggu sebentar, lalu coba lagi.";
    case "ORIGIN_FORBIDDEN":
      return "Permintaan ditolak oleh server. Muat ulang halaman ini.";
    case "SERVICE_UNAVAILABLE":
      return "Server lagi gangguan. Coba lagi sebentar lagi.";
    default:
      return "Ada yang error. Coba lagi.";
  }
}

export function nameError(reason: "EMPTY" | "TOO_LONG" | "CHARS"): string {
  if (reason === "TOO_LONG") return `Maksimal ${LIMITS.displayNameMax} karakter.`;
  if (reason === "CHARS") return "Pakai huruf, angka, spasi, atau emoji aja.";
  return "Isi nama panggilan dulu.";
}
