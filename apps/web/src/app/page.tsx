import { AppShell } from "@/components/layout/AppShell";
import { FrameShowcase } from "@/components/landing/FrameShowcase";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingNav } from "@/components/landing/LandingNav";

/** SCR-01 — Landing (statis, SSR): hero, cara kerja, pilihan frame. */
export default function LandingPage() {
  return (
    <AppShell header={<LandingNav />}>
      <Hero />
      <HowItWorks />
      <FrameShowcase />
      <LandingFooter />
    </AppShell>
  );
}
