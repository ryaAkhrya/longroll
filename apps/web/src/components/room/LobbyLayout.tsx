"use client";

import { ArrowRight } from "lucide-react";
import { LIMITS } from "@longroll/shared";
import type { RoomView } from "@longroll/shared";
import { useSyncExternalStore } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { iconProps } from "@/components/ui/icon-props";
import { InvitePanel } from "./InvitePanel";
import { ParticipantSlot } from "./ParticipantSlot";
import styles from "./LobbyLayout.module.css";

const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

/**
 * Kerangka lobby SCR-05 (V1-APPROVED): grid 4 slot + panel undangan + daftar peserta + CTA.
 * Hanya layout dengan data dari props. Tombol "Mulai vote mode" belum aktif (alur voting = P04).
 */
export function LobbyLayout({ room }: { room: RoomView }) {
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const inviteUrl = `${origin}/r/${room.code}`;
  const total = LIMITS.maxParticipants;
  const joined = room.participants.length;
  const slots = Array.from({ length: total }, (_, i) => room.participants[i]);

  return (
    <div className={styles.lobby}>
      <section className={styles.main} aria-labelledby="lobby-title">
        <h1 id="lobby-title" className={`dc ${styles.title}`}>
          Nungguin geng lengkap
        </h1>
        <p className={styles.sub}>
          {joined} dari {total} udah masuk<span className={styles.deskOnly}> · bisa mulai bertiga</span>
        </p>
        <ul className={styles.grid} aria-label="Peserta room">
          {slots.map((p, i) => (
            <ParticipantSlot key={p?.id ?? `empty-${i}`} participant={p} slotNumber={i + 1} inviteUrl={inviteUrl} />
          ))}
        </ul>
      </section>

      <aside className={styles.side} aria-label="Undangan dan peserta">
        <InvitePanel code={room.code} inviteUrl={inviteUrl} />
        <Card as="section" aria-labelledby="roster-title" className={styles.roster}>
          <h2 id="roster-title" className="cap">
            Di room · {joined}/{total}
          </h2>
          <ul className={styles.people}>
            {room.participants.map((p) => (
              <li key={p.id}>
                <Avatar name={p.displayName} color={p.color} size={34} status={p.status} />
                <span>
                  <strong>{p.displayName}</strong>
                  <small>{p.statusText}</small>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card as="section" aria-label="Mulai voting" className={styles.cta}>
          <div className={styles.ctaText}>
            <h2 className={`d ${styles.ctaTitle}`}>Udah siap pilih mode?</h2>
            <p>Siapa aja boleh mulai. Yang telat tetap bisa nyusul.</p>
          </div>
          <Button variant="primary" size="xl" fullWidth disabled iconAfter={<ArrowRight size={18} {...iconProps} />}>
            Mulai vote mode
          </Button>
          <p className={styles.mobNote}>Siapa aja boleh mulai · bisa bertiga</p>
        </Card>
      </aside>
    </div>
  );
}
