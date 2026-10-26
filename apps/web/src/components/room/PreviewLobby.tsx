"use client";

import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { MobileRoomHeader } from "@/components/layout/MobileRoomHeader";
import { RoomHeader } from "@/components/layout/RoomHeader";
import { SAMPLE_ME, SAMPLE_ROOM } from "@/lib/sample-room";
import { useOrigin } from "@/room/hooks";
import { LobbyLayout } from "./LobbyLayout";
import { PreviewBadge } from "./PreviewBadge";

/** Pratinjau visual lobby (dev) dengan data statis; tidak terhubung ke realtime service. */
export function PreviewLobby() {
  const origin = useOrigin();
  const room = SAMPLE_ROOM;
  const active = room.participants.filter((p) => p.connection !== "LEFT");
  return (
    <AppShell
      header={
        <>
          <RoomHeader code={room.code} participants={active} statusTag="Lobby" />
          <MobileRoomHeader code={room.code} participants={active} />
        </>
      }
    >
      <Container>
        <PreviewBadge />
      </Container>
      <LobbyLayout room={room} meId={SAMPLE_ME} inviteUrl={`${origin}/r/${room.code}`} />
    </AppShell>
  );
}
