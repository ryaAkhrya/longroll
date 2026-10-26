import { isCompleteRoomCode, normalizeRoomCode } from "@longroll/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Banner } from "@/components/ui/Banner";
import { buttonClass } from "@/components/ui/Button";
import { PreviewBadge } from "@/components/room/PreviewBadge";
import { PreviewLobby } from "@/components/room/PreviewLobby";
import { RoomApp } from "@/components/room/RoomApp";
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
 * Aplikasi room (13 §3). `/r/new` → SCR-02, `/r/{KODE}` → resume/SCR-03/SCR-05/SCR-21 (client-side).
 * `?preview=lobby|expired` hanya di dev: tampilan statis dengan data contoh, tanpa realtime service.
 */
export default async function RoomPage({ params, searchParams }: Props) {
  const { code: rawCode } = await params;
  const sp = await searchParams;
  const preview = process.env.NODE_ENV !== "production" ? parsePreview(sp.preview) : null;
  const isNew = rawCode.toLowerCase() === "new";
  const code = normalizeRoomCode(safeDecode(rawCode));

  if (preview === "lobby") return <PreviewLobby />;
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

  if (isNew) return <RoomApp key="new" code="new" />;

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

  return <RoomApp key={code} code={code} />;
}
