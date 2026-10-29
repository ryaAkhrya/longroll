"use client";

import { useEffect, useState } from "react";
import { rtcForceRelay, setRtcForceRelay } from "@/media/debugFlag";
import type { DiagReport } from "@/media/diagnose";
import { useMedia } from "@/media/MediaProvider";
import styles from "./RtcDiagnosticsPanel.module.css";

/**
 * Panel diagnostik koneksi video (hanya muncul dengan ?rtcdebug=1). Isi laporan sudah tersanitasi: jumlah/jenis kandidat,
 * state, penghitung sinyal, hasil getStats ringkas. TIDAK memuat SDP, alamat IP, kredensial, token, atau nama pengguna.
 */
export function RtcDiagnosticsPanel() {
  const media = useMedia();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<DiagReport | null>(null);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const relay = rtcForceRelay();

  useEffect(() => {
    if (!open) return;
    const refresh = () => setReport(media.diagReport());
    refresh();
    const t = setInterval(refresh, 1_500);
    return () => clearInterval(t);
  }, [open, media]);

  const text = report ? JSON.stringify(report, null, 2) : "Belum ada data (transport belum siap).";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  };

  return (
    <div className={styles.root}>
      {!open ? (
        <button type="button" className={styles.fab} onClick={() => setOpen(true)} aria-haspopup="dialog">
          Diagnostik
        </button>
      ) : (
        <section className={styles.panel} role="dialog" aria-label="Diagnostik koneksi video">
          <header className={styles.head}>
            <strong>Diagnostik koneksi video</strong>
            <button type="button" className={styles.x} onClick={() => setOpen(false)} aria-label="Tutup diagnostik">
              ×
            </button>
          </header>
          <ul className={styles.verdicts}>
            {report?.peers.length ? (
              report.peers.map((p) => (
                <li key={p.peer} data-code={p.verdict.code}>
                  <b>{p.peer}</b> · ice={p.iceConnectionState} · {p.verdict.text}
                </li>
              ))
            ) : (
              <li>Belum ada peer lain.</li>
            )}
          </ul>
          <div className={styles.actions}>
            <button type="button" onClick={() => void copy()}>
              {copied === "ok" ? "Tersalin ✓" : copied === "fail" ? "Gagal menyalin" : "Salin laporan"}
            </button>
            <label className={styles.relay}>
              <input
                type="checkbox"
                checked={relay}
                onChange={(e) => {
                  setRtcForceRelay(e.target.checked);
                  window.location.reload();
                }}
              />{" "}
              Paksa relay (uji TURN)
            </label>
          </div>
          <pre className={styles.pre} tabIndex={0} aria-label="Laporan diagnostik">
            {text}
          </pre>
        </section>
      )}
    </div>
  );
}
