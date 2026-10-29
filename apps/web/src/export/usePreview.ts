"use client";

import { useEffect, useState } from "react";
import { renderExport } from "./render";
import { previewSize } from "./session";
import type { PreparedExport } from "./session";

/** Sisi terpanjang pratinjau di layar (cukup tajam untuk layar HiDPI, jauh lebih ringan dari export). */
const SCREEN_PREVIEW_PX = 1100;

/**
 * Pratinjau di layar SCR-17 dirender lokal dari dokumen yang sama dengan export (jalur gambar yang sama),
 * tanpa bergantung pada pratinjau WebP di server (yang dipakai galeri).
 */
export function usePreview(prepared: PreparedExport | null): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ for: PreparedExport | null; url: string | null; failed: boolean }>({ for: null, url: null, failed: false });
  useEffect(() => {
    if (!prepared) return;
    let alive = true;
    let made: string | null = null;
    const ac = new AbortController();
    const base = previewSize(prepared.baseW, prepared.baseH);
    const long = Math.max(base.width, base.height);
    const k = long > SCREEN_PREVIEW_PX ? SCREEN_PREVIEW_PX / long : 1;
    const size = { ...base, scale: base.scale * k, width: Math.max(1, Math.floor(base.width * k)), height: Math.max(1, Math.floor(base.height * k)) };
    renderExport({ ...prepared.request, size, format: "jpeg", quality: 0.85, signal: ac.signal }).then(
      (r) => {
        if (!alive) return;
        made = URL.createObjectURL(r.blob);
        setState({ for: prepared, url: made, failed: false });
      },
      () => alive && setState({ for: prepared, url: null, failed: true }),
    );
    return () => {
      alive = false;
      ac.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [prepared]);
  return state.for === prepared ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}
