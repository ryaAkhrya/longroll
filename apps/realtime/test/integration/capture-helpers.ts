import { expect } from "vitest";
import type { AttemptPrepared, CaptureState, S2C } from "@longroll/shared";
import { jpeg, sha } from "../fixtures/capture";
import { Client, ORIGIN, sleep, startServer } from "./helpers";
import type { Socket, TestServer } from "./helpers";

export const holder: { srv: TestServer | null } = { srv: null };

export interface P {
  c: Client;
  s: Socket;
  id: string;
  name: string;
}

export const ack = (s: Socket, type: string, payload: unknown) => {
  const id = `e-${Math.random().toString(36).slice(2)}`;
  s.send(type, payload, id);
  return s.waitFor("ack", (m) => m.replyTo === id).then((m) => m.payload as { ok: boolean; error?: string; data?: unknown; reason?: string });
};

/** Room nyata lewat HTTP + WS: n peserta, voting selesai, kamera live + siap. */
export async function room(n: number, env: Record<string, string> = {}) {
  const srv = (holder.srv = await startServer(env));
  const a = new Client(srv);
  const created = await a.create("P1");
  const code = created.body!.roomCode as string;
  const roomId = created.body!.roomId as string;
  const people: P[] = [];
  const clients = [a];
  for (let i = 1; i < n; i++) {
    const c = new Client(srv);
    await c.join(code, `P${i + 1}`);
    clients.push(c);
  }
  for (let i = 0; i < n; i++) {
    const s = await clients[i]!.connect(code);
    const auth = await s.waitFor("auth.ok");
    people.push({ c: clients[i]!, s, id: (auth.payload as { participantId: string }).participantId, name: `P${i + 1}` });
  }
  await ack(people[0]!.s, "session.create", {});
  const st = await people[0]!.s.waitFor("session.state");
  const sid = (st.payload as { session: { sessionId: string } }).session.sessionId;
  for (const p of people) await ack(p.s, "vote.cast", { sessionId: sid, round: 1, mode: "PHOTO_STRIP" });
  for (const p of people) await ack(p.s, "presence.set", { camera: "live", ready: true });
  return { code, roomId, sid, people };
}

export const lastCapture = (s: Socket) => ([...s.messages].reverse().find((m: S2C) => m.type === "capture.state")?.payload as { capture: CaptureState }).capture;

/** Unggah lewat URL bertanda tangan SUNGGUHAN (PUT HTTP) lalu attempt.uploaded. */
export async function shoot(p: P, sid: string, shotIndex: number, seed: number, kind = "shot") {
  const prep = await ack(p.s, "attempt.prepare", { sessionId: sid, shotIndex, kind });
  expect(prep.ok).toBe(true);
  const d = prep.data as AttemptPrepared;
  const pv = await jpeg(320, 240, seed);
  const full = await jpeg(1280, 960, seed, { exif: "GPS-JANGAN-BOCOR" });
  for (const [part, bytes, w, h] of [
    ["preview", pv, 320, 240],
    ["full", full, 1280, 960],
  ] as const) {
    const u = d.uploadUrls[part];
    const put = await fetch(u.url, { method: "PUT", headers: { ...u.headers, Origin: ORIGIN }, body: bytes });
    expect(put.status).toBe(200);
    const r = await ack(p.s, "attempt.uploaded", { attemptId: d.attemptId, part, bytes: bytes.byteLength, width: w, height: h, sha256: sha(bytes), capturedAtServerMs: Date.now() });
    expect(r).toMatchObject({ ok: true });
  }
  return d.attemptId;
}

export async function untilT0(s: Socket) {
  const cd = await s.waitFor("shot.countdown");
  await sleep(Math.max(0, (cd.payload as { t0ServerMs: number }).t0ServerMs - Date.now()) + 200);
}

