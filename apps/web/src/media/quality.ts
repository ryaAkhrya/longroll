/**
 * Adaptasi kualitas kirim (DEC-072, 09 §5): ≤ 640×480 @ 30 fps ≈ 500 kbps; turun ke 320×240, lalu 12 fps
 * berdasarkan `availableOutgoingBitrate` (stats tiap 2 s). Naik lagi setelah 3 sampel bagus berturut-turut.
 */
export interface QualityLevel {
  maxBitrate: number;
  maxWidth: number;
  maxHeight: number;
  maxFramerate: number;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { maxBitrate: 500_000, maxWidth: 640, maxHeight: 480, maxFramerate: 30 },
  { maxBitrate: 250_000, maxWidth: 320, maxHeight: 240, maxFramerate: 24 },
  { maxBitrate: 150_000, maxWidth: 320, maxHeight: 240, maxFramerate: 12 },
];

/** Bitrate keluar minimum (bps) agar level tetap dipertahankan. */
const DOWN_THRESHOLD = [350_000, 180_000];
/** Bitrate keluar yang dianggap cukup untuk naik satu level. */
const UP_THRESHOLD = [0, 650_000, 320_000];
const UP_STREAK = 3;

export interface QualityState {
  level: number;
  goodStreak: number;
}

/** Fungsi murni: sampel bitrate (bps) terendah antar-peer → level berikutnya. */
export function nextQuality(state: QualityState, availableBps: number | null): QualityState {
  if (availableBps === null || !Number.isFinite(availableBps)) return state;
  const { level } = state;
  if (level < QUALITY_LEVELS.length - 1 && availableBps < DOWN_THRESHOLD[level]!) return { level: level + 1, goodStreak: 0 };
  if (level > 0 && availableBps >= UP_THRESHOLD[level]!) {
    const goodStreak = state.goodStreak + 1;
    return goodStreak >= UP_STREAK ? { level: level - 1, goodStreak: 0 } : { level, goodStreak };
  }
  return { level, goodStreak: 0 };
}

/** Parameter encoding untuk track berukuran (w × h) pada level tertentu. */
export function encodingFor(level: number, trackWidth: number, trackHeight: number) {
  const q = QUALITY_LEVELS[Math.max(0, Math.min(level, QUALITY_LEVELS.length - 1))]!;
  const long = Math.max(trackWidth, trackHeight) || q.maxWidth;
  const short = Math.min(trackWidth, trackHeight) || q.maxHeight;
  const scale = Math.max(1, long / q.maxWidth, short / q.maxHeight);
  return { maxBitrate: q.maxBitrate, maxFramerate: q.maxFramerate, scaleResolutionDownBy: Math.round(scale * 100) / 100 };
}
