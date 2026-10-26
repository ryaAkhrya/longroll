import type { S2C } from "@longroll/shared";
import type { RoomState } from "../room/types";

/** Gagal membaca/menulis penyimpanan room (PostgreSQL). Dipetakan ke SERVICE_UNAVAILABLE. */
export class StoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Room store unavailable");
    this.name = "StoreUnavailableError";
    this.cause = cause;
  }
}

/**
 * Revisi tersimpan berbeda dari yang diharapkan actor (penulis lain / commit ambigu setelah koneksi
 * putus). Actor harus memuat ulang state dari store sebelum menulis lagi.
 */
export class StaleRevisionError extends Error {
  constructor(readonly roomId: string) {
    super("Stale room revision");
    this.name = "StaleRevisionError";
  }
}

export const TOMBSTONE = "EXPIRED";

export interface SaveRoomInput {
  state: RoomState;
  /** Revisi yang dibaca actor sebelum mutasi (optimistic concurrency). 0 = room baru. */
  expectedRevision: number;
  /** Event non-volatile hasil mutasi ini (sudah ber-seq). */
  events: S2C[];
  /** Hanya peserta yang berubah yang ditulis. */
  changedParticipantIds: string[];
  /** Hanya sesi yang berubah yang ditulis. */
  changedSessionIds?: string[];
  /** Frame custom yang berubah / dihapus (upload gagal atau kedaluwarsa). */
  changedFrameIds?: string[];
  deletedFrameIds?: string[];
}

export interface LoadedRoom {
  state: RoomState;
  /** Event terakhir (maks. eventBufferSize) untuk replay resume setelah restart. */
  events: S2C[];
}

/**
 * Persistensi state room sementara. Tidak ada TTL otomatis: kedaluwarsa & pembersihan dikerjakan
 * eksplisit oleh RoomActor (grace) + RoomCleanup + purgeExpired() (tombstone & rate limit).
 *
 * Yang TIDAK pernah ditulis ke store: kursor, heartbeat, awareness (volatile, memori proses).
 */
export interface RoomStore {
  readonly kind: "postgres" | "memory";
  ping(): Promise<boolean>;
  /** Pesan kode unik. Tombstone yang belum habis memblokir pemakaian ulang (DEC-084). */
  reserveCode(code: string, roomId: string): Promise<boolean>;
  /** Hapus reservasi hanya bila masih menunjuk roomId tersebut (create gagal). */
  releaseCode(code: string, roomId: string): Promise<void>;
  resolveCode(code: string): Promise<string | typeof TOMBSTONE | null>;
  /** Satu transaksi: room + peserta yang berubah + event baru (+ pangkas event lama). */
  saveRoom(input: SaveRoomInput): Promise<void>;
  loadRoom(roomId: string): Promise<LoadedRoom | null>;
  /** Room yang perlu dipulihkan setelah restart (ACTIVE/GRACE/EXPIRING). */
  listRecoverableRooms(): Promise<{ roomId: string; code: string }[]>;
  /** Satu transaksi: hapus semua data room (cascade) + tulis tombstone kode. Idempoten. */
  finalizeExpiredRoom(roomId: string, code: string, tombstoneSeconds: number): Promise<void>;
  /** Jumlah baris tersisa milik room (verifikasi cleanup, harus 0). */
  countRoomData(roomId: string): Promise<number>;
  /** Counter fixed-window; mengembalikan nilai setelah increment. */
  hit(key: string, windowSeconds: number): Promise<number>;
  /** Nilai counter window berjalan tanpa increment. */
  peek(key: string, windowSeconds: number): Promise<number>;
  /** Hapus tombstone & counter rate limit yang sudah lewat, serta reservasi kode yatim. */
  purgeExpired(): Promise<{ tombstones: number; rateLimits: number; staleReservations: number }>;
  close(): Promise<void>;
}

/** Awal window fixed-window rate limit (ms). */
export function windowStartMs(windowSeconds: number, nowMs = Date.now()): number {
  const w = windowSeconds * 1000;
  return Math.floor(nowMs / w) * w;
}
