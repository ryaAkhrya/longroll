"use client";

import { useEffect, useRef } from "react";
import type { CursorSurface, ParticipantView } from "@longroll/shared";
import { CURSOR } from "@longroll/shared";
import type { RoomClient } from "@/room/client";
import { createCursorSender } from "@/room/cursors";
import { useCursors, useMediaQuery } from "@/room/hooks";
import styles from "./CursorLayer.module.css";

interface CursorLayerProps {
  client: RoomClient;
  surface: CursorSurface;
  participants: ParticipantView[];
}

/**
 * Kursor multiplayer desktop (07 §8): hanya `pointer: fine`, koordinat 0..1 relatif permukaan,
 * kirim ≤ 20 Hz & ≥ 2 px, render interpolasi linear ≤ 100 ms, hilang setelah 5 s diam.
 * Dekoratif untuk pembaca layar (aria-hidden).
 */
export function CursorLayer({ client, surface, participants }: CursorLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fine = useMediaQuery("(pointer: fine)");
  const cursors = useCursors(client);

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!fine || !host) return;
    const sender = createCursorSender((x, y) => client.sendCursor(surface, x, y));
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      const r = host.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      sender.move(px / r.width, py / r.height, px, py);
    };
    host.addEventListener("pointermove", onMove);
    return () => {
      host.removeEventListener("pointermove", onMove);
      sender.dispose();
    };
  }, [client, surface, fine]);

  if (!fine) return <div ref={ref} hidden />;
  const byId = new Map(participants.map((p) => [p.participantId, p]));

  return (
    <div ref={ref} className={styles.layer} aria-hidden="true">
      {cursors
        .filter((c) => c.surface === surface)
        .map((c) => {
          const p = byId.get(c.participantId);
          if (!p || p.connection === "LEFT") return null;
          return (
            <div
              key={c.participantId}
              className={styles.cursor}
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                transition: `left ${CURSOR.interpolateMs}ms linear, top ${CURSOR.interpolateMs}ms linear`,
              }}
            >
              <svg width="15" height="17" viewBox="0 0 15 17" className={styles.arrow}>
                <path d="M1 1 L1 15 L5 11 L8 16 L10.5 15 L7.6 10 L13 10 Z" style={{ fill: `var(--${p.color.toLowerCase()}-mid)` }} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              <span className={styles.label} style={{ background: `var(--${p.color.toLowerCase()}-mid)` }}>
                {c.label ? `${p.displayName} · ${c.label}` : p.displayName}
              </span>
            </div>
          );
        })}
    </div>
  );
}
