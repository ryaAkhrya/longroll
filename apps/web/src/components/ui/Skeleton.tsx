import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  radius?: CSSProperties["borderRadius"];
  className?: string;
}

/** Placeholder loading (SCR-22): bentuk surface, bukan spinner. Dekoratif. */
export function Skeleton({ width = "100%", height = 16, radius = 10, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.root, className)}
      style={{ width, height, borderRadius: radius }}
    />
  );
}
