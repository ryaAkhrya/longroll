"use client";

import { Check, Lock, TriangleAlert } from "lucide-react";
import { MODE_INFO, canCloseVoting, tallyVotes } from "@longroll/shared";
import type { Mode, ParticipantView, SessionView } from "@longroll/shared";
import { useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { iconProps } from "@/components/ui/icon-props";
import { cx } from "@/lib/cx";
import type { RoomClient } from "@/room/client";
import { useNow } from "@/room/hooks";
import { ModeArt } from "./ModeArt";
import styles from "./VotingScreen.module.css";

interface VotingScreenProps {
  client: RoomClient;
  session: SessionView;
  participants: ParticipantView[];
  meId: string | null;
  clockOffsetMs: number;
  /** Lapisan kursor (desktop, DEC-071). */
  overlay?: ReactNode;
}

const BG: Record<Mode, string> = {
  PHOTO_STRIP: "var(--p1-tint)",
  GROUP_SHOT: "#e6ece8",
  PHOTO_GRID: "var(--p2-tint)",
  FREEFORM_COLLAGE: "#efe5d3",
};

/**
 * SCR-06 Voting mode (V1): kartu `radiogroup`, suara terbuka (avatar pemilih), progres, "Tutup vote" setelah
 * mayoritas dengan jendela 5 s. TIDAK ADA timer penutup voting (DEC-046): kartu "Sisa waktu" di mockup
 * diganti status penutupan.
 */
export function VotingScreen({ client, session, participants, meId, clockOffsetMs, overlay }: VotingScreenProps) {
  const toast = useToast();
  const voting = session.voting;
  const active = participants.filter((p) => p.connection !== "LEFT");
  const connected = active.filter((p) => p.connection === "CONNECTED").map((p) => p.participantId);
  const [pending, setPending] = useState<{ mode: Mode; round: number } | null>(null);
  const closing = voting.phase === "CLOSING";
  const now = useNow(250, closing);
  const myServerVote = meId ? voting.votes[meId] : undefined;
  const myVote = pending && pending.round === voting.round ? pending.mode : myServerVote;
  const votes = { ...voting.votes, ...(meId && myVote ? { [meId]: myVote } : {}) };
  const tally = tallyVotes(votes, (pid) => active.some((p) => p.participantId === pid));
  const votedCount = active.filter((p) => votes[p.participantId]).length;
  const canClose = canCloseVoting({ ...voting, votes }, connected);
  const isTie = voting.round === 2;
  const byId = new Map(participants.map((p) => [p.participantId, p]));

  const cast = async (mode: Mode) => {
    if (myVote === mode) return; // mengetuk kartu yang sama tidak membatalkan suara (08 §4)
    setPending({ mode, round: voting.round });
    const ack = await client.sendIntent("vote.cast", { sessionId: session.sessionId, round: voting.round, mode });
    setPending(null);
    if (!ack.ok) toast.show({ message: ack.error === "VOTING_CLOSED" ? "Voting udah ditutup." : "Suaramu gak kekirim, coba lagi", tone: "warn" });
  };

  const close = async () => {
    const ack = await client.sendIntent("vote.close", { sessionId: session.sessionId, round: voting.round });
    if (!ack.ok) toast.show({ message: ack.error === "CLOSE_NOT_ALLOWED" ? "Belum mayoritas, belum bisa ditutup." : "Gagal nutup vote, coba lagi", tone: "warn" });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const opts = voting.options;
    const idx = Math.max(0, opts.indexOf(myVote ?? opts[0]!));
    const next = opts[(idx + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length]!;
    (e.currentTarget.querySelector(`[data-mode='${next}']`) as HTMLElement | null)?.focus();
    void cast(next);
  };

  const remainingSec = closing && voting.closingAtMs ? Math.max(0, Math.ceil((voting.closingAtMs - (now + clockOffsetMs)) / 1000)) : 0;
  const closer = voting.closedBy ? byId.get(voting.closedBy) : null;
  const waitingFor = active.filter((p) => p.connection === "CONNECTED" && !votes[p.participantId]);
  const tieScore = isTie && voting.tieTally ? voting.options.map((m) => voting.tieTally![m] ?? 0).join("–") : null;

  const statusBox = (
    <div className={styles.status} aria-live="polite">
      {closing ? (
        <p className={styles.closing}>
          <strong>{closer ? (closer.participantId === meId ? "Kamu" : closer.displayName) : "Seseorang"}</strong> nutup vote dalam{" "}
          <span className="tnum">{remainingSec}</span>… <span className={styles.muted}>Masih bisa ganti pilihan.</span>
        </p>
      ) : canClose ? (
        <Button variant="secondary" size="md" onClick={() => void close()}>
          Tutup vote
        </Button>
      ) : waitingFor.length > 0 ? (
        <p className={styles.muted}>Nunggu {waitingFor.map((p) => (p.participantId === meId ? "kamu" : p.displayName)).join(", ")}</p>
      ) : null}
    </div>
  );

  const progress = (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <p className={styles.progressText}>
          <span className="tnum">{votedCount}</span> dari <span className="tnum">{active.length}</span> udah vote
        </p>
        <div className={styles.bars} aria-hidden="true">
          {active.map((p) => (
            <span key={p.participantId} className={styles.bar} style={{ background: votes[p.participantId] ? `var(--${p.color.toLowerCase()}-mid)` : undefined }} />
          ))}
        </div>
      </div>
      {statusBox}
    </div>
  );

  return (
    <section className={styles.screen} aria-labelledby="vote-title">
      <header className={styles.head}>
        <div>
          <p className="cap">
            Sesi {session.index} · {isTie ? "vote ulang" : "pilih mode"}
          </p>
          {isTie ? (
            <>
              <p className={styles.tieTag}>
                <TriangleAlert size={13} {...iconProps} /> Seri {tieScore}
              </p>
              <h1 id="vote-title" className={`dc ${styles.title}`}>
                Pilih salah satu, <span className="s">sekali lagi.</span>
              </h1>
            </>
          ) : (
            <h1 id="vote-title" className={`dc ${styles.title}`}>
              Mau foto <span className="s">model apa?</span>
            </h1>
          )}
        </div>
        <div className={styles.deskProgress}>{progress}</div>
      </header>

      <div className={styles.gridWrap}>
        <div role="radiogroup" aria-label="Mode foto" className={cx(styles.grid, isTie && styles.gridTie)} onKeyDown={onKey}>
          {voting.options.map((mode) => {
            const selected = myVote === mode;
            const voters = active.filter((p) => votes[p.participantId] === mode);
            const count = tally[mode] ?? 0;
            return (
              <div
                key={mode}
                role="radio"
                aria-checked={selected}
                tabIndex={selected || (!myVote && mode === voting.options[0]) ? 0 : -1}
                data-mode={mode}
                className={cx(styles.card, selected && styles.selected)}
                onClick={() => void cast(mode)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void cast(mode);
                  }
                }}
                aria-label={`${MODE_INFO[mode].name}. ${MODE_INFO[mode].description} ${count} suara${selected ? ", pilihanmu" : ""}`}
              >
                <span className={styles.preview} style={{ "--bg": BG[mode] } as CSSProperties}>
                  <ModeArt mode={mode} />
                  {selected && (
                    <span className={styles.mine}>
                      <Check size={13} {...iconProps} />
                      <span className={styles.mineText}>Pilihanmu</span>
                    </span>
                  )}
                </span>
                <span className={styles.body}>
                  <span className={styles.nameRow}>
                    <span className={`d ${styles.name}`}>
                      <span className={styles.longName}>{MODE_INFO[mode].name}</span>
                      <span className={styles.shortName}>{mode === "FREEFORM_COLLAGE" ? "Collage" : MODE_INFO[mode].name}</span>
                    </span>
                    <span className={styles.voters} aria-hidden="true">
                      {voters.map((p) => (
                        <Avatar key={p.participantId} name={p.displayName} color={p.color} size={26} ring />
                      ))}
                    </span>
                  </span>
                  <span className={styles.desc}>{MODE_INFO[mode].description}</span>
                  <span className={styles.foot}>
                    <span className={cx(styles.count, count === 0 && styles.muted)}>{count ? `${count} suara` : "Belum ada suara"}</span>
                    {!selected && (
                      <span className={styles.pick} aria-hidden="true">
                        Pilih
                      </span>
                    )}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        {overlay}
      </div>

      <div className={styles.mobProgress}>{progress}</div>
      <p className={styles.lockNote}>
        <Lock size={14} {...iconProps} /> Mode yang menang dikunci buat sesi ini. Frame dan layout tetap bisa diatur bareng.
      </p>
    </section>
  );
}
