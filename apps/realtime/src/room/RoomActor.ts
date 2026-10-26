import { randomUUID } from "node:crypto";
import {
  LIMITS,
  PLAYER_COLORS,
  ROOM_DEFAULTS,
  WS_CLOSE,
  uniqueDisplayName,
  validateDisplayName,
} from "@longroll/shared";
import type { AckPayload, AuthOkPayload, CursorPayload, ParticipantView, RoomEvent, S2C } from "@longroll/shared";
import { log } from "../log";
import { generateToken, hashEquals, hashToken } from "../security";
import { StaleRevisionError, StoreUnavailableError } from "../store/types";
import type { RoomStore } from "../store/types";
import { participantView, roomView } from "./views";
import { RoomError } from "./types";
import type { RoomConnection, RoomState, ServerParticipant } from "./types";

export interface ActorConfig {
  graceSeconds: number;
  holdSeconds: number;
  maxLifetimeHours: number | null;
  connectDeadlineMs: number;
  credentialTtlSeconds: number;
  credentialRotationGraceMs: number;
}

export interface ActorDeps {
  store: RoomStore;
  config: ActorConfig;
  /** Dipanggil sekali saat room masuk EXPIRING; manager menjalankan cleanup. */
  onExpiring: (actor: RoomActor) => void;
}

interface BufferedEvent {
  seq: number;
  message: S2C;
}

const LIFETIME_WARNING_MS = 15 * 60 * 1000;

/**
 * Actor room (07 §1, DEC-037): satu per room, semua mutasi lewat antrean serial.
 * Setiap mutasi dikerjakan pada salinan state, DISIMPAN ke store dulu, baru diterapkan,
 * disiarkan (seq bertambah), dan di-ack (13 §7 "commit sebelum ack").
 */
export class RoomActor {
  private state: RoomState;
  private readonly deps: ActorDeps;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly buffer: BufferedEvent[] = [];
  private readonly conns = new Map<string, RoomConnection>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly connectDeadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly processed = new Map<string, Map<string, AckPayload>>();
  private expiringNotified = false;
  private lifetimeWarned = false;

  /** `events`: event tersimpan (mis. dari PostgreSQL setelah restart) agar resume tetap bisa replay. */
  constructor(state: RoomState, deps: ActorDeps, events: S2C[] = []) {
    this.state = state;
    this.deps = deps;
    for (const message of events.slice(-ROOM_DEFAULTS.eventBufferSize)) {
      if (message.seq !== undefined) this.buffer.push({ seq: message.seq, message });
    }
  }

  static createState(roomId: string, code: string, config: ActorConfig, nowMs = Date.now()): RoomState {
    return {
      roomId,
      code,
      status: "ACTIVE",
      createdAtMs: nowMs,
      emptySinceMs: null,
      // DEC-052: hanya diisi bila batas umur dikonfigurasi (default null = nonaktif).
      expiresAtMs: config.maxLifetimeHours ? nowMs + config.maxLifetimeHours * 3_600_000 : null,
      participants: {},
      activeSessionId: null,
      sessionOrder: [],
      roomVersion: 0,
      lastSeq: 0,
      revision: 0,
    };
  }

  get roomId() {
    return this.state.roomId;
  }
  get code() {
    return this.state.code;
  }
  get status() {
    return this.state.status;
  }
  /** Salinan read-only untuk tes & preview. */
  snapshot(): RoomState {
    return structuredClone(this.state);
  }
  get isOpen() {
    return this.state.status === "ACTIVE" || this.state.status === "GRACE";
  }
  connectionCount() {
    return this.conns.size;
  }

  view() {
    return roomView(this.state, this.deps.config);
  }

  // ---------------------------------------------------------------- antrean serial

  private run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(() => fn());
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async commit(mutate: (draft: RoomState, emit: (e: RoomEvent) => void) => void): Promise<S2C[]> {
    const draft = structuredClone(this.state);
    const events: RoomEvent[] = [];
    mutate(draft, (e) => events.push(e));
    const atMs = Date.now();
    const messages: S2C[] = events.map((e) => {
      draft.lastSeq += 1;
      draft.roomVersion += 1;
      return { type: e.type, payload: e.payload, seq: draft.lastSeq, roomVersion: draft.roomVersion, atMs };
    });
    draft.revision = this.state.revision + 1;
    const changedParticipantIds = Object.keys(draft.participants).filter(
      (pid) => JSON.stringify(draft.participants[pid]) !== JSON.stringify(this.state.participants[pid]),
    );
    try {
      await this.deps.store.saveRoom({ state: draft, expectedRevision: this.state.revision, events: messages, changedParticipantIds });
    } catch (err) {
      log.warn("room.commit_failed", { roomId: draft.roomId, stale: err instanceof StaleRevisionError });
      // Revisi berbeda (commit ambigu / penulis lain): muat ulang dari store sebelum menerima tulisan baru.
      if (err instanceof StaleRevisionError) await this.resync();
      throw err instanceof StoreUnavailableError || err instanceof StaleRevisionError ? new RoomError("SERVICE_UNAVAILABLE") : err;
    }
    this.state = draft;
    for (const m of messages) {
      this.buffer.push({ seq: m.seq!, message: m });
      if (this.buffer.length > ROOM_DEFAULTS.eventBufferSize) this.buffer.shift();
      this.broadcast(m);
    }
    this.reconcileTimers();
    return messages;
  }

  /**
   * Samakan state di memori dengan store (dipanggil di dalam antrean). Klien yang terhubung menerima
   * snapshot penuh; bila room sudah tidak ada di store, room diperlakukan bubar.
   */
  private async resync() {
    let loaded;
    try {
      loaded = await this.deps.store.loadRoom(this.state.roomId);
    } catch {
      return; // store masih bermasalah; commit berikutnya akan mencoba lagi
    }
    if (!loaded) {
      log.warn("room.resync_missing", { roomId: this.state.roomId });
      for (const conn of this.conns.values()) {
        conn.send({ type: "room.expired", atMs: Date.now(), payload: {} });
        conn.close(WS_CLOSE.EXPIRED, "expired");
      }
      this.conns.clear();
      this.dispose();
      this.state = { ...this.state, status: "EXPIRED" };
      return;
    }
    this.state = loaded.state;
    this.buffer.length = 0;
    for (const message of loaded.events) if (message.seq !== undefined) this.buffer.push({ seq: message.seq, message });
    for (const [pid, conn] of this.conns) {
      if (this.state.participants[pid]?.connection === "LEFT") conn.close(WS_CLOSE.AUTH_INVALID, "auth");
      else conn.send({ type: "room.snapshot", atMs: Date.now(), payload: { room: this.view(), lastSeq: this.state.lastSeq } });
    }
    log.info("room.resynced", { roomId: this.state.roomId, revision: this.state.revision });
    this.reconcileTimers();
  }

  private broadcast(message: S2C, exceptParticipantId?: string) {
    for (const [pid, conn] of this.conns) if (pid !== exceptParticipantId) conn.send(message);
  }

  private nonLeft(draft: RoomState = this.state): ServerParticipant[] {
    return Object.values(draft.participants).filter((p) => p.connection !== "LEFT");
  }

  /** ACTIVE ⇄ GRACE berdasarkan jumlah peserta CONNECTED (07 §12). */
  private applyRoomStatus(draft: RoomState, emit: (e: RoomEvent) => void, nowMs: number) {
    const connected = Object.values(draft.participants).some((p) => p.connection === "CONNECTED");
    if (draft.status === "ACTIVE" && !connected) {
      draft.status = "GRACE";
      draft.emptySinceMs = nowMs;
      emit({ type: "room.status", payload: { status: "GRACE", emptySinceMs: nowMs } });
    } else if (draft.status === "GRACE" && connected) {
      draft.status = "ACTIVE";
      draft.emptySinceMs = null;
      emit({ type: "room.status", payload: { status: "ACTIVE", emptySinceMs: null } });
    }
  }

  private assertOpen() {
    if (!this.isOpen) throw new RoomError("ROOM_EXPIRED");
  }

  // ---------------------------------------------------------------- recovery

  /**
   * Setelah dimuat dari snapshot (restart proses): tidak ada socket yang hidup, jadi peserta
   * CONNECTED → RECONNECTING mulai sekarang. Grace dilanjutkan dari emptySinceMs tersimpan.
   */
  recover(): Promise<void> {
    return this.run(async () => {
      if (this.state.status === "EXPIRING") {
        this.notifyExpiring();
        return;
      }
      const now = Date.now();
      const needsUpdate = Object.values(this.state.participants).some((p) => p.connection === "CONNECTED");
      if (needsUpdate) {
        await this.commit((draft, emit) => {
          for (const p of Object.values(draft.participants)) {
            if (p.connection !== "CONNECTED") continue;
            p.connection = "RECONNECTING";
            p.disconnectedAtMs = now;
            emit({ type: "presence.update", payload: { participantId: p.participantId, connection: "RECONNECTING", disconnectedAtMs: now } });
          }
          this.applyRoomStatus(draft, emit, now);
        });
      } else {
        this.reconcileTimers();
      }
    });
  }

  // ---------------------------------------------------------------- join & kredensial

  /** Join atomik di dalam actor (07 §3.1, §4): kapasitas dicek & ditulis dalam satu langkah. */
  join(rawName: unknown): Promise<{ participant: ParticipantView; token: string }> {
    return this.run(async () => {
      this.assertOpen();
      const name = validateDisplayName(rawName);
      if (!name.ok) throw new RoomError("NAME_INVALID", `NAME_${name.reason}` as const);
      const active = this.nonLeft();
      if (active.length >= LIMITS.maxParticipants) {
        throw new RoomError("ROOM_FULL", active.some((p) => p.connection === "RECONNECTING") ? "HOLD" : undefined);
      }
      const usedColors = new Set(active.map((p) => p.color));
      const color = PLAYER_COLORS.find((c) => !usedColors.has(c))!;
      const displayName = uniqueDisplayName(name.value, active.map((p) => p.displayName));
      const token = generateToken();
      const now = Date.now();
      const participant: ServerParticipant = {
        participantId: randomUUID(),
        displayName,
        color,
        joinedAtMs: now,
        connection: "CONNECTED",
        disconnectedAtMs: null,
        camera: "none",
        ready: false,
        tokenHash: hashToken(token),
        tokenIssuedAtMs: now,
        prevTokenHash: null,
        prevTokenValidUntilMs: null,
      };
      await this.commit((draft, emit) => {
        draft.participants[participant.participantId] = participant;
        emit({ type: "participant.joined", payload: { participant: participantView(participant) } });
        this.applyRoomStatus(draft, emit, now);
      });
      this.scheduleConnectDeadline(participant.participantId);
      return { participant: participantView(participant), token };
    });
  }

  /**
   * Validasi token (constant-time) → participantId, atau null. Token berlaku bila peserta belum LEFT,
   * room masih terbuka, dan umur kredensial belum lewat TTL (bounded, diperbarui lewat refreshSession).
   */
  authenticate(token: string | null | undefined): string | null {
    if (!token || !this.isOpen) return null;
    const hash = hashToken(token);
    const now = Date.now();
    const ttlMs = this.deps.config.credentialTtlSeconds * 1000;
    let found: string | null = null;
    for (const p of Object.values(this.state.participants)) {
      if (p.connection === "LEFT") continue;
      const current = hashEquals(hash, p.tokenHash) && p.tokenIssuedAtMs !== null && now - p.tokenIssuedAtMs < ttlMs;
      const previous = hashEquals(hash, p.prevTokenHash) && (p.prevTokenValidUntilMs ?? 0) > now;
      if (current || previous) found = p.participantId;
    }
    return found;
  }

  /** Rotasi token (15 §2) + perpanjangan umur kredensial. Token lama diterima sebentar (race multi-tab). */
  refreshSession(token: string | null | undefined): Promise<{ participant: ParticipantView; token: string }> {
    return this.run(async () => {
      this.assertOpen();
      const pid = this.authenticate(token);
      if (!pid) throw new RoomError("AUTH_INVALID");
      const fresh = generateToken();
      const now = Date.now();
      await this.commit((draft) => {
        const p = draft.participants[pid]!;
        p.prevTokenHash = p.tokenHash;
        p.prevTokenValidUntilMs = now + this.deps.config.credentialRotationGraceMs;
        p.tokenHash = hashToken(fresh);
        p.tokenIssuedAtMs = now;
      });
      return { participant: participantView(this.state.participants[pid]!), token: fresh };
    });
  }

  // ---------------------------------------------------------------- koneksi

  /**
   * Pasang koneksi WS terautentikasi. Tab lama dengan peserta sama menerima `session.replaced` (DEC-083).
   * Resume: replay event sejak lastSeq bila masih di ring buffer, kalau tidak kirim snapshot (14 §13).
   */
  attach(conn: RoomConnection, participantId: string, lastSeq: number | null): Promise<void> {
    return this.run(async () => {
      const p = this.state.participants[participantId];
      if (!this.isOpen || !p || p.connection === "LEFT") {
        conn.close(this.isOpen ? WS_CLOSE.AUTH_INVALID : WS_CLOSE.EXPIRED, "auth");
        return;
      }
      const previous = this.conns.get(participantId);
      if (previous && previous.id !== conn.id) {
        previous.send({ type: "session.replaced", atMs: Date.now(), payload: {} });
        previous.close(WS_CLOSE.REPLACED, "replaced");
      }
      this.conns.set(participantId, conn);
      this.clearConnectDeadline(participantId);

      const replay = lastSeq === null ? null : this.eventsSince(lastSeq);
      const authOk: AuthOkPayload = { participantId, serverTimeMs: Date.now() };
      if (replay) authOk.resumedFromSeq = lastSeq!;
      else authOk.room = this.view();
      conn.send({ type: "auth.ok", atMs: Date.now(), payload: authOk });
      for (const m of replay ?? []) conn.send(m);

      if (p.connection !== "CONNECTED") {
        const now = Date.now();
        try {
          await this.commit((draft, emit) => {
            const dp = draft.participants[participantId]!;
            dp.connection = "CONNECTED";
            dp.disconnectedAtMs = null;
            emit({ type: "presence.update", payload: { participantId, connection: "CONNECTED", disconnectedAtMs: null } });
            this.applyRoomStatus(draft, emit, now);
          });
        } catch (err) {
          // Store mati: tutup supaya klien mencoba lagi (state tidak berubah).
          this.conns.delete(participantId);
          conn.close(1011, "unavailable");
          throw err;
        }
      }
    });
  }

  /** Socket tertutup. Diabaikan bila socket itu sudah digantikan tab lain. */
  detach(conn: RoomConnection, participantId: string): Promise<void> {
    return this.run(async () => {
      if (this.conns.get(participantId)?.id !== conn.id) return;
      this.conns.delete(participantId);
      await this.markDisconnected(participantId);
    });
  }

  private async markDisconnected(participantId: string) {
    const p = this.state.participants[participantId];
    if (!p || p.connection !== "CONNECTED" || this.conns.has(participantId) || !this.isOpen) return;
    const now = Date.now();
    try {
      await this.commit((draft, emit) => {
        const dp = draft.participants[participantId]!;
        dp.connection = "RECONNECTING";
        dp.disconnectedAtMs = now;
        emit({ type: "presence.update", payload: { participantId, connection: "RECONNECTING", disconnectedAtMs: now } });
        this.applyRoomStatus(draft, emit, now);
      });
    } catch {
      // Store tidak tersedia: coba lagi nanti; peserta tetap terlihat CONNECTED sementara.
      this.setTimer(`retry-disconnect:${participantId}`, 2_000, () => this.run(() => this.markDisconnected(participantId)));
    }
  }

  private eventsSince(lastSeq: number): S2C[] | null {
    if (!Number.isInteger(lastSeq) || lastSeq < 0 || lastSeq > this.state.lastSeq) return null;
    if (lastSeq === this.state.lastSeq) return [];
    const first = this.buffer[0];
    if (!first || first.seq > lastSeq + 1) return null;
    return this.buffer.filter((e) => e.seq > lastSeq).map((e) => e.message);
  }

  // ---------------------------------------------------------------- intent

  /**
   * Intent dari peserta terautentikasi. Idempoten per clientEventId (14 §8.1):
   * duplikat dibalas hasil yang sama tanpa efek ganda.
   */
  async intent(participantId: string, type: string, payload: unknown, clientEventId?: string): Promise<AckPayload> {
    if (clientEventId) {
      const cached = this.processed.get(participantId)?.get(clientEventId);
      if (cached) return cached;
    }
    let result: AckPayload;
    try {
      await this.handleIntent(participantId, type, payload);
      result = { ok: true };
    } catch (err) {
      result = { ok: false, error: err instanceof RoomError ? err.code : "BAD_REQUEST" };
    }
    // Hasil SERVICE_UNAVAILABLE tidak di-cache: retry dengan clientEventId sama harus dicoba lagi.
    if (clientEventId && result.error !== "SERVICE_UNAVAILABLE") this.remember(participantId, clientEventId, result);
    return result;
  }

  private remember(participantId: string, clientEventId: string, result: AckPayload) {
    let map = this.processed.get(participantId);
    if (!map) this.processed.set(participantId, (map = new Map()));
    map.set(clientEventId, result);
    if (map.size > ROOM_DEFAULTS.idempotencyCacheSize) map.delete(map.keys().next().value!);
  }

  private handleIntent(participantId: string, type: string, payload: unknown): Promise<void> {
    switch (type) {
      case "participant.leave":
        return this.leave(participantId);
      case "presence.set":
        return this.presenceSet(participantId, payload);
      default:
        return Promise.reject(new RoomError("UNKNOWN_EVENT"));
    }
  }

  /** P02: hanya `ready`. Kamera (P03) belum bisa diubah. Selalu untuk diri sendiri (14 §8.2). */
  private presenceSet(participantId: string, payload: unknown): Promise<void> {
    return this.run(async () => {
      this.assertOpen();
      const p = this.state.participants[participantId];
      if (!p || p.connection !== "CONNECTED") throw new RoomError("NOT_CONNECTED");
      const ready = (payload as { ready?: unknown } | null)?.ready;
      if (typeof ready !== "boolean") throw new RoomError("BAD_REQUEST");
      if (p.ready === ready) return;
      await this.commit((draft, emit) => {
        draft.participants[participantId]!.ready = ready;
        emit({ type: "presence.update", payload: { participantId, ready } });
      });
    });
  }

  /** Keluar (07 §11): LEFT, token dicabut, slot & warna dibebaskan. Idempoten. */
  leave(participantId: string): Promise<void> {
    return this.run(async () => {
      const p = this.state.participants[participantId];
      if (!p || p.connection === "LEFT" || !this.isOpen) return;
      const now = Date.now();
      await this.commit((draft, emit) => {
        const dp = draft.participants[participantId]!;
        dp.connection = "LEFT";
        dp.disconnectedAtMs = now;
        dp.tokenHash = null;
        dp.prevTokenHash = null;
        dp.prevTokenValidUntilMs = null;
        dp.ready = false;
        emit({ type: "participant.left", payload: { participantId } });
        this.applyRoomStatus(draft, emit, now);
      });
      this.clearConnectDeadline(participantId);
      const conn = this.conns.get(participantId);
      this.conns.delete(participantId);
      conn?.close(WS_CLOSE.LEFT, "left");
    });
  }

  /** Kursor volatile (07 §8): tidak disimpan, tidak masuk antrean, tanpa seq. */
  relayCursor(participantId: string, payload: CursorPayload) {
    if (!this.isOpen || this.state.participants[participantId]?.connection !== "CONNECTED") return;
    this.broadcast({ type: "cursor.move", atMs: Date.now(), payload: { ...payload, participantId } }, participantId);
  }

  /** Resume di tengah koneksi (klien mendeteksi lompatan seq). */
  resume(conn: RoomConnection, lastSeq: number) {
    const replay = this.eventsSince(lastSeq);
    if (replay) for (const m of replay) conn.send(m);
    else conn.send({ type: "room.snapshot", atMs: Date.now(), payload: { room: this.view(), lastSeq: this.state.lastSeq } });
  }

  // ---------------------------------------------------------------- timer & lifecycle

  private setTimer(key: string, delayMs: number, fn: () => unknown) {
    const old = this.timers.get(key);
    if (old) clearTimeout(old);
    const t = setTimeout(() => {
      this.timers.delete(key);
      Promise.resolve(fn()).catch((err) => log.warn("room.timer_failed", { roomId: this.roomId, key, message: String(err) }));
    }, Math.max(0, delayMs));
    t.unref?.();
    this.timers.set(key, t);
  }

  private scheduleConnectDeadline(participantId: string) {
    this.clearConnectDeadline(participantId);
    const t = setTimeout(() => {
      this.connectDeadlines.delete(participantId);
      void this.run(() => this.markDisconnected(participantId));
    }, this.deps.config.connectDeadlineMs);
    t.unref?.();
    this.connectDeadlines.set(participantId, t);
  }

  private clearConnectDeadline(participantId: string) {
    const t = this.connectDeadlines.get(participantId);
    if (t) clearTimeout(t);
    this.connectDeadlines.delete(participantId);
  }

  /** Jadwalkan ulang timer dari timestamp tersimpan (aman setelah restart). */
  private reconcileTimers() {
    for (const [key, t] of this.timers) {
      if (key.startsWith("hold:") || key === "grace" || key.startsWith("lifetime")) {
        clearTimeout(t);
        this.timers.delete(key);
      }
    }
    if (!this.isOpen) return;
    const now = Date.now();
    const { holdSeconds, graceSeconds } = this.deps.config;
    for (const p of Object.values(this.state.participants)) {
      if (p.connection !== "RECONNECTING" || p.disconnectedAtMs === null) continue;
      const pid = p.participantId;
      this.setTimer(`hold:${pid}`, p.disconnectedAtMs + holdSeconds * 1000 - now, () => this.holdExpired(pid));
    }
    if (this.state.status === "GRACE" && this.state.emptySinceMs !== null) {
      this.setTimer("grace", this.state.emptySinceMs + graceSeconds * 1000 - now, () => this.graceExpired());
    }
    if (this.state.expiresAtMs !== null) {
      const at = this.state.expiresAtMs;
      if (!this.lifetimeWarned) {
        this.setTimer("lifetime-warn", at - LIFETIME_WARNING_MS - now, () => {
          this.lifetimeWarned = true;
          return this.run(async () => {
            if (this.isOpen) await this.commit((_d, emit) => emit({ type: "room.expiring", payload: { reason: "MAX_LIFETIME", atMs: at } }));
          });
        });
      }
      this.setTimer("lifetime", at - now, () => this.run(() => this.startExpiry("MAX_LIFETIME")));
    }
  }

  /** Hold slot habis (DEC-021) → LEFT. Token dicabut; reconnect berikutnya harus join ulang. */
  private holdExpired(participantId: string): Promise<void> {
    return this.run(async () => {
      const p = this.state.participants[participantId];
      if (!p || p.connection !== "RECONNECTING" || p.disconnectedAtMs === null || !this.isOpen) return;
      if (Date.now() < p.disconnectedAtMs + this.deps.config.holdSeconds * 1000) return this.reconcileTimers();
      await this.commit((draft, emit) => {
        const dp = draft.participants[participantId]!;
        dp.connection = "LEFT";
        dp.tokenHash = null;
        dp.prevTokenHash = null;
        dp.prevTokenValidUntilMs = null;
        dp.ready = false;
        emit({ type: "participant.left", payload: { participantId } });
      });
    });
  }

  private graceExpired(): Promise<void> {
    return this.run(async () => {
      if (this.state.status !== "GRACE" || this.state.emptySinceMs === null) return;
      if (Date.now() < this.state.emptySinceMs + this.deps.config.graceSeconds * 1000) return this.reconcileTimers();
      await this.startExpiry("GRACE");
    });
  }

  /** Untuk sweeper: periksa ulang kondisi timer (mis. setelah jam sistem melompat). */
  checkTimers(): Promise<void> {
    return this.run(async () => {
      if (this.state.status === "EXPIRING") return this.notifyExpiring();
      const now = Date.now();
      if (this.state.status === "GRACE" && this.state.emptySinceMs !== null && now >= this.state.emptySinceMs + this.deps.config.graceSeconds * 1000) {
        await this.startExpiry("GRACE");
      }
    });
  }

  /** 15 §8.2 langkah 1–2: EXPIRING, cabut semua token, tutup socket dengan room.expired. */
  private async startExpiry(reason: "GRACE" | "MAX_LIFETIME") {
    if (!this.isOpen) return;
    const now = Date.now();
    await this.commit((draft, emit) => {
      draft.status = "EXPIRING";
      for (const p of Object.values(draft.participants)) {
        p.tokenHash = null;
        p.prevTokenHash = null;
        p.prevTokenValidUntilMs = null;
      }
      emit({ type: "room.expiring", payload: { reason, atMs: now } });
    });
    for (const conn of this.conns.values()) {
      conn.send({ type: "room.expired", atMs: now, payload: {} });
      conn.close(WS_CLOSE.EXPIRED, "expired");
    }
    this.conns.clear();
    this.dispose();
    log.info("room.expiring", { roomId: this.roomId, reason });
    this.notifyExpiring();
  }

  private notifyExpiring() {
    if (this.expiringNotified) return;
    this.expiringNotified = true;
    this.deps.onExpiring(this);
  }

  /** Hentikan semua timer (room selesai atau proses dimatikan). */
  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const t of this.connectDeadlines.values()) clearTimeout(t);
    this.connectDeadlines.clear();
  }

  /** Tandai EXPIRED di memori setelah cleanup terverifikasi (data room di store sudah dihapus). */
  markExpired() {
    this.state = { ...this.state, status: "EXPIRED" };
  }
}
