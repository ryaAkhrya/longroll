import type { ParticipantView } from "@longroll/shared";
import { cx } from "@/lib/cx";
import { Avatar } from "./Avatar";
import styles from "./AvatarStack.module.css";

interface AvatarStackProps {
  participants: Pick<ParticipantView, "id" | "displayName" | "color">[];
  size?: number;
  className?: string;
}

/** Avatar bertumpuk (overlap -7 px, ring 2 px warna latar). Grup berlabel jumlah peserta. */
export function AvatarStack({ participants, size = 30, className }: AvatarStackProps) {
  return (
    <span
      className={cx(styles.stack, className)}
      role="group"
      aria-label={`${participants.length} peserta di room`}
    >
      {participants.map((p) => (
        <Avatar key={p.id} name={p.displayName} color={p.color} size={size} ring />
      ))}
    </span>
  );
}
