import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@longroll/shared";

/** Kode room 6 karakter, CSPRNG tanpa bias (randomInt), alfabet DEC-022. */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** Token peserta: 32 byte CSPRNG, base64url (07 §3). Rahasia, tidak pernah dicatat. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Server hanya menyimpan hash SHA-256 token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Pembandingan hash constant-time. */
export function hashEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** IP disimpan sebagai HMAC bersalt (15 §9), bukan IP mentah. */
export function hashIp(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(ip).digest("base64url").slice(0, 22);
}

/** UUIDv7 (14 §1) untuk roomId: 48 bit waktu + acak. */
export function uuidv7(nowMs = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(nowMs);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
