import type { PlayerColor, PresenceStatus } from "@longroll/shared";
import { cx } from "@/lib/cx";
import styles from "./Avatar.module.css";

interface AvatarProps {
  name: string;
  color: PlayerColor;
  /** Diameter px. Spesifikasi: 18 (tag kamera), 24 (header mobile), 30–40 (daftar). */
  size?: number;
  /** Titik status 30% ukuran avatar. */
  status?: PresenceStatus;
  /** Cincin latar (dipakai di AvatarStack). */
  ring?: boolean;
  className?: string;
}

const STATUS_LABEL: Record<PresenceStatus, string> = { online: "online", pending: "sedang nyambung lagi", away: "tidak aktif" };

/** Avatar inisial di warna pemain (tint/deep). Bukan kartun; foto kamera mini menyusul di P03. */
export function Avatar({ name, color, size = 30, status, ring, className }: AvatarProps) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  const dot = Math.max(6, Math.round(size * 0.3));
  return (
    <span
      className={cx(styles.avatar, styles[color], ring && styles.ring, className)}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}
      role="img"
      aria-label={status ? `${name}, ${STATUS_LABEL[status]}` : name}
    >
      <span aria-hidden="true">{initial}</span>
      {status && (
        <span
          aria-hidden="true"
          className={cx(styles.dot, styles[status])}
          style={{ width: dot, height: dot }}
        />
      )}
    </span>
  );
}
