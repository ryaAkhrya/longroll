/**
 * Konfigurasi terpusat. Nilai PROPOSED (18): jangan tersebar sebagai angka di komponen.
 * Menurunkan technical safeguard butuh persetujuan pemilik produk.
 */
export const LIMITS = {
  /** DEC-003 (CONFIRMED) */
  maxParticipants: 4,
  /** DEC-043 (PROPOSED) */
  displayNameMax: 20,
  /** DEC-042 (PROPOSED, technical safeguard) */
  maxShots: 8,
  /** DEC-053 (PROPOSED, technical safeguard) */
  maxSessionsPerRoom: 20,
} as const;

/** DEC-020 (OPEN, default PROPOSED): dipakai untuk copy SCR-21; server memakai env ROOM_GRACE_PERIOD_SECONDS di P02. */
export const DEFAULT_ROOM_GRACE_PERIOD_SECONDS = 120;

/** DEC-022 (PROPOSED): 32 karakter tanpa yang ambigu (0/O, 1/I). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
