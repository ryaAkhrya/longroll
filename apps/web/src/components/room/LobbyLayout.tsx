"use client";

import { ArrowRight } from "lucide-react";
import { PLAYER_COLORS } from "@longroll/shared";
import type { ParticipantView, RoomView } from "@longroll/shared";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { iconProps } from "@/components/ui/icon-props";
import { InvitePanel } from "./InvitePanel";
import { ParticipantSlot } from "./ParticipantSlot";
import styles from "./LobbyLayout.module.css";

interface LobbyLayoutProps {
  room: RoomView;
  meId: string | null;
  inviteUrl: string;
  clockOffsetMs?: number;
  /** Lapisan di atas grid (mis. kursor permukaan dev). */
  gridOverlay?: ReactNode;
}

const COUNT_WORD = ["", "sendiri", "berdua", "bertiga"];

/** DEC-025 (min. 1 peserta, PROPOSED): teks lobby mengikuti jumlah peserta. */
function subtitle(joined: number, max: number) {
  if (joined >= max) return { main: `${joined} dari ${max} udah masuk`, extra: " · geng lengkap" };
  return { main: `${joined} dari ${max} udah masuk`, extra: ` · bisa mulai ${COUNT_WORD[joined] ?? ""}` };
}

function statusLine(p: ParticipantView, isSelf: boolean) {
  const conn = p.connection === "RECONNECTING" ? "nyambung lagi…" : "terhubung";
  return isSelf ? `Kamu · ${conn}` : conn.charAt(0).toUpperCase() + conn.slice(1);
}

/**
 * Lobby SCR-05 (V1): grid 4 slot berdasarkan warna (P1..P4), panel undangan, daftar peserta, CTA.
 * "Mulai vote mode" milik P04: hanya tampil di dev, nonaktif dengan label "Segera".
 */
export function LobbyLayout({ room, meId, inviteUrl, clockOffsetMs = 0, gridOverlay }: LobbyLayoutProps) {
  const total = room.config.maxParticipants;
  const active = room.participants.filter((p) => p.connection !== "LEFT");
  const byColor = new Map(active.map((p) => [p.color, p]));
  const joined = active.length;
  const sub = subtitle(joined, total);
  const showVoteStub = process.env.NODE_ENV !== "production";

  return (
    <div className={styles.lobby}>
      <section className={styles.main} aria-labelledby="lobby-title">
        <h1 id="lobby-title" className={`dc ${styles.title}`}>
          {joined >= total ? "Geng udah lengkap" : "Nungguin geng lengkap"}
        </h1>
        <p className={styles.sub} aria-live="polite">
          {sub.main}
          <span className={styles.deskOnly}>{sub.extra}</span>
        </p>
        <div className={styles.gridWrap}>
          <ul className={styles.grid} aria-label="Peserta room">
            {PLAYER_COLORS.slice(0, total).map((color, i) => {
              const p = byColor.get(color);
              return (
                <ParticipantSlot
                  key={p?.participantId ?? `empty-${color}`}
                  participant={p}
                  isSelf={!!p && p.participantId === meId}
                  slotNumber={i + 1}
                  inviteUrl={inviteUrl}
                  holdSeconds={room.config.holdSeconds}
                  clockOffsetMs={clockOffsetMs}
                />
              );
            })}
          </ul>
          {gridOverlay}
        </div>
      </section>

      <aside className={styles.side} aria-label="Undangan dan peserta">
        <InvitePanel code={room.code} inviteUrl={inviteUrl} />
        <Card as="section" aria-labelledby="roster-title" className={styles.roster}>
          <h2 id="roster-title" className="cap">
            Di room · {joined}/{total}
          </h2>
          <ul className={styles.people}>
            {active.map((p) => (
              <li key={p.participantId}>
                <Avatar
                  name={p.displayName}
                  color={p.color}
                  size={34}
                  status={p.connection === "RECONNECTING" ? "pending" : "online"}
                />
                <span>
                  <strong>{p.displayName}</strong>
                  <small>{statusLine(p, p.participantId === meId)}</small>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        {showVoteStub && (
          <Card as="section" aria-label="Mulai voting" className={styles.cta}>
            <div className={styles.ctaText}>
              <h2 className={`d ${styles.ctaTitle}`}>Udah siap pilih mode?</h2>
              <p>Siapa aja boleh mulai. Yang telat tetap bisa nyusul.</p>
            </div>
            <Button variant="primary" size="xl" fullWidth disabled iconAfter={<ArrowRight size={18} {...iconProps} />}>
              Mulai vote mode · Segera
            </Button>
            <p className={styles.mobNote}>Siapa aja boleh mulai · voting hadir di tahap berikutnya</p>
          </Card>
        )}
      </aside>
    </div>
  );
}
