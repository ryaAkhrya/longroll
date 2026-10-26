"use client";

import { Camera, Plus, Trash2 } from "lucide-react";
import { PLAYER_COLORS } from "@longroll/shared";
import type { ParticipantView } from "@longroll/shared";
import { useState } from "react";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/LogoMark";
import { Wordmark } from "@/components/brand/Wordmark";
import { Avatar } from "@/components/ui/Avatar";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { SheetSnap } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, ChipButton } from "@/components/ui/Chip";
import { CodeInput } from "@/components/ui/CodeInput";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { Tag } from "@/components/ui/Tag";
import { useToast } from "@/components/ui/Toast";
import { iconProps } from "@/components/ui/icon-props";
import { SAMPLE_ROOM } from "@/lib/sample-room";
import styles from "./Catalog.module.css";

const NAMES = ["Nadia", "Raka", "Sasa", "Bimo"];
const PEOPLE: ParticipantView[] = PLAYER_COLORS.map((color, i) => ({
  id: color,
  displayName: NAMES[i] ?? color,
  color,
  isSelf: i === 0,
  status: "online",
  statusText: "",
}));

export function Catalog() {
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1 className="dc">Katalog komponen inti P01</h1>
        <p>Hanya dev. Tema light dan stage berdampingan; ubah lebar browser untuk cek 390 / 1280 px.</p>
      </header>
      <ThemeSection theme="light" />
      <ThemeSection theme="stage" />
    </div>
  );
}

function ThemeSection({ theme }: { theme: "light" | "stage" }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [chip, setChip] = useState("Semua");
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const stage = theme === "stage";

  return (
    <section className={styles.theme} data-theme={stage ? "stage" : undefined} aria-label={`Tema ${theme}`}>
      <h2 className={`dc ${styles.h2}`}>Tema {theme}</h2>

      <Group title="Brand">
        <div className={styles.row}>
          <LogoMark height={48} tone={stage ? "dark" : "light"} />
          <Wordmark size={32} tone={stage ? "dark" : "light"} />
          <Wordmark size={16} tone={stage ? "dark" : "light"} withMark={false} />
        </div>
      </Group>

      <Group title="Tombol">
        <div className={styles.row}>
          <Button variant="primary" icon={<Plus size={16} {...iconProps} />}>Bikin room</Button>
          <Button variant="secondary">Gabung</Button>
          <Button variant="soft">Sekunder</Button>
          <Button variant="ghost">Nanti aja</Button>
          <Button variant="danger" icon={<Trash2 size={16} {...iconProps} />}>Keluar</Button>
          <Button variant="secondary" iconOnly aria-label="Kamera">
            <Camera size={17} {...iconProps} />
          </Button>
        </div>
        <div className={styles.row}>
          {(["sm", "md", "lg", "xl"] as const).map((s) => (
            <Button key={s} variant="primary" size={s}>
              {s.toUpperCase()}
            </Button>
          ))}
          <Button variant="primary" disabled>Disabled</Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
          >
            {loading ? "Bikin room…" : "Loading"}
          </Button>
        </div>
      </Group>

      <Group title="Input & kode room">
        <div className={styles.col}>
          <Input
            label="Nama panggilan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            counter={`${name.length}/20`}
            error={name.length > 20 ? "Maksimal 20 karakter." : undefined}
            hint="Cuma buat ditampilin di room ini."
          />
          <Input label="Dengan error" defaultValue="Terlalu panjang sekali nama panggilannya" error="Maksimal 20 karakter." />
          <CodeInput value={code} onChange={setCode} />
        </div>
      </Group>

      <Group title="Chip & tag">
        <div className={styles.row}>
          {["Semua", "Korean", "Sesi 2"].map((c) => (
            <ChipButton key={c} selected={chip === c} onClick={() => setChip(c)}>
              {c}
            </ChipButton>
          ))}
          <Chip tone="ok">✓ Udah pakai</Chip>
          <Chip tone="warn">Ngulang · ke-2</Chip>
          <Chip tone="neutral">Lagi milih…</Chip>
          <Chip tone="err">Keputus</Chip>
          <Tag kind="bareng" />
          <Tag kind="local" />
        </div>
      </Group>

      <Group title="Kartu & banner">
        <div className={styles.cols}>
          <Card>Kartu biasa</Card>
          <Card selected>Kartu terpilih</Card>
        </div>
        <div className={styles.col}>
          <Banner tone="info">Info: perubahan ini berlaku buat semua orang.</Banner>
          <Banner tone="warn" title="Galeri ini sementara.">Unduh yang kamu suka sebelum room kedaluwarsa.</Banner>
          <Banner tone="error">Gagal terhubung. Coba lagi.</Banner>
        </div>
      </Group>

      <Group title="Avatar & stack">
        <div className={styles.row}>
          {SAMPLE_ROOM.participants.map((p) => (
            <Avatar key={p.id} name={p.displayName} color={p.color} size={40} status={p.status} />
          ))}
          <AvatarStack participants={PEOPLE} />
        </div>
      </Group>

      <Group title="Loading">
        <div className={styles.row}>
          <Spinner size={24} label="Memuat" />
          <Skeleton width={160} height={20} />
          <Skeleton width={90} height={90} radius={20} />
        </div>
      </Group>

      <Group title="Toast, modal, bottom sheet">
        <div className={styles.row}>
          <Button onClick={() => toast.show({ message: "Link room tersalin" })}>Toast</Button>
          <Button
            onClick={() =>
              toast.show({ message: "Raka mindahin stiker yang kamu atur", action: { label: "Balikin", onAction: () => {} } })
            }
          >
            Toast + aksi
          </Button>
          <Button onClick={() => toast.show({ message: "Sinyal lemah, nyambung lagi…", tone: "warn" })}>Toast warn</Button>
          <Button onClick={() => setModal(true)}>Modal</Button>
          <Button onClick={() => setSheet(true)}>Bottom sheet</Button>
        </div>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Keluar dari room?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(false)}>Batal</Button>
              <Button variant="danger" onClick={() => setModal(false)}>Keluar</Button>
            </>
          }
        >
          Kamu masih bisa gabung lagi lewat kode selama room belum kedaluwarsa.
        </Modal>
        <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Alat" snap={snap} onSnapChange={setSnap}>
          <p>Seret handle ke atas untuk memperbesar, ke bawah untuk menutup.</p>
        </BottomSheet>
      </Group>
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <h3 className="cap">{title}</h3>
      {children}
    </div>
  );
}
