"use client";

import { Check, Eye, RotateCcw, X } from "lucide-react";
import { CAPTURE_CONFIG } from "@longroll/shared";
import type { Attempt, CaptureState, ParticipantView, Shot, ShotParticipantState } from "@longroll/shared";
import { AttemptImage } from "@/capture/AttemptImage";
import type { CaptureController } from "@/capture/useCapture";
import { VideoView } from "@/components/media/VideoView";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { iconProps } from "@/components/ui/icon-props";
import { cx } from "@/lib/cx";
import { useMedia } from "@/media/MediaProvider";
import { useNow } from "@/room/hooks";
import styles from "./ReviewScreen.module.css";

interface ReviewScreenProps {
  cap: CaptureController;
  code: string;
  capture: CaptureState;
  shot: Shot;
  participants: ParticipantView[];
  meId: string;
  clockOffsetMs: number;
}

const stateText: Record<string, string> = {
  PENDING: "Nunggu…",
  CAPTURING: "Nyimpen foto…",
  UPLOADING: "Nyimpen foto…",
  DECIDING: "Lagi milih…",
  RETAKE_COUNTDOWN: "Ngulang",
  ACCEPTED: "Udah pakai",
  SKIPPED: "Dilewati",
  MISSING: "Nyambung lagi…",
  FAILED: "Fotonya gagal kekirim, nyoba lagi…",
  NOT_REQUIRED: "Gak ikut shot ini",
};

function currentAttempt(capture: CaptureState, ps: ShotParticipantState): Attempt | null {
  const id = ps.currentAttemptId ?? ps.acceptedAttemptId;
  return id ? (capture.attempts[id] ?? null) : null;
}

/**
 * SCR-14 "Pakai ini atau ulang?" (+ SCR-15 setelah accept). Keputusan HANYA dari tombol pemilik; tidak ada
 * timer, progress ring, atau teks yang menyiratkan penerimaan otomatis (REQ-CAP-09).
 */
export function ReviewScreen({ cap, code, capture, shot, participants, meId, clockOffsetMs }: ReviewScreenProps) {
  const media = useMedia();
  const now = useNow(250, true);
  const me = participants.find((p) => p.participantId === meId)!;
  const ps = shot.perParticipant[meId]!;
  const att = currentAttempt(capture, ps);
  const others = cap.required.filter((p) => p.participantId !== meId);
  const waitingFor = others.filter((p) => !["ACCEPTED", "SKIPPED"].includes(shot.perParticipant[p.participantId]?.status ?? ""));
  const nextIdx = shot.index + 2;
  const decidable = ps.status === "DECIDING" && att?.status === "READY";
  const retakeLeft = ps.retakeT0ServerMs ? Math.max(0, Math.ceil((ps.retakeT0ServerMs - (now + clockOffsetMs)) / 1000)) : 0;

  let photo;
  if (ps.status === "RETAKE_COUNTDOWN") {
    photo = (
      <div className={styles.live}>
        <VideoView stream={media.local.stream} mirrored={media.local.mirrored} presentation={media.local.presentation} />
        <span className={`dc ${styles.bigNum}`} aria-live="assertive" data-testid="retake-countdown">
          {retakeLeft}
        </span>
        <span className={styles.liveTag}>LIVE · ngulang</span>
      </div>
    );
  } else if (ps.status === "DECIDING" || ps.status === "ACCEPTED") {
    photo = <AttemptImage code={code} attemptId={att?.attemptId ?? null} alt={`Fotomu untuk shot ${shot.index + 1}`} pending={!att?.preview} />;
  } else if (ps.status === "FAILED" || cap.needsMakeup) {
    photo = (
      <div className={styles.note}>
        <p>{ps.status === "FAILED" ? "Fotomu gagal kekirim." : "Fotomu belum kekirim."}</p>
        <Button variant="primary" size="lg" onClick={() => void cap.retake()}>
          {ps.status === "MISSING" ? "Ambil fotomu" : "Coba lagi"}
        </Button>
      </div>
    );
  } else {
    photo = (
      <div className={styles.note} role="status">
        <p>{cap.saving ? `Nyimpen foto… ${Math.round(cap.saving.progress * 100)}%` : "Nyimpen foto…"}</p>
      </div>
    );
  }

  const accepted = ps.status === "ACCEPTED";
  return (
    <section className={styles.review} aria-label={`Foto shot ${shot.index + 1}`} data-testid="review" data-my-status={ps.status}>
      <div className={styles.mine}>
        <p className="cap">
          Shot {shot.index + 1} dari {cap.shotCount} · fotomu
        </p>
        {accepted ? (
          <h1 className={`dc ${styles.title}`} data-testid="review-title">
            Kamu udah oke. <span className="s">{waitingFor.length ? `Nunggu ${waitingFor.map((p) => p.displayName).join(", ")}…` : "Lanjut!"}</span>
          </h1>
        ) : (
          <h1 className={`dc ${styles.title}`} data-testid="review-title">
            Pakai ini <span className="s">atau ulang?</span>
          </h1>
        )}
        <div className={styles.photo} style={{ boxShadow: `0 0 0 3px var(--${me.color.toLowerCase()}-mid)` }} data-testid="my-photo">
          {photo}
          <span className={styles.nameTag}>
            <Avatar name={me.displayName} color={me.color} size={18} /> Kamu
          </span>
        </div>
        {accepted ? (
          <div className={styles.actions}>
            <Button variant="secondary" size="xl" onClick={() => void cap.reopen()} className={styles.change}>
              Ganti pilihanku
            </Button>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button variant="secondary" size="xl" disabled={!decidable} onClick={() => att && void cap.retake(att.attemptId)} icon={<RotateCcw size={18} {...iconProps} />} className={styles.retake}>
              Ulang
            </Button>
            <Button variant="primary" size="xl" disabled={!decidable} onClick={() => att && void cap.accept(att.attemptId)} icon={<Check size={18} {...iconProps} />} className={styles.accept}>
              Pakai ini
            </Button>
          </div>
        )}
        <p className={styles.caption}>Gak ada batas waktu. Temen-temen lihat kalau kamu ngulang.</p>
      </div>

      <div className={styles.others} aria-label="Yang lain">
        <header className={styles.othersHead}>
          <span className="cap">Yang lain</span>
          <span className={styles.hint}>{nextIdx <= cap.shotCount ? `Lanjut ke shot ${nextIdx} kalau semua udah “Pakai”` : "Shot terakhir. Semua “Pakai” → masuk editor"}</span>
        </header>
        <ul className={styles.cards}>
          {others.map((p) => (
            <OtherCard key={p.participantId} p={p} shot={shot} capture={capture} code={code} cap={cap} now={now} clockOffsetMs={clockOffsetMs} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function OtherCard({ p, shot, capture, code, cap, now, clockOffsetMs }: { p: ParticipantView; shot: Shot; capture: CaptureState; code: string; cap: CaptureController; now: number; clockOffsetMs: number }) {
  const media = useMedia();
  const ps = shot.perParticipant[p.participantId]!;
  const att = currentAttempt(capture, ps);
  const rejected = ps.attempts.map((id) => capture.attempts[id]).filter((a): a is Attempt => !!a && a.status === "REJECTED" && !a.purged && !!a.preview);
  const retaking = ps.status === "RETAKE_COUNTDOWN" || (rejected.length > 0 && (ps.status === "CAPTURING" || ps.status === "UPLOADING"));
  const gone = p.connection === "RECONNECTING";
  const goneSec = gone && p.disconnectedAtMs ? Math.floor((now + clockOffsetMs - p.disconnectedAtMs) / 1000) : 0;
  const canSkip = gone && goneSec * 1000 >= CAPTURE_CONFIG.skipAfterMs && ps.status !== "ACCEPTED" && ps.status !== "SKIPPED";
  const left = ps.retakeT0ServerMs ? Math.max(0, Math.ceil((ps.retakeT0ServerMs - (now + clockOffsetMs)) / 1000)) : 0;
  const stream = media.remote(p.participantId)?.stream ?? null;
  const decided = ps.status === "ACCEPTED" || ps.status === "SKIPPED";
  const label = gone && !decided ? "Nyambung lagi…" : retaking ? `Ngulang · percobaan ${ps.attempts.length + (ps.status === "RETAKE_COUNTDOWN" ? 1 : 0)}` : (stateText[ps.status] ?? ps.status);

  return (
    <li className={cx(styles.card, retaking && styles.cardRetake)} aria-label={`${p.displayName}: ${label}`} data-testid={`other-${p.color}`} data-status={ps.status}>
      <header className={styles.cardHead}>
        <Avatar name={p.displayName} color={p.color} size={24} />
        <strong>{p.displayName}</strong>
        <Chip tone={ps.status === "ACCEPTED" ? "ok" : retaking || ps.status === "FAILED" ? "warn" : "neutral"} icon={ps.status === "ACCEPTED" ? <Check size={13} {...iconProps} /> : ps.status === "DECIDING" ? <Eye size={13} {...iconProps} /> : undefined}>
          {label}
        </Chip>
      </header>
      <div className={styles.cardBody}>
        {rejected.length > 0 && (
          <ul className={styles.rejected} aria-label={`Foto ${p.displayName} yang diulang`}>
            {rejected.map((a) => (
              <li key={a.attemptId} className={styles.reject}>
                <AttemptImage code={code} attemptId={a.attemptId} alt={`Take ${a.attemptNo} ${p.displayName}, diulang`} />
                <span className={styles.rejectTag}>
                  <X size={11} {...iconProps} /> Take {a.attemptNo} · diulang
                </span>
              </li>
            ))}
          </ul>
        )}
        {retaking ? (
          <div className={styles.liveCard}>
            <VideoView stream={stream} mirrored={p.mirrored} presentation={p.cameraPresentation} />
            <span className={styles.liveTagSm}>LIVE</span>
            {ps.status === "RETAKE_COUNTDOWN" && <span className={`dc ${styles.smallNum}`}>{left}</span>}
          </div>
        ) : att && (ps.status === "DECIDING" || ps.status === "ACCEPTED") ? (
          <div className={styles.thumb}>
            <AttemptImage code={code} attemptId={att.attemptId} alt={`Foto ${p.displayName}`} pending={!att.preview} />
          </div>
        ) : (
          <div className={styles.thumb} aria-hidden="true">
            <span className={styles.wait}>{stateText[ps.status] ?? ""}</span>
          </div>
        )}
      </div>
      <footer className={styles.cardFoot}>
        {canSkip && (
          <Button size="sm" variant="secondary" onClick={() => void cap.skip(p.participantId)}>
            Lanjut tanpa {p.displayName}
          </Button>
        )}
        {!decided && !gone && (
          <Button size="sm" variant="ghost" onClick={() => void cap.nudge(p.participantId)}>
            Colek {p.displayName}
          </Button>
        )}
      </footer>
    </li>
  );
}
