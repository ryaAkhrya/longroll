import { isCompleteRoomCode, normalizeRoomCode } from "@longroll/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { AppShell } from "@/components/layout/AppShell";
import { MobileRoomHeader } from "@/components/layout/MobileRoomHeader";
import { RoomHeader } from "@/components/layout/RoomHeader";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Banner } from "@/components/ui/Banner";
import { buttonClass } from "@/components/ui/Button";
import { CreateRoomForm } from "@/components/room/CreateRoomForm";
import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import { LobbyLayout } from "@/components/room/LobbyLayout";
import { PreviewBadge } from "@/components/room/PreviewBadge";
import { RoomClosed } from "@/components/room/RoomClosed";
import { parsePreview, SAMPLE_ROOM } from "@/lib/sample-room";

export const metadata: Metadata = { title: "Room", robots: { index: false } };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Kerangka aplikasi room (13 §3). P01: hanya layout.
 * - `/r/new` → SCR-02, `/r/{KODE}` → SCR-03 (tombol belum aktif sampai P02).
 * - `?preview=lobby|expired|join|create` hanya aktif di dev dan memakai data contoh.
 */
export default async function RoomPage({ params, searchParams }: Props) {
  const { code: rawCode } = await params;
  const sp = await searchParams;
  const preview = process.env.NODE_ENV !== "production" ? parsePreview(sp.preview) : null;
  const isNew = rawCode.toLowerCase() === "new";
  const code = normalizeRoomCode(safeDecode(rawCode));

  if (preview === "lobby") {
    const room = SAMPLE_ROOM;
    return (
      <AppShell
        header={
          <>
            <RoomHeader code={room.code} participants={room.participants} statusTag="Lobby" />
            <MobileRoomHeader code={room.code} participants={room.participants} />
          </>
        }
      >
        <Container>
          <PreviewBadge />
        </Container>
        <LobbyLayout room={room} />
      </AppShell>
    );
  }

  if (preview === "expired") {
    return (
      <AppShell header={<SiteHeader />}>
        <Container>
          <PreviewBadge derived />
          <RoomClosed code={isCompleteRoomCode(code) ? code : SAMPLE_ROOM.code} />
        </Container>
      </AppShell>
    );
  }

  if (isNew || preview === "create") {
    return (
      <AppShell header={<SiteHeader />}>
        <Container size="narrow">
          {preview === "create" && <PreviewBadge derived />}
          <CreateRoomForm />
        </Container>
      </AppShell>
    );
  }

  if (!isCompleteRoomCode(code)) {
    return (
      <AppShell header={<SiteHeader />}>
        <Container size="narrow">
          <Banner
            tone="error"
            title="Kode room tidak valid."
            action={
              <Link href="/" className={buttonClass({ variant: "secondary", size: "sm" })}>
                Ke beranda
              </Link>
            }
          >
            Kode terdiri dari 6 huruf atau angka. Cek lagi link dari temenmu.
          </Banner>
        </Container>
      </AppShell>
    );
  }

  return (
    <AppShell header={<SiteHeader />}>
      <Container size="narrow">
        {preview === "join" && <PreviewBadge derived />}
        <JoinRoomForm code={code} previewRoom={preview === "join" ? SAMPLE_ROOM : undefined} />
      </Container>
    </AppShell>
  );
}
