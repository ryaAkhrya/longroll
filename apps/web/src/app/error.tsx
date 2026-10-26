"use client";

import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";

/** Error boundary rute (SCR-22): apa yang salah + apa yang bisa dilakukan + satu tombol utama. Tanpa detail teknis. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AppShell>
      <Container size="narrow">
        <section style={{ padding: "48px 0", display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
          <h1 className="dc" style={{ fontSize: 40 }}>
            Ada yang <span className="s">error.</span>
          </h1>
          <Banner tone="error">Halaman ini gagal dimuat. Coba lagi, atau balik ke beranda kalau masih bermasalah.</Banner>
          <Button variant="primary" size="lg" onClick={reset}>
            Coba lagi
          </Button>
        </section>
      </Container>
    </AppShell>
  );
}
