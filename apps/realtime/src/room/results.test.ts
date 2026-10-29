import * as Y from "yjs";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSticker, docFromSnapshot, listElements } from "@longroll/shared";
import type { GalleryView, ResultPreviewPrepared } from "@longroll/shared";
import { CAPTURE_TEST_CONFIG, CaptureRoom, TestConn, jpeg, sha } from "../../test/fixtures/capture";
import type { Person } from "../../test/fixtures/capture";
import { RoomActor } from "./RoomActor";
import { docSnapshotKey, resultPreviewKey } from "./results";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
afterEach(() => vi.useRealTimers());

async function webp(w: number, h: number, seed = 1) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: seed * 40, g: 90, b: 150 } } }).webp({ quality: 80 }).toBuffer();
}

/** Sesi selesai: shot-shot DONE (dengan retake pada shot pertama oleh peserta ke-1) → EDITING. */
async function editingRoom(n = 3, shots = 2) {
  const r = await CaptureRoom.create(n, { shots });
  const a = r.people[0]!;
  await r.arm(a);
  await r.passT0();
  const first: Record<string, string> = {};
  for (const p of r.people) first[p.id] = await r.shoot(p);
  const rejected = first[a.id]!;
  await r.retake(a, rejected);
  await r.passRetakeT0(a);
  first[a.id] = await r.shoot(a, "retake");
  for (const p of r.people) await r.accept(p, first[p.id]!);
  for (let s = 1; s < shots; s++) await r.fullShot();
  expect(r.session.state).toBe("EDITING");
  await vi.advanceTimersByTimeAsync(30);
  return { r, rejected };
}

const send = (r: CaptureRoom, p: Person, type: string, payload: object = {}) => r.actor.intent(p.id, type, { sessionId: r.sid, ...payload });
const result = (r: CaptureRoom) => r.session.result!;
const finalize = async (r: CaptureRoom, by: Person) => {
  const ack = await send(r, by, "session.finalize");
  await vi.advanceTimersByTimeAsync(20);
  return ack;
};
async function uploadPreview(r: CaptureRoom, p: Person, bytes: Buffer, over: Record<string, unknown> = {}) {
  const prep = await send(r, p, "result.preview.prepare");
  expect(prep.ok).toBe(true);
  const d = prep.data as ResultPreviewPrepared;
  await r.storage.put(resultPreviewKey("room-cap", r.sid), bytes, "image/webp");
  return send(r, p, "result.preview.uploaded", { bytes: bytes.byteLength, sha256: sha(bytes), version: d.version, ...over });
}

describe("P08 finalisasi & hasil sesi (DEC-059/060)", () => {
  it("siapa pun (bukan pembuat) → FINAL + SessionResult (accepted saja, snapshot nama), snapshot dokumen ke storage, render diminta ke finalizer; idempoten", async () => {
    const { r, rejected } = await editingRoom(3, 2);
    const [a, , c] = r.people as [Person, Person, Person];
    const ed = r.actor.editor.docOf(r.sid)!;
    addSticker(ed, { participantId: c.id, name: "P3", origin: {} }, "heart", { x: 10, y: 10 });
    const [x, y] = await Promise.all([finalize(r, c), send(r, a, "session.finalize")]);
    expect([x, y]).toEqual([{ ok: true }, { ok: true }]);
    expect(r.session.state).toBe("FINAL");
    const res = result(r);
    expect(res).toMatchObject({ index: 1, version: 1, title: "Sesi 1", finalizedBy: c.id, previewReady: false });
    expect(res.acceptedAttempts).toHaveLength(6); // 2 shot × 3 peserta
    expect(res.acceptedAttempts.map((x) => x.attemptId)).not.toContain(rejected);
    expect(res.participants.map((p) => p.name).sort()).toEqual(["P1", "P2", "P3"]);
    expect(JSON.stringify(r.actor.view())).not.toContain("doc.bin");
    expect(JSON.stringify(r.actor.view())).not.toContain("previewKey");
    // snapshot dokumen tersimpan (bisa dirender ulang di P08)
    const bytes = await r.storage.get(docSnapshotKey("room-cap", r.sid), 5e6);
    expect(bytes).not.toBeNull();
    const restored = docFromSnapshot(bytes!);
    expect(listElements(restored).filter((e) => e.type === "sticker")).toHaveLength(1);
    expect(listElements(restored).filter((e) => e.type === "photo")).toHaveLength(6);
    // render diminta persis sekali ke finalizer
    expect(c.conn.of("result.render.request")).toHaveLength(1);
    expect(a.conn.of("result.render.request")).toHaveLength(0);
    // FINAL dua kali tetap satu versi
    await finalize(r, a);
    expect(result(r).version).toBe(1);
  });

  it("fallback render: tak ada pratinjau dalam 30 detik → peserta terhubung berikutnya (round-robin), berhenti saat sukses; tidak ada pengulangan ke yang sudah dicoba", async () => {
    const { r } = await editingRoom(3, 1);
    const [a, b, c] = r.people as [Person, Person, Person];
    await finalize(r, b);
    expect(b.conn.of("result.render.request")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    const second = [a, c].filter((p) => p.conn.of("result.render.request").length === 1);
    expect(second).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect([a, b, c].map((p) => p.conn.of("result.render.request").length)).toEqual([1, 1, 1]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect([a, b, c].map((p) => p.conn.of("result.render.request").length)).toEqual([1, 1, 1]); // semua sudah dicoba → berhenti
    // Pratinjau akhirnya diunggah (oleh siapa pun) → siap
    expect(await uploadPreview(r, a, await webp(1200, 900))).toEqual({ ok: true });
    expect(result(r).previewReady).toBe(true);
  });

  it("pratinjau sukses menghentikan fallback; versi lama / WebP palsu / terlalu besar / sha salah / dimensi > 1600 ditolak", async () => {
    const { r } = await editingRoom(2, 1);
    const [a, b] = r.people as [Person, Person];
    await finalize(r, a);
    const good = await webp(800, 600);
    expect(await uploadPreview(r, b, good, { version: 99 })).toMatchObject({ ok: false, error: "TOO_LATE" });
    expect(await uploadPreview(r, b, Buffer.from("bukan webp".repeat(40)))).toMatchObject({ ok: false, error: "UPLOAD_MISMATCH", reason: "FORMAT" });
    expect(await uploadPreview(r, b, good, { sha256: "0".repeat(64) })).toMatchObject({ ok: false, reason: "SHA256" });
    expect(await uploadPreview(r, b, good, { bytes: good.byteLength + 3 })).toMatchObject({ ok: false, reason: "SIZE" });
    expect(await uploadPreview(r, b, await webp(2000, 1000))).toMatchObject({ ok: false, reason: "DIMENSIONS" });
    const big = Buffer.concat([await webp(100, 100), Buffer.alloc(1024 * 1024 + 10, 1)]);
    expect(await uploadPreview(r, b, big)).toMatchObject({ ok: false, error: "UPLOAD_MISMATCH" });
    expect(result(r).previewReady).toBe(false);
    expect(await uploadPreview(r, b, good)).toEqual({ ok: true });
    expect(result(r).previewReady).toBe(true);
    expect(await uploadPreview(r, a, good)).toEqual({ ok: true }); // idempoten
    await vi.advanceTimersByTimeAsync(120_000);
    expect(b.conn.of("result.render.request")).toHaveLength(0); // fallback dibatalkan
    // Pratinjau tidak bisa diminta/diunggah oleh peserta tak terhubung / sesi belum FINAL
    await r.actor.detach(b.conn, b.id);
    expect(await send(r, b, "result.preview.prepare")).toMatchObject({ ok: false, error: "NOT_CONNECTED" });
  });

  it("Balik edit → EDITING (dokumen sama); Selesai lagi → versi 2, pratinjau lama dianggap basi, snapshot diperbarui", async () => {
    const { r } = await editingRoom(2, 1);
    const [a, b] = r.people as [Person, Person];
    await finalize(r, a);
    await uploadPreview(r, a, await webp(600, 450));
    expect(result(r).previewReady).toBe(true);
    expect(await send(r, b, "session.reopen")).toEqual({ ok: true });
    expect(r.session.state).toBe("EDITING");
    addSticker(r.actor.editor.docOf(r.sid)!, { participantId: b.id, name: "P2", origin: {} }, "star", { x: 5, y: 5 });
    await finalize(r, b);
    expect(result(r)).toMatchObject({ version: 2, previewReady: false, finalizedBy: b.id });
    const snap = docFromSnapshot((await r.storage.get(docSnapshotKey("room-cap", r.sid), 5e6))!);
    expect(listElements(snap).filter((e) => e.type === "sticker")).toHaveLength(1);
    expect(await uploadPreview(r, a, await webp(600, 450), { version: 1 })).toMatchObject({ ok: false, error: "TOO_LATE" });
    expect(b.conn.of("result.render.request").length).toBeGreaterThanOrEqual(1);
  });
});

describe("P08 galeri multi-sesi & aset (AC: REQ-GAL-03/07/08, TC-SEC-018)", () => {
  async function twoSessions() {
    const { r, rejected } = await editingRoom(3, 1);
    const [a, b] = r.people as [Person, Person, Person];
    await finalize(r, a);
    await uploadPreview(r, a, await webp(800, 600));
    const sid1 = r.sid;
    // Sesi baru oleh peserta yang bukan pembuat room: sesi lama CLOSED, voting dimulai dari awal.
    expect(await r.actor.intent(b.id, "session.create", {})).toEqual({ ok: true });
    return { r, rejected, sid1, a, b };
  }

  it("Sesi baru oleh siapa pun: sesi lama CLOSED (hasil tetap), sesi baru VOTING tanpa suara & tanpa mode; sesi aktif bukan FINAL ditolak; batas 20 sesi", async () => {
    const { r, sid1, b } = await twoSessions();
    const s1 = r.actor.snapshot().sessions[sid1]!;
    expect(s1.state).toBe("CLOSED");
    expect(s1.result).toMatchObject({ index: 1, previewReady: true });
    expect(r.session).toMatchObject({ index: 2, state: "VOTING", mode: null, createdBy: b.id });
    expect(r.session.voting.votes).toEqual({});
    expect(r.session.result).toBeNull();
    expect(await r.actor.intent(r.people[0]!.id, "session.create", {})).toMatchObject({ ok: false, error: "SESSION_ACTIVE_NOT_FINAL" });
    // 20 sesi: simulasikan sesi 2..20 FINAL lalu buat ke-21
    r.actor.dispose();
    const saved = (await r.store.loadRoom("room-cap"))!;
    const st = saved.state;
    for (let i = 3; i <= 20; i++) {
      const id = `s-${i}`;
      st.sessions[id] = { ...structuredClone(st.sessions[st.activeSessionId!]!), sessionId: id, index: i, state: "CLOSED" };
      st.sessionOrder.push(id);
    }
    st.sessions[st.activeSessionId!]!.state = "FINAL";
    const actor2 = new RoomActor(st, { store: r.store, config: CAPTURE_TEST_CONFIG, onExpiring: vi.fn(), storage: r.storage }, saved.events);
    for (const p of r.people) await actor2.attach(new TestConn(), p.id, null);
    expect(await actor2.intent(r.people[0]!.id, "session.create", {})).toMatchObject({ ok: false, error: "SESSION_LIMIT" });
    actor2.dispose();
  });

  it("editor.sync pada sesi CLOSED yang punya hasil: dokumen terbaca (read-only) untuk export ulang dari galeri; tulis ditolak READ_ONLY; sesi tanpa hasil tidak terbaca", async () => {
    const { r, sid1, b } = await twoSessions();
    const ack = await r.actor.intent(b.id, "editor.sync", { sessionId: sid1, stateVector: "" });
    expect(ack).toMatchObject({ ok: true });
    const data = ack.data as { update: string; readOnly: boolean };
    expect(data.readOnly).toBe(true);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(data.update, "base64")));
    expect(listElements(doc).filter((e) => e.type === "photo")).toHaveLength(3);
    const edit = new Y.Doc();
    expect(await r.actor.intent(b.id, "editor.update", { sessionId: sid1, update: Buffer.from(Y.encodeStateAsUpdate(edit)).toString("base64") })).toMatchObject({ ok: false, error: "READ_ONLY" });
    // Sesi aktif (VOTING, belum ada dokumen/hasil) tidak bisa di-sync.
    expect(await r.actor.intent(b.id, "editor.sync", { sessionId: r.session.sessionId, stateVector: "" })).toMatchObject({ ok: false, error: "NOT_IN_STUDIO" });
  });

  it("gallery.get: sesi FINAL/CLOSED berurut waktu, pratinjau signed ≤ 10 menit; 'Per orang' HANYA foto accepted — attempt ditolak tak ada di respons manapun", async () => {
    const { r, rejected } = await twoSessions();
    const ack = await r.actor.intent(r.people[1]!.id, "gallery.get", {});
    expect(ack.ok).toBe(true);
    const g = ack.data as GalleryView;
    expect(g.sessions).toHaveLength(1); // sesi 2 masih VOTING → belum ada hasil
    expect(g.sessions[0]).toMatchObject({ index: 1, state: "CLOSED", title: "Sesi 1" });
    expect(g.sessions[0]!.previewUrl).toMatch(/^http/);
    expect(g.sessions[0]!.expiresAtMs - Date.now()).toBeLessThanOrEqual(600_000);
    expect(g.perPerson).toHaveLength(3);
    expect(g.perPerson.map((p) => p.participantName).sort()).toEqual(["P1", "P2", "P3"]);
    const body = JSON.stringify(g);
    expect(body).not.toContain(rejected);
    expect(g.perPerson.every((p) => p.attemptId !== rejected)).toBe(true);
    // Setelah retake A, attempt lama dihapus dari storage (DEC-029) dan tidak pernah masuk galeri
    expect(await r.storage.size(r.actor.attemptRecord(rejected)!.previewKey!)).toBeNull();
  });

  it("asset.urls: hanya key yang dikenal state & milik room ini; attempt ditolak / room lain / key acak / path traversal diabaikan; > 50 key ditolak", async () => {
    const { r, rejected } = await twoSessions();
    const b = r.people[1]!;
    const acceptedAttempt = r.actor.snapshot().sessions[r.actor.snapshot().sessionOrder[0]!]!.result!.acceptedAttempts[0]!.attemptId;
    const rec = r.actor.attemptRecord(acceptedAttempt)!;
    const rej = r.actor.attemptRecord(rejected)!;
    const keys = [
      rec.previewKey!,
      rec.fullKey!,
      rej.previewKey!,
      rej.fullKey!,
      "rooms/room-lain/attempts/x/preview.jpg",
      "rooms/room-cap/../room-lain/secret.jpg",
      docSnapshotKey("room-cap", r.sid),
      "bukan-key",
    ];
    const ack = await r.actor.intent(b.id, "asset.urls", { keys });
    const urls = (ack.data as { urls: Record<string, { url: string; expiresAtMs: number }> }).urls;
    expect(Object.keys(urls).sort()).toEqual([rec.previewKey!, rec.fullKey!].sort());
    for (const u of Object.values(urls)) expect(u.expiresAtMs - Date.now()).toBeLessThanOrEqual(600_000);
    expect(await r.actor.intent(b.id, "asset.urls", { keys: Array.from({ length: 51 }, (_, i) => `k${i}`) })).toMatchObject({ ok: false, error: "BAD_REQUEST" });
    expect(await r.actor.intent(b.id, "asset.urls", { keys: "x" })).toMatchObject({ ok: false });
    await r.actor.detach(b.conn, b.id);
    expect(await r.actor.intent(b.id, "gallery.get", {})).toMatchObject({ ok: false, error: "NOT_CONNECTED" });
  });

  it("restart: hasil sesi & galeri dipulihkan dari store; pratinjau belum siap → galeri memicu permintaan render ulang", async () => {
    const { r } = await editingRoom(2, 1);
    const [a, b] = r.people as [Person, Person];
    await finalize(r, a);
    r.actor.dispose();
    const saved = (await r.store.loadRoom("room-cap"))!;
    const actor2 = new RoomActor(saved.state, { store: r.store, config: CAPTURE_TEST_CONFIG, onExpiring: vi.fn(), storage: r.storage }, saved.events);
    await actor2.recover();
    const conns = r.people.map(() => new TestConn());
    for (const [i, p] of r.people.entries()) await actor2.attach(conns[i]!, p.id, null);
    expect(actor2.view().activeSession!.result).toMatchObject({ version: 1, previewReady: false });
    const g = (await actor2.intent(b.id, "gallery.get", {})).data as GalleryView;
    expect(g.sessions).toHaveLength(1);
    expect(g.sessions[0]!.previewUrl).toBeNull(); // belum ada pratinjau → "Lagi nyiapin pratinjau…"
    expect(conns[1]!.of("result.render.request")).toHaveLength(1);
    actor2.dispose();
    void Y;
    void jpeg;
  });
});
