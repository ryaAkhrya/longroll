"use client";

import { LIMITS, nameLength, validateDisplayName } from "@longroll/shared";
import type { PreviewResponse, SessionResponse } from "@longroll/shared";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Banner } from "@/components/ui/Banner";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeInput } from "@/components/ui/CodeInput";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/room/api";
import { errorMessage, nameError } from "@/room/messages";
import styles from "./FormCard.module.css";

interface JoinRoomFormProps {
  code: string;
  /** Pesan konteks, mis. slot dilepas setelah lama terputus. */
  notice?: string | null;
  onJoined: (session: SessionResponse) => void;
  onExpired: (graceSeconds?: number) => void;
}

type PreviewState =
  | { kind: "loading" }
  | { kind: "ok"; data: PreviewResponse }
  | { kind: "error"; message: string; retry: boolean; notFound?: boolean };

/** SCR-03 (DERIVED): kode terkunci → preview (inisial saja, tanpa feed) → nama → join. */
export function JoinRoomForm({ code, notice, onJoined, onExpired }: JoinRoomFormProps) {
  const [preview, setPreview] = useState<PreviewState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);

  // Ref: callback induk boleh berubah tanpa memicu fetch ulang.
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  });

  const [reload, setReload] = useState(0);

  // Preview dimuat ulang per kode / tombol "Coba lagi"; setState hanya di callback respons jaringan.
  useEffect(() => {
    let alive = true;
    api.preview(code).then(
      (data) => {
        if (!alive) return;
        setPreview({ kind: "ok", data });
        setFull(
          data.participantCount >= data.capacity
            ? data.holding > 0
              ? "Room penuh. Ada yang lagi nyambung lagi, coba sebentar lagi."
              : `Udah ${data.capacity} orang di dalem.`
            : null,
        );
      },
      (err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.code === "ROOM_EXPIRED") return onExpiredRef.current(err.body?.graceSeconds);
        setPreview({
          kind: "error",
          message: errorMessage(err, { code }),
          retry: !(err instanceof ApiError && err.code === "ROOM_NOT_FOUND"),
          notFound: err instanceof ApiError && err.code === "ROOM_NOT_FOUND",
        });
      },
    );
    return () => {
      alive = false;
    };
  }, [code, reload]);

  const retryPreview = () => {
    setPreview({ kind: "loading" });
    setReload((n) => n + 1);
  };

  const length = nameLength(name.trim());
  const check = validateDisplayName(name);
  const fieldError = !check.ok && (touched || length > LIMITS.displayNameMax) ? nameError(check.reason) : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!check.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      onJoined(await api.join(code, check.value));
    } catch (err) {
      if (err instanceof ApiError && err.code === "ROOM_EXPIRED") return onExpired(err.body?.graceSeconds);
      if (err instanceof ApiError && err.code === "ROOM_FULL") setFull(errorMessage(err));
      else setError(errorMessage(err, { code, action: "join" }));
      setBusy(false);
    }
  };

  if (preview.kind === "error" && preview.notFound) {
    return (
      <Card as="section" aria-labelledby="join-title" padding="lg" className={`${styles.card} ${styles.single}`}>
        <div className={styles.form}>
          <h1 id="join-title" className={`dc ${styles.title}`}>
            Room-nya <span className="s">gak ketemu.</span>
          </h1>
          <Banner tone="error">{preview.message}</Banner>
          <div className={styles.row}>
            <LinkButton href="/" variant="secondary" size="lg">
              Coba kode lain
            </LinkButton>
            <LinkButton href="/r/new" variant="primary" size="lg">
              Bikin room baru
            </LinkButton>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="join-title" padding="lg" className={`${styles.card} ${styles.single}`}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div>
          <p className="cap">Gabung room</p>
          <h1 id="join-title" className={`dc ${styles.title}`}>
            Ada yang <span className="s">ngajak kamu.</span>
          </h1>
        </div>
        {notice && <Banner tone="info">{notice}</Banner>}
        <CodeInput value={code} onChange={() => {}} readOnly />

        <div aria-live="polite">
          {preview.kind === "loading" && <Skeleton height={56} radius={12} />}
          {preview.kind === "ok" && (
            <div className={styles.found}>
              <span className={styles.initials} role="img" aria-label={`${preview.data.participantCount} orang di room`}>
                {preview.data.initials.map((ini, i) => (
                  <Avatar key={i} name={ini} color={preview.data.colors[i] ?? "P1"} size={30} ring />
                ))}
              </span>
              <p>
                <strong>Room ketemu</strong> ·{" "}
                <span className="tnum">
                  {preview.data.participantCount}/{preview.data.capacity}
                </span>
              </p>
            </div>
          )}
          {preview.kind === "error" && (
            <Banner
              tone="error"
              action={
                preview.retry ? (
                  <Button variant="secondary" size="sm" onClick={retryPreview}>
                    Coba lagi
                  </Button>
                ) : undefined
              }
            >
              {preview.message}
            </Banner>
          )}
        </div>

        {full ? (
          <>
            <Banner tone="warn">{full}</Banner>
            <LinkButton href="/r/new" variant="primary" size="xl" fullWidth>
              Bikin room baru
            </LinkButton>
          </>
        ) : (
          <>
            <Input
              label="Nama panggilan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name && setTouched(true)}
              counter={`${length}/${LIMITS.displayNameMax}`}
              error={fieldError}
              autoComplete="nickname"
              enterKeyHint="done"
              disabled={busy}
              autoFocus
            />
            <div aria-live="polite">{error && <Banner tone="error">{error}</Banner>}</div>
            <Button type="submit" variant="primary" size="xl" fullWidth disabled={!check.ok || preview.kind !== "ok"} loading={busy}>
              Gabung ke {code}
            </Button>
          </>
        )}
      </form>
    </Card>
  );
}
