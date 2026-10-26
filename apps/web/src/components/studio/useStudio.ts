"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BUILTIN_FRAMES, FILTER_PRESETS, applyStudioPatch, builtinFrame } from "@longroll/shared";
import type {
  AckPayload,
  CustomFrameView,
  FrameRef,
  FrameTemplate,
  ParticipantView,
  SafeguardViolation,
  SessionView,
  StudioChange,
  StudioPatch,
  StudioState,
} from "@longroll/shared";
import { useToast } from "@/components/ui/Toast";
import type { RoomClient } from "@/room/client";

export function frameLookupFrom(custom: CustomFrameView[]) {
  return (frameId: string, source: FrameRef["source"]): FrameTemplate | undefined =>
    source === "BUILTIN" ? builtinFrame(frameId) : custom.find((f) => f.frameId === frameId)?.template;
}

export function allFrames(custom: CustomFrameView[]): { ref: FrameRef; template: FrameTemplate }[] {
  return [
    ...BUILTIN_FRAMES.map((t) => ({ ref: { frameId: t.id, source: "BUILTIN" as const, adapt: t.adapt === "PATTERN" ? ("CONTAIN" as const) : t.adapt, overlayOpacity: 1 }, template: t })),
    ...custom.map((f) => ({ ref: { frameId: f.frameId, source: "CUSTOM" as const, adapt: f.template.adapt, overlayOpacity: 1 }, template: f.template })),
  ];
}

/** Kalimat aksi untuk toast "{nama} {aksi} · Balikin" (04 SCR-09, 11). */
export function describeChange(change: StudioChange, studio: StudioState, custom: CustomFrameView[]): string {
  if (change.kind !== "revert" && change.kind !== "frame" && change.fields.includes("frame")) {
    const t = studio.frame ? frameLookupFrom(custom)(studio.frame.frameId, studio.frame.source) : null;
    return `${t ? `pasang ${t.name}` : "lepas frame"}${change.fields.includes("shotCount") ? ` · ${studio.layout.shotCount} shot` : ""}`;
  }
  switch (change.kind) {
    case "frame": {
      const t = studio.frame ? frameLookupFrom(custom)(studio.frame.frameId, studio.frame.source) : null;
      return t ? `pasang ${t.name}` : "lepas frame";
    }
    case "filter":
      return `ganti filter ke ${FILTER_PRESETS.find((f) => f.id === studio.style.filterPreset)?.label ?? "Asli"}`;
    case "strategy":
      return "ganti susunan foto";
    case "slots":
      return "mindahin slot foto";
    case "layout":
      return change.fields.includes("shotCount") ? `ubah jadi ${studio.layout.shotCount} shot` : "ngubah layout";
    case "revert":
      return "balikin perubahan";
    default:
      return "ngubah gaya hasil";
  }
}

export function studioErrorMessage(ack: AckPayload): string {
  const v = (ack.detail as { violation?: SafeguardViolation } | undefined)?.violation;
  if (v) return v.message;
  switch (ack.error) {
    case "STRUCTURE_LOCKED":
      return "Dikunci setelah shot pertama.";
    case "FRAME_NOT_FOUND":
      return "Frame-nya gak ketemu.";
    case "NOT_IN_STUDIO":
      return "Studio udah gak aktif.";
    case "INVALID_PATCH":
      return ack.reason === "STALE_UNDO" ? "Udah ada perubahan baru, gak bisa dibalikin." : "Perubahan ini gak valid.";
    default:
      return "Gagal nyimpen perubahan, coba lagi.";
  }
}

/**
 * State studio bersama untuk UI: server otoritatif + prediksi optimistis (fungsi patch yang SAMA dengan
 * server). Prediksi hanya berlaku untuk versi server tempat ia dibuat; ack gagal → rollback + toast.
 */
export function useStudio(client: RoomClient, session: SessionView, meId: string | null, participants: ParticipantView[], custom: CustomFrameView[]) {
  const toast = useToast();
  const server = session.studio!;
  const [pending, setPending] = useState<{ base: number; studio: StudioState } | null>(null);
  const studio = pending && pending.base === server.version ? pending.studio : server;
  const lookup = useMemo(() => frameLookupFrom(custom), [custom]);

  const send = useCallback(
    async (patch: StudioPatch): Promise<AckPayload> => {
      if (session.mode) {
        const predicted = applyStudioPatch(server, patch, server.version, {
          mode: session.mode,
          participantSlots: server.participantSlots,
          by: meId ?? "",
          nowMs: Date.now(),
          changeId: "local",
          frameLookup: lookup,
        });
        if (predicted.ok) setPending({ base: server.version, studio: predicted.studio });
      }
      const ack = await client.sendIntent("studio.update", { sessionId: session.sessionId, patch, baseVersion: server.version });
      setPending(null);
      if (!ack.ok) toast.show({ message: studioErrorMessage(ack), tone: "warn" });
      return ack;
    },
    [client, session.sessionId, session.mode, server, meId, lookup, toast],
  );

  const revert = useCallback(
    async (changeId: string) => {
      const ack = await client.sendIntent("studio.revert", { sessionId: session.sessionId, changeId });
      if (!ack.ok) toast.show({ message: studioErrorMessage(ack), tone: "warn" });
      return ack;
    },
    [client, session.sessionId, toast],
  );

  // Toast perubahan orang lain + "Balikin" (satu langkah; server menolak bila sudah ada perubahan baru).
  useEffect(
    () =>
      client.onEvent((e) => {
        if (e.type !== "studio.updated" || Date.now() - e.atMs > 10_000) return;
        const { change, studio: next, sessionId } = e.payload as { change: StudioChange | null; studio: StudioState; sessionId: string };
        if (!change || sessionId !== session.sessionId || change.by === client.getSnapshot().me) return;
        const who = participants.find((p) => p.participantId === change.by)?.displayName ?? "Seseorang";
        toast.show({
          message: `${who} ${describeChange(change, next, client.getSnapshot().room?.customFrames ?? [])}`,
          action: change.kind === "revert" ? undefined : { label: "Balikin", onAction: () => void revert(change.changeId) },
        });
      }),
    [client, session.sessionId, participants, toast, revert],
  );

  return { studio, send, revert, lookup, pending: !!pending };
}
