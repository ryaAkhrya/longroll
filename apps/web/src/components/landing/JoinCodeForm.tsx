"use client";

import { isCompleteRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from "@longroll/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import { api, ApiError } from "@/room/api";
import { errorMessage } from "@/room/messages";
import styles from "./JoinCodeForm.module.css";

export const JOIN_INPUT_ID = "kode-room";

/**
 * Input kode di landing (F-03): huruf besar otomatis, karakter di luar alfabet DEC-022 diabaikan,
 * maks. 6. Gabung → preview → error inline atau lanjut ke SCR-03.
 */
export function JoinCodeForm({ className }: { className?: string }) {
  const router = useRouter();
  const errId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isCompleteRoomCode(code)) {
      setError(`Kode room terdiri dari ${ROOM_CODE_LENGTH} karakter.`);
      return;
    }
    setBusy(true);
    setError("");
    setFull(false);
    try {
      const preview = await api.preview(code);
      if (preview.participantCount >= preview.capacity) {
        setFull(true);
        setError(
          preview.holding > 0
            ? "Room penuh. Ada yang lagi nyambung lagi, coba sebentar lagi."
            : `Udah ${preview.capacity} orang di dalem.`,
        );
        setBusy(false);
        return;
      }
      router.push(`/r/${code}`);
    } catch (err) {
      setError(errorMessage(err, { code, action: "join" }));
      setFull(err instanceof ApiError && err.code === "ROOM_FULL");
      setBusy(false);
    }
  };

  return (
    <form className={cx(styles.form, className)} onSubmit={submit} noValidate>
      <div className={cx(styles.group, error && styles.invalid)}>
        <label htmlFor={JOIN_INPUT_ID} className="sr-only">
          Kode room
        </label>
        <input
          id={JOIN_INPUT_ID}
          className={cx(styles.input, "tnum")}
          value={code}
          placeholder="KODE ROOM"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          readOnly={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => {
            setCode(normalizeRoomCode(e.target.value));
            setError("");
            setFull(false);
          }}
        />
        <Button type="submit" variant="soft" size="md" loading={busy}>
          Gabung
        </Button>
      </div>
      <p id={errId} className={styles.error} aria-live="polite">
        {error}
        {full && (
          <>
            {" "}
            <Link href="/r/new" className={styles.link}>
              Bikin room baru
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
