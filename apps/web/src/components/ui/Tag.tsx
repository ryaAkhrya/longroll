import { Eye, Users } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { iconProps } from "./icon-props";
import styles from "./Tag.module.css";

type TagKind = "bareng" | "local" | "neutral";

interface TagProps {
  /** `bareng` = berlaku untuk semua; `local` = "Cuma kamu"; `neutral` = label biasa. */
  kind?: TagKind;
  children?: ReactNode;
  className?: string;
}

const DEFAULT_LABEL: Record<Exclude<TagKind, "neutral">, string> = {
  bareng: "Bareng",
  local: "Cuma kamu",
};

export function Tag({ kind = "neutral", children, className }: TagProps) {
  const label = children ?? (kind === "neutral" ? null : DEFAULT_LABEL[kind]);
  return (
    <span className={cx(styles.tag, styles[kind], className)}>
      {kind === "bareng" && <Users size={12} {...iconProps} />}
      {kind === "local" && <Eye size={12} {...iconProps} />}
      {label}
    </span>
  );
}
