"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeExportSize, exportFileName, needsTiling, qualityWarnings } from "@longroll/shared";
import type { CustomFrameView, ExportFormat, ExportPresetId, ExportQualityWarning, ParticipantView, SessionResult } from "@longroll/shared";

/** Bagian hasil sesi yang dibutuhkan export (tersedia dari SessionResult maupun entri galeri). */
export type ExportSource = Pick<SessionResult, "index" | "version" | "dateMs" | "finalizedAtMs"> & { participants: { name: string; color: string }[] };
import type { RoomClient } from "@/room/client";
import { deliver, DELIVERY_TOAST } from "./download";
import { browserDriveEnv, DRIVE_MESSAGES, DriveClient, DriveError } from "./drive";
import type { DriveErrorCode, DriveFile } from "./drive";
import { EXPORT_MESSAGES, ExportError, renderExport } from "./render";
import { loadSessionDoc, prepareExport } from "./session";
import type { PreparedExport } from "./session";

export type ExportPhase = "idle" | "rendering" | "ready" | "drive_auth" | "drive_uploading" | "drive_done" | "drive_error";

export interface ExportState {
  phase: ExportPhase;
  progress: number;
  message: string | null;
  driveError: DriveErrorCode | null;
  driveFile: DriveFile | null;
  /** Dokumen belum selesai dimuat / gagal dimuat. */
  doc: "loading" | "ready" | "error";
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null;

/** Satu klien Drive per tab (token hanya di memori tab; hilang saat tab ditutup). */
let sharedDrive: DriveClient | null = null;
export function driveClient(): DriveClient {
  sharedDrive ??= new DriveClient(browserDriveEnv(GOOGLE_CLIENT_ID));
  return sharedDrive;
}

interface Args {
  client: RoomClient;
  sessionId: string;
  result: ExportSource;
  participants: ParticipantView[];
  customFrames: CustomFrameView[];
  /** Berubah → muat ulang dokumen (Balik edit lalu Selesai lagi). */
  reloadKey: number;
  /** Tampilkan toast kecil (mis. "Tersimpan di Unduhan"). */
  notify: (message: string) => void;
}

export function useExport({ client, sessionId, result, participants, customFrames, reloadKey, notify }: Args) {
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);
  const [docState, setDocState] = useState<ExportState["doc"]>("loading");
  const [format, setFormat] = useState<ExportFormat>("png");
  const [preset, setPreset] = useState<ExportPresetId>("ASLI");
  const [state, setState] = useState<Omit<ExportState, "doc">>({ phase: "idle", progress: 0, message: null, driveError: null, driveFile: null });
  const cache = useRef(new Map<string, { blob: Blob; name: string }>());
  const abort = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Muat skrip GIS di muka (bila Drive dikonfigurasi) agar popup consent tetap berada di dalam gesture klik.
  useEffect(() => {
    if (GOOGLE_CLIENT_ID) driveClient().preload();
  }, []);

  // Muat dokumen sesi (read-only) sekali per versi hasil.
  useEffect(() => {
    let alive = true;
    cache.current.clear();
    (async () => {
      try {
        const doc = await loadSessionDoc(client, sessionId);
        const p = await prepareExport(client, doc, {
          custom: customFrames,
          dateMs: result.dateMs ?? result.finalizedAtMs,
          nameOfColor: (c) => participants.find((x) => x.color === c && x.connection !== "LEFT")?.displayName ?? result.participants.find((x) => x.color === c)?.name ?? "",
        });
        if (!alive) return;
        setPrepared(p);
        setDocState(p ? "ready" : "error");
      } catch {
        if (alive) setDocState("error");
      }
    })();
    return () => {
      alive = false;
      abort.current?.abort();
    };
    // Dokumen hanya dimuat ulang saat sesi/versi hasil berubah (bukan tiap perubahan presence).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionId, result.version, reloadKey, attempt]);

  const base = useMemo(() => (prepared ? { w: prepared.baseW, h: prepared.baseH } : null), [prepared]);
  const size = useMemo(() => (base ? computeExportSize(base, preset) : null), [base, preset]);
  const tiled = size ? needsTiling(size.width, size.height) : false;
  const effectiveFormat: ExportFormat = tiled ? "png" : format;
  const warnings: ExportQualityWarning[] = useMemo(() => {
    if (!prepared || !size) return [];
    return qualityWarnings(prepared.request.model.elements as never, size.scale);
  }, [prepared, size]);
  const elementCount = useMemo(() => prepared?.request.model.elements.length ?? 0, [prepared]);
  const fileName = exportFileName(client.code, result.index, effectiveFormat, new Date());

  const patch = useCallback((p: Partial<Omit<ExportState, "doc">>) => setState((s) => ({ ...s, ...p })), []);

  const render = useCallback(async () => {
    if (!prepared || !size) throw new ExportError("ENCODE", EXPORT_MESSAGES.ENCODE);
    const key = `${effectiveFormat}:${preset}`;
    const hit = cache.current.get(key);
    if (hit) return hit;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    patch({ phase: "rendering", progress: 0, message: null });
    const out = await renderExport({ ...prepared.request, size, format: effectiveFormat, signal: ac.signal, onProgress: (f) => patch({ progress: f }) });
    const entry = { blob: out.blob, name: exportFileName(client.code, result.index, effectiveFormat, new Date()) };
    cache.current.set(key, entry);
    return entry;
  }, [prepared, size, effectiveFormat, preset, client.code, result.index, patch]);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ExportError && err.code === "ABORTED") return patch({ phase: "idle", message: null });
      const message = err instanceof ExportError ? EXPORT_MESSAGES[err.code] : EXPORT_MESSAGES.ENCODE;
      patch({ phase: "idle", message });
    },
    [patch],
  );

  const download = useCallback(async () => {
    try {
      const f = await render();
      patch({ phase: "ready", progress: 1, message: null });
      const d = await deliver(f.blob, f.name);
      if (!d.cancelled) notify(DELIVERY_TOAST[d.method]);
    } catch (err) {
      fail(err);
    }
  }, [render, patch, notify, fail]);

  const upload = useCallback(
    async (drive: DriveClient) => {
      try {
        const f = await render();
        patch({ phase: "drive_uploading", progress: 0, message: null, driveError: null });
        const file = await drive.upload(f.blob, f.name, { onProgress: (p) => patch({ progress: p }) });
        patch({ phase: "drive_done", progress: 1, driveFile: file, message: null });
        notify(`Tersimpan di Drive: ${file.name || f.name}`);
      } catch (err) {
        if (err instanceof DriveError) patch({ phase: "drive_error", driveError: err.code, message: DRIVE_MESSAGES[err.code] });
        else fail(err);
      }
    },
    [render, patch, notify, fail],
  );

  /** Harus dipanggil langsung dari klik (popup Google butuh gesture). */
  const saveToDrive = useCallback(async () => {
    const drive = driveClient();
    patch({ phase: "drive_auth", message: null, driveError: null, driveFile: null });
    try {
      if (!drive.connected) await drive.connect();
    } catch (err) {
      const code = err instanceof DriveError ? err.code : "FAILED";
      // Menolak consent bukan galat keras: kembali tenang (12 §6).
      patch({ phase: code === "CONSENT_DENIED" ? "idle" : "drive_error", driveError: code, message: DRIVE_MESSAGES[code] });
      return;
    }
    await upload(drive);
  }, [patch, upload]);

  /** Tombol "Lanjut" setelah token kedaluwarsa (gesture baru → minta token lagi, lalu lanjut). */
  const continueDrive = saveToDrive;

  const disconnectDrive = useCallback(async () => {
    await driveClient().revoke();
    patch({ phase: "idle", driveError: null, driveFile: null, message: "Google Drive diputuskan." });
  }, [patch]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    patch({ phase: "idle", progress: 0 });
  }, [patch]);

  return {
    ...state,
    doc: docState,
    prepared,
    reload: () => setAttempt((n) => n + 1),
    format,
    setFormat,
    preset,
    setPreset: (p: ExportPresetId) => (setPreset(p), patch({ phase: "idle", message: null })),
    size,
    tiled,
    effectiveFormat,
    warnings,
    elementCount,
    fileName,
    driveConfigured: !!GOOGLE_CLIENT_ID,
    driveConnected: driveClient().connected,
    download,
    saveToDrive,
    continueDrive,
    disconnectDrive,
    cancel,
    busy: state.phase === "rendering" || state.phase === "drive_auth" || state.phase === "drive_uploading",
  };
}
