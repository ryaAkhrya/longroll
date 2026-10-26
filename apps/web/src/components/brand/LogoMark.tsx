import type { SVGProps } from "react";

interface LogoMarkProps extends Omit<SVGProps<SVGSVGElement>, "height" | "width"> {
  /** Tinggi dalam px; lebar mengikuti rasio 32:48. */
  height?: number;
  /** `light` = latar terang (plum), `dark` = latar gelap (putih hangat). Kosong = ikut tema (`--logo`). */
  tone?: "light" | "dark";
  /** Warna lubang gulungan; ikut warna latar. */
  holeColor?: string;
  /** Sembunyikan dari screen reader (mis. di dalam lockup yang sudah punya teks). */
  decorative?: boolean;
}

const FRAMES = [
  { y: 9, h: 7, fill: "#F4B9A0" },
  { y: 18.5, h: 7, fill: "#EED27A" },
  { y: 28, h: 7, fill: "#9DD5B8" },
  { y: 37.5, h: 6, fill: "#BBA9EC" },
] as const;

/** Geometri 05 Lampiran A (viewBox 32x48). Urutan warna frame tidak boleh diubah. */
export function LogoMark({ height = 32, tone, holeColor, decorative, ...rest }: LogoMarkProps) {
  const body = tone === "light" ? "#3B2350" : tone === "dark" ? "#F6F3EE" : "var(--logo)";
  const hole = holeColor ?? (tone === "light" ? "#F6F3EE" : tone === "dark" ? "#131015" : "var(--logo-hole)");
  return (
    <svg
      viewBox="0 0 32 48"
      height={height}
      width={(height * 32) / 48}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "LONGROLL" })}
      {...rest}
    >
      <circle cx="12" cy="10" r="9" style={{ fill: body }} />
      <path
        d="M12 1 h12 a3 3 0 0 1 3 3 v39 a3 3 0 0 1 -3 3 H15 a3 3 0 0 1 -3 -3 V19"
        style={{ fill: body }}
      />
      <circle cx="12" cy="10" r="3.2" style={{ fill: hole }} />
      {FRAMES.map((f) => (
        <rect key={f.y} x="15" y={f.y} width="9" height={f.h} rx="1.2" fill={f.fill} />
      ))}
    </svg>
  );
}
