import Link from "next/link";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Spinner } from "./Spinner";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "soft" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Tombol ikon tunggal (persegi). Wajib beri aria-label. */
  iconOnly?: boolean;
  fullWidth?: boolean;
  className?: string;
}

export function buttonClass({ variant = "secondary", size = "md", iconOnly, fullWidth, className }: StyleProps) {
  return cx(
    styles.btn,
    styles[variant],
    styles[size],
    iconOnly && styles.iconOnly,
    fullWidth && styles.full,
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, StyleProps {
  /** Spinner menggantikan ikon; label tetap. Klik diabaikan saat loading. */
  loading?: boolean;
  icon?: ReactNode;
  iconAfter?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, iconOnly, fullWidth, className, loading, icon, iconAfter, children, onClick, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(buttonClass({ variant, size, iconOnly, fullWidth, className }), loading && styles.loading)}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children}
      {!loading && iconAfter}
    </button>
  );
});

interface LinkButtonProps extends StyleProps {
  href: string;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  children?: ReactNode;
  "aria-label"?: string;
}

/** Navigasi yang tampil seperti tombol; tetap `<a>` (semantik). */
export function LinkButton({ href, icon, iconAfter, children, variant, size, iconOnly, fullWidth, className, ...rest }: LinkButtonProps) {
  return (
    <Link href={href} className={buttonClass({ variant, size, iconOnly, fullWidth, className })} {...rest}>
      {icon}
      {children}
      {iconAfter}
    </Link>
  );
}
