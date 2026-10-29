import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";
import { addSticker, addText, commitTransform, createEditorDoc, createUndo, elementsMap, fromBase64, listElements, toBase64 } from "@longroll/shared";
import type { EditorCtx } from "@longroll/shared";
import { sleep } from "./helpers";
import type { Socket } from "./helpers";
import { ack, holder, room, shoot, untilT0 } from "./capture-helpers";
import type { P } from "./capture-helpers";

afterEach(async () => {
  await holder.srv?.close();
  holder.srv = null;
});

/** Klien editor di atas WebSocket sungguhan: sync dua langkah + update lokal + relay masuk. */
async function editorClient(p: P, sid: string) {
  const doc = createEditorDoc();
  const r = await ack(p.s, "editor.sync", { sessionId: sid, stateVector: toBase64(Y.encodeStateVector(doc)) });
  expect(r.ok).toBe(true);
  const d = r.data as { update: string };
  Y.applyUpdate(doc, fromBase64(d.update), "remote");
  let applied = 0;
  const pump = () => {
    const ms = p.s.messages.filter((m) => m.type === "editor.update");
    for (const m of ms.slice(applied)) Y.applyUpdate(doc, fromBase64((m.payload as { update: string }).update), "remote");
    applied = ms.length;
  };
  doc.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "remote") void ack(p.s, "editor.update", { sessionId: sid, update: toBase64(u) });
  });
  const ctx: EditorCtx = { participantId: p.id, name: p.name, origin: { p: p.id } };
  return { doc, pump, ctx };
}

async function toEditing(n = 3) {
  const R = await room(n);
  const { sid, people } = R;
  await ack(people[0]!.s, "studio.update", { sessionId: sid, patch: { shotCount: 1, countdownSec: 3 } });
  await ack(people[0]!.s, "shot.arm", { sessionId: sid, shotIndex: 0, confirmNotReady: true });
  await untilT0(people[0]!.s);
  for (const [i, p] of people.entries()) {
    const id = await shoot(p, sid, 0, i + 1);
    expect(await ack(p.s, "capture.accept", { sessionId: sid, shotIndex: 0, attemptId: id })).toMatchObject({ ok: true });
  }
  await people[0]!.s.waitFor("session.state", (m) => (m.payload as { session: { state: string } }).session.state === "EDITING");
  return R;
}

describe("P07 integrasi WebSocket (editor)", () => {
  it("3 klien: seed identik, edit simultan konvergen di semua klien + server, undo hanya milik sendiri, Selesai edit → FINAL ke semua", async () => {
    const { sid, people } = await toEditing(3);
    const [a, b, c] = people as [P, P, P];
    const [ca, cb, cc] = await Promise.all([a, b, c].map((p) => editorClient(p, sid))) as [Awaited<ReturnType<typeof editorClient>>, Awaited<ReturnType<typeof editorClient>>, Awaited<ReturnType<typeof editorClient>>];
    expect(listElements(ca.doc).filter((e) => e.type === "photo")).toHaveLength(3);
    expect(listElements(ca.doc)).toEqual(listElements(cb.doc));

    const ua = createUndo(ca.doc, ca.ctx.origin);
    const t0 = Date.now();
    const s1 = addSticker(ca.doc, ca.ctx, "heart", { x: 100, y: 100 });
    ua.stopCapturing();
    const t1 = addText(cb.doc, cb.ctx, { x: 200, y: 200 }, "milik B");
    await sleep(150);
    for (const x of [ca, cb, cc]) x.pump();
    expect(Date.now() - t0).toBeLessThan(500); // AC-1 (loopback)
    // Pergeseran bersamaan pada elemen yang sama
    commitTransform(cb.doc, cb.ctx, s1, { x: 300, y: 300, scaleX: 1, scaleY: 1, rotation: 0 });
    commitTransform(cc.doc, cc.ctx, s1, { x: 500, y: 500, scaleX: 1, scaleY: 1, rotation: 0 });
    await sleep(250);
    for (const x of [ca, cb, cc]) x.pump();
    await sleep(100);
    for (const x of [ca, cb, cc]) x.pump();
    const pos = (d: Y.Doc) => JSON.stringify([elementsMap(d).get(s1)!.get("x"), elementsMap(d).get(s1)!.get("y")]);
    expect(pos(cb.doc)).toBe(pos(ca.doc));
    expect(pos(cc.doc)).toBe(pos(ca.doc));
    const serverDoc = holder.srv!.app.manager.activeCount; // server hidup
    expect(serverDoc).toBeGreaterThan(0);
    // Undo A membatalkan stiker A saja; teks B tetap
    ua.undo();
    await sleep(200);
    for (const x of [ca, cb, cc]) x.pump();
    expect(elementsMap(cb.doc).has(s1)).toBe(false);
    expect(elementsMap(cb.doc).has(t1)).toBe(true);
    // Selesai edit oleh peserta bukan pembuat → FINAL di semua klien
    expect(await ack(c.s, "session.finalize", { sessionId: sid })).toMatchObject({ ok: true });
    for (const p of people) await p.s.waitFor("session.state", (m) => (m.payload as { session: { state: string } }).session.state === "FINAL");
    expect(await ack(a.s, "editor.update", { sessionId: sid, update: toBase64(new Uint8Array([0, 0])) })).toMatchObject({ ok: false, error: "READ_ONLY" });
  });

  it("awareness (kursor/seleksi) di-relay volatile dengan identitas dari server; payload editor > 64 KB hanya diizinkan untuk editor.*", async () => {
    const { sid, people } = await toEditing(2);
    const [a, b] = people as [P, P];
    await editorClient(a, sid);
    await editorClient(b, sid);
    a.s.send("editor.awareness", { sessionId: sid, state: { participantId: b.id, cursor: { x: 5, y: 6 }, tool: "stiker" } });
    const m = await b.s.waitFor("editor.awareness");
    expect(m.payload).toMatchObject({ participantId: a.id, state: { cursor: { x: 5, y: 6 } } });
    expect(m.seq).toBeUndefined();
    // Pesan non-editor > 64 KB → koneksi ditutup (1009)
    const raw = (a.s as Socket).ws;
    raw.send(JSON.stringify({ type: "presence.set", payload: { pad: "x".repeat(70_000) } }));
    expect(await a.s.waitClose()).toBe(1009);
  });
});
