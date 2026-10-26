"use client";

import { useEffect, useRef } from "react";
import type { CameraPresentation } from "@longroll/shared";
import { presentationFilter, presentationTransform } from "@/media/presentation";
import { cx } from "@/lib/cx";
import styles from "./VideoView.module.css";

interface VideoViewProps {
  stream: MediaStream | null;
  mirrored: boolean;
  presentation: CameraPresentation;
  className?: string;
  /** Dipanggil saat frame pertama tampil (feed benar-benar hidup). */
  onPlaying?: () => void;
}

/**
 * <video playsInline muted autoPlay> (06 §9, 09 §6) dengan framing pemilik sebagai transform tampilan.
 * Selalu muted: tidak ada audio di P03 (DEC-076).
 */
export function VideoView({ stream, mirrored, presentation, className, onPlaying }: VideoViewProps) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);

  return (
    <span className={cx(styles.wrap, className)} aria-hidden="true">
      <video
        ref={ref}
        className={styles.video}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        onPlaying={onPlaying}
        style={{ transform: presentationTransform(presentation, mirrored), filter: presentationFilter(presentation) }}
      />
    </span>
  );
}
