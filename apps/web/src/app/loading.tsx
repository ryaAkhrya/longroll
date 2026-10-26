import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { Skeleton } from "@/components/ui/Skeleton";

/** Loading rute: skeleton bergaya surface (SCR-22), bukan spinner. */
export default function Loading() {
  return (
    <AppShell>
      <Container size="narrow">
        <div role="status" aria-label="Memuat halaman" style={{ display: "flex", flexDirection: "column", gap: 14, padding: "48px 0" }}>
          <Skeleton width={120} height={12} />
          <Skeleton width="70%" height={44} radius={12} />
          <Skeleton height={220} radius={20} />
        </div>
      </Container>
    </AppShell>
  );
}
