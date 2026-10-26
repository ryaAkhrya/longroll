import { AppShell } from "@/components/layout/AppShell";
import { Container } from "@/components/layout/Container";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { LinkButton } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <AppShell header={<SiteHeader />}>
      <Container size="narrow">
        <section style={{ padding: "48px 0", display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
          <p className="cap">404</p>
          <h1 className="dc" style={{ fontSize: 44 }}>
            Halamannya <span className="s">gak ketemu.</span>
          </h1>
          <p style={{ color: "var(--ink2)" }}>Link-nya mungkin salah ketik atau halamannya udah dipindah.</p>
          <LinkButton href="/" variant="primary" size="lg">
            Ke beranda
          </LinkButton>
        </section>
      </Container>
    </AppShell>
  );
}
