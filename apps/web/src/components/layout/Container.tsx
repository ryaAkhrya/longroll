import type { ElementType, HTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import styles from "./Container.module.css";

interface ContainerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** `narrow` = maks. 640 px di tengah (tablet/portrait, 06 §2 & §11). */
  size?: "default" | "narrow";
}

/** Container responsif: padding halaman mengikuti token (16 / 24 / 56 px), lebar maks. 1280 px. */
export function Container({ as: Tag = "div", size = "default", className, ...rest }: ContainerProps) {
  return <Tag className={cx(styles.container, size === "narrow" && styles.narrow, className)} {...rest} />;
}
