import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { iconProps } from "./icon-props";
import styles from "./Banner.module.css";

export type BannerTone = "info" | "warn" | "error";

interface BannerProps {
  tone?: BannerTone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

const ICONS = { info: Info, warn: AlertTriangle, error: AlertCircle } as const;

/** Banner inline (SCR-22): info lavender, peringatan butter, error merah muda. Error → role="alert". */
export function Banner({ tone = "info", title, children, action, className }: BannerProps) {
  const Icon = ICONS[tone];
  return (
    <div className={cx(styles.banner, styles[tone], className)} role={tone === "error" ? "alert" : "status"}>
      <Icon size={17} {...iconProps} className={styles.icon} />
      <p className={styles.text}>
        {title && <strong>{title} </strong>}
        {children}
      </p>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
