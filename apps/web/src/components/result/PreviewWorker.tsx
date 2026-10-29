"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomView } from "@longroll/shared";
import { loadSessionDoc, prepareExport, renderAndUploadPreview } from "@/export/session";
import type { RoomClient } from "@/room/client";

interface Props {
  client: RoomClient;
  room: RoomView;
  meId: string | null;
}

/**
 * Pekerja tanpa UI: merender pratinjau WebP ≤1600 px hasil sesi dan mengunggahnya (DEC-059/060).
 * Pemicu: (a) saya yang menekan Selesai → langsung; (b) server meminta (`result.render.request`, fallback
 * round-robin 30 detik bila finalizer putus). Satu render per (sesi, versi); versi lama diabaikan server.
 */
export function PreviewWorker({ client, room, meId }: Props) {
  const [asked, setAsked] = useState<{ sessionId: string; version: number } | null>(null);
  const done = useRef(new Set<string>());
  const live = room.activeSession;
  const result = live?.state === "FINAL" ? live.result : null;

  useEffect(
    () =>
      client.onSignal((type, payload) => {
        if (type === "result.render.request") setAsked(payload as { sessionId: string; version: number });
      }),
    [client],
  );

  const own = result && meId && result.finalizedBy === meId && !result.previewReady ? { sessionId: result.sessionId, version: result.version } : null;
  const target = own ?? (asked && result && asked.sessionId === result.sessionId && asked.version === result.version && !result.previewReady ? asked : null);
  const key = target ? `${target.sessionId}:${target.version}` : null;
  const customFrames = room.customFrames;
  const participants = room.participants;

  useEffect(() => {
    if (!target || !key || !result || done.current.has(key)) return;
    done.current.add(key);
    const ac = new AbortController();
    (async () => {
      try {
        const doc = await loadSessionDoc(client, target.sessionId);
        const prepared = await prepareExport(client, doc, {
          custom: customFrames,
          dateMs: result.dateMs ?? result.finalizedAtMs,
          nameOfColor: (c) => participants.find((x) => x.color === c && x.connection !== "LEFT")?.displayName ?? result.participants.find((x) => x.color === c)?.name ?? "",
        });
        if (!prepared || ac.signal.aborted) return done.current.delete(key);
        await renderAndUploadPreview(client, target.sessionId, target.version, prepared, ac.signal);
      } catch {
        // Gagal (jaringan / storage): izinkan percobaan ulang pada permintaan server berikutnya.
        done.current.delete(key);
      }
    })();
    return () => ac.abort();
    // Hanya dijalankan ulang bila target berganti; data room dibaca saat itu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client]);

  return null;
}
