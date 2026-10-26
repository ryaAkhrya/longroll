"use client";

import { ArrowLeft, ImageUp } from "lucide-react";
import { useRef, useState } from "react";
import { FRAME_LIMITS, OUTPUT_PRESET_LABEL, computeFrameTransform, exportScaleFor, frameUpscaleWarning, planFromHoles } from "@longroll/shared";
import type { FrameAdapt, FrameRef, FrameTemplate, Insets, Mode, StudioPatch, StudioState } from "@longroll/shared";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Slider } from "@/components/ui/Slider";
import { Tag } from "@/components/ui/Tag";
import { iconProps } from "@/components/ui/icon-props";
import { ApiError, api, uploadToUrl } from "@/room/api";
import { cx } from "@/lib/cx";
import styles from "./panels.module.css";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; progress: number }
  | { kind: "checking"; name: string }
  | { kind: "ready"; frameId: string; template: FrameTemplate; holes: number }
  | { kind: "error"; message: string };

const ADAPT_LABEL: Record<FrameAdapt, string> = {
  FIXED: "Ikuti lubang",
  CONTAIN: "Pas otomatis",
  COVER: "Penuhi",
  PATTERN: "Ulangi pola",
  NINE_SLICE: "9-slice",
};

function sizeText(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/** Pesan error 10 §9 (nama file dirender sebagai teks). */
export function uploadErrorMessage(code: string, name: string, bytes: number): string {
  switch (code) {
    case "FRAME_TOO_LARGE":
      return `${name} kebesaran (${sizeText(bytes)}). Maksimal 10 MB.`;
    case "FRAME_UNSUPPORTED":
      return "Format ini belum bisa. Pakai PNG atau WebP.";
    case "FRAME_DIMENSIONS":
      return "Ukurannya harus antara 600 dan 6000 px di sisi terpanjang.";
    case "FRAME_DECODE_FAILED":
      return "File-nya gak kebaca. Coba ekspor ulang.";
    case "FRAME_QUOTA":
      return "Room ini udah punya 20 frame custom.";
    case "RATE_LIMITED":
      return "Kebanyakan upload. Coba lagi sebentar lagi.";
    case "FRAME_NOT_FOUND":
      return "Upload-nya keputus. Coba upload ulang.";
    default:
      return "Upload gagal, coba lagi.";
  }
}

interface UploadPanelProps {
  code: string;
  studio: StudioState;
  mode: Mode;
  onBack: () => void;
  /** Pratinjau lokal frame hasil upload dengan mode adaptasi terpilih. */
  onPreview: (ref: FrameRef, template: FrameTemplate) => void;
  /** Pasang buat semua; `extra` = alternatif struktur bila lubang frame tidak cukup (mis. jumlah shot). */
  onApply: (ref: FrameRef, extra?: StudioPatch) => void;
  compact?: boolean;
}

/**
 * SCR-10 Upload frame: pilih PNG/WebP → progres → "Ngecek file…" (validasi server) → "n lubang ketemu"
 * → mode adaptasi → Pasang buat semua. Pemeriksaan klien hanya UX; keputusan ada di server (DEC-041).
 */
export function UploadPanel({ code, studio, mode, onBack, onPreview, onApply, compact }: UploadPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [adapt, setAdapt] = useState<FrameAdapt>("CONTAIN");
  const [insets, setInsets] = useState<Insets | null>(null);

  const refFor = (frameId: string, a: FrameAdapt, ins: Insets | null): FrameRef => ({
    frameId,
    source: "CUSTOM",
    adapt: a,
    overlayOpacity: 1,
    ...(a === "NINE_SLICE" && ins ? { nineSlice: ins } : {}),
  });

  const pick = async (file: File) => {
    const name = file.name;
    if (!(FRAME_LIMITS.CONTENT_TYPES as readonly string[]).includes(file.type)) return setPhase({ kind: "error", message: uploadErrorMessage("FRAME_UNSUPPORTED", name, file.size) });
    if (file.size > FRAME_LIMITS.MAX_BYTES) return setPhase({ kind: "error", message: uploadErrorMessage("FRAME_TOO_LARGE", name, file.size) });
    try {
      setPhase({ kind: "uploading", name, progress: 0 });
      const prep = await api.framePrepare(code, { fileName: name, contentType: file.type, bytes: file.size });
      await uploadToUrl(prep.uploadUrl, prep.uploadHeaders, file, (progress) => setPhase({ kind: "uploading", name, progress }));
      setPhase({ kind: "checking", name });
      const done = await api.frameComplete(code, prep.frameId);
      const t = done.frame.template;
      const a: FrameAdapt = done.holes > 0 ? "FIXED" : "CONTAIN";
      const ins = { top: Math.round(t.baseSize.h * 0.15), bottom: Math.round(t.baseSize.h * 0.15), left: Math.round(t.baseSize.w * 0.15), right: Math.round(t.baseSize.w * 0.15) };
      setAdapt(a);
      setInsets(ins);
      setPhase({ kind: "ready", frameId: done.frame.frameId, template: t, holes: done.holes });
      onPreview(refFor(done.frame.frameId, a, ins), t);
    } catch (err) {
      setPhase({ kind: "error", message: uploadErrorMessage(err instanceof ApiError ? err.code : "SERVICE_UNAVAILABLE", name, file.size) });
    }
  };

  const choose = (a: FrameAdapt) => {
    if (phase.kind !== "ready") return;
    setAdapt(a);
    onPreview(refFor(phase.frameId, a, insets), phase.template);
  };
  const setInset = (k: keyof Insets, v: number) => {
    if (phase.kind !== "ready" || !insets) return;
    const next = { ...insets, [k]: Math.round(v) };
    setInsets(next);
    onPreview(refFor(phase.frameId, "NINE_SLICE", next), phase.template);
  };

  const ready = phase.kind === "ready" ? phase : null;
  const options: FrameAdapt[] = ready && ready.holes > 0 ? ["FIXED", "CONTAIN", "COVER", "PATTERN", "NINE_SLICE"] : ["CONTAIN", "COVER", "PATTERN", "NINE_SLICE"];
  const t = ready ? computeFrameTransform(ready.template.baseSize, { w: studio.layout.canvas.widthPx, h: studio.layout.canvas.heightPx }, adapt, insets ?? undefined) : null;
  const blurry = t ? frameUpscaleWarning(t, exportScaleFor(studio.layout.canvas)) : false;
  // FIXED mengikuti lubang: unit foto > lubang → alasan + alternatif, tidak dipotong diam-diam (DEC-042).
  const holePlan =
    ready && adapt === "FIXED" && ready.template.slots?.length
      ? planFromHoles({
          mode,
          strategy: studio.bindingStrategy,
          shotCount: studio.layout.shotCount,
          participantSlots: studio.participantSlots,
          slotRatio: studio.layout.slotRatio,
          gap: studio.style.gap,
          cornerRadius: studio.style.cornerRadius,
          holes: ready.template.slots,
          art: ready.template.baseSize,
        })
      : null;
  const holeViolation = holePlan && !holePlan.ok ? holePlan.violation : null;

  return (
    <div className={cx(styles.panel, compact && styles.compact)}>
      <header className={styles.head}>
        <Button variant="ghost" size="sm" iconOnly aria-label="Kembali ke daftar frame" onClick={onBack}>
          <ArrowLeft size={17} {...iconProps} />
        </Button>
        <h2 className={styles.title}>Upload frame</h2>
        <Tag kind="bareng" />
      </header>
      <input
        ref={input}
        type="file"
        accept="image/png,image/webp"
        className={styles.file}
        aria-label="Pilih file frame (PNG atau WebP)"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      {(phase.kind === "idle" || phase.kind === "error") && (
        <button type="button" className={styles.drop} onClick={() => input.current?.click()}>
          <ImageUp size={26} {...iconProps} />
          <strong>Pilih PNG atau WebP</strong>
          <span>Maks. 10 MB · 600–6000 px · bagian transparan jadi lubang foto</span>
        </button>
      )}
      {phase.kind === "error" && <Banner tone="error">{phase.message}</Banner>}
      {phase.kind === "uploading" && (
        <div className={styles.progress} role="status">
          <p>
            Ngunggah <span className={styles.fileName}>{phase.name}</span>… <span className="tnum">{Math.round(phase.progress * 100)}%</span>
          </p>
          <span className={styles.bar}>
            <span style={{ width: `${Math.round(phase.progress * 100)}%` }} />
          </span>
        </div>
      )}
      {phase.kind === "checking" && (
        <p className={styles.progress} role="status">
          Ngecek file… <span className={styles.fileName}>{phase.name}</span>
        </p>
      )}
      {ready && (
        <>
          <p className={styles.holes} role="status">
            {ready.holes > 0 ? `${ready.holes} lubang ketemu` : "Gak ada lubang transparan — frame dipasang di atas foto."} · <span className={styles.fileName}>{ready.template.fileName}</span>
          </p>
          <div className={styles.segment} role="radiogroup" aria-label="Mode adaptasi frame">
            {options.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={adapt === a} className={cx(styles.segItem, adapt === a && styles.segOn)} onClick={() => choose(a)}>
                {ADAPT_LABEL[a]}
              </button>
            ))}
          </div>
          {adapt === "NINE_SLICE" && insets && (
            <div className={styles.stack}>
              <p className={styles.note}>Atur slot 9-slice: sudut tetap, tepi diulang (tidak ditarik).</p>
              {(["top", "bottom", "left", "right"] as const).map((k) => (
                <Slider
                  key={k}
                  label={{ top: "Atas", bottom: "Bawah", left: "Kiri", right: "Kanan" }[k]}
                  value={insets[k]}
                  min={0}
                  max={Math.floor((k === "top" || k === "bottom" ? ready.template.baseSize.h : ready.template.baseSize.w) * 0.45)}
                  step={1}
                  onChange={(v) => setInset(k, v)}
                  format={(v) => `${Math.round(v)} px`}
                />
              ))}
            </div>
          )}
          {t?.cropWarning && <Banner tone="warn">Sebagian frame kepotong ({Math.round(t.cropFraction * 100)}%). Coba &quot;Pas otomatis&quot;.</Banner>}
          {holeViolation && (
            <Banner
              tone="warn"
              action={
                <span className={styles.alts}>
                  {holeViolation.alternatives.map((a) => (
                    <Button key={a.label} size="sm" variant="secondary" disabled={studio.structureLocked} onClick={() => onApply(refFor(ready.frameId, adapt, insets), a.patch)}>
                      {a.label}
                    </Button>
                  ))}
                </span>
              }
            >
              {holeViolation.message}
            </Banner>
          )}
          {blurry && <Banner tone="warn">Frame ini bakal sedikit buram di ukuran {OUTPUT_PRESET_LABEL[studio.layout.canvas.preset]}.</Banner>}
          <footer className={styles.foot}>
            <Button variant="secondary" size="lg" onClick={() => input.current?.click()}>
              Ganti file
            </Button>
            <Button variant="primary" size="lg" fullWidth disabled={!!holeViolation} onClick={() => onApply(refFor(ready.frameId, adapt, insets))}>
              Pasang buat semua
            </Button>
          </footer>
        </>
      )}
    </div>
  );
}
