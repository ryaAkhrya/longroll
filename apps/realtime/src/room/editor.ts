import * as Y from "yjs";
import {
  EDITOR_LIMITS,
  checkUpdate,
  createEditorDoc,
  createSeededDoc,
  fromBase64,
  snapshotDoc,
  toBase64,
  trimHistory,
} from "@longroll/shared";
import type { RoomState } from "./types";
import { builtinFrame } from "@longroll/shared";
import { errText, log, metrics } from "../log";
import type { RoomStore } from "../store/types";
import { RoomError } from "./types";

/**
 * Dokumen editor kolaboratif per sesi di server (11 §8, DEC-031). Server = relay + validator + penyimpan:
 * menerapkan update yang LOLOS validasi skema, me-relay ke peserta lain, dan menyimpan snapshot ke
 * PostgreSQL paling sering tiap 5 detik bila ada perubahan (tidak per update). Awareness tidak pernah
 * disimpan. Klien tidak dipercaya: tidak ada otoritas yang berpindah ke klien.
 */

export const EDITOR_SNAPSHOT_MS = 5_000;

export interface EditorDeps {
  roomId: string;
  store: RoomStore;
  /** State room terkini (tanpa menyalin) — untuk attempt accepted & studio saat seed. */
  state: () => RoomState;
  /** Kirim ke semua koneksi (opsional kecuali satu peserta). */
  broadcast: (type: string, payload: unknown, exceptParticipantId?: string) => void;
  sendTo: (participantId: string, type: string, payload: unknown) => void;
  now?: () => number;
}

interface Entry {
  doc: Y.Doc;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastWriteMs: number;
  writing: Promise<void> | null;
}

export class EditorHub {
  private readonly docs = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<Entry>>();
  private disposed = false;

  constructor(private readonly deps: EditorDeps) {}

  private now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** attemptId accepted (shot DONE) → pemilik, untuk validasi `photo`. */
  acceptedAttempts(sessionId: string): Map<string, string> {
    const out = new Map<string, string>();
    const c = this.deps.state().sessions[sessionId]?.capture;
    if (!c) return out;
    for (const shot of c.shots) {
      if (shot.state !== "DONE") continue;
      for (const [pid, ps] of Object.entries(shot.perParticipant)) if (ps.acceptedAttemptId) out.set(ps.acceptedAttemptId, pid);
    }
    return out;
  }

  private seed(sessionId: string): Y.Doc {
    const s = this.deps.state().sessions[sessionId];
    if (!s || !s.studio || !s.capture) throw new RoomError("NOT_IN_STUDIO");
    const names: Record<string, string> = {};
    for (const a of Object.values(s.capture.attempts)) names[a.ownerId] = a.ownerNameAtCapture;
    return createSeededDoc({
      studio: s.studio,
      capture: s.capture,
      names,
      srcDims: (id) => {
        const a = s.capture!.attempts[id];
        const part = a?.full ?? a?.preview;
        return part ? { w: part.width, h: part.height } : null;
      },
      frameTemplate: s.studio.frame?.source === "BUILTIN" ? (builtinFrame(s.studio.frame.frameId) ?? null) : null,
    });
  }

  /** Muat dari snapshot tersimpan; bila belum ada → seed dari foto accepted + BindingPlan lalu simpan segera. */
  ensure(sessionId: string): Promise<Entry> {
    const have = this.docs.get(sessionId);
    if (have) return Promise.resolve(have);
    const pending = this.loading.get(sessionId);
    if (pending) return pending;
    const p = (async () => {
      const state = this.deps.state().sessions[sessionId];
      // Sesi CLOSED yang punya hasil tetap bisa dibaca (galeri → export ulang), tanpa pernah di-seed ulang.
      const archived = state?.state === "CLOSED" && !!state.result;
      if (!state || (state.state !== "EDITING" && state.state !== "FINAL" && !archived)) throw new RoomError("NOT_IN_STUDIO");
      const saved = await this.deps.store.loadEditorDoc(sessionId);
      if (archived && !saved) throw new RoomError("NOT_IN_STUDIO");
      let doc: Y.Doc;
      let dirty = false;
      if (saved) {
        doc = createEditorDoc();
        Y.applyUpdate(doc, saved);
      } else {
        doc = this.seed(sessionId);
        dirty = true;
      }
      const entry: Entry = { doc, dirty, timer: null, lastWriteMs: 0, writing: null };
      this.docs.set(sessionId, entry);
      if (dirty) await this.persist(sessionId, entry);
      return entry;
    })().finally(() => this.loading.delete(sessionId));
    this.loading.set(sessionId, p);
    return p;
  }

  private readOnly(sessionId: string): boolean {
    return this.deps.state().sessions[sessionId]?.state !== "EDITING";
  }

  /** `editor.sync` langkah 1: klien kirim state vector → balas diff + state vector server (klien lalu kirim diff-nya). */
  async sync(participantId: string, sessionId: string, svB64: unknown): Promise<{ update: string; stateVector: string; readOnly: boolean }> {
    void participantId;
    const entry = await this.ensure(sessionId);
    let sv: Uint8Array;
    try {
      sv = typeof svB64 === "string" && svB64.length < 100_000 ? fromBase64(svB64) : new Uint8Array();
    } catch {
      sv = new Uint8Array();
    }
    let update: Uint8Array;
    try {
      update = Y.encodeStateAsUpdate(entry.doc, sv);
    } catch {
      update = Y.encodeStateAsUpdate(entry.doc);
    }
    return { update: toBase64(update), stateVector: toBase64(Y.encodeStateVector(entry.doc)), readOnly: this.readOnly(sessionId) };
  }

  /**
   * `editor.update`: validasi → terapkan → relay. Gagal → RoomError; pengirim menerima `editor.reset` (state
   * server penuh) supaya klien membangun ulang dokumennya dari state yang sah (CRDT tak bisa "membatalkan").
   */
  async update(participantId: string, sessionId: string, updateB64: unknown): Promise<void> {
    if (typeof updateB64 !== "string" || updateB64.length > Math.ceil((EDITOR_LIMITS.maxUpdateBytes * 4) / 3) + 8) throw new RoomError("DOC_TOO_LARGE");
    if (this.readOnly(sessionId)) throw new RoomError("READ_ONLY");
    const entry = await this.ensure(sessionId);
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(updateB64);
    } catch {
      throw new RoomError("INVALID_PATCH", "MALFORMED");
    }
    const res = checkUpdate(entry.doc, bytes, { acceptedAttempts: this.acceptedAttempts(sessionId) });
    if (!res.ok) {
      metrics.inc("editor_update_rejected_total");
      log.info("editor.update_rejected", { roomId: this.deps.roomId, code: res.issue.code });
      this.deps.sendTo(participantId, "editor.reset", { sessionId, update: toBase64(Y.encodeStateAsUpdate(entry.doc)) });
      throw new RoomError(res.issue.code === "TOO_LARGE" ? "DOC_TOO_LARGE" : "INVALID_PATCH", res.issue.code);
    }
    Y.applyUpdate(entry.doc, bytes, "remote");
    this.deps.broadcast("editor.update", { sessionId, update: updateB64, by: participantId }, participantId);
    // Riwayat FIFO: pangkas bila penulisan bersamaan melampaui 200 (update pangkas ikut disiarkan ke semua).
    const before = Y.encodeStateVector(entry.doc);
    if (trimHistory(entry.doc, "server")) {
      const trim = Y.encodeStateAsUpdate(entry.doc, before);
      this.deps.broadcast("editor.update", { sessionId, update: toBase64(trim), by: "server" });
    }
    this.markDirty(sessionId, entry);
    metrics.inc("editor_update_total");
  }

  /** Awareness volatile: identitas dari server (bukan klaim klien), ukuran dibatasi, tak disimpan. */
  awareness(participantId: string, sessionId: string, state: unknown): void {
    if (this.readOnly(sessionId) && this.deps.state().sessions[sessionId]?.state !== "FINAL") return;
    const json = JSON.stringify(state ?? null);
    if (json.length > EDITOR_LIMITS.maxAwarenessBytes) return;
    this.deps.broadcast("editor.awareness", { sessionId, participantId, state }, participantId);
  }

  private markDirty(sessionId: string, e: Entry) {
    e.dirty = true;
    if (e.timer || this.disposed) return;
    const wait = Math.max(0, EDITOR_SNAPSHOT_MS - (this.now() - e.lastWriteMs));
    e.timer = setTimeout(() => {
      e.timer = null;
      void this.persist(sessionId, e).catch((err) => {
        metrics.inc("editor_snapshot_failures_total");
        log.warn("editor.snapshot_failed", { roomId: this.deps.roomId, message: errText(err) });
        // Store sedang bermasalah: jangan biarkan perubahan menggantung sampai ada update berikutnya — coba lagi.
        e.dirty = true;
        this.markDirty(sessionId, e);
      });
    }, wait);
    e.timer.unref?.();
  }

  private async persist(sessionId: string, e: Entry): Promise<void> {
    if (e.writing) await e.writing;
    if (!e.dirty) return;
    e.dirty = false;
    e.lastWriteMs = this.now();
    const bytes = snapshotDoc(e.doc);
    e.writing = this.deps.store.saveEditorDoc(this.deps.roomId, sessionId, bytes).catch((err) => {
      e.dirty = true; // tulis ulang pada giliran berikutnya
      throw err;
    });
    try {
      await e.writing;
    } finally {
      e.writing = null;
    }
  }

  /** Tulis semua snapshot yang kotor sekarang (FINAL, shutdown, tes). */
  async flush(): Promise<void> {
    let firstError: unknown = null;
    for (const [sid, e] of this.docs) {
      if (e.timer) {
        clearTimeout(e.timer);
        e.timer = null;
      }
      // Satu dokumen gagal tidak boleh menahan dokumen lain (shutdown: tulis sebanyak mungkin).
      if (e.dirty) await this.persist(sid, e).catch((err) => (firstError ??= err));
    }
    if (firstError) throw firstError;
  }

  /** Snapshot penuh untuk P08 (render ulang / DEC-060). Null bila dokumen belum ada. */
  async snapshot(sessionId: string): Promise<Uint8Array | null> {
    const e = this.docs.get(sessionId) ?? (await this.ensure(sessionId).catch(() => null));
    return e ? snapshotDoc(e.doc) : null;
  }

  has(sessionId: string) {
    return this.docs.has(sessionId);
  }

  /** Jumlah dokumen yang punya perubahan belum tersimpan (metrik/alarm). */
  get dirtyCount() {
    let n = 0;
    for (const e of this.docs.values()) if (e.dirty) n++;
    return n;
  }

  /** Dokumen di memori (batas memori: dilepas saat room selesai). */
  get size() {
    return this.docs.size;
  }

  /** Salinan dokumen untuk tes/inspeksi (jangan dimutasi). */
  docOf(sessionId: string): Y.Doc | null {
    return this.docs.get(sessionId)?.doc ?? null;
  }

  dispose() {
    this.disposed = true;
    for (const e of this.docs.values()) if (e.timer) clearTimeout(e.timer);
  }
}
