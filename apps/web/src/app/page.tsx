import { AppShell } from "@/components/layout/AppShell";
import { ClosingCta } from "@/components/landing/ClosingCta";
import { FrameShowcase } from "@/components/landing/FrameShowcase";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingNav } from "@/components/landing/LandingNav";

/** SCR-01 — Landing (statis, SSR). */
export default function LandingPage() {
  return (
    <AppShell header={<LandingNav />}>
      <Hero />
      <FrameShowcase />
      <HowItWorks />
      <ClosingCta />
    </AppShell>
  );
}
