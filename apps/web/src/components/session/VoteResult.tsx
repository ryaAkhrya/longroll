"use client";

import { ArrowRight, Lock } from "lucide-react";
import { MODE_INFO, MODES, SESSION_CONFIG } from "@longroll/shared";
import type { ParticipantView, SessionView } from "@longroll/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { cx } from "@/lib/cx";
import { useNow } from "@/room/hooks";
import { ModeArt } from "./ModeArt";
import styles from "./VoteResult.module.css";

interface VoteResultProps {
  session: SessionView;
  participants: ParticipantView[];
  clockOffsetMs: number;
  onEnter: () => void;
}

/**
 * SCR-07 hasil vote (DERIVED): pratinjau mode, bar hasil, gembok, "Masuk booth". Semua peserta otomatis
 * masuk studio 3 s setelah hasil (DEC-081) — transisi, bukan keputusan. Hasil acak diumumkan jelas (DEC-024).
 */
export function VoteResult({ session, participants, clockOffsetMs, onEnter }: VoteResultProps) {
  const now = useNow(200);
  const result = session.voting.result;
  if (!result || !session.mode) return null;
  const lockedAt = session.lockedAtMs ?? 0;
  const left = Math.max(0, Math.ceil((lockedAt + SESSION_CONFIG.studioAutoEnterMs - (now + clockOffsetMs)) / 1000));
  const total = Object.values(result.tally).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const random = result.method === "RANDOM";
  const modes = random && result.options ? result.options : MODES.filter((m) => (result.tally[m] ?? 0) > 0 || m === result.mode);
  const finalVotes = session.voting.votes;

  return (
    <section className={styles.wrap} aria-labelledby="result-title" aria-live="polite">
      <div className={styles.art}>
        <ModeArt mode={session.mode} />
        {random && <span className={styles.coin} aria-hidden="true" />}
      </div>
      <div className={styles.side}>
        <p className="cap">Sesi {session.index} · hasil vote</p>
        <h1 id="result-title" className={`dc ${styles.title}`}>
          {MODE_INFO[session.mode].name} <span className="s">menang.</span>
        </h1>
        {random && <p className={styles.random}>Booth lempar koin karena masih seri.</p>}
        <ul className={styles.bars}>
          {modes.map((m) => {
            const n = result.tally[m] ?? 0;
            const voters = participants.filter((p) => finalVotes[p.participantId] === m);
            return (
              <li key={m} className={cx(styles.row, m === session.mode && styles.win)}>
                <span className={styles.rowHead}>
                  <span className={styles.rowName}>{MODE_INFO[m].name}</span>
                  <span className={styles.rowVoters} aria-hidden="true">
                    {voters.map((p) => (
                      <Avatar key={p.participantId} name={p.displayName} color={p.color} size={22} ring />
                    ))}
                  </span>
                  <span className="tnum">{n} suara</span>
                </span>
                <span className={styles.track} aria-hidden="true">
                  <span className={styles.fill} style={{ width: `${(n / total) * 100}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
        <p className={styles.lock}>
          <Lock size={14} {...iconProps} /> Dikunci buat sesi {session.index}
        </p>
        <Button variant="primary" size="xl" fullWidth onClick={onEnter} iconAfter={<ArrowRight size={18} {...iconProps} />}>
          Masuk booth
        </Button>
        <p className={styles.auto}>
          Otomatis masuk dalam <span className="tnum">{left}</span> detik
        </p>
      </div>
    </section>
  );
}
