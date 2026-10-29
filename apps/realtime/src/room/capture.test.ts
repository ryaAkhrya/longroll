import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptedForCell } from "@longroll/shared";
import { CaptureRoom, jpeg, sha, TestConn } from "../../test/fixtures/capture";
import { RoomActor } from "./RoomActor";
import { CAPTURE_TEST_CONFIG } from "../../test/fixtures/capture";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
afterEach(() => vi.useRealTimers());

describe("P06 arm / countdown / hold", () => {
  it("arm oleh siapa pun: shot.countdown ke semua klien dengan t0 = server now + durasi bersama; sesi CAPTURING; struktur terkunci (AC-P06-12)", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    const now = Date.now();
    expect(await r.arm(c)).toEqual({ ok: true });
    expect(r.session.state).toBe("CAPTURING");
    expect(r.shot).toMatchObject({ state: "COUNTDOWN", armedBy: c.id, countdownSec: 5, required: expect.arrayContaining([a.id, b.id, c.id]) });
    expect(r.shot.t0ServerMs).toBe(now + 5000);
    for (const p of r.people) expect(p.conn.of("shot.countdown")[0]!.payload).toMatchObject({ shotIndex: 0, t0ServerMs: now + 5000, initiatedBy: c.id });
    expect(r.session.studio!.structureLocked).toBe(true);
    const bad = await r.actor.intent(a.id, "studio.update", { sessionId: r.sid, patch: { shotCount: 2 }, baseVersion: 1 });
    expect(bad).toMatchObject({ ok: false, error: "STRUCTURE_LOCKED" });
    // Frame / filter / timer tetap boleh saat CAPTURING.
    expect(await r.actor.intent(a.id, "studio.update", { sessionId: r.sid, patch: { style: { filterPreset: "MONO" } } })).toEqual({ ok: true });
  });

  it("validasi arm: ALREADY_ARMED, CONFIRM_REQUIRED (belum siap), NOT_REQUIRED (tak ada kamera live), shotIndex salah", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b] = r.people as [typeof r.people[0], typeof r.people[0]];
    await r.actor.intent(b.id, "presence.set", { ready: false });
    expect(await r.arm(a, 0, false)).toMatchObject({ ok: false, error: "CONFIRM_REQUIRED", detail: { notReady: 1 } });
    expect(await r.arm(a, 0, true)).toEqual({ ok: true });
    expect(await r.arm(b, 0)).toMatchObject({ ok: false, error: "ALREADY_ARMED" });
    const r2 = await CaptureRoom.create(2);
    for (const p of r2.people) await r2.actor.intent(p.id, "presence.set", { camera: "off" });
    expect(await r2.arm(r2.people[0]!, 0)).toMatchObject({ ok: false, error: "NOT_REQUIRED" });
    const r3 = await CaptureRoom.create(2);
    expect(await r3.arm(r3.people[0]!, 9)).toMatchObject({ ok: false, error: "SHOT_DONE" });
    expect(await r3.arm(r3.people[0]!, 2)).toMatchObject({ ok: false, error: "BAD_REQUEST" }); // melompat shot
  });

  it("AC-P06-2: Tunggu! oleh siapa pun sebelum T0 membatalkan untuk semua; setelah T0 → TOO_LATE", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b] = r.people as [typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await r.actor.intent(b.id, "shot.hold", { sessionId: r.sid, shotIndex: 0 })).toEqual({ ok: true });
    expect(r.shot.state).toBe("IDLE");
    for (const p of r.people) expect(p.conn.of("shot.cancelled")[0]!.payload).toMatchObject({ by: b.id });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.shot.state).toBe("IDLE"); // timer T0 lama tidak menghidupkan shot yang dibatalkan
    expect(await r.arm(b)).toEqual({ ok: true }); // arm ulang boleh
    await r.passT0();
    expect(r.shot.state).toBe("REVIEW");
    expect(await r.actor.intent(a.id, "shot.hold", { sessionId: r.sid, shotIndex: 0 })).toMatchObject({ ok: false, error: "TOO_LATE" });
    expect(r.shot.state).toBe("REVIEW");
  });

  it("T0: wajib terhubung → CAPTURING; peserta tanpa kamera → NOT_REQUIRED; putus saat countdown → MISSING (EC-05, EC-12)", async () => {
    const r = await CaptureRoom.create(4);
    const [a, b, c, d] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.actor.intent(d.id, "presence.set", { camera: "none" });
    await r.arm(a);
    expect(r.shot.required).not.toContain(d.id);
    await r.actor.detach(c.conn, c.id);
    await r.passT0();
    expect(r.ps(a).status).toBe("CAPTURING");
    expect(r.ps(b).status).toBe("CAPTURING");
    expect(r.ps(c).status).toBe("MISSING");
    expect(r.ps(d).status).toBe("NOT_REQUIRED");
  });

  it("countdown bersama bisa 3/5/10 detik (DEC-027); nilai lain ditolak", async () => {
    const r = await CaptureRoom.create(2);
    expect(await r.actor.intent(r.people[0]!.id, "studio.update", { sessionId: r.sid, patch: { countdownSec: 7 } })).toMatchObject({ ok: false, error: "INVALID_PATCH" });
    expect(await r.actor.intent(r.people[1]!.id, "studio.update", { sessionId: r.sid, patch: { countdownSec: 10 } })).toEqual({ ok: true });
    const now = Date.now();
    await r.arm(r.people[0]!);
    expect(r.shot.t0ServerMs).toBe(now + 10_000);
  });
});

describe("P06 upload & verifikasi (AC-P06-9)", () => {
  it("prepare mengembalikan URL PUT terikat key/content-type/ukuran; uploaded memverifikasi objek, strip EXIF, preview → DECIDING, full → READY", async () => {
    const r = await CaptureRoom.create(2);
    const [a, b] = r.people as [typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    const prep = await r.actor.intent(a.id, "attempt.prepare", { sessionId: r.sid, shotIndex: 0, kind: "shot" });
    expect(prep).toMatchObject({ ok: true, data: { maxBytes: { preview: 400 * 1024, full: 8 * 1024 * 1024 } } });
    const id = (prep.data as { attemptId: string }).attemptId;
    expect(r.ps(a).status).toBe("UPLOADING");
    const rec = r.attempt(id);
    expect(rec.previewKey).toMatch(/^rooms\/room-cap\/attempts\/.+\/preview\.jpg$/);

    const full = await jpeg(1280, 960, 7, { exif: "LOKASI-RAHASIA-GPS" });
    expect(full.includes(Buffer.from("LOKASI-RAHASIA-GPS"))).toBe(true);
    const pv = await jpeg(320, 240, 7);
    await r.storage.put(rec.previewKey!, pv, "image/jpeg");
    expect(await r.actor.intent(a.id, "attempt.uploaded", { attemptId: id, part: "preview", bytes: pv.byteLength, width: 320, height: 240, sha256: sha(pv), capturedAtServerMs: Date.now() })).toEqual({ ok: true });
    expect(r.ps(a).status).toBe("DECIDING");
    expect(r.attempt(id).status).toBe("UPLOADING");
    // accept menunggu full READY
    expect(await r.accept(a, id)).toMatchObject({ ok: false, error: "UPLOAD_MISMATCH", reason: "NOT_READY" });
    await r.storage.put(rec.fullKey!, full, "image/jpeg");
    const claim = { attemptId: id, part: "full", bytes: full.byteLength, width: 1280, height: 960, sha256: sha(full), capturedAtServerMs: Date.now() };
    expect(await r.actor.intent(a.id, "attempt.uploaded", claim)).toEqual({ ok: true });
    expect(r.attempt(id).status).toBe("READY");
    const stored = Buffer.from((await r.storage.get(rec.fullKey!, 1e9))!);
    expect(stored.includes(Buffer.from("LOKASI-RAHASIA-GPS"))).toBe(false); // metadata dibuang
    expect(stored[0]).toBe(0xff);
    expect(r.capture.bytesUsed).toBeGreaterThan(0);
    // idempoten pada (attemptId, part, sha256); sha berbeda → UPLOAD_MISMATCH (SY-05)
    expect(await r.actor.intent(a.id, "attempt.uploaded", claim)).toEqual({ ok: true });
    expect(await r.actor.intent(a.id, "attempt.uploaded", { ...claim, sha256: "0".repeat(64) })).toMatchObject({ ok: false, error: "UPLOAD_MISMATCH" });
    // peserta lain melihat attempt.ready tanpa key storage
    expect(b.conn.of("attempt.ready").length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(r.actor.view())).not.toContain("previewKey");
    expect(JSON.stringify(b.conn.messages)).not.toContain("attempts/");
  });

  it("verifikasi menolak: objek tak ada, sha salah, ukuran beda, bukan JPEG, dimensi dusta, melebihi batas; attempt.fail → FAILED + makeup", async () => {
    const r = await CaptureRoom.create(2);
    const [a, b] = r.people as [typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    const prep = await r.actor.intent(a.id, "attempt.prepare", { sessionId: r.sid, shotIndex: 0, kind: "shot" });
    const id = (prep.data as { attemptId: string }).attemptId;
    const rec = r.attempt(id);
    const pv = await jpeg(320, 240, 3);
    const up = (over: Record<string, unknown> = {}) =>
      r.actor.intent(a.id, "attempt.uploaded", { attemptId: id, part: "preview", bytes: pv.byteLength, width: 320, height: 240, sha256: sha(pv), capturedAtServerMs: Date.now(), ...over });
    expect(await up()).toMatchObject({ ok: false, error: "UPLOAD_MISMATCH", reason: "MISSING" });
    await r.storage.put(rec.previewKey!, pv, "image/jpeg");
    expect(await up({ sha256: "a".repeat(64) })).toMatchObject({ ok: false, reason: "SHA256" });
    expect(await up({ bytes: pv.byteLength + 1 })).toMatchObject({ ok: false, reason: "SIZE" });
    expect(await up({ width: 100 })).toMatchObject({ ok: false, reason: "DIMENSIONS" });
    expect(await up({ width: 5000 })).toMatchObject({ ok: false, error: "UPLOAD_MISMATCH" });
    expect(await up({ part: "bukan" })).toMatchObject({ ok: false, error: "UPLOAD_MISMATCH" });
    const png = Buffer.from("PNG fiktif bukan jpeg".repeat(20));
    await r.storage.put(rec.previewKey!, png, "image/jpeg");
    expect(await up({ bytes: png.byteLength, sha256: sha(png) })).toMatchObject({ ok: false, reason: "FORMAT" });
    expect(r.ps(a).status).toBe("UPLOADING");
    // Klien menyerah (3× gagal): FAILED terlihat peserta lain; "Coba lagi" = countdown individual, peserta lain tak tersentuh.
    const bBefore = JSON.stringify(r.ps(b));
    expect(await r.actor.intent(a.id, "attempt.fail", { attemptId: id })).toEqual({ ok: true });
    expect(r.ps(a).status).toBe("FAILED");
    expect(r.attempt(id).status).toBe("FAILED");
    expect(await r.actor.intent(a.id, "attempt.uploaded", { attemptId: id, part: "preview", bytes: pv.byteLength, width: 320, height: 240, sha256: sha(pv) })).toMatchObject({ ok: false, error: "ATTEMPT_REJECTED" });
    expect(await r.retake(a)).toEqual({ ok: true });
    expect(r.ps(a).status).toBe("RETAKE_COUNTDOWN");
    await r.passRetakeT0(a);
    expect(r.ps(a).status).toBe("CAPTURING");
    const id2 = await r.shoot(a, "makeup");
    expect(r.ps(a)).toMatchObject({ status: "DECIDING", currentAttemptId: id2 });
    expect(JSON.stringify(r.ps(b))).toBe(bBefore);
  });

  it("peserta lain tidak bisa mengunggah ke attempt orang lain; prepare ditolak bila bukan CAPTURING / bukan wajib", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.actor.intent(c.id, "presence.set", { camera: "off" });
    await r.arm(a);
    expect(await r.actor.intent(a.id, "attempt.prepare", { sessionId: r.sid, shotIndex: 0 })).toMatchObject({ ok: false, error: "TOO_LATE" }); // sebelum T0
    await r.passT0();
    expect(await r.actor.intent(c.id, "attempt.prepare", { sessionId: r.sid, shotIndex: 0 })).toMatchObject({ ok: false, error: "NOT_REQUIRED" });
    const id = await r.shoot(a);
    const pv = await jpeg(320, 240, 1);
    expect(await r.actor.intent(b.id, "attempt.uploaded", { attemptId: id, part: "preview", bytes: pv.byteLength, width: 320, height: 240, sha256: sha(pv) })).toMatchObject({ ok: false, error: "FORBIDDEN_NOT_OWNER" });
    expect(await r.actor.intent(a.id, "attempt.prepare", { sessionId: r.sid, shotIndex: 0 })).toMatchObject({ ok: false, error: "TOO_LATE" }); // sudah DECIDING
  });

  it("prepare ulang saat UPLOADING memakai attempt yang sama (retry setelah URL kedaluwarsa)", async () => {
    const r = await CaptureRoom.create(2);
    const a = r.people[0]!;
    await r.arm(a);
    await r.passT0();
    const p1 = await r.actor.intent(a.id, "attempt.prepare", { sessionId: r.sid, shotIndex: 0 });
    const p2 = await r.actor.intent(a.id, "attempt.prepare", { sessionId: r.sid, shotIndex: 0 });
    expect((p2.data as { attemptId: string }).attemptId).toBe((p1.data as { attemptId: string }).attemptId);
    expect(r.ps(a).attempts).toHaveLength(1);
  });

  it("DEC-085: batas storage room → ROOM_STORAGE_LIMIT", async () => {
    const r = await CaptureRoom.create(2);
    await r.arm(r.people[0]!);
    await r.passT0();
    const state = r.actor.snapshot();
    void state;
    // Sesi dimuat ulang dengan bytesUsed hampir penuh.
    r.actor.dispose();
    const saved = (await r.store.loadRoom("room-cap"))!;
    saved.state.sessions[saved.state.activeSessionId!]!.capture!.bytesUsed = 1024 * 1024 * 1024 - 1000;
    const actor2 = new RoomActor(saved.state, { store: r.store, config: CAPTURE_TEST_CONFIG, onExpiring: vi.fn(), storage: r.storage }, saved.events);
    for (const p of r.people) await actor2.attach(new TestConn(), p.id, null);
    r.actor = actor2;
    await r.passT0().catch(() => undefined);
    expect(await actor2.intent(r.people[0]!.id, "attempt.prepare", { sessionId: r.sid, shotIndex: 0 })).toMatchObject({ ok: false, error: "ROOM_STORAGE_LIMIT" });
  });
});

describe("P06 accept / retake independen (AC-P06-4..6, 11)", () => {
  it("INVARIANT: A retake 3× → B,C,D: acceptedAttemptId sama, byte foto identik, tanpa retake.started/countdown, status tidak berubah", async () => {
    const r = await CaptureRoom.create(4);
    const [a, b, c, d] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.arm(b);
    await r.passT0();
    const first: Record<string, string> = {};
    for (const p of [a, b, c, d]) first[p.id] = await r.shoot(p);
    for (const p of [b, c, d]) expect(await r.accept(p, first[p.id]!)).toEqual({ ok: true });

    const snap = async (p: typeof a) => {
      const rec = r.attempt(first[p.id]!);
      return {
        accepted: r.ps(p).acceptedAttemptId,
        state: JSON.stringify(r.ps(p)),
        previewSha: sha((await r.storage.get(rec.previewKey!, 1e9))!),
        fullSha: sha((await r.storage.get(rec.fullKey!, 1e9))!),
      };
    };
    const before = { b: await snap(b), c: await snap(c), d: await snap(d) };
    const eventsBefore = [b, c, d].map((p) => p.conn.of("retake.started").length);
    expect([b, c, d].map((p) => r.ps(p).status)).toEqual(["ACCEPTED", "ACCEPTED", "ACCEPTED"]);

    let prev = first[a.id]!;
    for (let i = 0; i < 3; i++) {
      expect(await r.retake(a, prev)).toEqual({ ok: true });
      expect(r.ps(a).status).toBe("RETAKE_COUNTDOWN");
      await r.passRetakeT0(a);
      expect(r.ps(a).status).toBe("CAPTURING");
      prev = await r.shoot(a, "retake");
      expect(r.attempt(prev).attemptNo).toBe(i + 2);
    }
    expect(r.ps(a).attempts).toHaveLength(4);
    expect(r.ps(a).acceptedAttemptId).toBeNull(); // A belum memutuskan: tidak ada auto-accept

    const after = { b: await snap(b), c: await snap(c), d: await snap(d) };
    expect(after).toEqual(before);
    // Tidak ada countdown retake / event retake.started yang menyasar atau mengubah mereka; yang lain MELIHAT retake A (AC-P06-5).
    for (const p of [b, c, d]) {
      const started = p.conn.of("retake.started");
      expect(started.length - eventsBefore[[b, c, d].indexOf(p)]!).toBe(3);
      expect(started.every((m) => (m.payload as { participantId: string }).participantId === a.id)).toBe(true);
      expect(r.ps(p).retakeT0ServerMs).toBeNull();
    }
    expect(a.conn.of("retake.started")).toHaveLength(3);
    // Foto A yang ditolak tetap terlihat selama shot aktif (preview ada, tidak purged).
    for (const id of r.ps(a).attempts.slice(0, 3)) expect(r.attempt(id)).toMatchObject({ status: "REJECTED", purged: false });
    expect(r.shot.state).toBe("REVIEW");
  });

  it("AC-P06-6: accept/retake attempt orang lain ditolak FORBIDDEN_NOT_OWNER; state tidak berubah (TC-SEC-014)", async () => {
    const r = await CaptureRoom.create(2);
    const [a, b] = r.people as [typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    const ida = await r.shoot(a);
    await r.shoot(b);
    const before = JSON.stringify(r.capture);
    expect(await r.accept(b, ida)).toMatchObject({ ok: false, error: "FORBIDDEN_NOT_OWNER" });
    expect(await r.retake(b, ida)).toMatchObject({ ok: false, error: "FORBIDDEN_NOT_OWNER" });
    expect(await r.actor.intent(b.id, "capture.reopen", { sessionId: r.sid, shotIndex: 0 })).toEqual({ ok: true }); // reopen hanya menyentuh status B sendiri (sudah DECIDING)
    expect(JSON.stringify(r.capture)).toBe(before);
    expect(r.ps(a).status).toBe("DECIDING");
  });

  it("accept idempoten; SY-06: accept attempt yang sudah di-Ulang ditolak ATTEMPT_REJECTED", async () => {
    const r = await CaptureRoom.create(2);
    const [a, b] = r.people as [typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    const ida = await r.shoot(a);
    await r.shoot(b);
    expect(await r.accept(a, ida)).toEqual({ ok: true });
    expect(await r.accept(a, ida)).toEqual({ ok: true });
    expect(r.ps(a).acceptedAttemptId).toBe(ida);
    await r.actor.intent(a.id, "capture.reopen", { sessionId: r.sid, shotIndex: 0 });
    expect(r.ps(a)).toMatchObject({ status: "DECIDING", acceptedAttemptId: ida }); // foto tidak hilang saat ganti pilihan (AC-P06-11)
    expect(await r.retake(a, ida)).toEqual({ ok: true });
    expect(r.ps(a).acceptedAttemptId).toBeNull();
    expect(await r.accept(a, ida)).toMatchObject({ ok: false, error: "ATTEMPT_REJECTED" });
    expect(await r.retake(a, ida)).toEqual({ ok: true }); // idempoten
  });

  it("AC-P06-8: diam 10 menit TIDAK mengubah status ke ACCEPTED dan shot tidak maju", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    const ids = [await r.shoot(a), await r.shoot(b), await r.shoot(c)];
    await r.accept(a, ids[0]!);
    await r.accept(b, ids[1]!);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(r.ps(c)).toMatchObject({ status: "DECIDING", acceptedAttemptId: null });
    expect(r.shot.state).toBe("REVIEW");
    expect(r.session.state).toBe("CAPTURING");
    expect(JSON.stringify(r.capture)).not.toMatch(/auto/i);
  });

  it("Colek: volatile ke target, tak mengubah state, maks 1× / 20 detik per pengirim (DEC-080)", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    const rev = r.actor.snapshot().revision;
    expect(await r.actor.intent(a.id, "nudge", { participantId: c.id })).toEqual({ ok: true });
    expect(c.conn.of("nudge")[0]!.payload).toEqual({ from: a.id });
    expect(b.conn.of("nudge")).toHaveLength(0);
    expect(await r.actor.intent(a.id, "nudge", { participantId: b.id })).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await r.actor.intent(a.id, "nudge", { participantId: b.id })).toEqual({ ok: true });
    expect(await r.actor.intent(a.id, "nudge", { participantId: a.id })).toMatchObject({ ok: false });
    expect(r.actor.snapshot().revision).toBe(rev);
  });
});

describe("P06 maju shot, skip, putus (AC-P06-7)", () => {
  it("shot maju hanya saat semua wajib ACCEPTED; DONE → banner event; slot accepted per sel (kedua strategi)", async () => {
    for (const strategy of ["PER_SHOT_GROUP", "PER_PARTICIPANT_SHOT"] as const) {
      const r = await CaptureRoom.create(3, { strategy, shots: 2 });
      const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
      const s0 = await r.fullShot(a);
      expect(r.capture.shots[0]!.state).toBe("DONE");
      expect(r.session.state).toBe("CAPTURING");
      for (const p of r.people) expect(p.conn.of("shot.done")[0]!.payload).toMatchObject({ shotIndex: 0, last: false });
      // Binding: foto accepted per (shot, slot) — identik untuk kedua strategi; tampil beda hanya di slot.
      expect(acceptedForCell(r.capture, 0, "P1")).toBe(s0[a.id]);
      expect(acceptedForCell(r.capture, 0, "P3")).toBe(s0[c.id]);
      expect(r.session.studio!.bindingStrategy).toBe(strategy);
      expect(r.session.studio!.layout.slots).toHaveLength(strategy === "PER_SHOT_GROUP" ? 2 : 6);
      // SY-08 / DONE: shot yang sudah selesai tidak bisa diubah lagi (retake/reopen → SHOT_DONE).
      expect(await r.actor.intent(a.id, "capture.retake", { sessionId: r.sid, shotIndex: 0, attemptId: s0[a.id] })).toMatchObject({ ok: false, error: "SHOT_DONE" });
      expect(await r.actor.intent(a.id, "capture.reopen", { sessionId: r.sid, shotIndex: 0 })).toMatchObject({ ok: false, error: "SHOT_DONE" });
      // Shot 2: tidak bisa arm dua kali / melompat
      expect(await r.arm(b, 0)).toMatchObject({ ok: false, error: "SHOT_DONE" });
      expect(await r.arm(b, 1)).toEqual({ ok: true });
      expect(r.shot.index).toBe(1);
      await r.passT0();
      void c;
    }
  });

  it("AC-P06-13 (non-browser): 2 retake dari peserta berbeda lalu final shot → sesi EDITING; rejected dihapus, accepted tersisa", async () => {
    const r = await CaptureRoom.create(4, { shots: 2 });
    const [a, b, c, d] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.fullShot(a);
    // Shot 2 dengan retake oleh B dan D
    await r.arm(c);
    await r.passT0();
    const first: Record<string, string> = {};
    for (const p of [a, b, c, d]) first[p.id] = await r.shoot(p);
    await r.accept(a, first[a.id]!);
    await r.accept(c, first[c.id]!);
    const aSnap = JSON.stringify(r.ps(a));
    for (const p of [b, d]) {
      expect(await r.retake(p, first[p.id])).toEqual({ ok: true });
      await r.passRetakeT0(p);
      first[p.id + "2"] = await r.shoot(p, "retake");
    }
    expect(JSON.stringify(r.ps(a))).toBe(aSnap);
    await r.accept(b, first[b.id + "2"]!);
    expect(r.shot.state).toBe("REVIEW");
    await r.accept(d, first[d.id + "2"]!);
    expect(r.shot.state).toBe("DONE");
    expect(r.session.state).toBe("EDITING");
    for (const p of r.people) expect(p.conn.of("shot.done").at(-1)!.payload).toMatchObject({ shotIndex: 1, last: true });
    // Hapus attempt REJECTED (AC-P06-10): objek hilang, accepted tetap ada
    await vi.advanceTimersByTimeAsync(10);
    const rejected = [first[b.id]!, first[d.id]!].map((id) => r.attempt(id));
    for (const rec of rejected) {
      expect(await r.storage.size(rec.previewKey!)).toBeNull();
      expect(await r.storage.size(rec.fullKey!)).toBeNull();
      expect(rec.purged).toBe(true);
    }
    for (const id of [first[a.id], first[c.id], first[b.id + "2"], first[d.id + "2"]]) {
      const rec = r.attempt(id!);
      expect(await r.storage.size(rec.previewKey!)).not.toBeNull();
      expect(rec.purged).toBe(false);
    }
    // Setelah EDITING tidak ada mutasi capture lagi: daftar accepted terkunci.
    expect(await r.retake(b, first[b.id + "2"])).toMatchObject({ ok: false, error: "NOT_IN_STUDIO" });
    expect(await r.actor.intent(b.id, "capture.reopen", { sessionId: r.sid, shotIndex: 1 })).toMatchObject({ ok: false, error: "NOT_IN_STUDIO" });
    const objects = await r.storage.list("rooms/room-cap/attempts/");
    expect(objects).toHaveLength(24); // 8 attempt accepted × (preview + full + edit); semua REJECTED sudah dihapus
  });

  it("peserta wajib putus: shot menunggu; skip sebelum 15 detik ditolak; setelahnya SKIPPED & shot maju; kembali sebelum DONE → Ambil fotomu", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    const ia = await r.shoot(a);
    const ib = await r.shoot(b);
    await r.accept(a, ia);
    await r.accept(b, ib);
    await r.actor.detach(c.conn, c.id);
    const skip = () => r.actor.intent(a.id, "shot.skip", { sessionId: r.sid, shotIndex: 0, participantId: c.id });
    expect(await skip()).toMatchObject({ ok: false, error: "SKIP_NOT_ALLOWED" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await skip()).toMatchObject({ ok: false, error: "SKIP_NOT_ALLOWED" });
    expect(r.shot.state).toBe("REVIEW");
    expect(await r.actor.intent(a.id, "shot.skip", { sessionId: r.sid, shotIndex: 0, participantId: b.id })).toMatchObject({ ok: false, error: "SKIP_NOT_ALLOWED" }); // terhubung
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await skip()).toEqual({ ok: true });
    expect(r.ps(c).status).toBe("SKIPPED");
    expect(r.shot.state).toBe("DONE");
    expect(r.ps(a).acceptedAttemptId).toBe(ia);
  });

  it("MISSING yang kembali sebelum shot maju → 'Ambil fotomu' (retake tanpa attemptId) lalu bisa accept (EC-05)", async () => {
    const r = await CaptureRoom.create(2);
    const [a, b] = r.people as [typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.actor.detach(b.conn, b.id);
    await r.passT0();
    expect(r.ps(b).status).toBe("MISSING");
    await r.shoot(a).then((id) => r.accept(a, id));
    expect(r.shot.state).toBe("REVIEW");
    await r.reconnect(b);
    expect(await r.retake(b)).toEqual({ ok: true });
    await r.passRetakeT0(b);
    expect(r.ps(b).status).toBe("CAPTURING");
    const ib = await r.shoot(b, "makeup");
    expect(await r.accept(b, ib)).toEqual({ ok: true });
    expect(r.shot.state).toBe("DONE");
  });

  it("hold slot habis (LEFT) mengeluarkan peserta dari required dan shot maju (09 §10.1); semua keluar → shot batal", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    await r.shoot(a).then((id) => r.accept(a, id));
    await r.shoot(b).then((id) => r.accept(b, id));
    await r.actor.detach(c.conn, c.id);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(r.shot.required).not.toContain(c.id);
    expect(r.shot.state).toBe("DONE");
  });

  it("join terlambat saat CAPTURING bukan peserta wajib sesi ini (DEC-030)", async () => {
    const r = await CaptureRoom.create(2);
    await r.arm(r.people[0]!);
    const j = await r.actor.join("Telat");
    const conn = new TestConn();
    await r.actor.attach(conn, j.participant.participantId, null);
    await r.actor.intent(j.participant.participantId, "presence.set", { camera: "live", ready: true });
    await r.passT0();
    expect(r.shot.required).not.toContain(j.participant.participantId);
    expect(r.shot.perParticipant[j.participant.participantId]).toBeUndefined();
    expect(await r.actor.intent(j.participant.participantId, "attempt.prepare", { sessionId: r.sid, shotIndex: 0 })).toMatchObject({ ok: false, error: "NOT_REQUIRED" });
  });
});

describe("P06 reconnect & restart (AC-P06-14, TC-ROOM-020)", () => {
  it("putus saat countdown lalu kembali saat review: status & foto dipulihkan dari state", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await vi.advanceTimersByTimeAsync(2000);
    await r.actor.detach(b.conn, b.id);
    await r.passT0();
    expect(r.ps(b).status).toBe("MISSING");
    const ia = await r.shoot(a);
    await r.accept(a, ia);
    await r.reconnect(b);
    const view = r.actor.view().activeSession!;
    expect(view.capture!.shots[0]!.perParticipant[a.id]).toMatchObject({ status: "ACCEPTED", acceptedAttemptId: ia });
    expect(b.conn.messages.some((m) => m.type === "auth.ok")).toBe(true);
    // resume mengirim ulang event capture
    void c;
  });

  it("restart saat COUNTDOWN: T0 dilanjutkan dari t0ServerMs tersimpan → REVIEW; wajib tanpa koneksi → MISSING", async () => {
    const r = await CaptureRoom.create(3);
    await r.arm(r.people[0]!);
    const t0 = r.shot.t0ServerMs!;
    r.actor.dispose();
    await vi.advanceTimersByTimeAsync(7000);
    const saved = (await r.store.loadRoom("room-cap"))!;
    const actor2 = new RoomActor(saved.state, { store: r.store, config: CAPTURE_TEST_CONFIG, onExpiring: vi.fn(), storage: r.storage }, saved.events);
    await actor2.recover();
    await vi.advanceTimersByTimeAsync(50);
    const cap = actor2.view().activeSession!.capture!;
    expect(Date.now()).toBeGreaterThan(t0);
    expect(cap.shots[0]!.state).toBe("REVIEW");
    expect(Object.values(cap.shots[0]!.perParticipant).every((p) => p.status === "MISSING")).toBe(true);
  });

  it("restart saat REVIEW: accepted & attempt dipulihkan; retake countdown individual dilanjutkan; tidak ada auto-accept", async () => {
    const r = await CaptureRoom.create(3);
    const [a, b, c] = r.people as [typeof r.people[0], typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    const ia = await r.shoot(a);
    const ib = await r.shoot(b);
    await r.shoot(c);
    await r.accept(a, ia);
    await r.retake(b, ib);
    r.actor.dispose();
    const saved = (await r.store.loadRoom("room-cap"))!;
    const actor2 = new RoomActor(saved.state, { store: r.store, config: CAPTURE_TEST_CONFIG, onExpiring: vi.fn(), storage: r.storage }, saved.events);
    await actor2.recover();
    for (const p of r.people) await actor2.attach(new TestConn(), p.id, null);
    r.actor = actor2;
    expect(r.ps(a)).toMatchObject({ status: "ACCEPTED", acceptedAttemptId: ia });
    expect(r.ps(b).status).toBe("RETAKE_COUNTDOWN");
    await r.passRetakeT0(b);
    expect(r.ps(b).status).toBe("CAPTURING");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(r.ps(c).acceptedAttemptId).toBeNull();
    expect(r.shot.state).toBe("REVIEW");
  });
});

describe("P06 cleanup & invarian acak (AC-P06-4, TC-SEC-030)", () => {
  it("purge yang gagal dicoba lagi oleh sweeper; room bubar menghapus semua objek attempt (prefix room)", async () => {
    const r = await CaptureRoom.create(2);
    const [a, b] = r.people as [typeof r.people[0], typeof r.people[0]];
    await r.arm(a);
    await r.passT0();
    const a1 = await r.shoot(a);
    await r.shoot(b).then((id) => r.accept(b, id));
    await r.retake(a, a1);
    await r.passRetakeT0(a);
    const a2 = await r.shoot(a, "retake");
    r.storage.failNextDeletes = 1;
    await r.accept(a, a2);
    expect(r.shot.state).toBe("DONE");
    expect(r.attempt(a1).purged).toBe(false); // hapus gagal → belum purged
    expect(await r.storage.size(r.attempt(a1).fullKey!)).not.toBeNull();
    await r.actor.purgeRejected(); // sweeper
    expect(r.attempt(a1).purged).toBe(true);
    expect(await r.storage.size(r.attempt(a1).fullKey!)).toBeNull();
    expect(await r.storage.size(r.attempt(a2).fullKey!)).not.toBeNull();
    expect(r.capture.bytesUsed).toBeGreaterThan(0);
    const before = r.capture.bytesUsed;
    const bAcc = r.attempt(r.ps(b).acceptedAttemptId!);
    const sz = (x: { preview: { bytes: number } | null; full: { bytes: number } | null; edit?: { bytes: number } | null }) => x.preview!.bytes + x.full!.bytes + (x.edit?.bytes ?? 0);
    expect(before).toBe(sz(r.attempt(a2)) + sz(bAcc));
  });

  it("fuzz: urutan acak aksi 4 peserta TIDAK PERNAH mengubah acceptedAttemptId peserta lain (7 seed)", async () => {
    let ownChanges = 0;
    for (let seed = 1; seed <= 7; seed++) {
      let x = seed * 7919;
      const rnd = () => {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        return x / 0x7fffffff;
      };
      const r = await CaptureRoom.create(4, { shots: 3 });
      await r.arm(r.people[0]!);
      await r.passT0();
      const acceptedOf = () => Object.fromEntries(r.people.map((p) => [p.id, r.shot.perParticipant[p.id]?.acceptedAttemptId ?? null]));
      for (let step = 0; step < 60; step++) {
        if (r.shot.state === "DONE" || r.session.state === "EDITING") break;
        const actor = r.people[Math.floor(rnd() * 4)]!;
        const other = r.people[Math.floor(rnd() * 4)]!;
        const before = acceptedOf();
        const op = Math.floor(rnd() * 9);
        const ps = r.shot.perParticipant[actor.id];
        const cur = ps?.currentAttemptId ?? undefined;
        try {
          if (op === 0 && ps?.status === "CAPTURING") await r.shoot(actor);
          else if (op === 1 && cur) await r.accept(actor, cur);
          else if (op === 2 && cur) await r.retake(actor, cur);
          else if (op === 3) await r.actor.intent(actor.id, "capture.reopen", { sessionId: r.sid, shotIndex: r.shot.index });
          else if (op === 4 && other.id !== actor.id && other && r.shot.perParticipant[other.id]?.currentAttemptId) await r.accept(actor, r.shot.perParticipant[other.id]!.currentAttemptId!); // ilegal
          else if (op === 5 && other.id !== actor.id && r.shot.perParticipant[other.id]?.currentAttemptId) await r.retake(actor, r.shot.perParticipant[other.id]!.currentAttemptId!); // ilegal
          else if (op === 6) await r.retake(actor); // makeup tanpa attemptId
          else if (op === 7) await vi.advanceTimersByTimeAsync(Math.floor(rnd() * 8000));
          else if (op === 8) await r.actor.intent(actor.id, "shot.skip", { sessionId: r.sid, shotIndex: r.shot.index, participantId: other.id });
        } catch {
          /* kesalahan harness (mis. preseden status) tidak relevan: yang dicek adalah invarian */
        }
        const after = acceptedOf();
        if (after[actor.id] !== before[actor.id]) ownChanges++;
        for (const p of r.people) {
          if (p.id === actor.id) continue;
          expect(after[p.id], `seed ${seed} step ${step} op ${op}: milik ${p.name} berubah oleh ${actor.name}`).toBe(before[p.id]);
        }
        if (r.shot.state === "REVIEW" && Object.values(r.shot.perParticipant).some((q) => q.status === "RETAKE_COUNTDOWN") && rnd() < 0.5) await vi.advanceTimersByTimeAsync(6000);
      }
    }
    // Penjaga anti-vakum: fuzz benar-benar menjalankan accept/retake sah oleh pemiliknya.
    expect(ownChanges).toBeGreaterThan(10);
    // Terukur P10: ±4,4 dtk tanpa beban (sharp mendekode JPEG 1280×960 per percobaan) — 88% dari batas bawaan 5 dtk, sehingga
    // beban CPU sesaat (mis. browser E2E berjalan bersamaan) membuatnya time-out meski invarian benar (seed tetap, tak acak).
  }, 60_000);
});