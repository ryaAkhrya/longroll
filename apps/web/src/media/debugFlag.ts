/**
 * Saklar diagnostik WebRTC di produksi: `?rtcdebug=1` pada URL (disimpan di localStorage supaya bertahan antar-halaman),
 * `?rtcdebug=0` mematikan. Tanpa saklar, tidak ada panel dan tidak ada jejak yang dikumpulkan di produksi.
 */
const KEY = "lr:rtcdebug";
const RELAY_KEY = "lr:rtcrelay";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function write(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* penyimpanan diblokir: saklar hanya berlaku untuk sesi ini */
  }
}

/** Membaca ?rtcdebug= dari URL sekali (dan menyimpannya), lalu mengembalikan status. */
export function rtcDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("rtcdebug");
    if (q === "1") write(KEY, true);
    else if (q === "0") {
      write(KEY, false);
      write(RELAY_KEY, false);
    }
  } catch {
    /* URL tak terbaca */
  }
  return read(KEY);
}

/** Paksa relay-only (uji TURN): hanya berlaku bila diagnostik aktif. */
export function rtcForceRelay(): boolean {
  return typeof window !== "undefined" && rtcDebugEnabled() && read(RELAY_KEY);
}
export function setRtcForceRelay(on: boolean) {
  write(RELAY_KEY, on);
}
