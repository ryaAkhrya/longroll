"use client";

import { LIMITS, PLAYER_COLOR_NAMES } from "@longroll/shared";
import { useState } from "react";
import { PhotoStrip } from "@/components/brand/PhotoStrip";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import styles from "./FormCard.module.css";

/**
 * Kerangka SCR-02 (DERIVED). Validasi nama hanya di UI; tombol belum membuat room (API di P02).
 */
export function CreateRoomForm() {
  const [name, setName] = useState("");
  const length = Array.from(name.trim()).length;
  const tooLong = length > LIMITS.displayNameMax;

  return (
    <Card as="section" aria-labelledby="create-title" padding="lg" className={styles.card}>
      <form className={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
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
          counter={`${length}/${LIMITS.displayNameMax}`}
          error={tooLong ? `Maksimal ${LIMITS.displayNameMax} karakter.` : undefined}
          hint="Cuma buat ditampilin di room ini. Tanpa akun."
          autoComplete="nickname"
          enterKeyHint="done"
          autoFocus
        />
        <p className={styles.colorNote}>
          Warna kamu ditentukan otomatis saat masuk room (mulai dari {PLAYER_COLOR_NAMES.P1}).
        </p>
        <Banner tone="info">Pembuatan room belum aktif di versi ini.</Banner>
        <Button type="submit" variant="primary" size="xl" fullWidth disabled>
          Bikin room
        </Button>
      </form>
      <div className={styles.art} aria-hidden="true">
        <PhotoStrip empty className={styles.strip} />
      </div>
    </Card>
  );
}
