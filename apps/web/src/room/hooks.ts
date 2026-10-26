"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { RoomClient } from "./client";

export function useRoomState(client: RoomClient) {
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}

export function useCursors(client: RoomClient) {
  return useSyncExternalStore(client.cursors.subscribe, client.cursors.getSnapshot, client.cursors.getSnapshot);
}

/** Jam yang berdetak tiap `intervalMs` (untuk hitung mundur hold slot). */
export function useNow(intervalMs = 1_000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

const subscribeNone = () => () => {};

/** Media query aman SSR. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (fn) => {
      if (typeof window === "undefined") return subscribeNone();
      const mq = window.matchMedia(query);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function useOrigin() {
  return useSyncExternalStore(subscribeNone, getOrigin, getServerOrigin);
}
