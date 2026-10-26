/**
 * Modul kamera (09 §1–§2). VIDEO SAJA: `audio: false` selalu (DEC-076 default). Tidak ada jalur kode yang
 * meminta mikrofon. Kamera hanya dinyalakan dari gesture pengguna di perangkat pemilik (REQ-CAM-13).
 */

export type CameraErrorKind = "denied" | "unavailable" | "in_use" | "unsupported";

export class CameraError extends Error {
  constructor(readonly kind: CameraErrorKind) {
    super(kind);
    this.name = "CameraError";
  }
}

export type Facing = "user" | "environment";

/** Pemetaan error DOM → state UI (09 §1.1). */
export function mapCameraError(err: unknown): CameraErrorKind {
  const name = (err as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "unavailable";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in_use";
    case "TypeError":
      return "unsupported";
    default:
      return "in_use";
  }
}

/** Urutan constraint: 1080p → 720p → 480p (fallback diam-diam, 09 §1.1). */
export const RESOLUTION_TIERS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 640, height: 480 },
] as const;

export function buildConstraints(opts: { deviceId?: string | null; facing?: Facing; tier: number }): MediaStreamConstraints {
  const t = RESOLUTION_TIERS[Math.min(opts.tier, RESOLUTION_TIERS.length - 1)]!;
  const video: MediaTrackConstraints = {
    width: { ideal: t.width },
    height: { ideal: t.height },
    frameRate: { ideal: 30, max: 30 },
  };
  if (opts.deviceId) video.deviceId = { exact: opts.deviceId };
  else video.facingMode = opts.facing ?? "user";
  return { video, audio: false };
}

export function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && (typeof isSecureContext === "undefined" || isSecureContext);
}

/**
 * Buka kamera. `OverconstrainedError` karena resolusi → turun tier; deviceId tersimpan yang sudah tidak ada
 * → coba lagi tanpa deviceId. Error lain dipetakan ke CameraError.
 */
export async function openCamera(opts: { deviceId?: string | null; facing?: Facing } = {}): Promise<MediaStream> {
  if (!cameraSupported()) throw new CameraError("unsupported");
  let deviceId = opts.deviceId ?? null;
  for (let tier = 0; tier < RESOLUTION_TIERS.length; tier++) {
    try {
      return await navigator.mediaDevices.getUserMedia(buildConstraints({ deviceId, facing: opts.facing, tier }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (deviceId && (name === "NotFoundError" || name === "OverconstrainedError")) {
        deviceId = null;
        tier = -1;
        continue;
      }
      if (name === "OverconstrainedError" && tier < RESOLUTION_TIERS.length - 1) continue;
      throw new CameraError(mapCameraError(err));
    }
  }
  throw new CameraError("unavailable");
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "videoinput");
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

const PREF_KEY = "lr:camDeviceId";

/** Preferensi lokal (bukan data room). */
export function getPreferredDeviceId(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

export function setPreferredDeviceId(id: string | null) {
  try {
    if (id) localStorage.setItem(PREF_KEY, id);
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* penyimpanan diblokir: abaikan */
  }
}

/** true bila izin kamera sudah granted (tidak semua browser mendukung Permissions API). */
export async function cameraPermissionGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
    return status?.state === "granted";
  } catch {
    return false;
  }
}
