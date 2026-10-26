"use client";

import { ArrowRight, Camera, Check, CircleAlert, RefreshCw, SwitchCamera } from "lucide-react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Slider } from "@/components/ui/Slider";
import { Toggle } from "@/components/ui/Toggle";
import { iconProps } from "@/components/ui/icon-props";
import { useMedia } from "@/media/MediaProvider";
import { useMediaQuery } from "@/room/hooks";
import { VideoView } from "./VideoView";
import styles from "./CameraCheck.module.css";

/**
 * SCR-04 Cek kamera (DEC-077, DERIVED). Penjelasan dulu, `getUserMedia` hanya setelah tombol ditekan.
 * Video saja — mikrofon tidak pernah diminta (DEC-076). Bisa masuk tanpa kamera (DEC-068).
 */
export function CameraCheck({ onDone }: { onDone: () => void }) {
  const media = useMedia();
  const { local } = media;
  const coarse = useMediaQuery("(pointer: coarse)");
  const live = local.status === "live" && !!local.stream;
  const cp = local.presentation;

  const enterWithout = () => {
    media.skip();
    onDone();
  };

  return (
    <section className={styles.wrap} aria-labelledby="camcheck-title">
      <div className={styles.preview}>
        {live ? (
          <VideoView stream={local.stream} mirrored={local.mirrored} presentation={cp} />
        ) : (
          <span className={styles.previewEmpty} aria-hidden="true">
            <Camera size={28} {...iconProps} />
          </span>
        )}
        <span className={styles.oval} aria-hidden="true" />
        {live && coarse && (
          <button type="button" className={styles.flip} onClick={() => void media.flip()} aria-label="Ganti kamera depan/belakang">
            <SwitchCamera size={18} {...iconProps} />
          </button>
        )}
      </div>

      <Card padding="lg" className={styles.panel}>
        <p className="cap">Sebelum masuk</p>
        <h1 id="camcheck-title" className={`dc ${styles.title}`}>
          Cek kamera <span className="s">dulu.</span>
        </h1>

        <div aria-live="polite" className={styles.stateBox}>
          {(local.status === "idle" || local.status === "off") && (
            <p className={styles.lead}>
              Kamera dipakai buat feed live ke peserta room ini dan buat foto yang disimpan sementara sampai room bubar. Kamera cuma nyala setelah
              kamu izinkan. Mikrofon gak dipakai.
            </p>
          )}
          {local.status === "starting" && <p className={styles.lead}>Nunggu izin dari browser…</p>}
          {local.status === "denied" && (
            <Banner tone="error" title="Browser nolak akses kamera.">
              Cara ngizinin lagi:
              <ol className={styles.steps}>
                <li>
                  <strong>Desktop:</strong> klik ikon gembok/kamera di address bar → izinkan Kamera → muat ulang halaman.
                </li>
                <li>
                  <strong>iPhone:</strong> Pengaturan › Safari › Kamera → Izinkan, lalu muat ulang.
                </li>
                <li>
                  <strong>Android:</strong> ikon gembok di Chrome → Izin → Kamera → Izinkan, lalu muat ulang.
                </li>
              </ol>
            </Banner>
          )}
          {local.status === "unavailable" && <Banner tone="warn">Kamera gak ketemu di perangkat ini. Kamu tetap bisa masuk tanpa kamera.</Banner>}
          {local.status === "in_use" && (
            <Banner tone="warn">Kamera lagi dipakai aplikasi lain. Tutup Zoom/Meet atau aplikasi lain yang pakai kamera, lalu coba lagi.</Banner>
          )}
          {local.status === "unsupported" && <Banner tone="warn">Browser ini belum bisa pakai kamera. Coba Chrome, Safari, atau Firefox terbaru.</Banner>}
        </div>

        {live && (
          <ul className={styles.checks}>
            <li>
              <Check size={16} {...iconProps} className={styles.ok} /> Izin kamera
            </li>
            {!coarse && local.devices.length > 1 && (
              <li className={styles.selectRow}>
                <label>
                  <span>Kamera</span>
                  <select value={local.deviceId ?? ""} onChange={(e) => void media.switchDevice(e.target.value)}>
                    {local.devices.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>
                        {d.label || `Kamera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            )}
            <li>
              <Toggle label="Cermin" checked={local.mirrored} onChange={media.setMirrored} className={styles.toggle} />
            </li>
          </ul>
        )}

        {live && (
          <div className={styles.sliders}>
            <Slider label="Kecerahan" min={-1} max={1} step={0.05} value={cp.brightness} format={(v) => `${Math.round(v * 100)}`} onChange={(brightness) => media.setPresentation({ ...cp, brightness })} />
            <Slider label="Zoom" min={1} max={2} step={0.05} value={cp.zoom} format={(v) => `${v.toFixed(2)}×`} onChange={(zoom) => media.setPresentation({ ...cp, zoom })} />
          </div>
        )}

        <div className={styles.actions}>
          {live ? (
            <Button variant="primary" size="xl" fullWidth iconAfter={<ArrowRight size={18} {...iconProps} />} onClick={onDone}>
              Masuk ke lobby
            </Button>
          ) : local.status === "in_use" ? (
            <Button variant="primary" size="xl" fullWidth icon={<RefreshCw size={18} {...iconProps} />} onClick={() => void media.enable()}>
              Coba lagi
            </Button>
          ) : local.status === "denied" || local.status === "unavailable" || local.status === "unsupported" ? (
            <Button variant="secondary" size="xl" fullWidth icon={<CircleAlert size={18} {...iconProps} />} onClick={() => void media.enable()}>
              Coba lagi
            </Button>
          ) : (
            <Button variant="primary" size="xl" fullWidth icon={<Camera size={18} {...iconProps} />} loading={local.status === "starting"} onClick={() => void media.enable()}>
              Nyalain kamera
            </Button>
          )}
          <Button variant="ghost" size="lg" fullWidth onClick={enterWithout}>
            Masuk tanpa kamera
          </Button>
        </div>
      </Card>
    </section>
  );
}
