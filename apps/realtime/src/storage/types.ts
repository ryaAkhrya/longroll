/**
 * Object storage sementara (DEC-036). P02 belum mengunggah apa pun; adapter ini dipakai cleanup
 * room (15 §8.2) dan diuji dengan objek dummy. Adapter S3/R2 ditambahkan saat upload pertama (P05/P06).
 */
export interface ObjectStorage {
  readonly kind: string;
  list(prefix: string): Promise<string[]>;
  /** Hapus maksimal 1000 key per panggilan (batas batch S3). */
  deleteMany(keys: string[]): Promise<void>;
}

export const DELETE_BATCH = 1000;

export function roomPrefix(roomId: string): string {
  return `rooms/${roomId}/`;
}
