import * as Y from "yjs";
import { afterAll, describe, expect, it } from "vitest";
import { addSticker, createEditorDoc, listElements, snapshotDoc } from "@longroll/shared";
import { RoomActor } from "../../src/room/RoomActor";
import { createPgDb } from "../../src/store/db";
import { PostgresRoomStore } from "../../src/store/postgres";
import { TestConn } from "../fixtures/capture";

/** P07 pada Neon `development` (role longroll_app): snapshot Yjs per sesi, batas ukuran, cascade bersih. */
const url = process.env.LONGROLL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const CFG = { graceSeconds: 1, holdSeconds: 1, maxLifetimeHours: null, connectDeadlineMs: 1000, credentialTtlSeconds: 60, credentialRotationGraceMs: 1000 };
const randomCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

suite("P07 persistensi dokumen editor di PostgreSQL (Neon development)", () => {
  const store = new PostgresRoomStore(createPgDb(url ?? "postgres://invalid", { poolMax: 2, statementTimeoutMs: 8000 }));
  afterAll(async () => {
    await store.close();
  });

  it("simpan → muat ulang (byte identik) → timpa (versi naik) → dokumen > 2.5 MB ditolak CHECK → finalize room menghapus semuanya", async () => {
    const rid = crypto.randomUUID();
    const code = randomCode();
    expect(await store.reserveCode(code, rid)).toBe(true);
    const actor = new RoomActor(RoomActor.createState(rid, code, CFG), { store, config: CFG, onExpiring: () => undefined });
    const j = await actor.join("Nadia");
    await actor.attach(new TestConn(), j.participant.participantId, null);
    await actor.intent(j.participant.participantId, "session.create", {});
    const sid = actor.view().activeSession!.sessionId;
    actor.dispose();

    const doc = createEditorDoc();
    addSticker(doc, { participantId: "p", name: "p", origin: {} }, "heart", { x: 10, y: 10 });
    const bytes = snapshotDoc(doc);
    await store.saveEditorDoc(rid, sid, bytes);
    const back = (await store.loadEditorDoc(sid))!;
    expect(Buffer.from(back).equals(Buffer.from(bytes))).toBe(true);
    const restored = createEditorDoc();
    Y.applyUpdate(restored, back);
    expect(listElements(restored)).toHaveLength(1);

    addSticker(doc, { participantId: "p", name: "p", origin: {} }, "star", { x: 20, y: 20 });
    await store.saveEditorDoc(rid, sid, snapshotDoc(doc));
    const again = createEditorDoc();
    Y.applyUpdate(again, (await store.loadEditorDoc(sid))!);
    expect(listElements(again)).toHaveLength(2);
    // Baris milik room lain tidak bisa ditimpa (WHERE room_id): simpan dengan roomId salah tidak mengubah apa pun.
    const current = Buffer.from((await store.loadEditorDoc(sid))!);
    await store.saveEditorDoc(crypto.randomUUID(), sid, bytes).catch(() => undefined);
    expect(Buffer.from((await store.loadEditorDoc(sid))!).equals(current)).toBe(true);
    // Batas ukuran dijaga CHECK basis data.
    await expect(store.saveEditorDoc(rid, sid, new Uint8Array(2_700_000))).rejects.toThrow();
    expect(await store.loadEditorDoc(crypto.randomUUID())).toBeNull();

    expect(await store.countRoomData(rid)).toBeGreaterThan(0);
    await store.finalizeExpiredRoom(rid, code, 60);
    expect(await store.countRoomData(rid)).toBe(0);
    expect(await store.loadEditorDoc(sid)).toBeNull();
  });
});
