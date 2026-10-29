import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { CAPTURE_CONFIG } from "@longroll/shared";
import type { AttemptPartName } from "@longroll/shared";
import { RoomError } from "../room/types";
import type { ObjectStorage } from "../storage/types";

sharp.cache(false);
sharp.concurrency(1);

export interface UploadVerifyInput {
  key: string;
  /** Hanya untuk part full: key varian editor (<= 1600 px) yang dibuat server. */
  editKey?: string | null;
  part: AttemptPartName;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}

/** Magic bytes JPEG (SOI + marker). Foto dibuat dari canvas → selalu JPEG (09 §7.3). */
export function isJpeg(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/**
 * Verifikasi objek attempt di storage SEBELUM ditandai ready (09 §7.2, 15 §7):
 * objek ada → ukuran sama dengan klaim → sha256 sama → JPEG sungguhan (magic bytes + decode aman, batas
 * piksel) → dimensi sama dengan klaim → di-encode ulang tanpa metadata (EXIF/GPS/ICC dibuang) dan
 * menimpa objek. Ketidakcocokan → UPLOAD_MISMATCH; file bukan JPEG/rusak → UPLOAD_MISMATCH.
 * Mengembalikan ukuran akhir (byte setelah re-encode).
 */
export async function verifyAttemptUpload(
  storage: ObjectStorage,
  input: UploadVerifyInput,
): Promise<{ finalBytes: number; edit: { bytes: number; width: number; height: number } | null }> {
  const max = input.part === "preview" ? CAPTURE_CONFIG.maxPreviewBytes : CAPTURE_CONFIG.maxFullBytes;
  const size = await storage.size(input.key);
  if (size === null) throw new RoomError("UPLOAD_MISMATCH", "MISSING");
  if (size !== input.bytes || size > max) throw new RoomError("UPLOAD_MISMATCH", "SIZE");
  const raw = await storage.get(input.key, max);
  if (!raw) throw new RoomError("UPLOAD_MISMATCH", "MISSING");
  if (createHash("sha256").update(raw).digest("hex") !== input.sha256) throw new RoomError("UPLOAD_MISMATCH", "SHA256");
  if (!isJpeg(raw)) throw new RoomError("UPLOAD_MISMATCH", "FORMAT");

  const maxPx = input.part === "preview" ? CAPTURE_CONFIG.previewMaxPx : CAPTURE_CONFIG.fullMaxPx;
  const limit = maxPx * maxPx;
  let meta: Metadata;
  try {
    meta = await sharp(raw, { limitInputPixels: false, failOn: "error" }).metadata();
  } catch {
    throw new RoomError("UPLOAD_MISMATCH", "DECODE");
  }
  if (meta.format !== "jpeg" || !meta.width || !meta.height) throw new RoomError("UPLOAD_MISMATCH", "FORMAT");
  if (meta.width * meta.height > limit || Math.max(meta.width, meta.height) > maxPx) throw new RoomError("UPLOAD_MISMATCH", "DIMENSIONS");
  if (meta.width !== input.width || meta.height !== input.height) throw new RoomError("UPLOAD_MISMATCH", "DIMENSIONS");
  let clean: Buffer;
  try {
    // Tanpa .withMetadata(): libvips membuang EXIF/XMP/IPTC/ICC. Orientasi tidak dipakai (canvas sudah lurus).
    clean = await sharp(raw, { limitInputPixels: limit, failOn: "error" })
      .jpeg({ quality: input.part === "preview" ? 85 : 95, chromaSubsampling: "4:4:4" })
      .toBuffer();
  } catch {
    throw new RoomError("UPLOAD_MISMATCH", "DECODE");
  }
  await storage.put(input.key, clean, "image/jpeg");
  // Varian editor (P07): <= 1600 px supaya 16 foto tidak membebani memori HP; full tetap untuk export (P08).
  let edit: { bytes: number; width: number; height: number } | null = null;
  if (input.part === "full" && input.editKey) {
    try {
      const small = await sharp(clean, { limitInputPixels: limit }).resize({ width: CAPTURE_CONFIG.editMaxPx, height: CAPTURE_CONFIG.editMaxPx, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      await storage.put(input.editKey, small.data, "image/jpeg");
      edit = { bytes: small.data.byteLength, width: small.info.width, height: small.info.height };
    } catch {
      throw new RoomError("UPLOAD_MISMATCH", "DECODE");
    }
  }
  return { finalBytes: clean.byteLength, edit };
}

/** Magic bytes WebP (RIFF....WEBP). */
export function isWebp(b: Uint8Array): boolean {
  return b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP";
}

/**
 * Pratinjau hasil sesi (12 2, 15 7): objek ada, <= 1 MB, sha256 cocok, WebP sungguhan (magic bytes + decode aman),
 * sisi terpanjang <= 1600 px. Di-encode ulang tanpa metadata lalu menimpa objek.
 */
export async function verifyResultPreview(storage: ObjectStorage, key: string, claim: { bytes: number; sha256: string }, maxBytes: number, maxPx: number): Promise<{ bytes: number; width: number; height: number }> {
  const size = await storage.size(key);
  if (size === null) throw new RoomError("UPLOAD_MISMATCH", "MISSING");
  if (size !== claim.bytes || size > maxBytes) throw new RoomError("UPLOAD_MISMATCH", "SIZE");
  const raw = await storage.get(key, maxBytes);
  if (!raw) throw new RoomError("UPLOAD_MISMATCH", "MISSING");
  if (createHash("sha256").update(raw).digest("hex") !== claim.sha256) throw new RoomError("UPLOAD_MISMATCH", "SHA256");
  if (!isWebp(raw)) throw new RoomError("UPLOAD_MISMATCH", "FORMAT");
  let meta: Metadata;
  try {
    meta = await sharp(raw, { limitInputPixels: false, failOn: "error" }).metadata();
  } catch {
    throw new RoomError("UPLOAD_MISMATCH", "DECODE");
  }
  if (meta.format !== "webp" || !meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new RoomError("UPLOAD_MISMATCH", "FORMAT");
  if (Math.max(meta.width, meta.height) > maxPx || meta.width * meta.height > maxPx * maxPx) throw new RoomError("UPLOAD_MISMATCH", "DIMENSIONS");
  try {
    const clean = await sharp(raw, { limitInputPixels: maxPx * maxPx, failOn: "error" }).webp({ quality: 86 }).toBuffer({ resolveWithObject: true });
    await storage.put(key, clean.data, "image/webp");
    return { bytes: clean.data.byteLength, width: clean.info.width, height: clean.info.height };
  } catch {
    throw new RoomError("UPLOAD_MISMATCH", "DECODE");
  }
}
