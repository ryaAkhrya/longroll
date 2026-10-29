"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoomClient } from "@/room/client";

/**
 * Status peserta lain di SCR-19 (04 SCR-19: Ikut / Lagi unduh… / Belum jawab), lewat `presence.activity`
 * (volatile, ≤ 80 karakter, tidak disimpan, identitas pengirim dari server). Tidak ada otoritas: ini murni info UX —
 * "Bentar" tidak menahan apa pun di server (penutupan voting tetap DEC-023: menunggu peserta CONNECTED, 08 §4).
 */
export type InviteAnswer = "join" | "later";
export type PeerInviteStatus = InviteAnswer | "download" | "pending";

const INVITE = /^invite:([0-9a-f-]{36}):(join|later)$/;
export const EXPORT_BUSY = "export:busy";
export const EXPORT_IDLE = "export:idle";

export const inviteActivity = (sessionId: string, answer: InviteAnswer) => `invite:${sessionId}:${answer}`;

export type PeerMap = Record<string, { answer?: InviteAnswer; busy?: boolean }>;

/** Reducer murni: payload `presence.activity` → peta status per peserta untuk sesi `sessionId`. */
export function reduceActivity(prev: PeerMap, sessionId: string, payload: unknown): PeerMap {
  const p = payload as { participantId?: unknown; activity?: unknown } | null;
  if (!p || typeof p.participantId !== "string") return prev;
  const act = typeof p.activity === "string" ? p.activity : null;
  const cur = prev[p.participantId] ?? {};
  const m = act ? INVITE.exec(act) : null;
  if (m) return m[1] === sessionId ? { ...prev, [p.participantId]: { ...cur, answer: m[2] as InviteAnswer } } : prev;
  if (act === EXPORT_BUSY) return { ...prev, [p.participantId]: { ...cur, busy: true } };
  if (act === EXPORT_IDLE || act === null) return { ...prev, [p.participantId]: { ...cur, busy: false } };
  return prev;
}

export function peerStatus(entry: PeerMap[string] | undefined): PeerInviteStatus {
  if (entry?.answer === "join") return "join";
  if (entry?.busy) return "download";
  return entry?.answer ?? "pending";
}

const RESEND_MS = 4_000;

/**
 * Mendengarkan jawaban peserta lain untuk sesi baru `sessionId` dan menyiarkan jawaban sendiri. Jawaban
 * disiarkan ulang berkala karena volatile (peserta yang baru membuka dialog tetap melihatnya).
 */
const EMPTY: PeerMap = {};

export function useInviteStatus(client: RoomClient, sessionId: string | null, myAnswer: InviteAnswer | null): PeerMap {
  // Peta dikunci ke sesi: berganti sesi otomatis "kosong" tanpa efek reset.
  const [store, setStore] = useState<{ sid: string | null; map: PeerMap }>({ sid: null, map: EMPTY });

  useEffect(() => {
    if (!sessionId) return;
    return client.onSignal((type, payload) => {
      if (type !== "presence.activity") return;
      setStore((prev) => ({ sid: sessionId, map: reduceActivity(prev.sid === sessionId ? prev.map : EMPTY, sessionId, payload) }));
    });
  }, [client, sessionId]);

  const send = useCallback(() => {
    if (sessionId && myAnswer) client.sendVolatile("presence.activity", { activity: inviteActivity(sessionId, myAnswer) });
  }, [client, sessionId, myAnswer]);

  useEffect(() => {
    if (!sessionId || !myAnswer) return;
    send();
    const t = setInterval(send, RESEND_MS);
    return () => clearInterval(t);
  }, [send, sessionId, myAnswer]);

  return store.sid === sessionId ? store.map : EMPTY;
}
