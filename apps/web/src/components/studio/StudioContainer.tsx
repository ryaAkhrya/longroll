"use client";

import { Camera, ChevronLeft, Frame, LayoutGrid, SlidersHorizontal, Sparkles, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { MODE_INFO, OUTPUT_PRESET_LABEL } from "@longroll/shared";
import type { FrameRef, FrameTemplate, ParticipantView, RoomView, SessionView, StudioPatch } from "@longroll/shared";
import { CameraSettings } from "@/components/media/CameraSettings";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { SheetSnap } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { iconProps } from "@/components/ui/icon-props";
import { cx } from "@/lib/cx";
import type { RoomClient } from "@/room/client";
import { useMediaQuery } from "@/room/hooks";
import { StudioCanvas } from "./canvas";
import { FilterPanel } from "./panels/FilterPanel";
import { FramePanel } from "./panels/FramePanel";
import { LayoutPanel } from "./panels/LayoutPanel";
import { UploadPanel } from "./panels/UploadPanel";
import { StudioScreen } from "./StudioScreen";
import { allFrames, useStudio } from "./useStudio";
import styles from "./StudioContainer.module.css";

interface StudioContainerProps {
  client: RoomClient;
  room: RoomView;
  session: SessionView;
  meId: string | null;
  clockOffsetMs: number;
  inviteUrl: string;
  onOpenCameraPanel: () => void;
}

type Panel = "frame" | "upload" | "layout" | "camera" | "filter";

const TOOLS: { id: Panel; label: string; icon: ReactNode }[] = [
  { id: "frame", label: "Frame", icon: <Frame size={19} {...iconProps} /> },
  { id: "layout", label: "Layout", icon: <LayoutGrid size={19} {...iconProps} /> },
  { id: "camera", label: "Kamera", icon: <Camera size={19} {...iconProps} /> },
  { id: "filter", label: "Filter", icon: <Sparkles size={19} {...iconProps} /> },
];
const PANEL_TITLE: Record<Panel, string> = { frame: "Frame", upload: "Upload frame", layout: "Layout", camera: "Kameraku", filter: "Filter" };

/**
 * Studio sesi aktif (P05, SCR-08..12): rail alat, pratinjau output bersama dengan feed live di slot,
 * panel Frame (pratinjau lokal vs Pasang buat semua), Upload, Layout, Kameraku (Cuma kamu), Filter.
 * Mobile: feed fullscreen + overlay + dock (Timer & shutter nonaktif sampai P06, Alat → sheet).
 */
export function StudioContainer({ client, room, session, meId, clockOffsetMs, inviteUrl, onOpenCameraPanel }: StudioContainerProps) {
  const custom = room.customFrames;
  const { studio, send, lookup } = useStudio(client, session, meId, room.participants, custom);
  const mobile = useMediaQuery("(max-width: 1023px)");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [preview, setPreview] = useState<{ ref: FrameRef; template: FrameTemplate } | null>(null);
  const [editSlots, setEditSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [activity, setActivity] = useState<Map<string, string>>(new Map());

  const frames = useMemo(() => allFrames(custom), [custom]);
  const applied = studio.frame ? (lookup(studio.frame.frameId, studio.frame.source) ?? null) : null;

  // Presence ringan "lagi lihat X" (volatile, tidak disimpan).
  useEffect(
    () =>
      client.onSignal((type, payload) => {
        if (type !== "presence.activity") return;
        const { participantId, activity: a } = payload as { participantId: string; activity: string | null };
        setActivity((cur) => {
          const next = new Map(cur);
          if (a) next.set(participantId, a);
          else next.delete(participantId);
          return next;
        });
      }),
    [client],
  );
  const viewers = useMemo(() => {
    const m = new Map<string, ParticipantView[]>();
    for (const [pid, a] of activity) {
      if (!a.startsWith("frame:") || pid === meId) continue;
      const p = room.participants.find((x) => x.participantId === pid && x.connection !== "LEFT");
      if (!p) continue;
      const id = a.slice(6);
      m.set(id, [...(m.get(id) ?? []), p]);
    }
    return m;
  }, [activity, room.participants, meId]);

  const open = (p: Panel | null) => {
    if ((p === null || p === "camera" || p === "filter" || p === "layout") && preview) {
      setPreview(null);
      client.sendVolatile("presence.activity", { activity: null });
    }
    if (p !== "layout") {
      setEditSlots(false);
      setSelectedSlot(null);
    }
    setPanel(p);
    if (mobile) setToolsOpen(p !== null || toolsOpen);
  };
  const doPreview = (ref: FrameRef, template: FrameTemplate) => {
    setPreview({ ref, template });
    client.sendVolatile("presence.activity", { activity: `frame:${ref.frameId}` });
  };
  const applyFrame = async (ref: FrameRef | undefined = preview?.ref, extra: StudioPatch = {}) => {
    if (!ref) return;
    const ack = await send({ ...extra, frame: ref });
    if (ack.ok) {
      setPreview(null);
      client.sendVolatile("presence.activity", { activity: null });
      if (panel === "upload") setPanel("frame");
    }
  };

  const showsPreview = panel === "frame" || panel === "upload" || panel === "layout" || panel === "filter";
  const previewStudio = preview ? { ...studio, frame: preview.ref } : studio;
  const previewTemplate = preview ? preview.template : applied;
  const lookingAt = [...viewers.entries()].flatMap(([id, ps]) => ps.map((p) => ({ p, name: frames.find((f) => f.ref.frameId === id)?.template.name })));
  const frameName = applied?.name ?? "Tanpa frame";
  const layoutText = `${studio.layout.shotCount} shot · ${studio.layout.canvas.preset === "AUTO" ? studio.layout.slotRatio : OUTPUT_PRESET_LABEL[studio.layout.canvas.preset]}`;

  const canvas = (live: boolean, editable = false, label = "Pratinjau hasil", className?: string) => (
    <StudioCanvas
      studio={editable ? studio : previewStudio}
      template={editable ? applied : previewTemplate}
      participants={room.participants}
      meId={meId}
      code={room.code}
      live={live}
      editable={editable}
      onSlotsChange={(slots) => void send({ slots })}
      selectedSlotId={selectedSlot}
      onSelectSlot={setSelectedSlot}
      label={label}
      dateMs={session.lockedAtMs ?? session.createdAtMs}
      className={className}
    />
  );

  const center = showsPreview ? (
    <div className={styles.previewArea}>
      <p className={cx("cap", styles.previewLabel)}>
        Pratinjau · {preview ? preview.template.name : frameName}
        {preview && <Tag kind="local">Cuma kamu</Tag>}
      </p>
      <div className={styles.previewCanvas}>{canvas(true, panel === "layout" && editSlots, `Pratinjau ${preview ? preview.template.name : frameName}`)}</div>
      <div className={styles.previewInfo}>
        {lookingAt.map(({ p, name }) => (
          <p key={p.participantId}>
            <strong>{p.displayName}</strong> lagi lihat {name ?? "frame"}
          </p>
        ))}
        <p className={styles.muted}>Frame berlaku buat semua. Siapa aja bisa ganti, dan semua orang langsung lihat perubahannya.</p>
      </div>
    </div>
  ) : undefined;

  const panelBody = (p: Panel, compact: boolean) => {
    switch (p) {
      case "frame":
        return (
          <FramePanel
            studio={studio}
            frames={frames}
            participants={room.participants}
            meId={meId}
            code={room.code}
            previewId={preview?.ref.frameId ?? null}
            onPreview={doPreview}
            onApply={() => void applyFrame()}
            onUpload={() => setPanel("upload")}
            viewers={viewers}
            compact={compact}
            dateMs={session.lockedAtMs ?? session.createdAtMs}
          />
        );
      case "upload":
        return (
          <UploadPanel
            code={room.code}
            studio={studio}
            mode={session.mode!}
            onBack={() => setPanel("frame")}
            onPreview={doPreview}
            onApply={(ref, extra) => void applyFrame(ref, extra)}
            compact={compact}
          />
        );
      case "layout":
        return (
          <LayoutPanel
            studio={studio}
            mode={session.mode!}
            send={send}
            editSlots={editSlots}
            onEditSlots={(on) => {
              setEditSlots(on);
              if (!on) setSelectedSlot(null);
            }}
            selectedSlotId={selectedSlot}
            compact={compact}
          />
        );
      case "filter":
        return <FilterPanel value={studio.style.filterPreset} onChange={(id) => void send({ style: { filterPreset: id } })} compact={compact} />;
      case "camera":
        return (
          <div className={styles.cameraPanel}>
            <h2 className={styles.drawerTitle}>Kameraku</h2>
            <CameraSettings compact={compact} />
          </div>
        );
    }
  };

  const rail = TOOLS.map((t) => (
    <button
      key={t.id}
      type="button"
      className={cx(styles.railItem, (panel === t.id || (t.id === "frame" && panel === "upload")) && styles.railOn)}
      aria-pressed={panel === t.id}
      onClick={() => open(panel === t.id ? null : t.id)}
    >
      {t.icon}
      <span>{t.label}</span>
    </button>
  ));

  const drawer =
    !mobile && panel ? (
      <div className={styles.drawerInner}>
        <Button variant="ghost" size="sm" iconOnly aria-label="Tutup panel" className={styles.drawerClose} onClick={() => open(null)}>
          ×
        </Button>
        {panelBody(panel, false)}
      </div>
    ) : undefined;

  // Mobile: kolom kanan tidak tampil → jangan render feed tersembunyi (beban decode video, NFR-11).
  const side = mobile ? undefined : (
    <section className={styles.result} aria-label="Hasil sementara">
      <header className={styles.resultHead}>
        <span className="cap">Hasil sementara</span>
        <Tag kind="bareng" />
      </header>
      <div className={styles.resultCanvas}>{canvas(true, false, `Hasil sementara: ${MODE_INFO[session.mode!].name}, ${frameName}, ${layoutText}`, styles.inset)}</div>
    </section>
  );

  const sheetTitle = panel ? PANEL_TITLE[panel] : "Alat";
  const mobileSheet = mobile ? (
    <BottomSheet
      open={toolsOpen}
      onClose={() => {
        setToolsOpen(false);
        open(null);
      }}
      title={sheetTitle}
      snap={snap}
      onSnapChange={setSnap}
      modal={false}
    >
      {panel ? (
        <div className={styles.sheetPanel}>
          <Button variant="ghost" size="sm" icon={<ChevronLeft size={16} {...iconProps} />} onClick={() => open(null)} className={styles.sheetBack}>
            Semua alat
          </Button>
          {panelBody(panel, true)}
        </div>
      ) : (
        <ul className={styles.toolList}>
          {TOOLS.map((t) => (
            <li key={t.id}>
              <button type="button" className={styles.toolItem} onClick={() => open(t.id)}>
                {t.icon}
                <span>{t.id === "camera" ? "Kameraku" : t.label}</span>
                <Tag kind={t.id === "camera" ? "local" : "bareng"} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  ) : null;

  const topOverlay = (
    <>
      <span className={styles.pill}>{room.code}</span>
      <span className={styles.pill}>
        {MODE_INFO[session.mode!].short} · 1/{studio.layout.shotCount}
        <span className={styles.progress} aria-hidden="true">
          {Array.from({ length: Math.min(8, studio.layout.shotCount) }, (_, i) => (
            <span key={i} />
          ))}
        </span>
      </span>
    </>
  );

  return (
    <StudioScreen
      session={session}
      participants={room.participants}
      meId={meId}
      holdSeconds={room.config.holdSeconds}
      clockOffsetMs={clockOffsetMs}
      inviteUrl={inviteUrl}
      onOpenCameraPanel={mobile ? () => open("camera") : onOpenCameraPanel}
      rail={rail}
      side={side}
      drawer={drawer}
      center={center}
      summary={{ frame: frameName, layout: layoutText, onFrame: () => open("frame"), onLayout: () => open("layout") }}
      shotLabel={`1/${studio.layout.shotCount}`}
      timer={
        <span className={styles.timer} title="Timer hadir di tahap berikutnya (P06)">
          <span className={styles.timerDesk} role="group" aria-label="Timer (belum tersedia)">
            {[3, 5, 10].map((s) => (
              <button key={s} type="button" disabled className={cx(styles.timerItem, s === studio.countdownSec && styles.timerOn)}>
                {s} dtk
              </button>
            ))}
          </span>
          <button type="button" disabled className={styles.dockBtn} aria-label="Timer — belum tersedia">
            <Timer size={18} {...iconProps} />
            <span>{studio.countdownSec}s</span>
          </button>
        </span>
      }
      topOverlay={topOverlay}
      dockRight={
        <button type="button" className={styles.dockBtn} onClick={() => setToolsOpen(true)} aria-haspopup="dialog">
          <SlidersHorizontal size={18} {...iconProps} />
          <span>Alat</span>
        </button>
      }
      mobileTools={mobileSheet}
    />
  );
}
