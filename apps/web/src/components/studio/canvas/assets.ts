"use client";

import { useEffect, useState } from "react";
import type { Fill } from "@longroll/shared";
import { api } from "@/room/api";

/**
 * Aset kanvas studio di sisi klien: pola latar prosedural (titik, kertas) dan artwork frame custom
 * lewat signed URL berumur pendek (≤ 10 menit). Gambar yang sudah ter-decode tetap dipakai walau URL-nya
 * kedaluwarsa; URL baru diminta hanya bila memuat ulang (`asset.urls` diganti endpoint `/url`).
 */

const patternCache = new Map<string, HTMLCanvasElement>();

export function patternImage(fill: Fill, scale: number): HTMLCanvasElement | null {
  if (fill.kind === "solid" || fill.kind === "linear") return null;
  const key = `${JSON.stringify(fill)}@${scale.toFixed(3)}`;
  const hit = patternCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  if (fill.kind === "stripes" || fill.kind === "grid" || fill.kind === "checker") {
    const tile = fill.kind === "checker" ? fill.size * 2 : Math.max(4, Math.round(fill.spacing));
    c.width = tile;
    c.height = tile;
    const g = c.getContext("2d")!;
    if (fill.kind === "stripes") {
      g.strokeStyle = fill.stripe;
      g.lineWidth = fill.width;
      // Tiga garis diagonal agar ulangan ubin tanpa sambungan (garis utama + dua sudut).
      for (let k = -1; k <= 1; k++) {
        g.beginPath();
        g.moveTo(k * tile, tile);
        g.lineTo(k * tile + tile, 0);
        g.stroke();
      }
    } else if (fill.kind === "grid") {
      g.strokeStyle = fill.line;
      g.globalAlpha = 0.55;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0.5, 0);
      g.lineTo(0.5, tile);
      g.moveTo(0, 0.5);
      g.lineTo(tile, 0.5);
      g.stroke();
    } else {
      g.fillStyle = fill.alt;
      g.fillRect(0, 0, fill.size, fill.size);
      g.fillRect(fill.size, fill.size, fill.size, fill.size);
    }
    patternCache.set(key, c);
    return c;
  }
  const size = Math.max(4, Math.round(fill.spacing * (fill.kind === "paper" ? 4 : 1)));
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  if (fill.kind === "dots") {
    ctx.fillStyle = fill.dot;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, fill.radius, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = fill.bg;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = fill.fleck;
    // Bintik kertas deterministik (tanpa Math.random) supaya semua klien identik.
    for (let i = 0; i < 18; i++) {
      const x = (i * 37) % size;
      const y = (i * 53 + 11) % size;
      ctx.globalAlpha = 0.35 + ((i * 13) % 5) / 10;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
  }
  patternCache.set(key, c);
  return c;
}

interface FrameAsset {
  img: HTMLImageElement;
}

const assetCache = new Map<string, Promise<FrameAsset>>();

function loadFrame(code: string, frameId: string): Promise<FrameAsset> {
  const key = `${code}:${frameId}`;
  const cached = assetCache.get(key);
  if (cached) return cached;
  const p = api.frameUrl(code, frameId).then(
    ({ url }) =>
      new Promise<FrameAsset>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onload = () => resolve({ img });
        img.onerror = () => reject(new Error("frame image"));
        img.src = url;
      }),
  );
  p.catch(() => assetCache.delete(key));
  assetCache.set(key, p);
  return p;
}

/** Artwork frame custom (null saat memuat / gagal; gagal dicatat & dicoba lagi saat dipakai ulang). */
export function useFrameImage(code: string | null, frameId: string | null): { img: HTMLImageElement | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; img: HTMLImageElement | null; failed: boolean }>({ key: "", img: null, failed: false });
  const key = code && frameId ? `${code}:${frameId}` : "";
  useEffect(() => {
    if (!code || !frameId) return;
    let alive = true;
    loadFrame(code, frameId).then(
      (a) => alive && setState({ key: `${code}:${frameId}`, img: a.img, failed: false }),
      () => {
        if (!alive) return;
        console.warn("[studio] artwork frame gagal dimuat", frameId);
        setState({ key: `${code}:${frameId}`, img: null, failed: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [code, frameId]);
  return state.key === key ? { img: state.img, failed: state.failed } : { img: null, failed: false };
}

/** Versi non-hook (export): artwork frame custom sebagai gambar yang sudah ter-decode. */
export function loadFrameImage(code: string, frameId: string): Promise<HTMLImageElement> {
  return loadFrame(code, frameId).then((a) => a.img);
}
