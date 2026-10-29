"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPTURE_CONFIG } from "@longroll/shared";
import type { AckPayload, ParticipantView, RoomView, SessionView, Shot, ShotParticipantState } from "@longroll/shared";
import { useToast } from "@/components/ui/Toast";
import { useMedia } from "@/media/MediaProvider";
import type { RoomClient } from "@/room/client";
import { captureFromVideo } from "./captureFrame";
import { uploadAttempt } from "./upload";

export interface CaptureController {
  shot: Shot | null;
  mine: ShotParticipantState | null;
  doneCount: number;
  shotCount: number;
  /** Peserta wajib di shot aktif (urut slot). */
  required: ParticipantView[];
  /** "Nyimpen foto…" lokal: ambil frame + upload berjalan. */
  saving: { progress: number } | null;
  /** Foto sendiri hilang / upload gagal → tombol "Ambil fotomu" / "Coba lagi". */
  needsMakeup: boolean;
  /** Konfirmasi "n orang belum siap" (DEC-026). */
  confirmNotReady: number | null;
  dismissConfirm: () => void;
  canArm: boolean;
  /** Banner "Shot n beres!" (null bila tidak ada). */
  doneBanner: { shotIndex: number; last: boolean } | null;
  waiting: boolean;
  setWaiting: (w: boolean) => void;
  arm: (confirm?: boolean) => Promise<AckPayload>;
  hold: () => Promise<AckPayload>;
  accept: (attemptId: string) => Promise<AckPayload>;
  retake: (attemptId?: string) => Promise<AckPayload>;
  reopen: () => Promise<AckPayload>;
  skip: (participantId: string) => Promise<AckPayload>;
  nudge: (participantId: string) => Promise<AckPayload>;
  setCountdown: (sec: 3 | 5 | 10) => Promise<AckPayload>;
}

const ARM_ERRORS: Record<string, string> = {
  ALREADY_ARMED: "Udah ada yang mulai hitung mundur.",
  NOT_REQUIRED: "Belum ada kamera yang nyala.",
  SHOT_DONE: "Shot ini udah beres.",
  NOT_IN_STUDIO: "Studio belum siap.",
  SERVICE_UNAVAILABLE: "Koneksi lagi gangguan, coba lagi.",
};

/**
 * Orkestrasi capture sisi klien (09 §7): siap otomatis (DEC-069), arm/hold, ambil frame lokal TEPAT pada T0
 * server (frame asli dari MediaStream, bukan placeholder), upload + retry, retake individual, skip/colek.
 * Tidak ada jalur yang menerima foto otomatis: accept hanya dari tombol pemilik.
 */
export function useCapture(client: RoomClient, room: RoomView, session: SessionView, meId: string | null): CaptureController {
  const toast = useToast();
  const media = useMedia();
  const mediaRef = useRef(media);
  useEffect(() => {
    mediaRef.current = media;
  });
  const capture = session.capture;
  const shot = capture && capture.shots.length ? capture.shots[capture.shots.length - 1]! : null;
  const mine = shot && meId ? (shot.perParticipant[meId] ?? null) : null;
  const doneCount = capture ? capture.shots.filter((s) => s.state === "DONE").length : 0;
  const shotCount = capture?.shotCount ?? session.studio?.layout.shotCount ?? 1;
  const me = room.participants.find((p) => p.participantId === meId) ?? null;

  const latest = useRef({ shot, mine, session });
  useEffect(() => {
    latest.current = { shot, mine, session };
  });

  // ---------------------------------------------------------------- video tersembunyi untuk capture
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute("aria-hidden", "true");
    v.dataset.captureSource = "";
    v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1";
    document.body.appendChild(v);
    videoRef.current = v;
    return () => {
      v.srcObject = null;
      v.remove();
      videoRef.current = null;
    };
  }, []);
  const stream = media.local.status === "live" ? media.local.stream : null;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);

  // ---------------------------------------------------------------- siap otomatis + "Bentar" (DEC-069)
  const [waiting, setWaiting] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const wantReady = media.local.status === "live" && visible && !waiting;
  const serverReady = me?.ready ?? false;
  useEffect(() => {
    if (!me || me.connection !== "CONNECTED" || wantReady === serverReady) return;
    const t = setTimeout(() => void client.sendIntent("presence.set", { ready: wantReady }), 120);
    return () => clearTimeout(t);
  }, [client, me, wantReady, serverReady]);

  // ---------------------------------------------------------------- jadwal capture pada T0
  const [saving, setSaving] = useState<{ progress: number } | null>(null);
  const handledKeys = useRef(new Set<string>());

  const scheduleKey = (() => {
    if (!shot || !meId) return null;
    if (shot.state === "COUNTDOWN" && shot.t0ServerMs !== null && shot.required.includes(meId)) return `s:${session.sessionId}:${shot.index}:${shot.t0ServerMs}`;
    if (shot.state === "REVIEW" && mine?.status === "RETAKE_COUNTDOWN" && mine.retakeT0ServerMs !== null) return `r:${session.sessionId}:${shot.index}:${mine.retakeT0ServerMs}`;
    return null;
  })();
  const t0 = shot?.state === "COUNTDOWN" ? shot.t0ServerMs : (mine?.retakeT0ServerMs ?? null);
  const kind: "shot" | "retake" = scheduleKey?.startsWith("r:") ? "retake" : "shot";

  useEffect(() => {
    if (!scheduleKey || t0 === null || handledKeys.current.has(scheduleKey)) return;
    const key = scheduleKey;
    const target = t0;
    const shotIndex = latest.current.shot!.index;
    const sessionId = latest.current.session.sessionId;
    const delay = Math.max(0, target - client.serverNow() - 600);
    const timer = setTimeout(async () => {
      const video = videoRef.current;
      const cam = mediaRef.current.local;
      if (!video || cam.status !== "live" || !video.srcObject || handledKeys.current.has(key)) return; // tanpa kamera → server menandai MISSING
      handledKeys.current.add(key);
      setSaving({ progress: 0 });
      try {
        const photo = await captureFromVideo(video, { t0ServerMs: target, serverNow: () => client.serverNow(), presentation: cam.presentation, mirrored: cam.mirrored });
        // SY-03: shot dibatalkan (Tunggu!) / retake dibatalkan setelah frame lokal → buang, jangan upload.
        const cur = latest.current;
        const cancelled = key.startsWith("s:")
          ? !cur.shot || cur.shot.index !== shotIndex || cur.shot.state === "IDLE" || (cur.shot.state === "COUNTDOWN" && cur.shot.t0ServerMs !== target)
          : cur.mine?.status !== "RETAKE_COUNTDOWN" && cur.mine?.status !== "CAPTURING";
        if (cancelled) return;
        const out = await uploadAttempt({ client, sessionId, shotIndex, kind, photo, onProgress: (progress) => setSaving({ progress }) });
        if (!out.ok && out.reason === "FAILED") {
          if (out.attemptId) await client.sendIntent("attempt.fail", { attemptId: out.attemptId });
          toast.show({ message: "Fotomu gagal kekirim. Coba lagi.", tone: "warn" });
        }
      } catch {
        toast.show({ message: "Gagal ngambil foto dari kamera. Coba lagi.", tone: "warn" });
      } finally {
        setSaving(null);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [scheduleKey, t0, kind, client, toast]);

  // ---------------------------------------------------------------- state turunan
  // Foto sendiri hilang (reload / crash sebelum upload / kamera mati saat T0) atau upload gagal 3×.
  const needsMakeup =
    !!mine &&
    !saving &&
    (mine.status === "MISSING" || mine.status === "FAILED" || ((mine.status === "CAPTURING" || mine.status === "UPLOADING") && shot?.state === "REVIEW"));

  const required = useMemo(() => {
    if (!shot) return [];
    return shot.required
      .map((id) => room.participants.find((p) => p.participantId === id))
      .filter((p): p is ParticipantView => !!p)
      .sort((a, b) => a.color.localeCompare(b.color));
  }, [shot, room.participants]);

  const canArm = !!meId && session.state !== "EDITING" && doneCount < shotCount && (!shot || shot.state === "DONE" || shot.state === "IDLE");

  // ---------------------------------------------------------------- aksi
  const [confirmNotReady, setConfirmNotReady] = useState<number | null>(null);
  const [doneBanner, setDoneBanner] = useState<{ shotIndex: number; last: boolean } | null>(null);
  const sessionId = session.sessionId;
  const idx = shot && shot.state !== "DONE" ? shot.index : doneCount;

  const arm = useCallback(
    async (confirm = false) => {
      const ack = await client.sendIntent("shot.arm", { sessionId, shotIndex: doneCount, confirmNotReady: confirm });
      if (!ack.ok) {
        if (ack.error === "CONFIRM_REQUIRED") setConfirmNotReady((ack.detail as { notReady?: number } | undefined)?.notReady ?? 1);
        else toast.show({ message: ARM_ERRORS[ack.error ?? ""] ?? "Gagal mulai hitung mundur.", tone: "warn" });
      } else setConfirmNotReady(null);
      return ack;
    },
    [client, sessionId, doneCount, toast],
  );
  const hold = useCallback(async () => {
    const ack = await client.sendIntent("shot.hold", { sessionId, shotIndex: idx });
    if (!ack.ok && ack.error === "TOO_LATE") toast.show({ message: "Udah lewat, fotonya keburu diambil.", tone: "warn" });
    return ack;
  }, [client, sessionId, idx, toast]);
  const accept = useCallback((attemptId: string) => client.sendIntent("capture.accept", { sessionId, shotIndex: idx, attemptId }), [client, sessionId, idx]);
  const retake = useCallback(
    (attemptId?: string) => client.sendIntent("capture.retake", { sessionId, shotIndex: idx, ...(attemptId ? { attemptId } : {}) }),
    [client, sessionId, idx],
  );
  const reopen = useCallback(() => client.sendIntent("capture.reopen", { sessionId, shotIndex: idx }), [client, sessionId, idx]);
  const skip = useCallback(
    async (participantId: string) => {
      const ack = await client.sendIntent("shot.skip", { sessionId, shotIndex: idx, participantId });
      if (!ack.ok) toast.show({ message: "Belum bisa lanjut tanpa dia. Tunggu 15 detik dulu.", tone: "warn" });
      return ack;
    },
    [client, sessionId, idx, toast],
  );
  const nudge = useCallback(
    async (participantId: string) => {
      const ack = await client.sendIntent("nudge", { participantId });
      if (!ack.ok) toast.show({ message: ack.error === "RATE_LIMITED" ? "Sabar, baru aja dicolek." : "Gagal mencolek.", tone: "warn" });
      else toast.show({ message: "Colekan terkirim" });
      return ack;
    },
    [client, toast],
  );
  const setCountdown = useCallback((sec: 3 | 5 | 10) => client.sendIntent("studio.update", { sessionId, patch: { countdownSec: sec } }), [client, sessionId]);

  // ---------------------------------------------------------------- event → toast / banner / colek
  const nameOf = useCallback((id: string) => client.getSnapshot().room?.participants.find((p) => p.participantId === id)?.displayName ?? "Seseorang", [client]);
  useEffect(
    () =>
      client.onEvent((e) => {
        if (Date.now() - e.atMs > 10_000) return;
        if (e.type === "shot.cancelled") {
          const { by } = e.payload as { by: string };
          toast.show({ message: `${by === client.getSnapshot().me ? "Kamu" : nameOf(by)} nahan dulu` });
        } else if (e.type === "shot.done") {
          const { shotIndex, last } = e.payload as { shotIndex: number; last: boolean };
          setDoneBanner({ shotIndex, last });
        }
      }),
    [client, toast, nameOf],
  );
  useEffect(() => {
    if (!doneBanner) return;
    const t = setTimeout(() => setDoneBanner(null), CAPTURE_CONFIG.shotDoneBannerMs);
    return () => clearTimeout(t);
  }, [doneBanner]);
  useEffect(
    () =>
      client.onSignal((type, payload) => {
        if (type !== "nudge") return;
        toast.show({ message: `${nameOf((payload as { from: string }).from)} nyolek kamu. Udah milih?` });
      }),
    [client, toast, nameOf],
  );

  return {
    shot,
    mine,
    doneCount,
    shotCount,
    required,
    saving,
    needsMakeup,
    confirmNotReady,
    dismissConfirm: () => setConfirmNotReady(null),
    canArm,
    doneBanner,
    waiting,
    setWaiting,
    arm,
    hold,
    accept,
    retake,
    reopen,
    skip,
    nudge,
    setCountdown,
  };
}
