import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Catalog } from "@/components/dev/Catalog";

export const metadata: Metadata = { title: "Katalog komponen (dev)", robots: { index: false } };

/** Katalog komponen inti P01. Hanya tersedia di development. */
export default function ComponentsCatalogPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Catalog />;
}
