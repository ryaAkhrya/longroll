"use client";

import { LIMITS, nameLength, validateDisplayName } from "@longroll/shared";
import type { SessionResponse } from "@longroll/shared";
import { useState } from "react";
import type { FormEvent } from "react";
import { PhotoStrip } from "@/components/brand/PhotoStrip";
import { Avatar } from "@/components/ui/Avatar";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { api } from "@/room/api";
import { errorMessage, nameError } from "@/room/messages";
import styles from "./FormCard.module.css";

/** SCR-02 (DERIVED): isi nama → POST /api/rooms → cookie kredensial HttpOnly di-set server. */
export function CreateRoomForm({ onCreated }: { onCreated: (session: SessionResponse) => void }) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      onCreated(await api.createRoom(check.value));
    } catch (err) {
      setError(errorMessage(err, { action: "create" }));
      setBusy(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="create-title" padding="lg" className={styles.card}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div>
          <p className="cap">Room baru</p>
          <h1 id="create-title" className={`dc ${styles.title}`}>
            Bikin room, <span className="s">kasih nama.</span>
          </h1>
        </div>
        <Input
          label="Nama panggilan"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name && setTouched(true)}
          counter={`${length}/${LIMITS.displayNameMax}`}
          error={fieldError}
          hint="Cuma buat ditampilin di room ini. Tanpa akun."
          autoComplete="nickname"
          enterKeyHint="done"
          disabled={busy}
          autoFocus
        />
        <div className={styles.colorNote}>
          <Avatar name={check.ok ? check.value : "?"} color="P1" size={28} />
          <span>Kamu dapat warna Peach. Warna peserta ditentukan otomatis.</span>
        </div>
        <div aria-live="polite">{error && <Banner tone="error">{error}</Banner>}</div>
        <Button type="submit" variant="primary" size="xl" fullWidth disabled={!check.ok} loading={busy}>
          {busy ? "Bikin room…" : "Bikin room"}
        </Button>
      </form>
      <div className={styles.art} aria-hidden="true">
        <PhotoStrip empty className={styles.strip} />
      </div>
    </Card>
  );
}
