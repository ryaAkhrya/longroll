import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FrameLab } from "@/components/dev/FrameLab";

export const metadata: Metadata = { title: "Lab frame & layout (dev)", robots: { index: false } };

/** Lab visual Phase 3: semua frame × susunan lewat jalur render export. Hanya development (produksi 404). */
export default async function FrameLabPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <FrameLab params={await searchParams} />;
}
