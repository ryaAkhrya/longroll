"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  addDoodle,
  addSticker,
  addText,
  commitTransform,
  deleteElement,
  duplicateElement,
  editText,
  elementLabel,
  encodePoints,
  listElements,
  readHistory,
  readMeta,
  revertEntry,
  setFrame,
  setGlobalAdjust,
  setGlobalFilter,
  setPhotoAdjust,
  setZ,
  simplifyRdp,
  updateElement,
} from "@longroll/shared";
import type { Adjust, EditorMeta, ElementView, FilterPresetId, FrameRef, HistoryEntry, ParticipantView, SessionView, StudioState, TextFontStyle } from "@longroll/shared";
import { parseLayoutJson } from "@/render/model";
import { useToast } from "@/components/ui/Toast";
import type { PeerView } from "@/components/editor/EditorCanvas";
import type { RoomClient } from "@/room/client";
import { EditorSession } from "./provider";
import type { SyncStatus } from "./provider";
import type { ConflictToast } from "./conflict";

export interface EditorController {
  es: EditorSession;
  status: SyncStatus;
  readOnly: boolean;
  elements: ElementView[];
  meta: EditorMeta | null;
  layoutJson: { studio: StudioState } | null;
  history: HistoryEntry[];
  peers: PeerView[];
  canUndo: boolean;
  canRedo: boolean;
  full: boolean;
  undo: () => void;
  redo: () => void;
  center: () => { x: number; y: number };
  addSticker: (assetId: string, tint?: string) => string | null;
  addText: (content?: string, style?: TextFontStyle, color?: string) => string | null;
  addDoodle: (points: [number, number][], color: string, width: number) => string | null;
  commit: (id: string, t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }) => void;
  update: (id: string, patch: Record<string, unknown>, label: string) => void;
  editText: (id: string, content: string) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => string | null;
  z: (id: string, mode: "front" | "back" | "up" | "down") => void;
  setFrame: (ref: FrameRef | null, name: string) => void;
  setGlobalFilter: (f: FilterPresetId | null) => void;
  setGlobalAdjust: (a: Adjust | null) => void;
  setPhotoAdjust: (id: string, a: Adjust | null) => void;
  revert: (entryId: string, force?: boolean) => ReturnType<typeof revertEntry>;
  nameOf: (pid: string) => string;
}

/**
 * State editor untuk UI: `EditorSession` (Yjs) → snapshot React tiap perubahan dokumen. Semua mutasi memakai
 * fungsi `@longroll/shared` (satu transaksi + entri riwayat); tidak ada jalur yang menulis dokumen tanpa itu.
 */
export function useEditor(client: RoomClient, participants: ParticipantView[], session: SessionView, meId: string): EditorController {
  const toast = useToast();
  const me = participants.find((p) => p.participantId === meId);
  const [es] = useState(() => new EditorSession(client, session.sessionId, { id: meId, name: me?.displayName ?? "Aku" }));
  useEffect(() => {
    es.start();
    return () => es.destroy();
  }, [es]);
  const version = useSyncExternalStore(es.subscribe, es.getVersion, es.getVersion);

  const nameOf = useCallback((pid: string) => participants.find((p) => p.participantId === pid)?.displayName ?? "Seseorang", [participants]);

  const data = useMemo(() => {
    void version;
    const meta = readMeta(es.doc);
    const layoutJson = parseLayoutJson(es.doc.getMap("meta").get("layout"));
    return { meta, layoutJson, elements: listElements(es.doc), history: readHistory(es.doc), canUndo: es.undo.undoStack.length > 0, canRedo: es.undo.redoStack.length > 0 };
  }, [es, version]);

  const readOnly = es.status === "readonly" || session.state !== "EDITING";
  const guard = <T,>(fn: () => T): T | null => {
    if (readOnly) return null;
    try {
      return fn();
    } catch (err) {
      if (err instanceof Error && err.message === "FULL") toast.show({ message: "Kanvasnya udah penuh banget.", tone: "warn" });
      return null;
    }
  };
  const ctx = es.ctx;
  const canvasCenter = () => ({ x: (data.meta?.canvas.w ?? 600) / 2, y: (data.meta?.canvas.h ?? 800) / 2 });

  // Toast konflik + Balikin (11 §5).
  useEffect(() => {
    es.setHandlers({
      onConflict: (list: ConflictToast[]) => {
        for (const t of list) {
          const label = elementLabel(es.elementSnapshot(t.elementId) ?? { type: "elemen" });
          const hist = readHistory(es.doc);
          const target = [...hist].reverse().find((h) => h.elementId === t.elementId && h.by === t.by && (t.kind === "deleted" ? h.after === null : true));
          toast.show({
            message: t.kind === "deleted" ? `${nameOf(t.by)} hapus ${label || "elemen"} yang lagi kamu edit` : `${nameOf(t.by)} ngubah ${label} yang barusan kamu atur`,
            action: target ? { label: "Balikin", onAction: () => void revertEntry(es.doc, ctx, target.id, true) } : undefined,
          });
        }
      },
      onReset: () => toast.show({ message: "Perubahan terakhirmu ditolak server. Kanvas disegarkan.", tone: "warn" }),
    });
    return () => es.setHandlers({});
  }, [es, toast, nameOf, ctx]);

  const peers: PeerView[] = useMemo(() => {
    void version;
    const out: PeerView[] = [];
    for (const [id, v] of es.peers) {
      const p = participants.find((x) => x.participantId === id && x.connection !== "LEFT");
      if (p && id !== meId) out.push({ id, name: p.displayName, color: p.color, state: v.state });
    }
    return out;
  }, [es, version, participants, meId]);

  return {
    es,
    status: es.status,
    readOnly,
    elements: data.elements,
    meta: data.meta,
    layoutJson: data.layoutJson,
    history: data.history,
    peers,
    canUndo: data.canUndo && !readOnly,
    canRedo: data.canRedo && !readOnly,
    full: data.elements.length >= 200,
    undo: () => !readOnly && es.undo.undo(),
    redo: () => !readOnly && es.undo.redo(),
    center: canvasCenter,
    addSticker: (assetId, tint) => guard(() => addSticker(es.doc, ctx, assetId, canvasCenter(), 160, tint)),
    addText: (content = "teks kamu", style = "display", color = "#1B1720") => guard(() => addText(es.doc, ctx, canvasCenter(), content, style, color)),
    addDoodle: (points, color, width) =>
      guard(() => {
        const pts = simplifyRdp(points);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        return addDoodle(es.doc, ctx, encodePoints(pts.map(([x, y]) => [x - cx, y - cy] as [number, number])), color, width, { x: cx, y: cy });
      }),
    commit: (id, t) => void guard(() => commitTransform(es.doc, ctx, id, t)),
    update: (id, patch, label) => void guard(() => updateElement(es.doc, ctx, id, patch, label)),
    editText: (id, content) => void guard(() => editText(es.doc, ctx, id, content)),
    remove: (id) => void guard(() => deleteElement(es.doc, ctx, id)),
    duplicate: (id) => guard(() => duplicateElement(es.doc, ctx, id)),
    z: (id, mode) => void guard(() => setZ(es.doc, ctx, id, mode)),
    setFrame: (ref, name) => void guard(() => setFrame(es.doc, ctx, ref, name)),
    setGlobalFilter: (f) => void guard(() => setGlobalFilter(es.doc, ctx, f)),
    setGlobalAdjust: (a) => void guard(() => setGlobalAdjust(es.doc, ctx, a)),
    setPhotoAdjust: (id, a) => void guard(() => setPhotoAdjust(es.doc, ctx, id, a)),
    revert: (entryId, force) => revertEntry(es.doc, ctx, entryId, force),
    nameOf,
  };
}
