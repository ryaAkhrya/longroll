"use client";

import { ArrowLeft, Download, FileArchive, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GalleryView, RoomView } from "@longroll/shared";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ChipButton } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { iconProps } from "@/components/ui/icon-props";
import { useExport } from "@/export/useExport";
import type { RoomClient } from "@/room/client";
import { useMediaQuery } from "@/room/hooks";
import { ExportPanel } from "./ExportPanel";
import styles from "./GalleryScreen.module.css";

type GallerySession = GalleryView["sessions"][number];

/** Copy banner retensi persis seperti 12 §1 (REQ-LIFE-06). */
export const GALLERY_RETENTION_COPY = {
  strong: "Galeri ini sementara.",
  rest: "Setelah semua keluar dan room kedaluwarsa, foto dan datanya dihapus. Unduh yang kamu suka sebelum itu.",
} as const;

/** Segarkan sebelum signed URL (≤10 menit) kedaluwarsa. */
const REFRESH_MS = 8 * 60_000;

type Filter = { kind: "all" } | { kind: "session"; sessionId: string } | { kind: "person" };

interface Props {
  client: RoomClient;
  room: RoomView;
  onBack: () => void;
  onNewSession: () => void;
}

function ExportDialogBody({ client, room, s, onClose }: { client: RoomClient; room: RoomView; s: GallerySession; onClose: () => void }) {
  const toast = useToast();
  const exp = useExport({
    client,
    sessionId: s.sessionId,
    result: { index: s.index, version: s.version, dateMs: s.dateMs, finalizedAtMs: s.finalizedAtMs, participants: s.participants },
    participants: room.participants,
    customFrames: room.customFrames,
    reloadKey: 0,
    notify: (message) => toast.show({ message }),
  });
  return (
    <div className={styles.dialog}>
      <ExportPanel exp={exp} />
      <Button variant="ghost" size="md" onClick={onClose}>
        Tutup
      </Button>
    </div>
  );
}

/** SCR-18 Galeri sementara: hanya foto ACCEPTED (tidak ada UI/filter/rute untuk take gagal), chip Semua / Sesi n / Per orang. */
export function GalleryScreen({ client, room, onBack, onNewSession }: Props) {
  const mobile = useMediaQuery("(max-width: 1023px)");
  const [data, setData] = useState<GalleryView | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [download, setDownload] = useState<string | null>(null);

  const active = room.activeSession;
  // Berubah saat ada sesi baru / hasil baru / pratinjau siap → ambil ulang galeri.
  const refreshKey = `${active?.sessionId ?? ""}:${active?.state ?? ""}:${active?.result?.version ?? 0}:${active?.result?.previewReady ? 1 : 0}:${room.sessionCount ?? 0}`;

  const load = useCallback(async () => {
    const ack = await client.sendIntent("gallery.get", {});
    if (ack.ok && ack.data) {
      setData(ack.data as GalleryView);
      setError(false);
    } else setError(true);
  }, [client]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pengambilan data eksternal; setState terjadi setelah ack
    void load();
  }, [load, refreshKey]);
  useEffect(() => {
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const sessions = data?.sessions ?? [];
  const selected = sessions.find((s) => s.sessionId === download) ?? null;
  const people = useMemo(() => {
    const by = new Map<string, { name: string; color: string; photos: GalleryView["perPerson"] }>();
    for (const p of data?.perPerson ?? []) {
      const cur = by.get(p.participantId) ?? { name: p.participantName, color: p.color, photos: [] };
      cur.photos = [...cur.photos, p];
      by.set(p.participantId, cur);
    }
    return [...by.entries()];
  }, [data]);
  const shown = filter.kind === "session" ? sessions.filter((s) => s.sessionId === filter.sessionId) : sessions;
  const sessionPhotos = filter.kind === "session" ? (data?.perPerson ?? []).filter((p) => p.sessionId === filter.sessionId) : [];

  const dialog = selected ? <ExportDialogBody key={selected.sessionId + selected.version} client={client} room={room} s={selected} onClose={() => setDownload(null)} /> : null;

  return (
    <section className={styles.screen} aria-label="Galeri" data-testid="gallery-screen">
      <div className={styles.head}>
        <Button variant="ghost" size="md" icon={<ArrowLeft size={16} {...iconProps} />} onClick={onBack}>
          Kembali
        </Button>
        <h1 className="dc">
          Galeri <span className="s">sementara.</span>
        </h1>
        <span className={styles.spacer} />
        <Button variant="soft" size="md" icon={<Plus size={16} {...iconProps} />} onClick={onNewSession}>
          Sesi baru
        </Button>
      </div>

      <Banner tone="warn">
        <strong>{GALLERY_RETENTION_COPY.strong}</strong> {GALLERY_RETENTION_COPY.rest}
      </Banner>

      <div className={styles.bar}>
        <div className={styles.chips} role="group" aria-label="Filter galeri">
          <ChipButton selected={filter.kind === "all"} onClick={() => setFilter({ kind: "all" })}>
            Semua
          </ChipButton>
          {sessions.map((s) => (
            <ChipButton key={s.sessionId} selected={filter.kind === "session" && filter.sessionId === s.sessionId} onClick={() => setFilter({ kind: "session", sessionId: s.sessionId })}>
              Sesi {s.index}
            </ChipButton>
          ))}
          <ChipButton selected={filter.kind === "person"} onClick={() => setFilter({ kind: "person" })}>
            Per orang
          </ChipButton>
        </div>
        {/* DEC-045 (P2): .zip belum dibangun; tampil jelas tidak tersedia, bukan tombol yang diam. */}
        <Button variant="secondary" size="md" icon={<FileArchive size={16} {...iconProps} />} disabled aria-describedby="zip-na">
          Unduh semua (.zip)
        </Button>
        <span id="zip-na" className={styles.hint}>
          Segera hadir. Sementara, unduh per sesi.
        </span>
      </div>

      {error && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Coba lagi
            </Button>
          }
        >
          Galeri belum bisa dimuat.
        </Banner>
      )}

      {!data && !error ? (
        <div className={styles.grid} role="status" aria-label="Memuat galeri">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={260} radius={18} />
          ))}
        </div>
      ) : data && sessions.length === 0 ? (
        <p className={styles.empty}>Belum ada hasil. Selesaikan sesi dulu, nanti muncul di sini.</p>
      ) : filter.kind === "person" ? (
        <div className={styles.people} data-testid="gallery-people">
          {people.map(([id, p]) => (
            <section key={id} className={styles.person} aria-label={p.name}>
              <h2>{p.name}</h2>
              <div className={styles.photos}>
                {p.photos.map((ph) => (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL storage berumur pendek
                  <img key={ph.attemptId} src={ph.previewUrl} alt={`Foto ${p.name}, sesi ${sessions.find((s) => s.sessionId === ph.sessionId)?.index ?? ""} shot ${ph.shotIndex + 1}`} loading="lazy" className={styles.photo} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className={styles.grid} data-testid="gallery-sessions">
            {shown.map((s) => (
              <article key={s.sessionId} className={styles.card} aria-label={`Sesi ${s.index}`}>
                <div className={styles.thumb}>
                  {s.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URL storage berumur pendek
                    <img src={s.previewUrl} alt={`Hasil sesi ${s.index}`} loading="lazy" />
                  ) : (
                    <Skeleton width="100%" height="100%" radius={0} />
                  )}
                </div>
                <div className={styles.meta}>
                  <strong>{s.title}</strong>
                  <span>
                    {s.mode} · {s.participants.map((p) => p.name).join(", ")}
                  </span>
                  <span className="tnum">{new Date(s.finalizedAtMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <Button variant="primary" size="md" fullWidth icon={<Download size={16} {...iconProps} />} onClick={() => setDownload(s.sessionId)}>
                  Unduh
                </Button>
              </article>
            ))}
          </div>
          {sessionPhotos.length > 0 && (
            <div className={styles.photos} aria-label="Foto di sesi ini">
              {sessionPhotos.map((ph) => (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL storage berumur pendek
                <img key={ph.attemptId} src={ph.previewUrl} alt={`Foto ${ph.participantName}, shot ${ph.shotIndex + 1}`} loading="lazy" className={styles.photo} />
              ))}
            </div>
          )}
        </>
      )}

      {mobile ? (
        <BottomSheet open={!!selected} onClose={() => setDownload(null)} title={selected ? `Unduh sesi ${selected.index}` : "Unduh"} snap="full">
          {dialog}
        </BottomSheet>
      ) : (
        <Modal open={!!selected} onClose={() => setDownload(null)} title={selected ? `Unduh sesi ${selected.index}` : "Unduh"}>
          {dialog}
        </Modal>
      )}
    </section>
  );
}
