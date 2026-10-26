/**
 * Object storage sementara (DEC-036), privat. Semua objek room di bawah `rooms/{roomId}/` supaya
 * cleanup room bisa menghapus & memverifikasi per prefix (15 §8). Akses klien HANYA lewat URL
 * bertanda tangan berumur pendek (PUT untuk upload, GET ≤ 10 menit untuk baca).
 */
export interface PresignedPut {
  url: string;
  /** Header yang wajib dikirim klien (Content-Type ikut ditandatangani). */
  headers: Record<string, string>;
}

export interface ObjectStorage {
  readonly kind: string;
  list(prefix: string): Promise<string[]>;
  /** Hapus maksimal 1000 key per panggilan (batas batch S3). */
  deleteMany(keys: string[]): Promise<void>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Baca objek; null bila tidak ada; ditolak (null) bila lebih besar dari maxBytes. */
  get(key: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Ukuran objek (byte) atau null bila tidak ada. */
  size(key: string): Promise<number | null>;
  presignPut(key: string, opts: { contentType: string; bytes: number; expiresSec: number }): Promise<PresignedPut>;
  presignGet(key: string, expiresSec: number): Promise<string>;
}

export const DELETE_BATCH = 1000;

export function roomPrefix(roomId: string): string {
  return `rooms/${roomId}/`;
}

export function framePrefix(roomId: string): string {
  return `${roomPrefix(roomId)}frames/`;
}
