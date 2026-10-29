"use client";

import { Images, Pencil, Plus } from "lucide-react";
import { useEffect } from "react";
import type { RoomView, SessionView } from "@longroll/shared";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { iconProps } from "@/components/ui/icon-props";
import { useExport } from "@/export/useExport";
import { usePreview } from "@/export/usePreview";
import type { RoomClient } from "@/room/client";
import { ExportPanel } from "./ExportPanel";
import { EXPORT_BUSY, EXPORT_IDLE } from "./inviteStatus";
import styles from "./ResultScreen.module.css";

interface Props {
  client: RoomClient;
  room: RoomView;
  /** Sesi FINAL (atau yang baru saja FINAL lalu ditutup karena sesi baru) dengan `result`. */
  session: SessionView;
  meId: string;
  /** Sesi ini sudah ditutup (ada sesi baru) → tidak bisa Balik edit. */
  closed?: boolean;
  onGallery: () => void;
  onNewSession: () => void;
  /** Banner "Sesi {n} lagi vote · Gabung" (SCR-19, setelah memilih Bentar). */
  newSession?: { index: number; label: string; onJoin: () => void } | null;
}

/** SCR-17 Hasil & export: pratinjau final + format/ukuran + Unduh (utama) + Simpan ke Google Drive. */
export function ResultScreen({ client, room, session, meId, closed = false, onGallery, onNewSession, newSession = null }: Props) {
  const toast = useToast();
  const result = session.result!;
  const exp = useExport({
    client,
    sessionId: session.sessionId,
    result,
    participants: room.participants,
    customFrames: room.customFrames,
    reloadKey: 0,
    notify: (message) => toast.show({ message }),
  });
  const preview = usePreview(exp.prepared);
  // SCR-19: peserta lain melihat "Lagi unduh…" selama saya merender/mengunggah (volatile, hanya info UX).
  const busy = exp.phase === "rendering" || exp.phase === "drive_uploading";
  useEffect(() => {
    if (!busy) return;
    client.sendVolatile("presence.activity", { activity: EXPORT_BUSY });
    return () => void client.sendVolatile("presence.activity", { activity: EXPORT_IDLE });
  }, [busy, client]);
  const finisher = room.participants.find((p) => p.participantId === result.finalizedBy)?.displayName ?? result.participants.find((p) => p.participantId === result.finalizedBy)?.name ?? "Seseorang";
  const reopen = async () => {
    const ack = await client.sendIntent("session.reopen", { sessionId: session.sessionId });
    if (!ack.ok) toast.show({ message: "Belum bisa balik edit sekarang.", tone: "warn" });
  };

  return (
    <section className={styles.screen} aria-label="Hasil dan ekspor" data-testid="result-screen" data-session={session.sessionId}>
      <div className={styles.top}>
        <h1 className="dc">
          Sesi {result.index} <span className="s">udah jadi.</span>
        </h1>
        <p className={styles.by}>Diselesaikan oleh {meId === result.finalizedBy ? "kamu" : finisher}</p>
      </div>
      {newSession && (
        <Banner
          tone="info"
          action={
            <Button variant="primary" size="sm" onClick={newSession.onJoin}>
              Gabung
            </Button>
          }
        >
          Sesi {newSession.index} lagi {newSession.label}.
        </Banner>
      )}
      <div className={styles.body}>
        <div className={styles.stage} aria-live="polite">
          {preview.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob URL lokal hasil render canvas
            <img src={preview.url} alt={`Hasil sesi ${result.index}`} className={styles.img} data-testid="result-preview" />
          ) : preview.failed || exp.doc === "error" ? (
            <p className={styles.fail}>Pratinjau belum bisa ditampilkan.</p>
          ) : (
            <Skeleton width="100%" height="100%" radius={18} />
          )}
        </div>
        <aside className={styles.side}>
          <ExportPanel exp={exp} />
          <div className={styles.nav}>
            {!closed && (
              <Button variant="secondary" size="md" icon={<Pencil size={16} {...iconProps} />} onClick={() => void reopen()}>
                Balik edit
              </Button>
            )}
            <Button variant="secondary" size="md" icon={<Images size={16} {...iconProps} />} onClick={onGallery}>
              Ke galeri
            </Button>
            <Button variant="soft" size="md" icon={<Plus size={16} {...iconProps} />} onClick={onNewSession}>
              Sesi baru
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}
