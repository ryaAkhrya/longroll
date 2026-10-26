"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SessionResponse } from "@longroll/shared";
import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/room/api";
import { errorMessage } from "@/room/messages";
import { CreateRoomForm } from "./CreateRoomForm";
import { JoinRoomForm } from "./JoinRoomForm";
import { RoomClosed } from "./RoomClosed";
import { RoomScreen } from "./RoomScreen";
import styles from "./RoomApp.module.css";

type Phase =
  | { kind: "checking" }
  | { kind: "create" }
  | { kind: "join"; notice?: string }
  | { kind: "room"; session: SessionResponse }
  | { kind: "expired"; graceSeconds?: number }
  | { kind: "error"; message: string };

/**
 * Aplikasi room di `/r/[code]` (13 §3): semua layar room adalah state di rute ini.
 * Cookie kredensial valid → langsung resume (F-04); tanpa kredensial → SCR-03; room bubar → SCR-21.
 */
export function RoomApp({ code }: { code: string }) {
  const router = useRouter();
  const isNew = code === "new";
  const [phase, setPhase] = useState<Phase>(isNew ? { kind: "create" } : { kind: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    api.session(code).then(
      (session) => alive && setPhase({ kind: "room", session }),
      (err) => {
        if (!alive) return;
        if (err instanceof ApiError) {
          if (err.code === "AUTH_INVALID" || err.code === "AUTH_REQUIRED" || err.code === "ROOM_NOT_FOUND") return setPhase({ kind: "join" });
          if (err.code === "ROOM_EXPIRED") return setPhase({ kind: "expired", graceSeconds: err.body?.graceSeconds });
        }
        setPhase({ kind: "error", message: errorMessage(err, { code }) });
      },
    );
    return () => {
      alive = false;
    };
  }, [code, isNew, attempt]);

  const onExpired = useCallback((graceSeconds?: number) => setPhase({ kind: "expired", graceSeconds }), []);
  const onJoined = useCallback((session: SessionResponse) => setPhase({ kind: "room", session }), []);
  const onCreated = useCallback((session: SessionResponse) => router.replace(`/r/${session.roomCode}`), [router]);
  const onUnauthorized = useCallback(
    (holdSeconds: number) =>
      setPhase({
        kind: "join",
        notice: `Slot kamu udah dilepas karena terputus lebih dari ${holdSeconds} detik. Gabung lagi pakai nama kamu.`,
      }),
    [],
  );
  const onLeft = useCallback(() => router.push("/"), [router]);

  if (phase.kind === "room") {
    return (
      <RoomScreen
        code={code}
        session={phase.session}
        onExpired={() => onExpired()}
        onUnauthorized={onUnauthorized}
        onLeft={onLeft}
      />
    );
  }

  return (
    <AppShell header={<SiteHeader />}>
      <Container size={phase.kind === "expired" ? "default" : "narrow"} className={styles.page}>
        {phase.kind === "checking" && (
          <div role="status" aria-label="Mengecek room" className={styles.checking}>
            <Skeleton width={120} height={12} />
            <Skeleton width="70%" height={40} radius={12} />
            <Skeleton height={240} radius={20} />
          </div>
        )}
        {phase.kind === "create" && <CreateRoomForm onCreated={onCreated} />}
        {phase.kind === "join" && <JoinRoomForm code={code} notice={phase.notice} onJoined={onJoined} onExpired={onExpired} />}
        {phase.kind === "expired" && <RoomClosed code={code} graceSeconds={phase.graceSeconds} />}
        {phase.kind === "error" && (
          <Banner
            tone="error"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPhase({ kind: "checking" });
                  setAttempt((n) => n + 1);
                }}
              >
                Coba lagi
              </Button>
            }
          >
            {phase.message}
          </Banner>
        )}
      </Container>
    </AppShell>
  );
}
