import * as Y from "yjs";
import { buildScene, listElements, readMeta } from "@longroll/shared";
import type { CustomFrameView, DocumentModel, EditorMeta, FrameRef, FrameTemplate, Scene, StudioState } from "@longroll/shared";
import { frameLookupFrom } from "@/components/studio/useStudio";

/** Layout studio yang disalin ke dokumen editor saat seed (`meta.layout`). */
export function parseLayoutJson(raw: unknown): { studio: StudioState } | null {
  if (typeof raw !== "string") return null;
  try {
    const j = JSON.parse(raw) as Pick<StudioState, "layout" | "participantSlots" | "style" | "bindingStrategy"> & { fieldVersions?: StudioState["fieldVersions"] };
    // Dokumen lama tidak menyimpan fieldVersions; buildScene membacanya, jadi default ke {} (tidak ada bg pilihan pengguna).
    return { studio: { ...j, fieldVersions: j.fieldVersions ?? {}, frame: null } as unknown as StudioState };
  } catch {
    return null;
  }
}

export function readLayout(doc: Y.Doc): { studio: StudioState } | null {
  return parseLayoutJson(doc.getMap("meta").get("layout"));
}

export function parseFrameRef(raw: string | null | undefined): FrameRef | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FrameRef;
  } catch {
    return null;
  }
}

/** Scene (latar, overlay, dekor) dari meta dokumen — dipakai kanvas editor DAN export. */
export function sceneFor(meta: EditorMeta, layout: { studio: StudioState } | null, template: FrameTemplate | null, names: string[], dateMs: number): Scene | null {
  if (!layout) return null;
  const frame = parseFrameRef(meta.frame) as StudioState["frame"];
  const studio = { ...layout.studio, frame, style: { ...layout.studio.style, bgColor: meta.frameStyle.bgColor } } as StudioState;
  return buildScene(studio, template, { names, dateText: new Date(dateMs).toISOString().slice(0, 10).replaceAll("-", ".") });
}

export interface ModelContext {
  custom: CustomFrameView[];
  /** Nama pemain per slot warna (P1..P4) untuk teks dekor frame. */
  nameOfColor: (color: string) => string;
  dateMs: number;
}

/** Model dokumen final untuk `drawDocument`. null bila dokumen belum berisi meta (belum tersinkron). */
export function documentModel(doc: Y.Doc, ctx: ModelContext): { model: DocumentModel; frameId: string | null; meta: EditorMeta } | null {
  const meta = readMeta(doc);
  if (!meta) return null;
  const layout = readLayout(doc);
  const ref = parseFrameRef(meta.frame);
  const template = ref ? (frameLookupFrom(ctx.custom)(ref.frameId, ref.source) ?? null) : null;
  const names = (layout?.studio.participantSlots ?? []).map((s) => ctx.nameOfColor(s));
  const scene = sceneFor(meta, layout, template, names, ctx.dateMs);
  const elements = listElements(doc) as unknown as DocumentModel["elements"];
  return { model: { meta, elements, scene }, frameId: scene?.overlay?.frameId ?? null, meta };
}
