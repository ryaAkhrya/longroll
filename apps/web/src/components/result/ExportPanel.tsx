"use client";

import { Download, ExternalLink, HardDriveUpload } from "lucide-react";
import { EXPORT_PRESETS } from "@longroll/shared";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ChipButton } from "@/components/ui/Chip";
import { iconProps } from "@/components/ui/icon-props";
import type { useExport } from "@/export/useExport";
import styles from "./ExportPanel.module.css";

type Controller = ReturnType<typeof useExport>;

const PHASE_LABEL: Partial<Record<Controller["phase"], string>> = {
  rendering: "Nyetak",
  drive_auth: "Nyambung ke Google…",
  drive_uploading: "Nyimpen ke Drive…",
};

/** Opsi + aksi export SCR-17 (format, ukuran, peringatan kualitas, Unduh, Simpan ke Google Drive). */
export function ExportPanel({ exp }: { exp: Controller }) {
  const presetLabel = EXPORT_PRESETS.find((p) => p.id === exp.preset)?.label ?? "";
  const pct = Math.round(exp.progress * 100);
  const loaded = exp.doc === "ready" && !!exp.size;
  const driveBlocked = !exp.driveConfigured;

  return (
    <section className={styles.panel} aria-label="Ekspor hasil" data-testid="export-panel" data-phase={exp.phase}>
      <fieldset className={styles.group} disabled={exp.busy}>
        <legend>Format</legend>
        <div className={styles.row}>
          <ChipButton selected={exp.effectiveFormat === "png"} onClick={() => exp.setFormat("png")}>
            PNG
          </ChipButton>
          <ChipButton selected={exp.effectiveFormat === "jpeg"} disabled={exp.tiled} onClick={() => exp.setFormat("jpeg")}>
            JPG
          </ChipButton>
        </div>
        {exp.tiled && <p className={styles.hint}>Ukuran sebesar ini cuma bisa PNG.</p>}
      </fieldset>

      <fieldset className={styles.group} disabled={exp.busy}>
        <legend>Ukuran</legend>
        <div className={styles.presets} role="radiogroup" aria-label="Ukuran hasil">
          {EXPORT_PRESETS.map((p) => {
            const on = exp.preset === p.id;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} className={on ? styles.presetOn : styles.preset} onClick={() => exp.setPreset(p.id)}>
                <strong>{p.label}</strong>
                <span>{p.hint}</span>
              </button>
            );
          })}
        </div>
        {exp.size && (
          <p className={styles.hint} data-testid="export-size">
            {exp.size.width} × {exp.size.height} px{exp.size.dpi ? ` · ${exp.size.dpi} dpi` : ""}
          </p>
        )}
        {exp.size?.reduced && <p className={styles.hint}>Ukurannya diturunkan biar muat di batas aman perangkat.</p>}
      </fieldset>

      {exp.warnings.length > 0 && (
        <Banner tone="warn" title="Kualitas foto bisa kurang tajam.">
          {exp.warnings[0]!.message}
          {exp.warnings.length > 1 ? ` (+${exp.warnings.length - 1} foto lain). Coba ukuran yang lebih besar.` : " Coba ukuran yang lebih besar."}
        </Banner>
      )}

      {exp.doc === "error" && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" onClick={exp.reload}>
              Coba lagi
            </Button>
          }
        >
          Hasilnya belum bisa dimuat.
        </Banner>
      )}
      {exp.message && exp.phase !== "drive_error" && <Banner tone={exp.message.startsWith("Google Drive") ? "info" : "error"}>{exp.message}</Banner>}

      {(exp.phase === "rendering" || exp.phase === "drive_uploading") && (
        <div className={styles.progress}>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${PHASE_LABEL[exp.phase]} ${presetLabel}`} className={styles.bar}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p aria-live="polite">
            {PHASE_LABEL[exp.phase]}
            {exp.phase === "rendering" ? ` versi ${presetLabel}…` : ""} {pct}%
          </p>
        </div>
      )}
      {exp.phase === "drive_auth" && (
        <p className={styles.hint} aria-live="polite">
          {PHASE_LABEL.drive_auth}
        </p>
      )}

      {exp.phase === "drive_done" && exp.driveFile && (
        <Banner
          tone="info"
          title="Tersimpan di Drive:"
          action={
            exp.driveFile.webViewLink ? (
              <a className={styles.link} href={exp.driveFile.webViewLink} target="_blank" rel="noopener noreferrer">
                Buka <ExternalLink size={13} {...iconProps} />
              </a>
            ) : undefined
          }
        >
          {exp.driveFile.name}
        </Banner>
      )}

      {exp.phase === "drive_error" && exp.driveError && (
        <Banner
          tone="error"
          action={
            exp.driveError === "TOKEN_EXPIRED" ? (
              <Button variant="primary" size="sm" onClick={() => void exp.continueDrive()}>
                Lanjut
              </Button>
            ) : exp.driveError === "QUOTA" ? (
              <Button variant="primary" size="sm" onClick={() => void exp.download()}>
                Unduh
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void exp.saveToDrive()}>
                Coba lagi
              </Button>
            )
          }
        >
          {exp.message}
        </Banner>
      )}

      <div className={styles.actions}>
        <Button
          variant="primary"
          size="xl"
          fullWidth
          icon={<Download size={18} {...iconProps} />}
          loading={exp.phase === "rendering"}
          disabled={!loaded || exp.busy}
          onClick={() => void exp.download()}
          data-testid="export-download"
        >
          Unduh
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          icon={<HardDriveUpload size={17} {...iconProps} />}
          disabled={!loaded || exp.busy || driveBlocked}
          loading={exp.phase === "drive_uploading" || exp.phase === "drive_auth"}
          onClick={() => void exp.saveToDrive()}
          data-testid="export-drive"
          aria-describedby={driveBlocked ? "drive-na" : undefined}
        >
          Simpan ke Google Drive
        </Button>
        {driveBlocked && (
          <p id="drive-na" className={styles.hint}>
            Simpan ke Drive belum aktif di versi ini. Unduh aja dulu.
          </p>
        )}
        {exp.driveConnected && (
          <Button variant="ghost" size="sm" onClick={() => void exp.disconnectDrive()}>
            Putuskan Google Drive
          </Button>
        )}
      </div>
      <p className={styles.file}>{exp.fileName}</p>
    </section>
  );
}
