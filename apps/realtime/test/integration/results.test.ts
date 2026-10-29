import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { GalleryView, ResultPreviewPrepared } from "@longroll/shared";
import { ORIGIN, sleep } from "./helpers";
import { ack, holder, room, shoot, untilT0 } from "./capture-helpers";
import type { P } from "./capture-helpers";
import { sha } from "../fixtures/capture";

afterEach(async () => {
  await holder.srv?.close();
  holder.srv = null;
});

async function toEditing(env: Record<string, string> = {}) {
  const R = await room(3, env);
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

describe("P08 integrasi WebSocket + HTTP + storage", () => {
  it("Selesai edit → render diminta ke finalizer → unggah pratinjau WebP lewat signed PUT → galeri (signed URL terbaca) → asset.urls terbatas room → sesi baru", async () => {
    const { code, roomId, sid, people } = await toEditing();
    const [a, b, c] = people as [P, P, P];
    expect(await ack(c.s, "session.finalize", { sessionId: sid })).toMatchObject({ ok: true });
    for (const p of people) await p.s.waitFor("session.state", (m) => (m.payload as { session: { state: string } }).session.state === "FINAL");
    const req = await c.s.waitFor("result.render.request");
    expect(req.payload).toMatchObject({ sessionId: sid, version: 1 });
    expect(b.s.messages.some((m) => m.type === "result.render.request")).toBe(false);

    const prep = await ack(c.s, "result.preview.prepare", { sessionId: sid });
    const d = prep.data as ResultPreviewPrepared;
    const img = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#d8c7e8" } }).webp().toBuffer();
    expect((await fetch(d.uploadUrl.url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: img })).status).toBe(403); // content-type salah
    expect((await fetch(d.uploadUrl.url, { method: "PUT", headers: { ...d.uploadUrl.headers, Origin: ORIGIN }, body: img })).status).toBe(200);
    expect(await ack(c.s, "result.preview.uploaded", { sessionId: sid, version: d.version, bytes: img.byteLength, sha256: sha(img) })).toMatchObject({ ok: true });
    await a.s.waitFor("session.state", (m) => (m.payload as { session: { result?: { previewReady: boolean } } }).session.result?.previewReady === true);

    const gal = (await ack(a.s, "gallery.get", {})).data as GalleryView;
    expect(gal.sessions).toHaveLength(1);
    expect(gal.perPerson).toHaveLength(3);
    const pv = await fetch(gal.sessions[0]!.previewUrl!, { headers: { Origin: ORIGIN } });
    expect(pv.status).toBe(200);
    expect(pv.headers.get("content-type")).toBe("image/webp");
    const keyOf = (u: string) => u;
    void keyOf;
    // Room lain tidak bisa meminta key room ini; key milik sendiri yang dikenal → URL.
    const acc = gal.perPerson[0]!;
    const rec = (await ack(a.s, "asset.urls", { keys: [`rooms/${roomId}/attempts/${acc.attemptId}/preview.jpg`, `rooms/${roomId}/attempts/${acc.attemptId}/full.jpg`, "rooms/lain/attempts/x/full.jpg"] })).data as { urls: Record<string, unknown> };
    expect(Object.keys(rec.urls)).toHaveLength(2);
    // Sesi baru oleh peserta lain: SCR-19 (session.invite) ke yang lain; sesi lama CLOSED tetap di galeri.
    expect(await ack(b.s, "session.create", {})).toMatchObject({ ok: true });
    await a.s.waitFor("session.invite");
    const gal2 = (await ack(a.s, "gallery.get", {})).data as GalleryView;
    expect(gal2.sessions[0]).toMatchObject({ index: 1, state: "CLOSED" });
  });

  it("room bubar → seluruh objek (attempt, snapshot dokumen, pratinjau hasil) terhapus & data bersih (TC-SEC-030)", async () => {
    const { roomId, sid, people } = await toEditing({ PARTICIPANT_HOLD_SECONDS: "0.3", ROOM_GRACE_PERIOD_SECONDS: "1.5" });
    const [a] = people as [P, P, P];
    await ack(a.s, "session.finalize", { sessionId: sid });
    await sleep(300);
    const keys = await holder.srv!.storage.list(`rooms/${roomId}/`);
    expect(keys.some((k) => k.includes("/sessions/") && k.endsWith("doc.bin"))).toBe(true);
    for (const p of people) p.s.close();
    await sleep(3500);
    expect(await holder.srv!.storage.list(`rooms/${roomId}/`)).toEqual([]);
    expect(await holder.srv!.store.countRoomData(roomId)).toBe(0);
  });
});
