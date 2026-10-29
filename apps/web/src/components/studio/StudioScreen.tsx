"use client";

import { Camera, ChevronRight, Lock } from "lucide-react";
import { MODE_INFO, PLAYER_COLORS } from "@longroll/shared";
import type { ParticipantView, SessionView } from "@longroll/shared";
import type { ReactNode } from "react";
import { CameraTile } from "@/components/media/CameraTile";
import { iconProps } from "@/components/ui/icon-props";
import { cx } from "@/lib/cx";
import styles from "./StudioScreen.module.css";

interface StudioScreenProps {
  session: SessionView;
  participants: ParticipantView[];
  meId: string | null;
  holdSeconds: number;
  clockOffsetMs: number;
  inviteUrl: string;
  onOpenCameraPanel: () => void;
  /** Rail alat desktop (Frame, Layout, Kamera, Filter). */
  rail?: ReactNode;
  /** Kolom kanan saat tidak ada panel: "Hasil sementara". */
  side?: ReactNode;
  /** Drawer panel (desktop 400 px) — menggantikan kolom kanan. */
  drawer?: ReactNode;
  /** Pusat pengganti grid (pratinjau besar saat panel Frame/Layout terbuka). */
  center?: ReactNode;
  summary?: { frame: string; layout: string; onFrame?: () => void; onLayout?: () => void };
  timer?: ReactNode;
  shotLabel?: string;
  /** Overlay atas mobile (pill kode, mode + progres). */
  topOverlay?: ReactNode;
  /** Tombol kanan dock mobile (Alat). */
  dockRight?: ReactNode;
  /** Sheet / elemen mengambang mobile. */
  mobileTools?: ReactNode;
  overlay?: ReactNode;
  /** P06: shutter nyata (disabled saat countdown / review). Tanpa prop: nonaktif. */
  shutter?: { disabled: boolean; onPress: () => void; label: string };
  /** Catatan per kartu peserta (mis. "Nyimpen foto…"). */
  cardNotes?: Record<string, ReactNode>;
  /** Kontrol di bar (Bentar/Siap, Tunggu!). */
  barExtra?: ReactNode;
  /** Teks kecil di bawah shutter. */
  caption?: string;
  /** "Siap x/y" (peserta wajib yang siap). */
  readyText?: string;
}

/**
 * SCR-08 Studio (V1, tema stage): grid feed live + rail + "Hasil sementara" + bar bawah. Shutter/countdown
 * milik P06: tombol ditampilkan NONAKTIF dengan label jujur, bukan capture palsu.
 */
export function StudioScreen(props: StudioScreenProps) {
  const { session, participants, meId, holdSeconds, clockOffsetMs, inviteUrl, onOpenCameraPanel } = props;
  const active = participants.filter((p) => p.connection !== "LEFT");
  const byColor = new Map(active.map((p) => [p.color, p]));
  const ready = active.filter((p) => p.ready).length;
  const mode = session.mode!;
  const count = active.length;

  const grid = (
    <div className={styles.gridWrap}>
      <ul className={cx(styles.grid, styles[`n${Math.max(1, count)}`])} aria-label="Kamera peserta">
        {PLAYER_COLORS.map((color, i) => {
          const p = byColor.get(color);
          if (!p) return null;
          return (
            <CameraTile
              key={p.participantId}
              participant={p}
              isSelf={p.participantId === meId}
              slotNumber={i + 1}
              inviteUrl={inviteUrl}
              holdSeconds={holdSeconds}
              clockOffsetMs={clockOffsetMs}
              variant="booth"
              onOpenCameraPanel={p.participantId === meId ? onOpenCameraPanel : undefined}
            >
              {props.cardNotes?.[p.participantId] ?? (p.ready && p.participantId !== meId && <span className={styles.readyBadge}>✓ Siap</span>)}
            </CameraTile>
          );
        })}
      </ul>
      {props.topOverlay && <div className={styles.topOverlay}>{props.topOverlay}</div>}
      {props.overlay}
    </div>
  );

  return (
    <section className={cx(styles.studio, !!props.drawer && styles.withDrawer)} aria-label={`Studio sesi ${session.index}`}>
      {props.rail && (
        <nav className={styles.rail} aria-label="Alat studio">
          {props.rail}
        </nav>
      )}
      <div className={styles.center}>{props.center ?? grid}</div>
      {props.drawer ? (
        <aside className={styles.drawer} aria-label="Panel studio">
          {props.drawer}
        </aside>
      ) : (
        <aside className={styles.side}>
          {props.side}
          <dl className={styles.summary}>
            <div>
              <dt>Mode</dt>
              <dd>
                {MODE_INFO[mode].name} <Lock size={14} {...iconProps} aria-label="dikunci" />
              </dd>
            </div>
            {props.summary && (
              <>
                <div>
                  <dt>Frame</dt>
                  <dd>
                    <button type="button" onClick={props.summary.onFrame} className={styles.link}>
                      {props.summary.frame} <ChevronRight size={14} {...iconProps} />
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Layout</dt>
                  <dd>
                    <button type="button" onClick={props.summary.onLayout} className={styles.link}>
                      {props.summary.layout} <ChevronRight size={14} {...iconProps} />
                    </button>
                  </dd>
                </div>
              </>
            )}
          </dl>
        </aside>
      )}

      {/* Bar bawah: area grid (lihat StudioScreen.module.css). Mobile = baris status (Shot · Bentar · Siap) di atas baris aksi
          (Timer · shutter · Alat); desktop = satu baris. `display: contents` pada barCenter/barRight membuat anaknya
          menjadi sel grid footer di mobile tanpa mengubah urutan baca. */}
      <footer className={styles.bar}>
        <div className={styles.barLeft}>{props.timer}</div>
        <div className={styles.barCenter}>
          <span className={cx(styles.stat, styles.statShot)}>
            <small>Shot</small>
            <strong className="dc tnum">{props.shotLabel ?? "1/1"}</strong>
          </span>
          <button
            type="button"
            className={styles.shutter}
            disabled={!props.shutter || props.shutter.disabled}
            onClick={props.shutter?.onPress}
            aria-label={props.shutter?.label ?? "Ambil foto"}
            data-testid="shutter"
          >
            <Camera size={24} {...iconProps} />
          </button>
          <span className={cx(styles.stat, styles.statReady)}>
            <small>Siap</small>
            <strong className="dc tnum" data-testid="ready-count">
              {props.readyText ?? `${ready}/${count}`}
            </strong>
          </span>
        </div>
        <div className={styles.barRight}>
          {props.barExtra && <span className={styles.wait}>{props.barExtra}</span>}
          <p className={styles.caption}>{props.caption ?? "Siapa saja boleh mengambil foto"}</p>
          {props.dockRight && <span className={styles.dockRight}>{props.dockRight}</span>}
        </div>
      </footer>
      {props.mobileTools}
    </section>
  );
}
