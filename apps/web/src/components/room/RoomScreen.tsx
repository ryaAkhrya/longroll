"use client";

import { useEffect, useRef, useState } from "react";
import { MODE_INFO, SESSION_CONFIG } from "@longroll/shared";
import type { ParticipantView, SessionResponse, SessionView } from "@longroll/shared";
import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { MobileRoomHeader } from "@/components/layout/MobileRoomHeader";
import { RoomHeader } from "@/components/layout/RoomHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ToastLane, useToast } from "@/components/ui/Toast";
import { CameraCheck } from "@/components/media/CameraCheck";
import { CameraPanelDialog } from "@/components/media/CameraPanelDialog";
import { MediaProvider } from "@/media/MediaProvider";
import { RoomClient } from "@/room/client";
import { useNow, useOrigin, useRoomState } from "@/room/hooks";
import { SessionStepper } from "@/components/session/SessionStepper";
import { VoteResult } from "@/components/session/VoteResult";
import { VotingScreen } from "@/components/session/VotingScreen";
import dynamic from "next/dynamic";
import { GalleryScreen } from "@/components/result/GalleryScreen";
import { InviteDialog } from "@/components/result/InviteDialog";
import { peerStatus, useInviteStatus } from "@/components/result/inviteStatus";
import { PreviewWorker } from "@/components/result/PreviewWorker";
import { ResultScreen } from "@/components/result/ResultScreen";
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
/** Editor di-lazy-load (Konva + Yjs) supaya JS rute room tetap ringan (13 §14). */
const EditorScreen = dynamic(() => import("@/components/editor/EditorScreen").then((m) => m.EditorScreen), {
  ssr: false,
  loading: () => <div role="status" aria-label="Memuat editor" style={{ flex: 1 }} />,
});

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
  // SCR-17/19: hasil FINAL terakhir yang saya lihat tetap tampil bila saya memilih "Bentar" saat sesi baru dimulai.
  const [lastFinal, setLastFinal] = useState<SessionView | null>(null);
  if (live?.state === "FINAL" && lastFinal !== live) setLastFinal(live);
  const [showGallery, setShowGallery] = useState(false);
  const [invite, setInvite] = useState<{ sessionId: string; kind: "join" | "later" } | null>(null);
  const newer = live && lastFinal && live.sessionId !== lastFinal.sessionId && live.index > lastFinal.index ? live : null;
  const answered = newer && invite?.sessionId === newer.sessionId ? invite.kind : null;
  const mine = !!newer && newer.createdBy === state.me;
  const askInvite = !!newer && !mine && answered === null;
  // SCR-19: status peserta lain (Ikut / Bentar / Lagi unduh… / Belum jawab) lewat presence.activity (volatile, info UX saja).
  const peerMap = useInviteStatus(client, newer && !mine ? newer.sessionId : null, answered);
  const invitePeers = newer
    ? active
        .filter((p) => p.participantId !== state.me)
        .map((p) => ({ participantId: p.participantId, name: p.displayName, color: p.color, status: p.participantId === newer.createdBy ? ("join" as const) : peerStatus(peerMap[p.participantId]) }))
    : [];
  const deferred = !!newer && !mine && answered !== "join";
  const resultPending = !!live && live.state !== "VOTING" && live.lockedAtMs !== null && enteredBooth !== live.sessionId;
  const nowMs = useNow(250, resultPending);
  const showResult = resultPending && nowMs + state.clockOffsetMs < live!.lockedAtMs! + SESSION_CONFIG.studioAutoEnterMs;
  const view: "check" | "lobby" | "voting" | "result" | "studio" | "editing" | "final" | "deferred" = !checkDone
    ? "check"
    : deferred && lastFinal?.result
      ? "deferred"
      : !live
        ? "lobby"
        : live.state === "VOTING"
          ? "voting"
          : showResult
            ? "result"
            : live.state === "FINAL"
              ? "final"
              : live.state === "EDITING"
                ? "editing"
                : "studio";

  // Layar baru selalu dibuka dari atas: posisi gulir lobby tidak boleh terbawa ke vote/studio (konten ke-gulir di bawah header).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, showGallery]);

  const startVote = async () => {
    const ack = await client.sendIntent("session.create", {});
    if (ack.ok) setShowGallery(false);
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
        ) : showGallery ? (
          <GalleryScreen client={client} room={room} onBack={() => setShowGallery(false)} onNewSession={() => void startVote()} />
        ) : view === "deferred" ? (
          <ResultScreen
            client={client}
            room={room}
            session={lastFinal!}
            meId={state.me!}
            closed
            onGallery={() => setShowGallery(true)}
            onNewSession={() => setInvite({ sessionId: live!.sessionId, kind: "join" })}
            newSession={{ index: live!.index, label: live!.state === "VOTING" ? "vote" : "jalan", onJoin: () => setInvite({ sessionId: live!.sessionId, kind: "join" }) }}
          />
        ) : view === "final" ? (
          <ResultScreen client={client} room={room} session={live!} meId={state.me!} onGallery={() => setShowGallery(true)} onNewSession={() => void startVote()} />
        ) : view === "lobby" ? (
          <>
            <ToastLane />
            <LobbyLayout
              room={room}
              meId={state.me}
              inviteUrl={inviteUrl}
              clockOffsetMs={state.clockOffsetMs}
              onOpenCameraPanel={() => setCameraPanel(true)}
              onStartVote={() => void startVote()}
              gridOverlay={devCursors("lobby")}
            />
          </>
        ) : view === "voting" ? (
          <>
            <ToastLane />
            <VotingScreen
              client={client}
              session={live!}
              participants={room.participants}
              meId={state.me}
              clockOffsetMs={state.clockOffsetMs}
              overlay={devCursors("vote")}
            />
          </>
        ) : view === "result" ? (
          <VoteResult
            session={live!}
            participants={room.participants}
            clockOffsetMs={state.clockOffsetMs}
            onEnter={() => setEnteredBooth(live!.sessionId)}
          />
        ) : view === "editing" ? (
          <EditorScreen client={client} room={room} session={live!} meId={state.me!} />
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
        {room && state.me && checkDone && <PreviewWorker client={client} room={room} meId={state.me} />}
        <InviteDialog
          open={askInvite}
          from={room?.participants.find((p) => p.participantId === newer?.createdBy)?.displayName ?? "Seseorang"}
          index={newer?.index ?? 0}
          peers={invitePeers}
          onJoin={() => (setShowGallery(false), setInvite({ sessionId: newer!.sessionId, kind: "join" }))}
          onLater={() => setInvite({ sessionId: newer!.sessionId, kind: "later" })}
        />
        <LeaveDialog
          open={leaveOpen}
          onClose={() => setLeaveOpen(false)}
          onConfirm={() => client.leave()}
          isLast={isLast}
          graceMinutes={graceMinutes}
          hasResults={!!lastFinal}
          onDownloadAll={() => (setLeaveOpen(false), setShowGallery(true))}
        />
        <CameraPanelDialog open={cameraPanel} onClose={() => setCameraPanel(false)} />
      </AppShell>
    </MediaProvider>
  );
}
