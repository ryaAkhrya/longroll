"use client";

import dynamic from "next/dynamic";
import type { StudioCanvasProps } from "./StudioCanvas";

/** Konva hanya di browser (tanpa SSR). */
export const StudioCanvas = dynamic<StudioCanvasProps>(() => import("./StudioCanvas").then((m) => m.StudioCanvas), {
  ssr: false,
  loading: () => <div aria-hidden="true" style={{ width: "100%", height: "100%" }} />,
});

export type { StudioCanvasProps };
