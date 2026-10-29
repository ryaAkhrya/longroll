import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_LIMITS,
  addSticker,
  addText,
  commitTransform,
  createEditorDoc,
  elementsMap,
  fromBase64,
  listElements,
  metaMap,
  readHistory,
  toBase64,
} from "@longroll/shared";
import type { EditorCtx, S2C } from "@longroll/shared";
import { CAPTURE_TEST_CONFIG, CaptureRoom, TestConn } from "../../test/fixtures/capture";
import type { Person } from "../../test/fixtures/capture";
import { RoomActor } from "./RoomActor";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
afterEach(() => vi.useRealTimers());

/** Sesi yang sudah melewati semua shot → EDITING (foto accepted NYATA dari alur capture P06). */
async function editingRoom(n = 3, opts: { strategy?: "PER_SHOT_GROUP" | "PER_PARTICIPANT_SHOT"; mode?: string; shots?: number } = {}) {
  const r = await CaptureRoom.create(n, { shots: opts.shots ?? 2, strategy: opts.strategy, mode: opts.mode });
  const accepted: Record<string, string>[] = [];
  for (let s = 0; s < (opts.shots ?? 2); s++) accepted.push(await r.fullShot());
  expect(r.session.state).toBe("EDITING");
  await vi.advanceTimersByTimeAsync(20);
  return { r, accepted };
}

const send = (r: CaptureRoom, p: Person, type: string, payload: unknown) => r.actor.intent(p.id, type, { sessionId: r.sid, ...(payload as object) });

/** Klien editor minimal: Y.Doc + sync dua langkah + kirim update lokal. */
async function client(r: CaptureRoom, p: Person) {
  const doc = createEditorDoc();
  const ack = await send(r, p, "editor.sync", { stateVector: toBase64(Y.encodeStateVector(doc)) });
  expect(ack.ok).toBe(true);
  const d = ack.data as { update: string; stateVector: string; readOnly: boolean };
  Y.applyUpdate(doc, fromBase64(d.update), "remote");
  const ctx: EditorCtx = { participantId: p.id, name: p.name, origin: { p: p.id }, now: () => Date.now() };
  const push = async () => {
    const diff = Y.encodeStateAsUpdate(doc, fromBase64(d.stateVector));
    return send(r, p, "editor.update", { update: toBase64(diff) });
  };
  let sv = Y.encodeStateVector(doc);
  const sendDelta = async () => {
    const delta = Y.encodeStateAsUpdate(doc, sv);
    sv = Y.encodeStateVector(doc);
    return send(r, p, "editor.update", { update: toBase64(delta) });
  };
  // Terapkan update relay dari server ke dokumen klien (seperti provider sesungguhnya).
  const pump = () => {
    for (const m of p.conn.of("editor.update")) {
      const pl = m.payload as { update: string };
      Y.applyUpdate(doc, fromBase64(pl.update), "remote");
    }
    p.conn.messages = p.conn.messages.filter((m) => m.type !== "editor.update");
    sv = Y.encodeStateVector(doc);
  };
  return { doc, ctx, push, sendDelta, pump, readOnly: d.readOnly };
}

describe("P07 seed & sinkron di server", () => {
  it("EDITING → dokumen di-seed dari foto accepted + BindingPlan (kedua strategi) dan disimpan ke store", async () => {
    for (const strategy of ["PER_SHOT_GROUP", "PER_PARTICIPANT_SHOT"] as const) {
      const { r, accepted } = await editingRoom(3, { strategy });
      const doc = r.actor.editor.docOf(r.sid)!;
      const photos = listElements(doc).filter((e) => e.type === "photo");
      expect(photos).toHaveLength(6); // 2 shot × 3 peserta (kedua strategi: 1 foto per cell accepted)
      const ids = new Set(accepted.flatMap((a) => Object.values(a)));
      for (const p of photos) expect(ids.has(String(p.attemptId))).toBe(true);
      expect(await r.store.loadEditorDoc(r.sid)).not.toBeNull();
      expect(metaMap(doc).get("canvas")).toBeTruthy();
    }
  });

  it("peserta mana pun (bukan pembuat room) bisa sinkron & menghias; update dirilis ke peserta lain saja", async () => {
    const { r } = await editingRoom(3);
    const [a, b, c] = r.people as [Person, Person, Person];
    const ca = await client(r, a);
    const cb = await client(r, b);
    const cc = await client(r, c);
    expect(listElements(ca.doc)).toEqual(listElements(cb.doc));
    const id = addSticker(cc.doc, cc.ctx, "heart", { x: 200, y: 300 });
    expect(await cc.sendDelta()).toEqual({ ok: true });
    expect(c.conn.of("editor.update")).toHaveLength(0); // pengirim tidak menerima echo
    ca.pump();
    cb.pump();
    for (const d of [ca.doc, cb.doc]) expect(elementsMap(d).has(id)).toBe(true);
    expect(elementsMap(r.actor.editor.docOf(r.sid)!).has(id)).toBe(true);
  });

  it("AC-3: dua klien memindah elemen sama → semua konvergen; AC-1: update diterima segera (relay sinkron)", async () => {
    const { r } = await editingRoom(3);
    const [a, b, c] = r.people as [Person, Person, Person];
    const ca = await client(r, a);
    const cb = await client(r, b);
    const cc = await client(r, c);
    const id = addText(ca.doc, ca.ctx, { x: 100, y: 100 }, "halo");
    await ca.sendDelta();
    cb.pump();
    cc.pump();
    commitTransform(cb.doc, cb.ctx, id, { x: 300, y: 300, scaleX: 1, scaleY: 1, rotation: 0 });
    commitTransform(cc.doc, cc.ctx, id, { x: 500, y: 500, scaleX: 1, scaleY: 1, rotation: 0 });
    await Promise.all([cb.sendDelta(), cc.sendDelta()]);
    for (const x of [ca, cb, cc]) x.pump();
    const server = r.actor.editor.docOf(r.sid)!;
    const pos = (d: Y.Doc) => [elementsMap(d).get(id)!.get("x"), elementsMap(d).get(id)!.get("y")];
    expect(pos(ca.doc)).toEqual(pos(server));
    expect(pos(cb.doc)).toEqual(pos(server));
    expect(pos(cc.doc)).toEqual(pos(server));
  });

  it("snapshot ke PostgreSQL di-throttle (≤ 1× per 5 detik) dan hanya bila ada perubahan; awareness tak pernah disimpan", async () => {
    const { r } = await editingRoom(2);
    const a = r.people[0]!;
    const ca = await client(r, a);
    await vi.advanceTimersByTimeAsync(6000);
    const w0 = r.store.editorWrites;
    for (let i = 0; i < 20; i++) {
      addSticker(ca.doc, ca.ctx, "dot", { x: i * 10, y: 50 });
      await ca.sendDelta();
    }
    expect(r.store.editorWrites).toBe(w0); // belum ada tulis: ditahan sampai jendela 5 detik
    await vi.advanceTimersByTimeAsync(5100);
    expect(r.store.editorWrites).toBe(w0 + 1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.store.editorWrites).toBe(w0 + 1); // tak ada perubahan → tak ada tulis
    for (let i = 0; i < 50; i++) r.actor.relayEditorAwareness(a.id, r.sid, { cursor: { x: i, y: i } });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.store.editorWrites).toBe(w0 + 1);
    const saved = createEditorDoc();
    Y.applyUpdate(saved, (await r.store.loadEditorDoc(r.sid))!);
    expect(listElements(saved).filter((e) => e.type === "sticker")).toHaveLength(20);
  });

  it("AC-7/reconnect: klien offline bersama edit lokal menyinkronkan dua arah (state vector) tanpa kehilangan operasi", async () => {
    const { r } = await editingRoom(2);
    const [a, b] = r.people as [Person, Person];
    const ca = await client(r, a);
    const cb = await client(r, b);
    // A offline: edit lokal tak terkirim. B terus mengedit.
    const offlineId = addText(ca.doc, ca.ctx, { x: 10, y: 10 }, "offline");
    const onlineId = addSticker(cb.doc, cb.ctx, "star", { x: 20, y: 20 });
    await cb.sendDelta();
    await r.actor.detach(a.conn, a.id);
    await r.reconnect(a);
    const ack = await send(r, a, "editor.sync", { stateVector: toBase64(Y.encodeStateVector(ca.doc)) });
    const d = ack.data as { update: string; stateVector: string };
    Y.applyUpdate(ca.doc, fromBase64(d.update), "remote");
    expect(await send(r, a, "editor.update", { update: toBase64(Y.encodeStateAsUpdate(ca.doc, fromBase64(d.stateVector))) })).toEqual({ ok: true });
    const server = r.actor.editor.docOf(r.sid)!;
    expect(elementsMap(server).has(offlineId) && elementsMap(server).has(onlineId)).toBe(true);
    expect(elementsMap(ca.doc).has(onlineId)).toBe(true);
    cb.pump();
    expect(elementsMap(cb.doc).has(offlineId)).toBe(true);
  });

  it("restart: dokumen dimuat dari snapshot; klien lama resync tanpa duplikasi", async () => {
    const { r } = await editingRoom(2);
    const ca = await client(r, r.people[0]!);
    const id = addText(ca.doc, ca.ctx, { x: 1, y: 1 }, "bertahan");
    await ca.sendDelta();
    await r.actor.editor.flush();
    r.actor.dispose();
    const saved = (await r.store.loadRoom("room-cap"))!;
    const actor2 = new RoomActor(saved.state, { store: r.store, config: CAPTURE_TEST_CONFIG, onExpiring: vi.fn(), storage: r.storage }, saved.events);
    await actor2.recover();
    for (const p of r.people) await actor2.attach(new TestConn(), p.id, null);
    r.actor = actor2;
    expect(actor2.editor.has(r.sid)).toBe(false);
    const again = await client(r, r.people[1]!);
    expect(elementsMap(again.doc).get(id)!.get("content")!.toString()).toBe("bertahan");
    expect(listElements(again.doc).filter((e) => e.type === "photo")).toHaveLength(4);
  });
});

describe("P07 validasi & otorisasi (TC-EDIT-022, AC-8, AC-10)", () => {
  it("update tidak valid ditolak: server tak berubah, tak dirilis, pengirim menerima editor.reset (state penuh)", async () => {
    const { r } = await editingRoom(3);
    const [a, b] = r.people as [Person, Person];
    const ca = await client(r, a);
    await client(r, b);
    const serverBefore = toBase64(Y.encodeStateAsUpdate(r.actor.editor.docOf(r.sid)!));
    const first = listElements(ca.doc).find((e) => e.type === "photo")!;
    elementsMap(ca.doc).get(first.id)!.set("x", Number.NaN);
    const ack = await ca.sendDelta();
    expect(ack).toMatchObject({ ok: false, error: "INVALID_PATCH", reason: "SCHEMA" });
    expect(toBase64(Y.encodeStateAsUpdate(r.actor.editor.docOf(r.sid)!))).toBe(serverBefore);
    expect(b.conn.of("editor.update")).toHaveLength(0);
    const reset = a.conn.of("editor.reset");
    expect(reset).toHaveLength(1);
    const clean = createEditorDoc();
    Y.applyUpdate(clean, fromBase64((reset[0]!.payload as { update: string }).update));
    expect(Number(elementsMap(clean).get(first.id)!.get("x"))).not.toBeNaN();
  });

  it("AC-8: foto REJECTED / bukan milik / attempt palsu tidak bisa masuk dokumen; foto sumber tak bisa ditukar", async () => {
    const r = await CaptureRoom.create(2, { shots: 1 });
    const [a, b] = r.people as [Person, Person];
    await r.arm(a);
    await r.passT0();
    const rejected = await r.shoot(a);
    await r.retake(a, rejected);
    await r.passRetakeT0(a);
    const keep = await r.shoot(a, "retake");
    await r.accept(a, keep);
    await r.accept(b, await r.shoot(b));
    expect(r.session.state).toBe("EDITING");
    await vi.advanceTimersByTimeAsync(20);
    const base = await client(r, a);
    const photo = listElements(base.doc).find((e) => e.type === "photo" && e.attemptId === keep)!;
    // Klien nyata membangun ulang dokumen dari state server setelah ditolak (editor.reset); di sini: klien baru per percobaan.
    const forge = async (attemptId: string, ownerId: string) => {
      const c = await client(r, a);
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ ...photo, id: undefined, attemptId, ownerId })) if (v !== undefined) m.set(k, v);
      elementsMap(c.doc).set(`photo:${attemptId}`, m);
      return c.sendDelta();
    };
    expect(await forge(rejected, a.id)).toMatchObject({ ok: false, error: "INVALID_PATCH", reason: "ATTEMPT" });
    expect(await forge("att-karangan", a.id)).toMatchObject({ ok: false, reason: "ATTEMPT" });
    const bPhoto = listElements(base.doc).find((e) => e.type === "photo" && e.ownerId === b.id)!;
    expect(await forge(String(bPhoto.attemptId), a.id)).toMatchObject({ ok: false, reason: "ATTEMPT" }); // bukan miliknya
    // Ganti sumber foto yang sudah ada
    const swap = await client(r, a);
    elementsMap(swap.doc).get(photo.id)!.set("attemptId", String(bPhoto.attemptId));
    expect(await swap.sendDelta()).toMatchObject({ ok: false, error: "INVALID_PATCH" });
    expect(r.actor.attemptRecord(rejected)!.status).toBe("REJECTED");
    expect(elementsMap(r.actor.editor.docOf(r.sid)!).has(`photo:${rejected}`)).toBe(false);
  });

  it("update dengan celah dependensi (tanpa resync setelah penolakan) ditolak — tak bisa menyelundupkan isi menggantung", async () => {
    const { r } = await editingRoom(2);
    const a = r.people[0]!;
    const c = await client(r, a);
    addSticker(c.doc, c.ctx, "heart", { x: 1, y: 1 });
    const skipped = Y.encodeStateVector(c.doc); // sengaja tidak mengirim perubahan pertama
    const bad = createEditorDoc();
    Y.applyUpdate(bad, Y.encodeStateAsUpdate(c.doc));
    addSticker(bad, { ...c.ctx, origin: { x: 1 } }, "star", { x: 2, y: 2 });
    const gap = Y.encodeStateAsUpdate(bad, skipped); // bergantung pada struct yang tak pernah dikirim
    expect(await send(r, a, "editor.update", { update: toBase64(gap) })).toMatchObject({ ok: false, error: "INVALID_PATCH", reason: "MALFORMED" });
    expect(listElements(r.actor.editor.docOf(r.sid)!).filter((e) => e.type === "sticker")).toHaveLength(0);
    // Kemudian mengirim perubahan pertama saja → sah, dan tidak membawa apa pun yang menggantung.
    expect(await send(r, a, "editor.update", { update: toBase64(Y.encodeStateAsUpdate(c.doc, Y.encodeStateVector(r.actor.editor.docOf(r.sid)!))) })).toEqual({ ok: true });
    expect(listElements(r.actor.editor.docOf(r.sid)!).filter((e) => e.type === "sticker")).toHaveLength(1);
  });

  it("ukuran: update > 256 KB → DOC_TOO_LARGE; base64 melebihi batas ditolak sebelum diproses", async () => {
    const { r } = await editingRoom(2);
    const a = r.people[0]!;
    await client(r, a);
    expect(await send(r, a, "editor.update", { update: "A".repeat(Math.ceil((EDITOR_LIMITS.maxUpdateBytes * 4) / 3) + 100) })).toMatchObject({ ok: false, error: "DOC_TOO_LARGE" });
    expect(await send(r, a, "editor.update", { update: toBase64(new Uint8Array(EDITOR_LIMITS.maxUpdateBytes + 10)) })).toMatchObject({ ok: false, error: "DOC_TOO_LARGE" });
    expect(await send(r, a, "editor.update", { update: toBase64(new Uint8Array([9, 9, 9, 9, 9])) })).toMatchObject({ ok: false, error: "INVALID_PATCH" });
    expect(await send(r, a, "editor.update", { update: 42 })).toMatchObject({ ok: false });
  });

  it("peserta tak terhubung / LEFT / sesi salah ditolak", async () => {
    const { r } = await editingRoom(3);
    const [a, b, c] = r.people as [Person, Person, Person];
    expect(await r.actor.intent(a.id, "editor.sync", { sessionId: "bukan-sesi", stateVector: "" })).toMatchObject({ ok: false, error: "NOT_IN_STUDIO" });
    await r.actor.detach(b.conn, b.id);
    expect(await send(r, b, "editor.sync", { stateVector: "" })).toMatchObject({ ok: false, error: "NOT_CONNECTED" });
    await r.actor.leave(c.id);
    expect(await send(r, c, "editor.sync", { stateVector: "" })).toMatchObject({ ok: false });
  });

  it("Selesai edit: siapa pun (idempoten, satu transisi) → FINAL; update lalu READ_ONLY; Balik edit → EDITING lagi dengan dokumen sama", async () => {
    const { r } = await editingRoom(3);
    const [a, b, c] = r.people as [Person, Person, Person];
    const ca = await client(r, a);
    addSticker(ca.doc, ca.ctx, "heart", { x: 1, y: 1 });
    await ca.sendDelta();
    const [x, y] = await Promise.all([send(r, c, "session.finalize", {}), send(r, b, "session.finalize", {})]);
    expect([x, y]).toEqual([{ ok: true }, { ok: true }]);
    expect(r.session.state).toBe("FINAL");
    expect(a.conn.of("session.state").filter((m) => (m.payload as { session: { state: string } }).session.state === "FINAL")).toHaveLength(1);
    expect(await r.store.loadEditorDoc(r.sid)).not.toBeNull(); // flush saat FINAL
    addSticker(ca.doc, ca.ctx, "star", { x: 2, y: 2 });
    expect(await ca.sendDelta()).toMatchObject({ ok: false, error: "READ_ONLY" });
    const snapshot = await r.actor.editor.snapshot(r.sid); // fungsi snapshot untuk P08
    expect(snapshot!.byteLength).toBeGreaterThan(100);
    expect(await send(r, b, "session.reopen", {})).toEqual({ ok: true });
    expect(r.session.state).toBe("EDITING");
    const cb = await client(r, b);
    expect(listElements(cb.doc).filter((e) => e.type === "sticker")).toHaveLength(1);
  });

  it("awareness: server menetapkan identitas pengirim, payload > 4 KB dibuang, tidak dikirim balik ke pengirim", async () => {
    const { r } = await editingRoom(3);
    const [a, b] = r.people as [Person, Person];
    r.actor.relayEditorAwareness(a.id, r.sid, { participantId: b.id, cursor: { x: 1, y: 2 }, selection: ["x"] });
    const got = b.conn.of("editor.awareness").at(-1)!.payload as { participantId: string };
    expect(got.participantId).toBe(a.id); // identitas dari server, bukan klaim klien
    expect(a.conn.of("editor.awareness")).toHaveLength(0);
    const n = b.conn.of("editor.awareness").length;
    r.actor.relayEditorAwareness(a.id, r.sid, { blob: "x".repeat(EDITOR_LIMITS.maxAwarenessBytes + 10) });
    expect(b.conn.of("editor.awareness")).toHaveLength(n);
  });

  it("P06 integritas: aktivitas editor tidak mengubah daftar accepted / state capture; update dobel idempoten", async () => {
    const { r, accepted } = await editingRoom(3);
    const before = JSON.stringify(r.capture.shots.map((s) => Object.fromEntries(Object.entries(s.perParticipant).map(([k, v]) => [k, v.acceptedAttemptId]))));
    const ca = await client(r, r.people[0]!);
    addSticker(ca.doc, ca.ctx, "heart", { x: 5, y: 5 });
    const delta = toBase64(Y.encodeStateAsUpdate(ca.doc, Y.encodeStateVector(r.actor.editor.docOf(r.sid)!)));
    expect(await send(r, r.people[0]!, "editor.update", { update: delta })).toEqual({ ok: true });
    const sizeOnce = Y.encodeStateAsUpdate(r.actor.editor.docOf(r.sid)!).byteLength;
    expect(await send(r, r.people[0]!, "editor.update", { update: delta })).toEqual({ ok: true });
    expect(Y.encodeStateAsUpdate(r.actor.editor.docOf(r.sid)!).byteLength).toBe(sizeOnce);
    expect(JSON.stringify(r.capture.shots.map((s) => Object.fromEntries(Object.entries(s.perParticipant).map(([k, v]) => [k, v.acceptedAttemptId]))))).toBe(before);
    expect(await r.actor.intent(r.people[1]!.id, "capture.retake", { sessionId: r.sid, shotIndex: 0, attemptId: accepted[0]![r.people[1]!.id] })).toMatchObject({ ok: false });
    expect(readHistory(r.actor.editor.docOf(r.sid)!).length).toBeGreaterThan(0);
    void ({} as S2C);
  });
});
