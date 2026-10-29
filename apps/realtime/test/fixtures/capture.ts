import { createHash } from "node:crypto";
import sharp from "sharp";
import { vi } from "vitest";
import type { AttemptPrepared, CaptureState, S2C, SessionView, Shot } from "@longroll/shared";
import { RoomActor } from "../../src/room/RoomActor";
import type { ActorConfig } from "../../src/room/RoomActor";
import type { RoomConnection } from "../../src/room/types";
import { MemoryObjectStorage } from "../../src/storage/memory";
import { MemoryRoomStore } from "../../src/store/memory";

export const CAPTURE_TEST_CONFIG: ActorConfig = {
  graceSeconds: 120,
  holdSeconds: 60,
  maxLifetimeHours: null,
  connectDeadlineMs: 15_000,
  credentialTtlSeconds: 12 * 3600,
  credentialRotationGraceMs: 60_000,
};

export class TestConn implements RoomConnection {
  static n = 0;
  readonly id = `c${TestConn.n++}`;
  messages: S2C[] = [];
  send(m: S2C) {
    this.messages.push(m);
  }
  close() {}
  of(type: string) {
    return this.messages.filter((m) => m.type === type);
  }
}

/** JPEG uji (warna khas per `seed`), opsional dengan EXIF/GPS palsu untuk uji pembuangan metadata. */
export async function jpeg(w: number, h: number, seed: number, opts: { exif?: string } = {}): Promise<Buffer> {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: (seed * 29) % 256 } } }).jpeg({ quality: 90 });
  if (opts.exif) img = img.withMetadata({ exif: { IFD0: { ImageDescription: opts.exif } } });
  return img.toBuffer();
}

export const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export interface Person {
  id: string;
  name: string;
  conn: TestConn;
}

/** Room 1–4 peserta yang sudah di STUDIO (mode terkunci, kamera live, siap). */
export class CaptureRoom {
  readonly store = new MemoryRoomStore();
  readonly storage = new MemoryObjectStorage();
  actor!: RoomActor;
  people: Person[] = [];
  sid = "";
  private seed = 1;

  static async create(n: number, opts: { mode?: string; strategy?: "PER_SHOT_GROUP" | "PER_PARTICIPANT_SHOT"; shots?: number; roomId?: string } = {}) {
    const r = new CaptureRoom();
    r.actor = new RoomActor(RoomActor.createState(opts.roomId ?? "room-cap", "CAP222", CAPTURE_TEST_CONFIG), {
      store: r.store,
      config: CAPTURE_TEST_CONFIG,
      onExpiring: vi.fn(),
      storage: r.storage,
    });
    for (let i = 0; i < n; i++) {
      const j = await r.actor.join(`P${i + 1}`);
      const conn = new TestConn();
      await r.actor.attach(conn, j.participant.participantId, null);
      r.people.push({ id: j.participant.participantId, name: `P${i + 1}`, conn });
    }
    await r.actor.intent(r.people[0]!.id, "session.create", {});
    r.sid = r.session.sessionId;
    for (const p of r.people) await r.actor.intent(p.id, "vote.cast", { sessionId: r.sid, round: 1, mode: opts.mode ?? "PHOTO_STRIP" });
    if (opts.strategy || opts.shots) {
      const patch: Record<string, unknown> = {};
      if (opts.strategy) patch.bindingStrategy = opts.strategy;
      if (opts.shots) patch.shotCount = opts.shots;
      const ack = await r.actor.intent(r.people[0]!.id, "studio.update", { sessionId: r.sid, patch, baseVersion: 1 });
      if (!ack.ok) throw new Error(`studio.update gagal: ${JSON.stringify(ack)}`);
    }
    for (const p of r.people) await r.actor.intent(p.id, "presence.set", { camera: "live", ready: true });
    return r;
  }

  get session(): SessionView {
    return this.actor.view().activeSession as SessionView;
  }
  get capture(): CaptureState {
    return this.session.capture!;
  }
  get shot(): Shot {
    return this.capture.shots[this.capture.shots.length - 1]!;
  }
  ps(p: Person) {
    return this.shot.perParticipant[p.id]!;
  }
  attempt(id: string) {
    return this.actor.attemptRecord(id)!;
  }

  arm(by: Person, shotIndex = this.capture?.shots.filter((s) => s.state === "DONE").length ?? 0, confirm = true) {
    return this.actor.intent(by.id, "shot.arm", { sessionId: this.sid, shotIndex, confirmNotReady: confirm });
  }
  /** Maju ke / melewati T0 shot aktif. */
  async passT0() {
    const t0 = this.shot.t0ServerMs!;
    await vi.advanceTimersByTimeAsync(Math.max(0, t0 - Date.now()) + 5);
  }
  async passRetakeT0(p: Person) {
    const t0 = this.ps(p).retakeT0ServerMs!;
    await vi.advanceTimersByTimeAsync(Math.max(0, t0 - Date.now()) + 5);
  }

  /** prepare + put + uploaded (preview lalu full). Mengembalikan attemptId. */
  async shoot(p: Person, kind: "shot" | "retake" | "makeup" = "shot", opts: { skipFull?: boolean; exif?: string; seed?: number } = {}) {
    const prep = await this.actor.intent(p.id, "attempt.prepare", { sessionId: this.sid, shotIndex: this.shot.index, kind });
    if (!prep.ok) throw new Error(`prepare gagal: ${JSON.stringify(prep)}`);
    const data = prep.data as AttemptPrepared;
    const seed = opts.seed ?? this.seed++;
    const rec = this.attempt(data.attemptId);
    const pv = await jpeg(320, 240, seed);
    const full = await jpeg(1280, 960, seed, { exif: opts.exif });
    await this.storage.put(rec.previewKey!, pv, "image/jpeg");
    const a1 = await this.actor.intent(p.id, "attempt.uploaded", { attemptId: data.attemptId, part: "preview", bytes: pv.byteLength, width: 320, height: 240, sha256: sha(pv), capturedAtServerMs: Date.now() });
    if (!a1.ok) throw new Error(`uploaded preview gagal: ${JSON.stringify(a1)}`);
    if (!opts.skipFull) {
      await this.storage.put(rec.fullKey!, full, "image/jpeg");
      const a2 = await this.actor.intent(p.id, "attempt.uploaded", { attemptId: data.attemptId, part: "full", bytes: full.byteLength, width: 1280, height: 960, sha256: sha(full), capturedAtServerMs: Date.now() });
      if (!a2.ok) throw new Error(`uploaded full gagal: ${JSON.stringify(a2)}`);
    }
    return data.attemptId;
  }

  accept(p: Person, attemptId: string) {
    return this.actor.intent(p.id, "capture.accept", { sessionId: this.sid, shotIndex: this.shot.index, attemptId });
  }
  retake(p: Person, attemptId?: string) {
    return this.actor.intent(p.id, "capture.retake", { sessionId: this.sid, shotIndex: this.shot.index, ...(attemptId ? { attemptId } : {}) });
  }

  /** Satu shot penuh: arm → T0 → semua wajib memotret & accept. Mengembalikan attemptId per peserta. */
  async fullShot(by: Person = this.people[0]!, who: Person[] = this.people): Promise<Record<string, string>> {
    const ack = await this.arm(by);
    if (!ack.ok) throw new Error(`arm gagal: ${JSON.stringify(ack)}`);
    await this.passT0();
    const out: Record<string, string> = {};
    for (const p of who) {
      out[p.id] = await this.shoot(p);
      const a = await this.accept(p, out[p.id]!);
      if (!a.ok) throw new Error(`accept gagal: ${JSON.stringify(a)}`);
    }
    return out;
  }

  async reconnect(p: Person) {
    p.conn = new TestConn();
    await this.actor.attach(p.conn, p.id, null);
  }
}
