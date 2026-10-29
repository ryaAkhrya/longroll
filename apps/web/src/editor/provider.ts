import * as Y from "yjs";
import { EDITOR_LIMITS, createEditorDoc, createUndo, elementsMap, fromBase64, readElement, toBase64 } from "@longroll/shared";
import type { EditorCtx } from "@longroll/shared";
import type { RoomClient } from "@/room/client";
import { ConflictTracker } from "./conflict";
import type { ChangeSet, ConflictToast } from "./conflict";

export type SyncStatus = "loading" | "ready" | "offline" | "readonly" | "error";

/** Awareness (11 §6): efemeral, tidak pernah masuk dokumen/DB. Identitas pengirim ditetapkan server. */
export interface AwarenessState {
  cursor?: { x: number; y: number };
  cursorLabel?: string;
  selection?: string[];
  dragging?: boolean;
  transient?: { id: string; x: number; y: number; rotation: number; scaleX: number; scaleY: number };
  doodleDraft?: { color: string; width: number; points: [number, number][] };
  tool?: string;
}

const AWARENESS_MIN_MS = 50; // ≤ 20 Hz
const AWARENESS_STALE_MS = 8_000;
const AWARENESS_KEEPALIVE_MS = 3_000;

/**
 * Bridge Yjs ↔ WebSocket room (11 §8): `editor.sync` (state vector dua langkah), `editor.update` (reliable lewat
 * intent+ack), `editor.awareness` (volatile). Operasi lokal tetap berjalan saat offline; saat tersambung kembali
 * sinkron dua arah menggabungkan semuanya (CRDT). Update ditolak server → dokumen dibangun ulang dari state server.
 */
export class EditorSession {
  doc: Y.Doc;
  undo: Y.UndoManager;
  readonly ctx: EditorCtx;
  status: SyncStatus = "loading";
  version = 0;
  readonly peers = new Map<string, { state: AwarenessState; at: number }>();
  readonly conflicts = new ConflictTracker();
  private onConflict: ((t: ConflictToast[]) => void) | null = null;
  private onReset: (() => void) | null = null;

  /** Pasang penangan: konflik (remote menimpa/menghapus yang baru kamu ubah) & reset (update ditolak server). */
  setHandlers(h: { onConflict?: ((t: ConflictToast[]) => void) | null; onReset?: (() => void) | null }) {
    this.onConflict = h.onConflict ?? null;
    this.onReset = h.onReset ?? null;
  }

  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  private syncedOnce = false;
  private syncing = false;
  private needsPush = false;
  private wasOpen = false;
  private bumpScheduled = false;
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessPending: AwarenessState | null = null;
  private awarenessLast = 0;
  private local: AwarenessState = {};
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private unbind: (() => void) | null = null;
  private destroyed = false;
  private undoOff: (() => void) | null = null;

  constructor(
    private readonly client: RoomClient,
    readonly sessionId: string,
    me: { id: string; name: string },
  ) {
    this.doc = createEditorDoc();
    this.ctx = { participantId: me.id, name: me.name, origin: { editor: me.id } };
    this.undo = createUndo(this.doc, this.ctx.origin);
    this.bind();
  }

  private watchUndo() {
    this.undoOff?.();
    const um = this.undo;
    const bump = () => this.bump();
    um.on("stack-item-added", bump);
    um.on("stack-item-popped", bump);
    um.on("stack-cleared", bump);
    this.undoOff = () => {
      um.off("stack-item-added", bump);
      um.off("stack-item-popped", bump);
      um.off("stack-cleared", bump);
    };
  }

  // ---------------------------------------------------------------- store untuk React
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  private bump() {
    if (this.bumpScheduled || this.destroyed) return;
    this.bumpScheduled = true;
    queueMicrotask(() => {
      this.bumpScheduled = false;
      this.version++;
      for (const fn of this.listeners) fn();
    });
  }

  private setStatus(s: SyncStatus) {
    if (this.status === s) return;
    this.status = s;
    this.bump();
  }

  // ---------------------------------------------------------------- doc ↔ jaringan
  private bind() {
    const doc = this.doc;
    const onUpdate = (u: Uint8Array, origin: unknown) => {
      if (origin === "remote" || this.destroyed) return;
      this.push(u);
    };
    const onAfter = (tr: Y.Transaction) => {
      this.bump();
      this.detect(tr);
    };
    doc.on("update", onUpdate);
    doc.on("afterTransaction", onAfter);
    this.unbind = () => {
      doc.off("update", onUpdate);
      doc.off("afterTransaction", onAfter);
    };
  }

  private connected() {
    return this.client.connected;
  }

  private async push(update: Uint8Array) {
    if (this.status === "readonly") return;
    if (!this.connected() || !this.syncedOnce || this.syncing) {
      this.needsPush = true; // sinkron berikutnya mengirim selisihnya (CRDT: idempoten)
      return;
    }
    const ack = await this.client.sendIntent("editor.update", { sessionId: this.sessionId, update: toBase64(update) });
    if (ack.ok) return;
    if (ack.error === "READ_ONLY") return this.setStatus("readonly");
    if (ack.error === "INVALID_PATCH" || ack.error === "DOC_TOO_LARGE") return; // server mengirim editor.reset
    this.needsPush = true;
  }

  /** Sinkron dua langkah: kirim state vector → terima diff → kirim diff kita (termasuk edit offline). */
  async sync() {
    if (this.syncing || this.destroyed || !this.connected()) return;
    this.syncing = true;
    try {
      const ack = await this.client.sendIntent("editor.sync", { sessionId: this.sessionId, stateVector: toBase64(Y.encodeStateVector(this.doc)) });
      if (!ack.ok) {
        this.setStatus(ack.error === "NOT_IN_STUDIO" ? "loading" : "error");
        return;
      }
      const d = ack.data as { update: string; stateVector: string; readOnly: boolean };
      Y.applyUpdate(this.doc, fromBase64(d.update), "remote");
      this.syncedOnce = true;
      if (d.readOnly) return this.setStatus("readonly");
      const diff = Y.encodeStateAsUpdate(this.doc, fromBase64(d.stateVector));
      this.needsPush = false;
      if (diff.byteLength > 2) {
        const res = await this.client.sendIntent("editor.update", { sessionId: this.sessionId, update: toBase64(diff) });
        if (!res.ok && res.error === "READ_ONLY") return this.setStatus("readonly");
        if (!res.ok && res.error !== "INVALID_PATCH" && res.error !== "DOC_TOO_LARGE") this.needsPush = true;
      }
      this.setStatus("ready");
      this.sendAwareness(this.local, true);
    } finally {
      this.syncing = false;
    }
  }

  /** Bangun ulang dokumen dari state server (update lokal ditolak; CRDT tak bisa "membatalkan" operasi). */
  private resetFrom(updateB64: string) {
    this.unbind?.();
    this.undoOff?.();
    this.undo.destroy();
    this.doc.destroy();
    this.doc = createEditorDoc();
    Y.applyUpdate(this.doc, fromBase64(updateB64), "remote");
    this.undo = createUndo(this.doc, this.ctx.origin);
    this.bind();
    this.watchUndo();
    this.needsPush = false;
    this.syncedOnce = true;
    this.setStatus("ready");
    this.bump();
    this.onReset?.();
  }

  start() {
    this.destroyed = false;
    this.watchUndo();
    this.offs.push(
      this.client.onSignal((type, payload) => {
        const p = payload as { sessionId?: string };
        if (p.sessionId !== this.sessionId) return;
        if (type === "editor.update") {
          Y.applyUpdate(this.doc, fromBase64((payload as { update: string }).update), "remote");
          const st = this.doc.store as unknown as { pendingStructs: unknown; pendingDs: unknown };
          if (st.pendingStructs || st.pendingDs) void this.sync(); // celah: ambil diff dari server
        } else if (type === "editor.reset") this.resetFrom((payload as { update: string }).update);
        else if (type === "editor.awareness") {
          const a = payload as { participantId: string; state: AwarenessState | null };
          if (a.state) this.peers.set(a.participantId, { state: a.state, at: Date.now() });
          else this.peers.delete(a.participantId);
          this.bump();
        }
      }),
      this.client.subscribe(() => {
        const open = this.client.connected;
        if (open && !this.wasOpen) void this.sync();
        if (!open && this.wasOpen && this.status !== "readonly") this.setStatus("offline");
        this.wasOpen = open;
      }),
    );
    this.wasOpen = this.connected();
    if (this.wasOpen) void this.sync();
    else this.setStatus("offline");
    this.keepAlive = setInterval(() => {
      const now = Date.now();
      for (const [id, v] of this.peers) if (now - v.at > AWARENESS_STALE_MS) this.peers.delete(id);
      if (this.connected() && Object.keys(this.local).length) this.sendAwareness(this.local, true);
      this.bump();
    }, AWARENESS_KEEPALIVE_MS);
  }

  // ---------------------------------------------------------------- awareness
  setAwareness(patch: Partial<AwarenessState>) {
    this.local = { ...this.local, ...patch };
    this.sendAwareness(this.local);
  }

  private sendAwareness(state: AwarenessState, immediate = false) {
    if (!this.connected()) return;
    this.awarenessPending = state;
    const wait = immediate ? 0 : Math.max(0, AWARENESS_MIN_MS - (Date.now() - this.awarenessLast));
    if (this.awarenessTimer) return;
    this.awarenessTimer = setTimeout(() => {
      this.awarenessTimer = null;
      this.awarenessLast = Date.now();
      if (this.awarenessPending) this.client.sendVolatile("editor.awareness", { sessionId: this.sessionId, state: this.awarenessPending });
      this.awarenessPending = null;
    }, wait);
  }

  // ---------------------------------------------------------------- konflik (11 §5)
  private detect(tr: Y.Transaction) {
    const els = elementsMap(this.doc);
    const local = tr.origin === this.ctx.origin;
    const remote = tr.origin === "remote";
    if (!local && !remote) return;
    const changes: ChangeSet[] = [];
    tr.changed.forEach((keys, type) => {
      if ((type as unknown) === els) {
        for (const k of keys) if (typeof k === "string" && !els.has(k)) changes.push({ elementId: k, props: [], deleted: true, by: "" });
        return;
      }
      const parent = type instanceof Y.Map ? type.parent : null;
      if (parent !== els || !(type instanceof Y.Map)) return;
      const id = [...els.entries()].find(([, v]) => v === type)?.[0];
      if (!id) return;
      const props = [...keys].filter((k): k is string => typeof k === "string" && k !== "updatedBy");
      if (props.length) changes.push({ elementId: id, props, deleted: false, by: String(type.get("updatedBy") ?? "") });
    });
    if (!changes.length) return;
    const now = Date.now();
    if (local) {
      for (const c of changes) if (!c.deleted) this.conflicts.noteLocal(c.elementId, c.props, now);
      return;
    }
    // Untuk penghapusan oleh remote, `by` diambil dari entri riwayat terakhir elemen itu.
    for (const c of changes) if (c.deleted) c.by = this.lastActorOf(c.elementId);
    const toasts = this.conflicts.onRemote(changes, now, this.ctx.participantId);
    if (toasts.length) this.onConflict?.(toasts);
  }

  private lastActorOf(elementId: string): string {
    const h = this.doc.getArray<{ elementId: string | null; by: string }>("history").toArray();
    for (let i = h.length - 1; i >= 0; i--) if (h[i]!.elementId === elementId) return h[i]!.by;
    return "";
  }

  /** Elemen sekarang (untuk label toast); undefined bila sudah terhapus. */
  elementSnapshot(id: string) {
    const el = elementsMap(this.doc).get(id);
    return el ? readElement(el) : undefined;
  }

  /** Berhenti (lepas langganan & timer). Dokumen dibiarkan agar `start()` ulang (StrictMode) aman. */
  destroy() {
    this.destroyed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    this.awarenessTimer = null;
    this.undoOff?.();
    this.client.sendVolatile("editor.awareness", { sessionId: this.sessionId, state: null });
  }
}

export const EDITOR_AWARENESS_MIN_MS = AWARENESS_MIN_MS;
export { EDITOR_LIMITS };
