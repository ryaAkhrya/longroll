import type { ElementType, HTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import styles from "./Card.module.css";

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Kartu terpilih: ring plum 2 px. */
  selected?: boolean;
  /** Padding dalam (default 20). */
  padding?: "none" | "md" | "lg";
}

export function Card({ as: Tag = "div", selected, padding = "md", className, ...rest }: CardProps) {
  return <Tag className={cx(styles.card, styles[padding], selected && styles.selected, className)} {...rest} />;
}
