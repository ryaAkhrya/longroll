"use client";

import { Camera, CameraOff, Link2, Plus, RefreshCw, SlidersHorizontal, VideoOff, WifiOff } from "lucide-react";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ParticipantView } from "@longroll/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/cx";
import { useMedia } from "@/media/MediaProvider";
import { useNow } from "@/room/hooks";
import { VideoView } from "./VideoView";
import styles from "./CameraTile.module.css";

interface CameraTileProps {
  participant?: ParticipantView;
  isSelf?: boolean;
  slotNumber: number;
  inviteUrl: string;
  holdSeconds: number;
  clockOffsetMs?: number;
  /** `lobby` = kartu radius 18 + tag LIVE; `booth` = stage, radius 16; `edge` = mobile fullscreen tanpa radius. */
  variant?: "lobby" | "booth" | "edge";
  onOpenCameraPanel?: () => void;
  /** Konten tambahan (mis. badge status siap). */
  children?: ReactNode;
}

function formatClock(totalSec: number) {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type View =
  | { kind: "video"; stream: MediaStream }
  | { kind: "connecting" }
  | { kind: "failed" }
  | { kind: "permission" }
  | { kind: "off" }
  | { kind: "none" }
  | { kind: "in_use" }
  | { kind: "self-error"; text: string };

/**
 * Kartu kamera (05 §10, SCR-05/SCR-08): feed live nyata dari track lokal/remote, plus state
 * connecting, permission, camera_off, reconnecting, failed, empty. Kontrol kamera hanya ada di kartu
 * milik sendiri; tidak ada kontrol untuk kamera orang lain (REQ-CAM-13).
 */
export function CameraTile({
  participant,
  isSelf,
  slotNumber,
  inviteUrl,
  holdSeconds,
  clockOffsetMs = 0,
  variant = "lobby",
  onOpenCameraPanel,
  children,
}: CameraTileProps) {
  const toast = useToast();
  const media = useMedia();
  const reconnecting = participant?.connection === "RECONNECTING";
  const now = useNow(1_000, reconnecting);
  const [playingFor, setPlayingFor] = useState<MediaStream | null>(null);

  if (!participant) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        toast.show({ message: "Link room tersalin" });
      } catch {
        toast.show({ message: "Gagal menyalin. Salin link dari kartu undangan.", tone: "warn" });
      }
    };
    return (
      <li className={cx(styles.tile, styles[variant], styles.empty)} aria-label={`Slot ke-${slotNumber}, kosong`}>
        <span className={styles.plus} aria-hidden="true">
          <Plus size={22} {...iconProps} />
        </span>
        <p className={styles.emptyTitle}>
          Slot ke-{slotNumber}
          <span className={styles.longOnly}> masih kosong</span>
        </p>
        <Button variant="secondary" size="sm" icon={<Link2 size={14} {...iconProps} />} onClick={copy} className={styles.longBtn}>
          Salin link undangan
        </Button>
      </li>
    );
  }

  const name = participant.displayName;
  const peer = isSelf ? null : media.remote(participant.participantId);
  const local = media.local;
  let view: View;
  if (isSelf) {
    if (local.status === "live" && local.stream) view = { kind: "video", stream: local.stream };
    else if (local.status === "starting") view = { kind: "permission" };
    else if (local.status === "off" || local.status === "ended") view = { kind: "off" };
    else if (local.status === "denied") view = { kind: "self-error", text: "Browser nolak akses kamera." };
    else if (local.status === "unavailable") view = { kind: "self-error", text: "Kamera gak ketemu di perangkat ini." };
    else if (local.status === "in_use") view = { kind: "self-error", text: "Kamera lagi dipakai aplikasi lain." };
    else if (local.status === "unsupported") view = { kind: "self-error", text: "Browser ini belum bisa pakai kamera." };
    else view = { kind: "none" };
  } else if (participant.camera === "permission") view = { kind: "permission" };
  else if (participant.camera === "off") view = { kind: "off" };
  else if (participant.camera === "none") view = { kind: "none" };
  else if (participant.camera === "in_use") view = { kind: "in_use" };
  else if (peer?.status === "failed") view = { kind: "failed" };
  else if (peer?.stream) view = { kind: "video", stream: peer.stream };
  else view = { kind: "connecting" };

  const mirrored = isSelf ? local.mirrored : participant.mirrored;
  const presentation = isSelf ? local.presentation : participant.cameraPresentation;
  const remaining =
    reconnecting && participant.disconnectedAtMs !== null ? holdSeconds - (now + clockOffsetMs - participant.disconnectedAtMs) / 1000 : 0;
  const showSkeleton = view.kind === "connecting" || (view.kind === "video" && !isSelf && playingFor !== view.stream && peer?.status !== "connected");

  const statusText = reconnecting
    ? `nyambung lagi, slot dijaga ${formatClock(remaining)}`
    : view.kind === "video"
      ? "live"
      : view.kind === "connecting"
        ? "lagi nyambung"
        : view.kind === "failed"
          ? "gagal nyambung"
          : view.kind === "permission"
            ? "lagi nyalain kamera"
            : view.kind === "off"
              ? "kamera off"
              : view.kind === "in_use"
                ? "kamera dipakai aplikasi lain"
                : view.kind === "self-error"
                  ? view.text
                  : "tanpa kamera";

  return (
    <li
      className={cx(
        styles.tile,
        styles[variant],
        styles[participant.color],
        isSelf && styles.self,
        reconnecting && styles.reconnecting,
        view.kind === "permission" && styles.blur,
      )}
      style={{ "--ring": `var(--${participant.color.toLowerCase()}-mid)` } as CSSProperties}
      aria-label={`Kamera ${name}${isSelf ? " (kamu)" : ""}, ${statusText}`}
      data-camera={view.kind}
    >
      {view.kind === "video" && (
        <VideoView stream={view.stream} mirrored={mirrored} presentation={presentation} onPlaying={() => setPlayingFor(view.stream)} />
      )}
      {showSkeleton && (
        <span className={styles.center} aria-hidden="true">
          <span className={styles.shimmer} />
          <span className={styles.state}>Nyambungin kamera {isSelf ? "kamu" : name}…</span>
        </span>
      )}
      {view.kind !== "video" && view.kind !== "connecting" && (
        <span className={styles.center}>
          {view.kind === "permission" ? (
            <span className={styles.iconBubble} aria-hidden="true">
              <Camera size={18} {...iconProps} />
            </span>
          ) : (
            <Avatar name={name} color={participant.color} size={64} className={styles.bigAvatar} />
          )}
          <span className={styles.state}>
            {view.kind === "failed" && <WifiOff size={14} {...iconProps} />}
            {(view.kind === "off" || view.kind === "none") && <CameraOff size={14} {...iconProps} />}
            {view.kind === "in_use" && <VideoOff size={14} {...iconProps} />}
            {view.kind === "permission" && (isSelf ? "Nyalain kamera…" : `${name} lagi nyalain kamera…`)}
            {view.kind === "off" && (isSelf ? "Kamera kamu lagi off" : `Kamera ${name} lagi off`)}
            {view.kind === "none" && (isSelf ? "Kamu masuk tanpa kamera" : `${name} masuk tanpa kamera`)}
            {view.kind === "in_use" && `Kamera ${name} lagi dipakai aplikasi lain`}
            {view.kind === "failed" && `Gak bisa nyambung ke kamera ${name}`}
            {view.kind === "self-error" && view.text}
          </span>
          {view.kind === "failed" && (
            <Button variant="secondary" size="sm" icon={<RefreshCw size={14} {...iconProps} />} onClick={() => media.retryPeer(participant.participantId)}>
              Coba lagi
            </Button>
          )}
          {isSelf && (view.kind === "off" || view.kind === "none" || view.kind === "self-error") && (
            <Button variant="primary" size="sm" icon={<Camera size={14} {...iconProps} />} onClick={() => void media.enable()}>
              {view.kind === "off" ? "Nyalain lagi" : "Nyalain kamera"}
            </Button>
          )}
        </span>
      )}

      {reconnecting && (
        <span className={styles.reconnectPill} aria-hidden="true">
          <WifiOff size={13} {...iconProps} /> Nyambung lagi… <span className="tnum">{formatClock(remaining)}</span>
        </span>
      )}

      <span className={styles.name} aria-hidden="true">
        <Avatar name={name} color={participant.color} size={18} />
        {isSelf ? "Kamu" : name}
      </span>

      {isSelf && view.kind === "video" && variant === "lobby" && <span className={styles.live}>LIVE</span>}
      {isSelf && local.quality > 0 && view.kind === "video" && <span className={styles.quality}>Kualitas diturunkan</span>}

      {isSelf && (
        <span className={styles.controls}>
          {onOpenCameraPanel && (
            <button type="button" className={styles.ctrl} onClick={onOpenCameraPanel} aria-label="Buka pengaturan Kameraku">
              <SlidersHorizontal size={16} {...iconProps} />
            </button>
          )}
          {view.kind === "video" && (
            <button type="button" className={styles.ctrl} onClick={media.disable} aria-label="Matikan kamera kamu">
              <CameraOff size={16} {...iconProps} />
            </button>
          )}
        </span>
      )}
      {children}
    </li>
  );
}
