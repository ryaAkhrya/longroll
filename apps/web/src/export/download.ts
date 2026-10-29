/**
 * Unduh per platform (12 §5). Keputusan metode murni (`chooseDelivery`) supaya bisa diuji tanpa browser;
 * `deliver` menjalankannya dengan lingkungan yang bisa diganti di tes.
 */

export type DeliveryMethod = "anchor" | "share" | "newtab";

export interface DeliveryEnv {
  userAgent: string;
  maxTouchPoints: number;
  platform: string;
  /** `navigator.canShare({files:[file]})` untuk file ini. */
  canShareFile: boolean;
  /** `HTMLAnchorElement.prototype` punya `download`. */
  anchorDownload: boolean;
}

export function isIos(env: Pick<DeliveryEnv, "userAgent" | "maxTouchPoints" | "platform">): boolean {
  if (/iPad|iPhone|iPod/.test(env.userAgent)) return true;
  // iPadOS 13+ mengaku Mac tetapi punya layar sentuh.
  return env.platform === "MacIntel" && env.maxTouchPoints > 1;
}

export function chooseDelivery(env: DeliveryEnv): DeliveryMethod {
  if (isIos(env)) return env.canShareFile ? "share" : "newtab";
  return env.anchorDownload ? "anchor" : env.canShareFile ? "share" : "newtab";
}

export interface DeliveryResult {
  method: DeliveryMethod;
  /** Pengguna menutup share sheet tanpa memilih (bukan galat). */
  cancelled: boolean;
}

export const DELIVERY_TOAST: Record<DeliveryMethod, string> = {
  anchor: "Tersimpan di Unduhan",
  share: "Siap disimpan",
  newtab: "Tekan lama gambar → Simpan ke Foto",
};

export function currentEnv(file: File): DeliveryEnv {
  const nav = typeof navigator === "undefined" ? ({} as Navigator) : navigator;
  let canShareFile = false;
  try {
    canShareFile = typeof nav.canShare === "function" && nav.canShare({ files: [file] });
  } catch {
    canShareFile = false;
  }
  return {
    userAgent: nav.userAgent ?? "",
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    platform: nav.platform ?? "",
    canShareFile,
    anchorDownload: typeof document !== "undefined" && "download" in document.createElement("a"),
  };
}

export async function deliver(blob: Blob, name: string, env?: DeliveryEnv): Promise<DeliveryResult> {
  const file = new File([blob], name, { type: blob.type });
  const e = env ?? currentEnv(file);
  const method = chooseDelivery(e);
  if (method === "share") {
    try {
      await navigator.share({ files: [file], title: name });
      return { method, cancelled: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return { method, cancelled: true };
      // Share gagal (bukan batal) → turun ke tab baru.
      return openInTab(blob);
    }
  }
  if (method === "newtab") return openInTab(blob);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { method, cancelled: false };
}

function openInTab(blob: Blob): DeliveryResult {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  return { method: "newtab", cancelled: false };
}
