import { LIMITS } from "./config";

export type DisplayNameResult = { ok: true; value: string } | { ok: false; reason: "EMPTY" | "TOO_LONG" | "CHARS" };

// DEC-043: huruf, angka, spasi, emoji (termasuk ZWJ, variation selector, modifier, regional indicator).
const ALLOWED = /^(?:[\p{L}\p{M}\p{N} ]|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200D|\uFE0F)+$/u;
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const KEEP_FORMAT = /[\u200D\uFE0F]/u;

/** Panjang dalam code point (emoji multi-unit tidak dihitung ganda). */
export function nameLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Normalisasi + validasi display name (DEC-043). Dipakai klien (UX) dan server (otoritatif).
 * Kontrol karakter dibuang, spasi dirapatkan, NFC. Nama selalu dirender sebagai teks.
 */
export function validateDisplayName(input: unknown): DisplayNameResult {
  if (typeof input !== "string") return { ok: false, reason: "EMPTY" };
  const cleaned = input
    .normalize("NFC")
    .replace(CONTROL, (ch) => (KEEP_FORMAT.test(ch) ? ch : ""))
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned.length === 0) return { ok: false, reason: "EMPTY" };
  if (nameLength(cleaned) > LIMITS.displayNameMax) return { ok: false, reason: "TOO_LONG" };
  if (!ALLOWED.test(cleaned)) return { ok: false, reason: "CHARS" };
  return { ok: true, value: cleaned };
}

/** Sufiks " 2", " 3", … untuk nama duplikat di room (DEC-043), tetap ≤ batas panjang. */
export function uniqueDisplayName(name: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (n) => n.toLocaleLowerCase("id")));
  if (!used.has(name.toLocaleLowerCase("id"))) return name;
  for (let i = 2; i < 100; i++) {
    const suffix = ` ${i}`;
    const base = Array.from(name).slice(0, LIMITS.displayNameMax - suffix.length).join("").trimEnd();
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase("id"))) return candidate;
  }
  return name;
}
