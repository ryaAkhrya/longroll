"use client";

import { useEffect, useRef, useState } from "react";
import { MODE_INFO, SESSION_CONFIG } from "@longroll/shared";
import type { ParticipantView, SessionResponse } from "@longroll/shared";
import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { MobileRoomHeader } from "@/components/layout/MobileRoomHeader";
import { RoomHeader } from "@/components/layout/RoomHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CameraCheck } from "@/components/media/CameraCheck";
import { CameraPanelDialog } from "@/components/media/CameraPanelDialog";
import { MediaProvider } from "@/media/MediaProvider";
import { RoomClient } from "@/room/client";
import { useNow, useOrigin, useRoomState } from "@/room/hooks";
import { SessionStepper } from "@/components/session/SessionStepper";
import { VoteResult } from "@/components/session/VoteResult";
import { VotingScreen } from "@/components/session/VotingScreen";
import { StudioContainer } from "@/components/studio/StudioContainer";
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
  const [cameraPanel, setCameraPanel] = useState(false);
  // SCR-04 sekali per room per tab; reload melompatinya (kamera dipulihkan otomatis bila izin sudah ada).
  const [checkDone, setCheckDone] = useState(() => {
    try {
      return sessionStorage.getItem(`lr:camcheck:${session.roomId}`) === "1";
    } catch {
      return false;
    }
  });
  const finishCheck = () => {
    try {
      sessionStorage.setItem(`lr:camcheck:${session.roomId}`, "1");
    } catch {
      /* abaikan */
    }
    setCheckDone(true);
  };
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
        } else if (e.type === "session.invite") {
          const { from, index } = e.payload as { from: string; index: number };
          const p = s.room?.participants.find((x) => x.participantId === from);
          if (p && from !== s.me) toast.show({ message: `${p.displayName} mulai vote mode · sesi ${index}` });
        } else if (e.type === "vote.resolved") {
          const { mode, method } = e.payload as { mode: keyof typeof MODE_INFO; method: string };
          if (method === "RANDOM") toast.show({ message: `Booth lempar koin: ${MODE_INFO[mode].name}` });
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

  // Routing layar dari state sesi otoritatif (13 §3: semua layar adalah state di /r/[code]).
  const live = room?.activeSession && room.activeSession.state !== "CLOSED" ? room.activeSession : null;
  const [enteredBooth, setEnteredBooth] = useState<string | null>(null);
  const resultPending = !!live && live.state !== "VOTING" && live.lockedAtMs !== null && enteredBooth !== live.sessionId;
  const nowMs = useNow(250, resultPending);
  const showResult = resultPending && nowMs + state.clockOffsetMs < live!.lockedAtMs! + SESSION_CONFIG.studioAutoEnterMs;
  const view: "check" | "lobby" | "voting" | "result" | "studio" = !checkDone
    ? "check"
    : !live
      ? "lobby"
      : live.state === "VOTING"
        ? "voting"
        : showResult
          ? "result"
          : "studio";

  const startVote = async () => {
    const ack = await client.sendIntent("session.create", {});
    if (!ack.ok)
      toast.show({
        message:
          ack.error === "SESSION_LIMIT"
            ? "Room ini udah 20 sesi. Bikin room baru buat lanjut."
            : ack.error === "SESSION_ACTIVE_NOT_FINAL"
              ? "Sesi yang jalan harus selesai dulu."
              : "Gagal mulai vote, coba lagi.",
        tone: "warn",
      });
  };

  const stepper = live ? <SessionStepper state={live.state} /> : null;
  const header = (
    <>
      <RoomHeader
        code={code}
        participants={active}
        statusTag={live ? undefined : "Lobby"}
        center={stepper}
        onLeave={room ? () => setLeaveOpen(true) : undefined}
      />
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

  const devCursors = (surface: "lobby" | "vote") =>
    room && (surface === "vote" || process.env.NODE_ENV !== "production") ? (
      <CursorLayer client={client} surface={surface} participants={room.participants} />
    ) : null;

  return (
    <MediaProvider client={client} code={code} inCheck={!checkDone}>
      <AppShell header={header} theme={view === "studio" ? "stage" : "light"}>
        <ConnectionBanner status={state.status} attempt={state.attempt} />
        {!room ? (
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
        ) : view === "check" ? (
          <CameraCheck onDone={finishCheck} />
        ) : view === "lobby" ? (
          <LobbyLayout
            room={room}
            meId={state.me}
            inviteUrl={inviteUrl}
            clockOffsetMs={state.clockOffsetMs}
            onOpenCameraPanel={() => setCameraPanel(true)}
            onStartVote={() => void startVote()}
            gridOverlay={devCursors("lobby")}
          />
        ) : view === "voting" ? (
          <VotingScreen
            client={client}
            session={live!}
            participants={room.participants}
            meId={state.me}
            clockOffsetMs={state.clockOffsetMs}
            overlay={devCursors("vote")}
          />
        ) : view === "result" ? (
          <VoteResult
            session={live!}
            participants={room.participants}
            clockOffsetMs={state.clockOffsetMs}
            onEnter={() => setEnteredBooth(live!.sessionId)}
          />
        ) : (
          <StudioContainer
            client={client}
            room={room}
            session={live!}
            meId={state.me}
            clockOffsetMs={state.clockOffsetMs}
            inviteUrl={inviteUrl}
            onOpenCameraPanel={() => setCameraPanel(true)}
          />
        )}
        <LeaveDialog
          open={leaveOpen}
          onClose={() => setLeaveOpen(false)}
          onConfirm={() => client.leave()}
          isLast={isLast}
          graceMinutes={graceMinutes}
        />
        <CameraPanelDialog open={cameraPanel} onClose={() => setCameraPanel(false)} />
      </AppShell>
    </MediaProvider>
  );
}
