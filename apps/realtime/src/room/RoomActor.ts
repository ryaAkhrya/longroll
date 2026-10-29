import { randomUUID } from "node:crypto";
import {
  CAMERA_STATES,
  DEFAULT_CAMERA_PRESENTATION,
  LIMITS,
  PLAYER_COLORS,
  ROOM_DEFAULTS,
  WS_CLOSE,
  sanitizeCameraPresentation,
  uniqueDisplayName,
  validateDisplayName,
} from "@longroll/shared";
import type {
  AckPayload,
  AuthOkPayload,
  CameraState,
  CursorPayload,
  ParticipantView,
  RoomEvent,
  RtcSignal,
  RtcSignalType,
  S2C,
} from "@longroll/shared";
import { errText, log } from "../log";
import { generateToken, hashEquals, hashToken } from "../security";
import { StaleRevisionError, StoreUnavailableError } from "../store/types";
import type { RoomStore } from "../store/types";
import { participantView, roomView } from "./views";
import { emitSessionState } from "./captureLogic";
import { castVote, closeVote, closingExpired, connectedIds, createSession, finalizeSession, onPresenceChanged, reopenSession } from "./sessionLogic";
import type { StudioInit } from "./sessionLogic";
import {
  defaultStudioInit,
  expirePendingFrames,
  frameReady,
  lockStructure,
  prepareFrame,
  studioRevert,
  studioUpdate,
  syncStudioParticipants,
} from "./studioLogic";
import type { FrameTemplate } from "@longroll/shared";
import { CAPTURE_CONFIG } from "@longroll/shared";
import { EditorHub } from "./editor";
import { RESULT_PREVIEW_MAX_BYTES, RESULT_PREVIEW_MAX_PX, URL_TTL_SEC, allowedAssetKeys, buildGallery, docSnapshotKey, resultPreviewKey } from "./results";
import { verifyResultPreview } from "../captures/verify";
import type { Attempt } from "@longroll/shared";
import { verifyAttemptUpload } from "../captures/verify";
import type { ObjectStorage } from "../storage/types";
import {
  acceptAttempt,
  armShot,
  commitUploadPart,
  failAttempt,
  holdShot,
  markPurged,
  onParticipantLeft,
  parseUploadClaim,
  prepareAttempt,
  processRetakeT0,
  processT0,
  purgeCandidates,
  reopenDecision,
  retakeAttempt,
  skipParticipant,
  uploadPrecheck,
} from "./captureLogic";
import { RoomError } from "./types";
import type { RoomConnection, RoomState, ServerFrame, ServerParticipant } from "./types";

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
  /** P05: inisialisasi studio saat mode terkunci. */
  studioInit?: StudioInit;
  /** P06: object storage privat untuk foto attempt (presign, verifikasi upload, purge). */
  storage?: ObjectStorage;
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
  private readonly nudgedAt = new Map<string, number>();
  /** Permintaan render pratinjau hasil: versi + siapa yang sudah dicoba (fallback round-robin 30 detik, DEC-060). */
  private readonly renderReq = new Map<string, { version: number; tried: string[]; timer: ReturnType<typeof setTimeout> | null }>();
  /** Dokumen editor kolaboratif per sesi (P07). */
  readonly editor: EditorHub;
  private expiringNotified = false;
  private lifetimeWarned = false;

  /** `events`: event tersimpan (mis. dari PostgreSQL setelah restart) agar resume tetap bisa replay. */
  constructor(state: RoomState, deps: ActorDeps, events: S2C[] = []) {
    this.state = state;
    this.state.frames ??= {};
    this.deps = deps;
    this.editor = new EditorHub({
      roomId: state.roomId,
      store: deps.store,
      state: () => this.state,
      broadcast: (type, payload, except) => this.broadcast({ type, atMs: Date.now(), payload }, except),
      sendTo: (pid, type, payload) => this.conns.get(pid)?.send({ type, atMs: Date.now(), payload }),
    });
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
      sessions: {},
      frames: {},
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
    const emit = (e: RoomEvent) => events.push(e);
    mutate(draft, emit);
    // Peserta berubah saat STUDIO sebelum shot 1 -> BindingPlan ikut (07 7.2), dalam commit yang sama.
    syncStudioParticipants(draft, emit);
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
    const changedSessionIds = Object.keys(draft.sessions).filter(
      (sid) => JSON.stringify(draft.sessions[sid]) !== JSON.stringify(this.state.sessions[sid]),
    );
    const changedFrameIds = Object.keys(draft.frames).filter((fid) => JSON.stringify(draft.frames[fid]) !== JSON.stringify(this.state.frames[fid]));
    const deletedFrameIds = Object.keys(this.state.frames).filter((fid) => !draft.frames[fid]);
    try {
      await this.deps.store.saveRoom({
        state: draft,
        expectedRevision: this.state.revision,
        events: messages,
        changedParticipantIds,
        changedSessionIds,
        changedFrameIds,
        deletedFrameIds,
      });
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

  private connected(draft: RoomState): string[] {
    return connectedIds(draft, (pid) => this.conns.has(pid));
  }

  private get studioInit(): StudioInit {
    return this.deps.studioInit ?? defaultStudioInit;
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
        mirrored: false,
        cameraPresentation: { ...DEFAULT_CAMERA_PRESENTATION, offset: { ...DEFAULT_CAMERA_PRESENTATION.offset } },
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
        onPresenceChanged(draft, emit, null, this.connected(draft).filter((id) => id !== participantId), now, this.studioInit);
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
      const data = await this.handleIntent(participantId, type, payload);
      result = data === undefined ? { ok: true } : { ok: true, data };
    } catch (err) {
      result =
        err instanceof RoomError
          ? { ok: false, error: err.code, ...(err.reason ? { reason: err.reason } : {}), ...(err.detail !== undefined ? { detail: err.detail } : {}) }
          : { ok: false, error: "BAD_REQUEST" };
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

  private handleIntent(participantId: string, type: string, payload: unknown): Promise<unknown> {
    switch (type) {
      case "participant.leave":
        return this.leave(participantId);
      case "presence.set":
        return this.presenceSet(participantId, payload);
      case "session.create":
      case "vote.cast":
      case "vote.close":
      case "studio.update":
      case "studio.revert":
        return this.sessionIntent(participantId, type, payload);
      case "session.finalize":
      case "session.reopen":
        return this.sessionIntent(participantId, type, payload).then(() => (type === "session.finalize" ? this.afterFinalize(participantId, payload) : undefined));
      case "result.preview.prepare":
        return this.resultPreviewPrepare(participantId, payload);
      case "result.preview.uploaded":
        return this.resultPreviewUploaded(participantId, payload);
      case "gallery.get":
        return this.galleryGet(participantId);
      case "asset.urls":
        return this.assetUrls(participantId, payload);
      case "editor.sync":
        return this.editorIntent(participantId, payload, (sid) => this.editor.sync(participantId, sid, (payload as { stateVector?: unknown }).stateVector));
      case "editor.update":
        return this.editorIntent(participantId, payload, (sid) => this.editor.update(participantId, sid, (payload as { update?: unknown }).update));
      case "shot.arm":
      case "shot.hold":
      case "attempt.fail":
      case "capture.accept":
      case "capture.retake":
      case "capture.reopen":
      case "shot.skip":
        return this.captureIntent(participantId, type, payload);
      case "attempt.prepare":
        return this.attemptPrepare(participantId, payload);
      case "attempt.uploaded":
        return this.attemptUploaded(participantId, payload);
      case "nudge":
        return this.nudge(participantId, payload);
      default:
        return Promise.reject(new RoomError("UNKNOWN_EVENT"));
    }
  }

  /**
   * Presence milik sendiri (14 §5.2, 09 §4): ready, camera, mirrored, cameraPresentation.
   * Server selalu memakai identitas terautentikasi; payload yang menyebut peserta lain ditolak
   * FORBIDDEN_NOT_OWNER (REQ-CAM-13, TC-SEC-012). Tidak ada event yang mengontrol kamera orang lain.
   */
  private presenceSet(participantId: string, payload: unknown): Promise<void> {
    return this.run(async () => {
      this.assertOpen();
      const p = this.state.participants[participantId];
      if (!p || p.connection !== "CONNECTED") throw new RoomError("NOT_CONNECTED");
      if (!payload || typeof payload !== "object") throw new RoomError("BAD_REQUEST");
      const input = payload as Record<string, unknown>;
      if (input.participantId !== undefined && input.participantId !== participantId) throw new RoomError("FORBIDDEN_NOT_OWNER");

      const patch: { ready?: boolean; camera?: CameraState; mirrored?: boolean; cameraPresentation?: ServerParticipant["cameraPresentation"] } = {};
      if (input.ready !== undefined) {
        if (typeof input.ready !== "boolean") throw new RoomError("BAD_REQUEST");
        if (input.ready !== p.ready) patch.ready = input.ready;
      }
      if (input.camera !== undefined) {
        if (!CAMERA_STATES.includes(input.camera as CameraState)) throw new RoomError("BAD_REQUEST");
        if (input.camera !== p.camera) patch.camera = input.camera as CameraState;
      }
      if (input.mirrored !== undefined) {
        if (typeof input.mirrored !== "boolean") throw new RoomError("BAD_REQUEST");
        if (input.mirrored !== p.mirrored) patch.mirrored = input.mirrored;
      }
      if (input.cameraPresentation !== undefined) {
        const cp = sanitizeCameraPresentation(input.cameraPresentation);
        if (!cp) throw new RoomError("BAD_REQUEST");
        if (JSON.stringify(cp) !== JSON.stringify(p.cameraPresentation)) patch.cameraPresentation = cp;
      }
      if (Object.keys(patch).length === 0) return;
      await this.commit((draft, emit) => {
        Object.assign(draft.participants[participantId]!, patch);
        emit({ type: "presence.update", payload: { participantId, ...patch } });
      });
    });
  }

  /**
   * Relay sinyal WebRTC (14 §5.3): hanya ke peserta lain di room yang sama yang sedang terhubung;
   * `from` diisi dari identitas terautentikasi. Volatile & tidak pernah dicatat (NFR-09).
   */
  relayRtc(fromParticipantId: string, type: RtcSignalType, signal: RtcSignal): boolean {
    const drop = (reason: string) => {
      if (reason !== "no-socket") log.info("rtc.dropped", { roomId: this.roomId, type, reason });
      return false;
    };
    // Pengirim cukup punya socket terautentikasi yang aktif: `auth.ok` dikirim sebelum commit CONNECTED
    // selesai disimpan, jadi status tersimpan bisa sesaat masih RECONNECTING.
    if (!this.isOpen || !this.conns.has(fromParticipantId) || this.state.participants[fromParticipantId]?.connection === "LEFT") return drop("sender");
    if (signal.to === fromParticipantId) return drop("self");
    const target = this.state.participants[signal.to];
    const conn = this.conns.get(signal.to);
    if (!target || target.connection === "LEFT") return drop("target");
    if (!conn) return drop("no-socket");
    conn.send({ type, atMs: Date.now(), payload: { ...signal, from: fromParticipantId } });
    return true;
  }

  /** Aktivitas ringan volatile (mis. "lagi lihat Lilac Dream"), tidak disimpan. */
  relayActivity(participantId: string, activity: string | null) {
    if (!this.isOpen || !this.conns.has(participantId)) return;
    this.broadcast({ type: "presence.activity", atMs: Date.now(), payload: { participantId, activity } }, participantId);
  }

  /** Intent sesi/voting (P04): validasi state di server, commit sebelum ack, tanpa hak khusus siapa pun. */
  private sessionIntent(participantId: string, type: string, payload: unknown): Promise<void> {
    return this.run(async () => {
      this.assertOpen();
      const p = this.state.participants[participantId];
      if (!p || p.connection === "LEFT" || !this.conns.has(participantId)) throw new RoomError("NOT_CONNECTED");
      const now = Date.now();
      await this.commit((draft, emit) => {
        const connected = this.connected(draft);
        if (type === "session.create") createSession(draft, emit, participantId, now);
        else if (type === "vote.cast") castVote(draft, emit, participantId, payload, connected, now, this.studioInit);
        else if (type === "vote.close") closeVote(draft, emit, participantId, payload, connected, now);
        else if (type === "session.finalize") finalizeSession(draft, emit, participantId, payload, now);
        else if (type === "session.reopen") reopenSession(draft, emit, participantId, payload, now);
        else if (type === "studio.update") studioUpdate(draft, emit, participantId, payload, now);
        else studioRevert(draft, emit, participantId, payload, now);
      });
    });
  }

  // ---------------------------------------------------------------- capture (P06, 09 §7–§12)

  private hasSocket = (pid: string) => this.conns.has(pid);

  /** Intent capture: commit-before-ack, validasi server, tanpa hak khusus siapa pun. */
  private captureIntent(participantId: string, type: string, payload: unknown): Promise<void> {
    return this.run(async () => {
      this.assertOpen();
      const p = this.state.participants[participantId];
      if (!p || p.connection === "LEFT" || !this.conns.has(participantId)) throw new RoomError("NOT_CONNECTED");
      const now = Date.now();
      await this.commit((draft, emit) => {
        // Jatuh tempo yang belum diproses timer (jam sistem / timer terlambat) diproses dulu: urutan konsisten.
        processT0(draft, emit, now, this.hasSocket);
        switch (type) {
          case "shot.arm":
            return armShot(draft, emit, participantId, payload, now, this.hasSocket);
          case "shot.hold":
            return holdShot(draft, emit, participantId, payload, now);
          case "attempt.fail":
            return failAttempt(draft, emit, participantId, payload, now);
          case "capture.accept":
            return acceptAttempt(draft, emit, participantId, payload, now);
          case "capture.retake":
            return retakeAttempt(draft, emit, participantId, payload, now);
          case "capture.reopen":
            return reopenDecision(draft, emit, participantId, payload, now);
          default:
            return skipParticipant(draft, emit, participantId, payload, now);
        }
      });
    }).then(() => {
      // Shot terakhir DONE -> sesi EDITING: seed dokumen editor dari foto accepted + BindingPlan (11 13).
      const s = this.state.activeSessionId ? this.state.sessions[this.state.activeSessionId] : null;
      if (s?.state === "EDITING" && !this.editor.has(s.sessionId)) void this.editor.ensure(s.sessionId).catch((err) => log.warn("editor.seed_failed", { roomId: this.roomId, message: errText(err) }));
      return this.purgeRejected();
    });
  }

  // ---------------------------------------------------------------- hasil, galeri, aset (P08)

  private requireMember(participantId: string) {
    this.assertOpen();
    const p = this.state.participants[participantId];
    if (!p || p.connection === "LEFT" || !this.conns.has(participantId)) throw new RoomError("NOT_CONNECTED");
  }

  /** Setelah FINAL tersimpan: snapshot dokumen ke storage (doc.bin) + minta klien merender pratinjau. Idempoten. */
  private async afterFinalize(by: string, payload: unknown) {
    const sid = (payload as { sessionId?: unknown } | null)?.sessionId;
    const s = typeof sid === "string" ? this.state.sessions[sid] : undefined;
    if (!s || s.state !== "FINAL" || !s.result) return;
    await this.editor.flush();
    const storage = this.deps.storage;
    const snap = await this.editor.snapshot(s.sessionId).catch(() => null);
    if (storage && snap && s.result.docSnapshotKey) {
      try {
        await storage.put(s.result.docSnapshotKey, snap, "application/octet-stream");
      } catch (err) {
        log.warn("result.snapshot_failed", { roomId: this.roomId, message: errText(err) });
      }
    }
    // Finalisasi bersamaan/ganda idempoten: satu permintaan render per versi.
    if (!s.result.previewReady && this.renderReq.get(s.sessionId)?.version !== s.result.version) this.requestRender(s.sessionId, s.result.version, by);
  }

  /** Minta satu peserta merender pratinjau; bila tak ada hasil dalam 30 detik → peserta terhubung berikutnya (round-robin). */
  private requestRender(sessionId: string, version: number, first?: string) {
    const cur = this.renderReq.get(sessionId);
    if (cur?.timer) clearTimeout(cur.timer);
    const rec = cur && cur.version === version ? cur : { version, tried: [] as string[], timer: null as ReturnType<typeof setTimeout> | null };
    this.renderReq.set(sessionId, rec);
    const ready = Object.values(this.state.participants)
      .filter((p) => p.connection === "CONNECTED" && this.conns.has(p.participantId))
      .map((p) => p.participantId);
    const next = (first && ready.includes(first) && !rec.tried.includes(first) ? first : undefined) ?? ready.find((id) => !rec.tried.includes(id));
    if (!next) return;
    rec.tried.push(next);
    this.conns.get(next)?.send({ type: "result.render.request", atMs: Date.now(), payload: { sessionId, version } });
    rec.timer = setTimeout(() => {
      const r = this.state.sessions[sessionId]?.result;
      if (r && r.version === version && !r.previewReady && this.isOpen) this.requestRender(sessionId, version);
    }, 30_000);
    rec.timer.unref?.();
  }

  private finalSession(payload: unknown) {
    const sid = (payload as { sessionId?: unknown } | null)?.sessionId;
    const s = typeof sid === "string" ? this.state.sessions[sid] : undefined;
    if (!s || !s.result || s.state !== "FINAL") throw new RoomError("NOT_IN_STUDIO");
    return s;
  }

  private async resultPreviewPrepare(participantId: string, payload: unknown) {
    this.requireMember(participantId);
    const storage = this.deps.storage;
    if (!storage) throw new RoomError("SERVICE_UNAVAILABLE");
    const s = this.finalSession(payload);
    const key = resultPreviewKey(this.roomId, s.sessionId);
    const put = await storage.presignPut(key, { contentType: "image/webp", bytes: RESULT_PREVIEW_MAX_BYTES, expiresSec: URL_TTL_SEC });
    return { uploadUrl: put, maxBytes: RESULT_PREVIEW_MAX_BYTES, version: s.result!.version };
  }

  private async resultPreviewUploaded(participantId: string, payload: unknown): Promise<void> {
    this.requireMember(participantId);
    const storage = this.deps.storage;
    if (!storage) throw new RoomError("SERVICE_UNAVAILABLE");
    const s = this.finalSession(payload);
    const p = (payload ?? {}) as { bytes?: unknown; sha256?: unknown; version?: unknown };
    if (p.version !== s.result!.version) throw new RoomError("TOO_LATE"); // pratinjau dari finalisasi lama
    if (s.result!.previewReady) return; // idempoten: satu pratinjau per versi
    if (!Number.isInteger(p.bytes) || typeof p.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sha256)) throw new RoomError("UPLOAD_MISMATCH");
    const key = resultPreviewKey(this.roomId, s.sessionId);
    await verifyResultPreview(storage, key, { bytes: p.bytes as number, sha256: p.sha256 }, RESULT_PREVIEW_MAX_BYTES, RESULT_PREVIEW_MAX_PX);
    const version = s.result!.version;
    await this.run(async () => {
      this.assertOpen();
      await this.commit((draft, emit) => {
        const d = draft.sessions[s.sessionId];
        if (!d?.result || d.result.version !== version || d.state !== "FINAL") throw new RoomError("TOO_LATE");
        d.result.previewReady = true;
        d.result.previewKey = key;
        emitSessionState(draft, emit, d);
      });
    });
    const rec = this.renderReq.get(s.sessionId);
    if (rec?.timer) clearTimeout(rec.timer);
    this.renderReq.delete(s.sessionId);
  }

  /** `gallery.get` → GalleryView (hanya yang ACCEPTED; signed URL ≤ 10 menit). */
  private async galleryGet(participantId: string) {
    this.requireMember(participantId);
    const storage = this.deps.storage;
    if (!storage) throw new RoomError("SERVICE_UNAVAILABLE");
    // Pratinjau yang belum ada (mis. finalizer putus / restart): minta render lagi, mulai dari peserta yang membuka galeri.
    for (const sess of Object.values(this.state.sessions)) {
      const r = sess.result;
      if (sess.state === "FINAL" && r && !r.previewReady && !this.renderReq.has(sess.sessionId)) this.requestRender(sess.sessionId, r.version, participantId);
    }
    return buildGallery(this.state, storage, Date.now());
  }

  /** `asset.urls {keys}` → hanya key milik room ini yang dikenal state (tidak pernah attempt REJECTED / room lain). */
  private async assetUrls(participantId: string, payload: unknown) {
    this.requireMember(participantId);
    const storage = this.deps.storage;
    if (!storage) throw new RoomError("SERVICE_UNAVAILABLE");
    const keys = (payload as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(keys) || keys.length > 50 || keys.some((k) => typeof k !== "string" || k.length > 300)) throw new RoomError("BAD_REQUEST");
    const allowed = allowedAssetKeys(this.state);
    const expiresAtMs = Date.now() + URL_TTL_SEC * 1000;
    const urls: Record<string, { url: string; expiresAtMs: number }> = {};
    for (const k of keys as string[]) if (allowed.has(k)) urls[k] = { url: await storage.presignGet(k, URL_TTL_SEC), expiresAtMs };
    return { urls };
  }

  /** Intent editor: peserta aktif + sesi dikenal; isi dokumen divalidasi di EditorHub. */
  private async editorIntent<T>(participantId: string, payload: unknown, fn: (sessionId: string) => Promise<T>): Promise<T> {
    this.assertOpen();
    const p = this.state.participants[participantId];
    if (!p || p.connection === "LEFT" || !this.conns.has(participantId)) throw new RoomError("NOT_CONNECTED");
    const sid = (payload as { sessionId?: unknown } | null)?.sessionId;
    if (typeof sid !== "string" || !this.state.sessions[sid]) throw new RoomError("NOT_IN_STUDIO");
    return fn(sid);
  }

  /** Awareness editor (volatile, tanpa seq): hanya dari peserta aktif; participantId ditetapkan server. */
  relayEditorAwareness(participantId: string, sessionId: string, state: unknown) {
    const p = this.state.participants[participantId];
    if (!this.isOpen || !p || p.connection === "LEFT" || !this.conns.has(participantId) || !this.state.sessions[sessionId]) return;
    this.editor.awareness(participantId, sessionId, state);
  }

  /** `attempt.prepare` → attempt + URL upload bertanda tangan terikat key, content-type, dan ukuran. */
  private async attemptPrepare(participantId: string, payload: unknown) {
    const storage = this.deps.storage;
    if (!storage) throw new RoomError("SERVICE_UNAVAILABLE");
    const prepared = await this.run(async () => {
      this.assertOpen();
      const p = this.state.participants[participantId];
      if (!p || p.connection === "LEFT" || !this.conns.has(participantId)) throw new RoomError("NOT_CONNECTED");
      const now = Date.now();
      let out!: ReturnType<typeof prepareAttempt>;
      await this.commit((draft, emit) => {
        out = prepareAttempt(draft, emit, participantId, payload, now, this.hasSocket);
      });
      return out;
    });
    const ttl = CAPTURE_CONFIG.uploadUrlTtlSec;
    const [preview, full] = await Promise.all([
      storage.presignPut(prepared.previewKey, { contentType: "image/jpeg", bytes: CAPTURE_CONFIG.maxPreviewBytes, expiresSec: ttl }),
      storage.presignPut(prepared.fullKey, { contentType: "image/jpeg", bytes: CAPTURE_CONFIG.maxFullBytes, expiresSec: ttl }),
    ]);
    return {
      attemptId: prepared.attemptId,
      uploadUrls: { preview, full },
      maxBytes: { preview: CAPTURE_CONFIG.maxPreviewBytes, full: CAPTURE_CONFIG.maxFullBytes },
      expiresInSec: ttl,
    };
  }

  /**
   * `attempt.uploaded`: verifikasi objek di storage DI LUAR antrean actor (decode gambar tidak boleh
   * menahan mutasi room), lalu commit bagian itu. Idempoten pada (attemptId, part, sha256).
   */
  private async attemptUploaded(participantId: string, payload: unknown): Promise<void> {
    const storage = this.deps.storage;
    if (!storage) throw new RoomError("SERVICE_UNAVAILABLE");
    const claim = parseUploadClaim(payload);
    const pre = await this.run(() => {
      this.assertOpen();
      const p = this.state.participants[participantId];
      if (!p || p.connection === "LEFT" || !this.conns.has(participantId)) throw new RoomError("NOT_CONNECTED");
      return uploadPrecheck(this.state, participantId, claim);
    });
    if (pre.already) return;
    const { finalBytes, edit } = await verifyAttemptUpload(storage, { key: pre.key, editKey: pre.editKey, part: claim.part, bytes: claim.bytes, width: claim.width, height: claim.height, sha256: claim.sha256 });
    await this.run(async () => {
      this.assertOpen();
      const now = Date.now();
      await this.commit((draft, emit) => commitUploadPart(draft, emit, participantId, { ...claim, finalBytes, edit }, now));
    });
  }

  /** Colek (DEC-080): notifikasi lembut volatile; tidak mengubah state; 1× per 20 detik per pengirim. */
  private nudge(participantId: string, payload: unknown): Promise<void> {
    const p = (payload ?? {}) as { participantId?: unknown };
    const target = typeof p.participantId === "string" ? this.state.participants[p.participantId] : undefined;
    const from = this.state.participants[participantId];
    if (!from || from.connection === "LEFT" || !this.conns.has(participantId)) return Promise.reject(new RoomError("NOT_CONNECTED"));
    if (!target || target.connection === "LEFT" || target.participantId === participantId) return Promise.reject(new RoomError("BAD_REQUEST"));
    const now = Date.now();
    if (now - (this.nudgedAt.get(participantId) ?? 0) < CAPTURE_CONFIG.nudgeIntervalMs) return Promise.reject(new RoomError("RATE_LIMITED"));
    this.nudgedAt.set(participantId, now);
    this.conns.get(target.participantId)?.send({ type: "nudge", atMs: now, payload: { from: participantId } });
    return Promise.resolve();
  }

  /** Hapus objek attempt yang tidak dipakai setelah shot DONE (DEC-029); gagal → dicoba lagi oleh sweeper. */
  purgeRejected(): Promise<void> {
    return this.run(async () => {
      const storage = this.deps.storage;
      if (!storage || !this.isOpen) return;
      const list = purgeCandidates(this.state);
      if (!list.length) return;
      const keys = list.flatMap((a) => [a.previewKey, a.fullKey, a.editKey]).filter((k): k is string => !!k);
      try {
        await storage.deleteMany(keys);
      } catch (err) {
        log.warn("capture.purge_failed", { roomId: this.roomId, message: errText(err) });
        return;
      }
      const ids = list.map((a) => a.attemptId);
      await this.commit((draft) => markPurged(draft, ids));
    });
  }

  // ---------------------------------------------------------------- frame custom (P05, 10 §9)

  /** Presign upload: peserta aktif (bukan LEFT), tipe/ukuran deklarasi & kuota room diperiksa. */
  framePrepare(participantId: string, input: { fileName: unknown; contentType: unknown; bytes: unknown }): Promise<ServerFrame> {
    return this.run(async () => {
      this.assertOpen();
      const p = this.state.participants[participantId];
      if (!p || p.connection === "LEFT") throw new RoomError("AUTH_INVALID");
      let frame: ServerFrame | null = null;
      const now = Date.now();
      await this.commit((draft) => {
        expirePendingFrames(draft, now);
        frame = prepareFrame(draft, participantId, input, now);
      });
      return structuredClone(frame!);
    });
  }

  /** Salinan attempt (dengan key storage) milik room ini — untuk otorisasi signed URL. */
  attemptRecord(attemptId: string): Attempt | null {
    for (const s of Object.values(this.state.sessions)) {
      const a = s.capture?.attempts[attemptId];
      if (a) return structuredClone(a);
    }
    return null;
  }

  /** Attempt yang dipilih pemiliknya di shot yang sudah DONE (boleh dilihat penuh oleh semua peserta). */
  isAcceptedAttempt(attemptId: string): boolean {
    for (const s of Object.values(this.state.sessions)) {
      const a = s.capture?.attempts[attemptId];
      const shot = a ? s.capture!.shots.find((x) => x.index === a.shotIndex) : undefined;
      if (a && shot?.state === "DONE" && shot.perParticipant[a.ownerId]?.acceptedAttemptId === attemptId) return true;
    }
    return false;
  }

  /** Salinan record frame milik room (null bila tidak ada). */
  frameRecord(frameId: string): ServerFrame | null {
    const f = this.state.frames[frameId];
    return f ? structuredClone(f) : null;
  }

  frameReady(frameId: string, result: { objectKey: string; bytes: number; template: FrameTemplate }): Promise<void> {
    return this.run(async () => {
      this.assertOpen();
      await this.commit((draft, emit) => frameReady(draft, emit, frameId, result));
    });
  }

  /** Upload gagal validasi -> baris dihapus (objek dihapus pemanggil). */
  frameDiscard(frameId: string): Promise<void> {
    return this.run(async () => {
      if (!this.isOpen || this.state.frames[frameId]?.status !== "PENDING") return;
      await this.commit((draft) => void delete draft.frames[frameId]);
    });
  }

  /** Sweeper: upload PENDING kedaluwarsa -> key objek mentah yang harus dihapus dari storage. */
  expireFrameUploads(): Promise<string[]> {
    return this.run(async () => {
      if (!this.isOpen) return [];
      const now = Date.now();
      if (!Object.values(this.state.frames).some((f) => f.status === "PENDING" && (f.expiresAtMs ?? 0) <= now)) return [];
      let keys: string[] = [];
      await this.commit((draft) => void (keys = expirePendingFrames(draft, now)));
      return keys;
    });
  }

  /** Kunci struktur studio setelah shot pertama (DEC-065). Dipanggil alur capture P06. */
  lockStudioStructure(sessionId: string): Promise<void> {
    return this.run(async () => {
      this.assertOpen();
      await this.commit((draft, emit) => lockStructure(draft, emit, sessionId));
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
        dp.camera = "none";
        emit({ type: "participant.left", payload: { participantId } });
        this.applyRoomStatus(draft, emit, now);
        onPresenceChanged(draft, emit, participantId, this.connected(draft).filter((id) => id !== participantId), now, this.studioInit);
        onParticipantLeft(draft, emit, participantId, now);
      });
      this.clearConnectDeadline(participantId);
      const conn = this.conns.get(participantId);
      this.conns.delete(participantId);
      conn?.close(WS_CLOSE.LEFT, "left");
    });
  }

  /** Kursor volatile (07 §8): tidak disimpan, tidak masuk antrean, tanpa seq. */
  relayCursor(participantId: string, payload: CursorPayload) {
    if (!this.isOpen || !this.conns.has(participantId)) return;
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
      Promise.resolve(fn()).catch((err) => log.warn("room.timer_failed", { roomId: this.roomId, key, message: errText(err) }));
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
      if (key.startsWith("hold:") || key === "grace" || key.startsWith("lifetime") || key === "vote-closing" || key === "shot-t0" || key.startsWith("retake:")) {
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
    const active = this.state.activeSessionId ? this.state.sessions[this.state.activeSessionId] : null;
    if (active?.state === "VOTING" && active.voting.phase === "CLOSING" && active.voting.closingAtMs !== null) {
      // Jendela "Tutup vote" (DEC-023); dilanjutkan dari closingAtMs tersimpan setelah restart.
      this.setTimer("vote-closing", active.voting.closingAtMs - now, () =>
        this.run(async () => {
          const s = this.state.activeSessionId ? this.state.sessions[this.state.activeSessionId] : null;
          if (s?.voting.phase !== "CLOSING") return;
          if ((s.voting.closingAtMs ?? 0) > Date.now()) return this.reconcileTimers();
          await this.commit((draft, emit) => void closingExpired(draft, emit, Date.now(), this.studioInit));
        }),
      );
    }
    const shot = active?.state === "CAPTURING" && active.capture ? active.capture.shots[active.capture.shots.length - 1] : undefined;
    if (shot?.state === "COUNTDOWN" && shot.t0ServerMs !== null) {
      // T0 capture: dilanjutkan dari t0ServerMs tersimpan setelah restart (instance baru → REVIEW, 09 §18).
      this.setTimer("shot-t0", shot.t0ServerMs - now, () =>
        this.run(async () => {
          if (this.isOpen) await this.commit((draft, emit) => void processT0(draft, emit, Date.now(), this.hasSocket));
        }),
      );
    }
    if (shot?.state === "REVIEW") {
      for (const [pid, ps] of Object.entries(shot.perParticipant)) {
        if (ps.status !== "RETAKE_COUNTDOWN" || ps.retakeT0ServerMs === null) continue;
        this.setTimer(`retake:${pid}`, ps.retakeT0ServerMs - now, () =>
          this.run(async () => {
            if (this.isOpen) await this.commit((draft, emit) => void processRetakeT0(draft, emit, pid, Date.now(), this.hasSocket));
          }),
        );
      }
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
        dp.camera = "none";
        emit({ type: "participant.left", payload: { participantId } });
        onPresenceChanged(draft, emit, participantId, this.connected(draft), Date.now(), this.studioInit);
        onParticipantLeft(draft, emit, participantId, Date.now());
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

  /** Tulis snapshot dokumen editor yang belum tersimpan (shutdown/sweeper). Aman diulang. */
  flushEditors(): Promise<void> {
    return this.editor.flush();
  }

  get editorDirtyCount() {
    return this.editor.dirtyCount;
  }

  /** Hentikan semua timer (room selesai atau proses dimatikan). */
  dispose() {
    this.editor.dispose();
    for (const r of this.renderReq.values()) if (r.timer) clearTimeout(r.timer);
    this.renderReq.clear();
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
