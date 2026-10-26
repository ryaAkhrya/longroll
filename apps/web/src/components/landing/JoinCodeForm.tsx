"use client";

import { isCompleteRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from "@longroll/shared";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import styles from "./JoinCodeForm.module.css";

export const JOIN_INPUT_ID = "kode-room";

/**
 * Input kode di landing. Hanya validasi UI + navigasi ke /r/[code]; belum memanggil API (P02).
 * Huruf besar otomatis, karakter di luar alfabet DEC-022 diabaikan, maks. 6.
 */
export function JoinCodeForm({ className }: { className?: string }) {
  const router = useRouter();
  const errId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isCompleteRoomCode(code)) {
      setError(`Kode room terdiri dari ${ROOM_CODE_LENGTH} karakter.`);
      return;
    }
    router.push(`/r/${code}`);
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => {
            setCode(normalizeRoomCode(e.target.value));
            setError("");
          }}
        />
        <Button type="submit" variant="soft" size="md">
          Gabung
        </Button>
      </div>
      <p id={errId} className={styles.error} aria-live="polite">
        {error}
      </p>
    </form>
  );
}
