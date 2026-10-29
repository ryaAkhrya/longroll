import { afterEach, describe, expect, it } from "vitest";
import type { AttemptPrepared } from "@longroll/shared";
import { jpeg, sha } from "../fixtures/capture";
import { Client, ORIGIN, sleep } from "./helpers";
import { ack, holder, lastCapture, room, shoot, untilT0 } from "./capture-helpers";
import type { P } from "./capture-helpers";

afterEach(async () => {
  await holder.srv?.close();
  holder.srv = null;
});

describe("P06 integrasi WS + HTTP + storage", () => {
  it("4 klien: satu T0 untuk semua; retake A 3× tidak menyentuh B/C/D (acceptedAttemptId & byte foto identik, tanpa retake untuk mereka); rejected dihapus saat DONE", async () => {
    const { code, roomId, sid, people } = await room(4);
    const [a, b, c, d] = people as [P, P, P, P];
    expect((await ack(a.s, "studio.update", { sessionId: sid, patch: { countdownSec: 3 } })).ok).toBe(true);
    const armedAt = Date.now();
    expect(await ack(c.s, "shot.arm", { sessionId: sid, shotIndex: 0, confirmNotReady: true })).toMatchObject({ ok: true });
    const cds = await Promise.all(people.map((p) => p.s.waitFor("shot.countdown")));
    const times = cds.map((m) => (m.payload as { t0ServerMs: number }).t0ServerMs);
    expect(new Set(times).size).toBe(1);
    expect(times[0]! - armedAt).toBeGreaterThanOrEqual(2900);
    await sleep(Math.max(0, times[0]! - Date.now()) + 200);

    const first: Record<string, string> = {};
    for (const [i, p] of people.entries()) first[p.id] = await shoot(p, sid, 0, i + 1);
    for (const p of [b, c, d]) expect(await ack(p.s, "capture.accept", { sessionId: sid, shotIndex: 0, attemptId: first[p.id] })).toMatchObject({ ok: true });

    // Metadata GPS tidak ikut tersimpan (re-encode di server).
    const storedA = Buffer.from((await holder.srv!.storage.get(`rooms/${roomId}/attempts/${first[a.id]}/full.jpg`, 1e9))!);
    expect(storedA.includes(Buffer.from("GPS-JANGAN-BOCOR"))).toBe(false);

    const fetchOwnFull = async (p: P, attemptId: string) => {
      const r = await p.c.request("GET", `/api/rooms/${code}/attempts/${attemptId}/url?part=full`);
      expect(r.status).toBe(200);
      expect((r.body!.expiresAtMs as number) - Date.now()).toBeLessThanOrEqual(600_000);
      const res = await fetch(r.body!.url as string, { headers: { Origin: ORIGIN } });
      expect(res.status).toBe(200);
      return sha(Buffer.from(await res.arrayBuffer()));
    };
    const snapshot = async () => {
      const out: Record<string, { accepted: string | null; sha: string; state: string }> = {};
      for (const p of [b, c, d]) {
        const ps = lastCapture(p.s).shots[0]!.perParticipant[p.id]!;
        out[p.id] = { accepted: ps.acceptedAttemptId, sha: await fetchOwnFull(p, first[p.id]!), state: JSON.stringify(ps) };
      }
      return out;
    };
    const before = await snapshot();
    const startedBefore = [b, c, d].map((p) => p.s.messages.filter((m) => m.type === "retake.started").length);

    let prev = first[a.id]!;
    for (let i = 0; i < 3; i++) {
      expect(await ack(a.s, "capture.retake", { sessionId: sid, shotIndex: 0, attemptId: prev })).toMatchObject({ ok: true });
      const rs = await a.s.waitFor("retake.started", (m) => (m.payload as { attemptNo: number }).attemptNo === i + 1 && (m.payload as { rejectedAttemptId: string }).rejectedAttemptId === prev);
      await sleep(Math.max(0, (rs.payload as { t0ServerMs: number }).t0ServerMs - Date.now()) + 250);
      prev = await shoot(a, sid, 0, 10 + i, "retake");
    }
    await sleep(100);
    const after = await snapshot();
    expect(after).toEqual(before);
    [b, c, d].forEach((p, i) => {
      const started = p.s.messages.filter((m) => m.type === "retake.started");
      expect(started.length - startedBefore[i]!).toBe(3);
      expect(started.every((m) => (m.payload as { participantId: string }).participantId === a.id)).toBe(true);
      expect(lastCapture(p.s).shots[0]!.perParticipant[p.id]!.retakeT0ServerMs).toBeNull();
    });
    // Attempt ditolak A terlihat (preview) oleh peserta lain selama shot aktif; full hanya pemilik.
    const rejected = lastCapture(b.s).shots[0]!.perParticipant[a.id]!.attempts.slice(0, 3);
    expect((await b.c.request("GET", `/api/rooms/${code}/attempts/${rejected[0]}/url?part=preview`)).status).toBe(200);
    expect((await b.c.request("GET", `/api/rooms/${code}/attempts/${first[a.id]}/url?part=full`)).status).toBe(403);

    // A memutuskan → DONE → attempt ditolak dihapus dari storage
    expect(await ack(a.s, "capture.accept", { sessionId: sid, shotIndex: 0, attemptId: prev })).toMatchObject({ ok: true });
    const done = await a.s.waitFor("shot.done");
    expect(done.payload).toMatchObject({ shotIndex: 0, last: false });
    await sleep(300);
    const left = await holder.srv!.storage.list(`rooms/${roomId}/attempts/`);
    expect(left.sort()).toEqual(
      [first[b.id], first[c.id], first[d.id], prev].flatMap((id) => ["full", "preview", "edit"].map((p) => `rooms/${roomId}/attempts/${id}/${p}.jpg`)).sort(),
    );
    // Setelah DONE foto accepted milik orang lain boleh dilihat penuh (editor/export); yang ditolak sudah hilang.
    expect((await a.c.request("GET", `/api/rooms/${code}/attempts/${first[b.id]}/url?part=full`)).status).toBe(200);
    expect((await a.c.request("GET", `/api/rooms/${code}/attempts/${rejected[0]}/url?part=preview`)).status).toBe(404);
  });

  it("otorisasi & validasi: bukan pemilik, room lain, content-type/ukuran/format salah (TC-SEC-014/018)", async () => {
    const { code, sid, people } = await room(2);
    const [a, b] = people as [P, P];
    await ack(a.s, "studio.update", { sessionId: sid, patch: { countdownSec: 3 } });
    await ack(a.s, "shot.arm", { sessionId: sid, shotIndex: 0, confirmNotReady: true });
    await untilT0(a.s);

    const prep = await ack(a.s, "attempt.prepare", { sessionId: sid, shotIndex: 0 });
    const d = prep.data as AttemptPrepared;
    const pv = await jpeg(320, 240, 1);
    expect((await fetch(d.uploadUrls.preview.url, { method: "PUT", headers: { "Content-Type": "image/svg+xml" }, body: pv })).status).toBe(403);
    expect((await fetch(`${d.uploadUrls.preview.url}x`, { method: "PUT", headers: d.uploadUrls.preview.headers, body: pv })).status).toBe(403);
    expect((await fetch(d.uploadUrls.full.url, { method: "PUT", headers: d.uploadUrls.full.headers, body: Buffer.alloc(9 * 1024 * 1024, 1) })).status).toBe(413);
    // Upload non-JPEG menyamar → UPLOAD_MISMATCH (FORMAT)
    const fake = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".repeat(5));
    expect((await fetch(d.uploadUrls.preview.url, { method: "PUT", headers: d.uploadUrls.preview.headers, body: fake })).status).toBe(200);
    expect(await ack(a.s, "attempt.uploaded", { attemptId: d.attemptId, part: "preview", bytes: fake.byteLength, width: 320, height: 240, sha256: sha(fake) })).toMatchObject({
      ok: false,
      error: "UPLOAD_MISMATCH",
      reason: "FORMAT",
    });
    // B (bukan pemilik) tidak bisa mengunggah / menerima / mengulang attempt A
    expect(await ack(b.s, "attempt.uploaded", { attemptId: d.attemptId, part: "preview", bytes: pv.byteLength, width: 320, height: 240, sha256: sha(pv) })).toMatchObject({ ok: false, error: "FORBIDDEN_NOT_OWNER" });
    expect(await ack(b.s, "capture.accept", { sessionId: sid, shotIndex: 0, attemptId: d.attemptId })).toMatchObject({ ok: false, error: "FORBIDDEN_NOT_OWNER" });
    expect(await ack(b.s, "capture.retake", { sessionId: sid, shotIndex: 0, attemptId: d.attemptId })).toMatchObject({ ok: false, error: "FORBIDDEN_NOT_OWNER" });
    // Preview belum terverifikasi → 404; cookie room lain / tanpa cookie → 401
    expect((await b.c.request("GET", `/api/rooms/${code}/attempts/${d.attemptId}/url?part=preview`)).status).toBe(404);
    const other = new Client(holder.srv!);
    await other.create("Orang Lain");
    expect((await other.request("GET", `/api/rooms/${code}/attempts/${d.attemptId}/url?part=preview`)).status).toBe(401);
    expect((await new Client(holder.srv!).request("GET", `/api/rooms/${code}/attempts/${d.attemptId}/url?part=preview`)).status).toBe(401);
  });

  it("room bubar → semua objek attempt terhapus & data room bersih (TC-SEC-030)", async () => {
    const { roomId, sid, people } = await room(2, { PARTICIPANT_HOLD_SECONDS: "0.3", ROOM_GRACE_PERIOD_SECONDS: "1.5" });
    const [a, b] = people as [P, P];
    await ack(a.s, "studio.update", { sessionId: sid, patch: { countdownSec: 3 } });
    await ack(a.s, "shot.arm", { sessionId: sid, shotIndex: 0, confirmNotReady: true });
    await untilT0(a.s);
    await shoot(a, sid, 0, 1);
    await shoot(b, sid, 0, 2);
    expect((await holder.srv!.storage.list(`rooms/${roomId}/attempts/`)).length).toBe(6);
    a.s.close();
    b.s.close();
    await sleep(3500);
    expect(await holder.srv!.storage.list(`rooms/${roomId}/`)).toEqual([]);
    expect(await holder.srv!.store.countRoomData(roomId)).toBe(0);
  });
});
