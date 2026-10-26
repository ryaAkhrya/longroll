import { DEFAULT_ROOM_GRACE_PERIOD_SECONDS } from "@longroll/shared";
import { PhotoStrip } from "@/components/brand/PhotoStrip";
import { LinkButton } from "@/components/ui/Button";
import styles from "./RoomClosed.module.css";

/** SCR-21 (DERIVED). "{N} menit" mengikuti DEC-020; tanpa kata "permanen" (15 §8 belum terverifikasi). */
export function RoomClosed({ code }: { code: string }) {
  const minutes = Math.round(DEFAULT_ROOM_GRACE_PERIOD_SECONDS / 60);
  return (
    <section className={styles.wrap} aria-labelledby="closed-title">
      <div className={styles.art} aria-hidden="true">
        <PhotoStrip empty className={styles.back} />
        <PhotoStrip empty className={styles.front} />
      </div>
      <p className={`cap tnum ${styles.code}`}>Room {code}</p>
      <h1 id="closed-title" className={`dc ${styles.title}`}>
        Room-nya <span className="s">udah bubar.</span>
      </h1>
      <p className={styles.text}>
        Semua orang keluar lebih dari {minutes} menit, jadi room dan fotonya udah dihapus. File yang udah kamu unduh atau simpan ke Drive tetap aman.
      </p>
      <div className={styles.actions}>
        <LinkButton href="/r/new" variant="primary" size="lg">
          Bikin room baru
        </LinkButton>
        <LinkButton href="/" variant="secondary" size="lg">
          Ke beranda
        </LinkButton>
      </div>
    </section>
  );
}
