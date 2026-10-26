"use client";

import { Camera, CameraOff, RefreshCw, RotateCcw, SwitchCamera } from "lucide-react";
import { useRef } from "react";
import type { PointerEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Slider } from "@/components/ui/Slider";
import { Tag } from "@/components/ui/Tag";
import { Toggle } from "@/components/ui/Toggle";
import { iconProps } from "@/components/ui/icon-props";
import { useMedia } from "@/media/MediaProvider";
import { useMediaQuery } from "@/room/hooks";
import { VideoView } from "./VideoView";
import styles from "./CameraSettings.module.css";

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;

/**
 * Kameraku (SCR-12, "Cuma kamu"): device, ganti depan/belakang, cermin, zoom/geser/kecerahan/kehangatan,
 * reset. Semua kontrol lokal; framing dikirim sebagai `cameraPresentation` milik sendiri (DEC-049).
 * Geser bisa dengan drag di pratinjau atau slider (alternatif non-gestur, 06 §13).
 */
export function CameraSettings({ showPreview = true, compact = false }: { showPreview?: boolean; compact?: boolean }) {
  const media = useMedia();
  const { local } = media;
  const coarse = useMediaQuery("(pointer: coarse)");
  const cp = local.presentation;
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const live = local.status === "live";

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (cp.zoom <= 1) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: cp.offset.x, oy: cp.offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const span = (cp.zoom - 1) / 2;
    const flip = local.mirrored ? -1 : 1;
    const clamp = (n: number) => Math.max(-1, Math.min(1, Math.round(n * 100) / 100));
    const x = clamp(d.ox - (flip * (e.clientX - d.x)) / (r.width * span || 1));
    const y = clamp(d.oy - (e.clientY - d.y) / (r.height * span || 1));
    media.setPresentation({ ...cp, offset: { x, y } });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className={compact ? `${styles.wrap} ${styles.compact}` : styles.wrap}>
      <div className={styles.head}>
        <Tag kind="local" />
        <p className={styles.note}>Pengaturan ini cuma ngubah kamera kamu. Filter buat semua ada di tab Filter.</p>
      </div>

      {showPreview && (
        <div
          className={styles.preview}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="img"
          aria-label="Pratinjau kamera kamu"
        >
          {live && local.stream ? (
            <VideoView stream={local.stream} mirrored={local.mirrored} presentation={cp} />
          ) : (
            <span className={styles.previewEmpty}>Kamera kamu lagi off</span>
          )}
          {cp.zoom > 1 && live && <span className={styles.dragHint}>Geser buat atur posisi</span>}
        </div>
      )}

      <div className={styles.row}>
        {live ? (
          <Button variant="secondary" size="md" icon={<CameraOff size={16} {...iconProps} />} onClick={media.disable}>
            Matikan kamera
          </Button>
        ) : (
          <Button variant="primary" size="md" icon={<Camera size={16} {...iconProps} />} onClick={() => void media.enable()}>
            Nyalain kamera
          </Button>
        )}
        {coarse ? (
          <Button variant="secondary" size="md" icon={<SwitchCamera size={16} {...iconProps} />} onClick={() => void media.flip()} disabled={!live}>
            Ganti kamera
          </Button>
        ) : (
          local.devices.length > 1 && (
            <label className={styles.select}>
              <span className="sr-only">Pilih kamera</span>
              <select value={local.deviceId ?? ""} onChange={(e) => void media.switchDevice(e.target.value)} disabled={!live}>
                {local.devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Kamera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )
        )}
      </div>

      <Toggle label="Cermin" checked={local.mirrored} onChange={media.setMirrored} className={styles.toggle} />

      <div className={styles.sliders}>
        <Slider label="Zoom" min={1} max={2} step={0.05} value={cp.zoom} format={(v) => `${v.toFixed(2)}×`} onChange={(zoom) => media.setPresentation({ ...cp, zoom })} />
        <Slider
          label="Geser kiri–kanan"
          min={-1}
          max={1}
          step={0.05}
          value={cp.offset.x}
          disabled={cp.zoom <= 1}
          format={pct}
          onChange={(x) => media.setPresentation({ ...cp, offset: { ...cp.offset, x } })}
        />
        <Slider
          label="Geser atas–bawah"
          min={-1}
          max={1}
          step={0.05}
          value={cp.offset.y}
          disabled={cp.zoom <= 1}
          format={pct}
          onChange={(y) => media.setPresentation({ ...cp, offset: { ...cp.offset, y } })}
        />
        <Slider label="Kecerahan" min={-1} max={1} step={0.05} value={cp.brightness} format={pct} onChange={(brightness) => media.setPresentation({ ...cp, brightness })} />
        <Slider label="Kehangatan" min={-1} max={1} step={0.05} value={cp.warmth} format={pct} onChange={(warmth) => media.setPresentation({ ...cp, warmth })} />
      </div>

      <div className={styles.row}>
        <Button variant="ghost" size="md" icon={<RotateCcw size={16} {...iconProps} />} onClick={media.resetPresentation}>
          Reset
        </Button>
        {local.status === "in_use" && (
          <Button variant="secondary" size="md" icon={<RefreshCw size={16} {...iconProps} />} onClick={() => void media.enable()}>
            Coba lagi
          </Button>
        )}
      </div>
    </div>
  );
}
