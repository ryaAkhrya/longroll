import { deflateSync } from "node:zlib";
import sharp from "sharp";

/** Gambar uji frame (dibuat on-the-fly; tidak ada file biner di repo). */

/** PNG 1200×1800 opak dengan `holes` lubang transparan (persegi). */
export async function framePng(w = 1200, h = 1800, holes = 4, extra: { text?: string } = {}): Promise<Buffer> {
  const rects = Array.from({ length: holes }, (_, i) => {
    const hh = (h - 100 * (holes + 1)) / holes;
    return `<rect x="100" y="${100 + i * (hh + 100)}" width="${w - 200}" height="${hh}" fill="black"/>`;
  }).join("");
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="white"/>${rects}</svg>`);
  const alpha = await sharp(mask).greyscale().raw().toBuffer();
  const base = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 240, g: 220, b: 200 } } }).raw().toBuffer();
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = base[i * 3]!;
    rgba[i * 4 + 1] = base[i * 3 + 1]!;
    rgba[i * 4 + 2] = base[i * 3 + 2]!;
    rgba[i * 4 + 3] = alpha[i]!;
  }
  let img = sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png();
  if (extra.text) img = img.withMetadata({ exif: { IFD0: { ImageDescription: extra.text } } });
  return img.toBuffer();
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Decompression bomb: header 30000×30000 dengan IDAT kecil (zlib dari nol). */
export function bombPng(side = 30000) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + side * 4);
  const idat = deflateSync(Buffer.concat(Array.from({ length: 64 }, () => row)), { level: 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** WebP animasi minimal (VP8X flag animasi + ANIM + 2 × ANMF) dibangun manual dari frame statis. */
export async function animatedWebp(w: number, h: number) {
  const still = await sharp({ create: { width: w, height: h, channels: 4, background: "#f00f" } }).webp({ lossless: true }).toBuffer();
  const image = still.subarray(12); // chunk VP8L
  const u24 = (n: number) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);
  const riffChunk = (name: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(data.length);
    return Buffer.concat([Buffer.from(name, "ascii"), len, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8x = riffChunk("VP8X", Buffer.concat([Buffer.from([0x12, 0, 0, 0]), u24(w - 1), u24(h - 1)]));
  const animChunk = riffChunk("ANIM", Buffer.from([0, 0, 0, 0, 0, 0]));
  const frame = riffChunk("ANMF", Buffer.concat([u24(0), u24(0), u24(w - 1), u24(h - 1), u24(100), Buffer.from([0]), image]));
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), vp8x, animChunk, frame, frame]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), size, body]);
}

/** Sisipkan chunk acTL (APNG) setelah IHDR. */
export function asApng(png: Buffer) {
  const ihdrEnd = 8 + 12 + 13;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk("acTL", actl), png.subarray(ihdrEnd)]);
}
