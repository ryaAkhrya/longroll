import type { CameraPresentation } from "@longroll/shared";

/**
 * Framing pra-capture sebagai transform TAMPILAN (09 §4.1): zoom, geser, kecerahan, kehangatan, cermin.
 * String filter sengaja memakai fungsi yang juga tersedia di `CanvasRenderingContext2D.filter`, agar
 * capture/export (P06/P08) bisa menerapkan transform yang sama persis.
 */
export function presentationFilter(cp: CameraPresentation): string {
  const parts: string[] = [];
  if (cp.brightness !== 0) parts.push(`brightness(${round(1 + 0.35 * cp.brightness)})`);
  if (cp.warmth > 0) parts.push(`sepia(${round(0.3 * cp.warmth)})`, `saturate(${round(1 + 0.15 * cp.warmth)})`);
  if (cp.warmth < 0) parts.push(`hue-rotate(${round(12 * -cp.warmth)}deg)`, `saturate(${round(1 + 0.15 * cp.warmth)})`);
  return parts.length ? parts.join(" ") : "none";
}

/** Transform CSS untuk <video> object-fit: cover di dalam wadah overflow: hidden. */
export function presentationTransform(cp: CameraPresentation, mirrored: boolean): string {
  const z = cp.zoom;
  const range = ((z - 1) / 2) * 100;
  const tx = round(-cp.offset.x * range);
  const ty = round(-cp.offset.y * range);
  const parts = [];
  if (tx || ty) parts.push(`translate(${tx}%, ${ty}%)`);
  if (z !== 1) parts.push(`scale(${z})`);
  if (mirrored) parts.push("scaleX(-1)");
  return parts.length ? parts.join(" ") : "none";
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
