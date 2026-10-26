"use client";

import { useEffect, useRef, useState } from "react";
import type { ParticipantView, SessionResponse } from "@longroll/shared";
import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { MobileRoomHeader } from "@/components/layout/MobileRoomHeader";
import { RoomHeader } from "@/components/layout/RoomHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { RoomClient } from "@/room/client";
import { useOrigin, useRoomState } from "@/room/hooks";
import { ConnectionBanner } from "./ConnectionBanner";
import { CursorLayer } from "./CursorLayer";
import { LeaveDialog } from "./LeaveDialog";
import { LobbyLayout } from "./LobbyLayout";
import styles from "./RoomScreen.module.css";

interface RoomScreenProps {
  code: string;
  session: SessionResponse;
  onExpired: () => void;
  onUnauthorized: (holdSeconds: number) => void;
  onLeft: () => void;
}

/** Event lebih tua dari ini (replay setelah reconnect) tidak memunculkan toast. */
const TOAST_MAX_AGE_MS = 10_000;

/**
 * Room tersambung: lobby SCR-05 + presence real-time, banner SCR-20(b), takeover multi-tab, keluar.
 * Kursor lobby hanya di dev (DEC-071 tidak menampilkan kursor di lobby; P02 memakainya sebagai permukaan uji).
 */
export function RoomScreen({ code, session, onExpired, onUnauthorized, onLeft }: RoomScreenProps) {
  const [client] = useState(() => new RoomClient(code, session));
  const state = useRoomState(client);
  const toast = useToast();
  const origin = useOrigin();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const holdSeconds = state.room?.config.holdSeconds ?? 60;

  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);

  // Toast presence ringan (04 SCR-22, maks. 3 bertumpuk di ToastProvider).
  useEffect(
    () =>
      client.onEvent((e) => {
        if (Date.now() - e.atMs > TOAST_MAX_AGE_MS) return;
        const s = client.getSnapshot();
        if (e.type === "participant.joined") {
          const p = (e.payload as { participant: ParticipantView }).participant;
          if (p.participantId !== s.me) toast.show({ message: `${p.displayName} masuk room` });
        } else if (e.type === "participant.left") {
          const id = (e.payload as { participantId: string }).participantId;
          const p = s.room?.participants.find((x) => x.participantId === id);
          if (p && id !== s.me) toast.show({ message: `${p.displayName} keluar room` });
        }
      }),
    [client, toast],
  );

  // Status terminal → serahkan ke RoomApp (sekali).
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    if (state.status === "expired") {
      handled.current = true;
      onExpired();
    } else if (state.status === "unauthorized") {
      handled.current = true;
      onUnauthorized(holdSeconds);
    } else if (state.status === "left") {
      handled.current = true;
      toast.show({ message: "Kamu udah keluar dari room" });
      onLeft();
    }
  }, [state.status, onExpired, onUnauthorized, onLeft, holdSeconds, toast]);

  const room = state.room;
  const active = room?.participants.filter((p) => p.connection !== "LEFT") ?? [];
  const inviteUrl = origin ? `${origin}/r/${code}` : `/r/${code}`;
  const others = active.filter((p) => p.participantId !== state.me);
  const isLast = others.length === 0;
  const graceMinutes = Math.max(1, Math.round((room?.config.graceSeconds ?? 120) / 60));

  const header = (
    <>
      <RoomHeader code={code} participants={active} statusTag="Lobby" onLeave={room ? () => setLeaveOpen(true) : undefined} />
      <MobileRoomHeader code={code} participants={active} inviteUrl={inviteUrl} onLeave={room ? () => setLeaveOpen(true) : undefined} />
    </>
  );

  if (state.status === "replaced") {
    return (
      <AppShell header={header}>
        <Container size="narrow">
          <Card as="section" padding="lg" className={styles.replaced} aria-labelledby="replaced-title">
            <h1 id="replaced-title" className="dc">
              LONGROLL dibuka <span className="s">di tab lain.</span>
            </h1>
            <p>Room ini sekarang aktif di tab atau jendela lain. Satu orang cuma bisa pakai satu tab.</p>
            <Button variant="primary" size="lg" onClick={() => client.takeOver()}>
              Pakai di sini
            </Button>
          </Card>
        </Container>
      </AppShell>
    );
  }

  return (
    <AppShell header={header}>
      <ConnectionBanner status={state.status} attempt={state.attempt} />
      {room ? (
        <LobbyLayout
          room={room}
          meId={state.me}
          inviteUrl={inviteUrl}
          clockOffsetMs={state.clockOffsetMs}
          gridOverlay={
            process.env.NODE_ENV !== "production" ? <CursorLayer client={client} surface="lobby" participants={room.participants} /> : null
          }
        />
      ) : (
        <Container>
          <div role="status" aria-label="Menyambung ke room" className={styles.loading}>
            <Skeleton width="50%" height={36} radius={12} />
            <div className={styles.loadingGrid}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height="100%" radius={18} />
              ))}
            </div>
          </div>
        </Container>
      )}
      <LeaveDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => client.leave()}
        isLast={isLast}
        graceMinutes={graceMinutes}
      />
    </AppShell>
  );
}
