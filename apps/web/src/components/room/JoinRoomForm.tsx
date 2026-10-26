"use client";

import { LIMITS } from "@longroll/shared";
import type { RoomView } from "@longroll/shared";
import { useState } from "react";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeInput } from "@/components/ui/CodeInput";
import { Input } from "@/components/ui/Input";
import styles from "./FormCard.module.css";

interface JoinRoomFormProps {
  code: string;
  /** Hanya diisi pada pratinjau dev. Preview room sungguhan datang dari API di P02. */
  previewRoom?: RoomView;
}

/** Kerangka SCR-03 (DERIVED). Kode terkunci (dari link); tombol belum memanggil API (P02). */
export function JoinRoomForm({ code, previewRoom }: JoinRoomFormProps) {
  const [name, setName] = useState("");
  const length = Array.from(name.trim()).length;
  const tooLong = length > LIMITS.displayNameMax;

  return (
    <Card as="section" aria-labelledby="join-title" padding="lg" className={`${styles.card} ${styles.single}`}>
      <form className={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
        <div>
          <p className="cap">Gabung room</p>
          <h1 id="join-title" className={`dc ${styles.title}`}>
            Ada yang <span className="s">ngajak kamu.</span>
          </h1>
        </div>
        <CodeInput value={code} onChange={() => {}} readOnly />
        {previewRoom ? (
          <div className={styles.found}>
            <AvatarStack participants={previewRoom.participants} size={30} />
            <p>
              <strong>Room ketemu</strong> · {previewRoom.participants.length}/{LIMITS.maxParticipants}
            </p>
          </div>
        ) : (
          <Banner tone="warn">Status room belum bisa dicek: layanan room belum aktif.</Banner>
        )}
        <Input
          label="Nama panggilan"
          value={name}
          onChange={(e) => setName(e.target.value)}
          counter={`${length}/${LIMITS.displayNameMax}`}
          error={tooLong ? `Maksimal ${LIMITS.displayNameMax} karakter.` : undefined}
          autoComplete="nickname"
          enterKeyHint="done"
        />
        <Button type="submit" variant="primary" size="xl" fullWidth disabled>
          Gabung ke {code}
        </Button>
      </form>
    </Card>
  );
}
