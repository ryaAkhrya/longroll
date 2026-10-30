"use client";

import { Brush, ChevronDown, ChevronUp, Frame, Layers, Minus, Plus, Redo2, Smile, SlidersHorizontal, Type, Undo2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BUILTIN_FRAMES } from "@longroll/shared";
import type { Adjust, FrameRef, HistoryEntry, RoomView, SessionView } from "@longroll/shared";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { SheetSnap } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { iconProps } from "@/components/ui/icon-props";
import { frameLookupFrom } from "@/components/studio/useStudio";
import { useEditor } from "@/editor/useEditor";
import { cx } from "@/lib/cx";
import type { RoomClient } from "@/room/client";
import { useMediaQuery, useNow } from "@/room/hooks";
import { EditorCanvas } from "./EditorCanvas";
import type { Tool } from "./EditorCanvas";
import { AdjustPanel, DoodlePanel, FramePanel, HistoryPanel, LayerPanel, PropsPanel, StickerPanel, TextPanel } from "./EditorPanels";
import styles from "./EditorScreen.module.css";

type ToolId = "sticker" | "text" | "doodle" | "filter" | "frame" | "layer";
const TOOLS: { id: ToolId; label: string; icon: ReactNode }[] = [
  { id: "sticker", label: "Stiker", icon: <Smile size={19} {...iconProps} /> },
  { id: "text", label: "Teks", icon: <Type size={19} {...iconProps} /> },
  { id: "doodle", label: "Coret", icon: <Brush size={19} {...iconProps} /> },
  { id: "filter", label: "Atur", icon: <SlidersHorizontal size={19} {...iconProps} /> },
  { id: "frame", label: "Frame", icon: <Frame size={19} {...iconProps} /> },
  { id: "layer", label: "Layer", icon: <Layers size={19} {...iconProps} /> },
];

function parseFrame(raw: string | null): FrameRef | null {
  try {
    return raw ? (JSON.parse(raw) as FrameRef) : null;
  } catch {
    return null;
  }
}

interface Props {
  client: RoomClient;
  room: RoomView;
  session: SessionView;
  meId: string;
}

/**
 * SCR-16 Editor kolaboratif: rail alat + kanvas + panel (desktop); kanvas fullscreen + overlay + dock lipat +
 * sheet kontekstual (mobile). Siapa pun bisa mengedit apa pun (tanpa host/kunci); konsistensi lewat CRDT.
 */
export function EditorScreen({ client, room, session, meId }: Props) {
  const mobile = useMediaQuery("(max-width: 1023px)");
  const ed = useEditor(client, room.participants, session, meId);
  const now = useNow(5_000, true);
  const [tool, setTool] = useState<ToolId>("sticker");
  const [adjustDraft, setAdjustDraft] = useState<{ target: string; adjust: Adjust | null } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [selection, setSelection] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [doodle, setDoodle] = useState({ color: "#F2778F", width: 8 });
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState<{ entry: HistoryEntry; changedBy?: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const active = room.participants.filter((p) => p.connection !== "LEFT");

  const canvasTool: Tool = tool === "doodle" && !ed.readOnly ? "doodle" : "select";
  const sel = ed.elements.find((e) => e.id === selection[0]) ?? null;
  // Seleksi yang elemennya sudah dihapus (oleh siapa pun) otomatis hilang.
  const liveSelection = useMemo(() => selection.filter((id) => ed.elements.some((e) => e.id === id)), [selection, ed.elements]);

  const frameRef: FrameRef | null = useMemo(() => parseFrame(ed.meta?.frame ?? null), [ed.meta?.frame]);
  const custom = room.customFrames;
  const frameChoices = useMemo(
    () => [
      ...BUILTIN_FRAMES.filter((t) => !session.mode || t.modes.includes(session.mode) || t.id === frameRef?.frameId).map((t) => ({ id: t.id, name: t.name, category: t.category, palette: t.palette, ref: { frameId: t.id, source: "BUILTIN" as const, adapt: t.adapt === "PATTERN" ? ("CONTAIN" as const) : t.adapt, overlayOpacity: 1 } satisfies FrameRef })),
      ...custom.map((f) => ({ id: f.frameId, name: f.template.name, category: f.template.category, palette: f.template.palette, ref: { frameId: f.frameId, source: "CUSTOM" as const, adapt: f.template.adapt, overlayOpacity: 1 } satisfies FrameRef })),
    ],
    [custom, session.mode, frameRef?.frameId],
  );
  const template = frameRef ? (frameLookupFrom(custom)(frameRef.frameId, frameRef.source) ?? null) : null;
  const names = useMemo(() => {
    const slots = ed.layoutJson?.studio.participantSlots ?? [];
    return slots.map((s) => active.find((p) => p.color === s)?.displayName ?? "");
  }, [ed.layoutJson, active]);

  // Pintasan keyboard (desktop, 13): Ctrl/Cmd+Z / Shift+Z, Ctrl/Cmd+D, Delete, [ ].
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, select, [contenteditable='true'], [role='option'], dialog")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
      } else if (mod && e.key.toLowerCase() === "d" && sel) {
        e.preventDefault();
        const id = ed.duplicate(sel.id);
        if (id) setSelection([id]);
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        ed.remove(sel.id);
        setSelection([]);
      } else if (e.key === "[" && sel) ed.z(sel.id, "down");
      else if (e.key === "]" && sel) ed.z(sel.id, "up");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ed, sel]);

  const finalize = async () => {
    setConfirmFinal(false);
    await client.sendIntent("session.finalize", { sessionId: session.sessionId });
  };
  const reopen = () => void client.sendIntent("session.reopen", { sessionId: session.sessionId });

  const onEditText = (id: string) => {
    setSelection([id]);
    setPanelOpen(true);
    setTimeout(() => textRef.current?.focus(), 60);
  };

  const panel = (() => {
    switch (tool) {
      case "sticker":
        return <StickerPanel ed={ed} />;
      case "text":
        return <TextPanel ed={ed} />;
      case "doodle":
        return <DoodlePanel color={doodle.color} width={doodle.width} onColor={(color) => setDoodle((d) => ({ ...d, color }))} onWidth={(width) => setDoodle((d) => ({ ...d, width }))} />;
      case "filter":
        return <AdjustPanel ed={ed} selected={sel} onDraft={setAdjustDraft} />;
      case "frame":
        return <FramePanel ed={ed} frames={frameChoices} current={frameRef?.frameId ?? null} />;
      case "layer":
        return <LayerPanel ed={ed} selection={liveSelection} onSelect={setSelection} />;
    }
  })();

  const props = sel ? <PropsPanel ed={ed} el={sel} textRef={textRef} /> : null;
  const header = (
    <div className={styles.bar}>
      <Button variant="secondary" size="md" iconOnly aria-label="Undo" disabled={!ed.canUndo} onClick={ed.undo}>
        <Undo2 size={17} {...iconProps} />
      </Button>
      <Button variant="secondary" size="md" iconOnly aria-label="Redo" disabled={!ed.canRedo} onClick={ed.redo}>
        <Redo2 size={17} {...iconProps} />
      </Button>
      <span className={styles.spacer} />
      {mobile && <AvatarStack participants={active} size={26} />}
      {session.state === "EDITING" ? (
        <Button variant="primary" size="md" onClick={() => setConfirmFinal(true)} data-testid="finish-edit">
          {mobile ? "Selesai" : "Selesai edit"}
        </Button>
      ) : (
        <Button variant="secondary" size="md" onClick={reopen}>
          Balik edit
        </Button>
      )}
    </div>
  );

  const canvas = (
    <EditorCanvas
      code={room.code}
      elements={ed.elements}
      meta={ed.meta ?? { canvas: { w: 600, h: 800 }, frame: null, frameStyle: { bgColor: "#FFFFFF", overlayOpacity: 1 }, globalFilter: null, schemaVersion: 1 }}
      layoutJson={ed.layoutJson}
      template={template}
      names={names}
      dateMs={session.lockedAtMs ?? session.createdAtMs}
      selection={liveSelection}
      tool={canvasTool}
      doodle={doodle}
      peers={ed.peers}
      zoom={zoom}
      readOnly={ed.readOnly}
      showCursors={!mobile}
      label={`Kanvas hasil sesi ${session.index}. ${ed.elements.length} elemen. Pakai panel Layer buat memilih dan memindah tanpa mouse.`}
      onSelect={setSelection}
      onCommit={ed.commit}
      onEditText={onEditText}
      onDoodle={(pts) => {
        const id = ed.addDoodle(pts, doodle.color, doodle.width);
        if (id) setSelection([]);
      }}
      onLocalAwareness={ed.es.setAwareness.bind(ed.es)}
      onZoom={setZoom}
      adjustDraft={adjustDraft}
    />
  );

  const banners = (
    <div className={styles.banners}>
      {ed.status === "offline" && (
        <Banner tone="warn" title="Editanmu disimpan dulu di perangkat">
          <WifiOff size={14} {...iconProps} /> Nyambung lagi otomatis, lalu semuanya digabung.
        </Banner>
      )}
      {session.state !== "EDITING" && (
        <Banner tone="info">Sesi ini udah selesai. Tekan Balik edit kalau mau lanjut ngedit.</Banner>
      )}
      {ed.full && <Banner tone="warn">Kanvasnya udah penuh banget. Hapus sesuatu dulu.</Banner>}
    </div>
  );

  const zoomBar = (
    <div className={styles.zoom} role="group" aria-label="Zoom tampilan">
      <Button variant="secondary" size="sm" iconOnly aria-label="Perkecil" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>
        <Minus size={15} {...iconProps} />
      </Button>
      <span className="tnum" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <Button variant="secondary" size="sm" iconOnly aria-label="Perbesar" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}>
        <Plus size={15} {...iconProps} />
      </Button>
    </div>
  );

  const dialogs = (
    <>
      <Modal
        open={confirmFinal}
        onClose={() => setConfirmFinal(false)}
        title="Selesai buat semua?"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setConfirmFinal(false)}>
              Lanjut ngedit
            </Button>
            <Button variant="primary" size="lg" onClick={() => void finalize()}>
              Selesai
            </Button>
          </>
        }
      >
        <p>Siapa aja bisa Balik edit lagi nanti.</p>
      </Modal>
      <Modal
        open={!!confirmRevert}
        onClose={() => setConfirmRevert(null)}
        title="Balikin perubahan ini?"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setConfirmRevert(null)}>
              Batal
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                if (confirmRevert) ed.revert(confirmRevert.entry.id, true);
                setConfirmRevert(null);
              }}
            >
              Tetap balikin
            </Button>
          </>
        }
      >
        <p>
          Elemen ini udah diubah lagi sama {confirmRevert?.changedBy ? ed.nameOf(confirmRevert.changedBy) : "temenmu"}. Tetap balikin ke versi {confirmRevert ? ed.nameOf(confirmRevert.entry.by) : ""}?
        </p>
      </Modal>
    </>
  );

  if (!mobile) {
    return (
      <section className={styles.editor} aria-label="Editor" data-testid="editor" data-status={ed.status}>
        <nav className={styles.rail} aria-label="Alat editor">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={cx(styles.railItem, tool === t.id && styles.railOn)} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className={styles.center}>
          {header}
          {banners}
          <div className={styles.canvasBox}>{canvas}</div>
          {zoomBar}
        </div>
        <aside className={styles.side} aria-label="Panel alat">
          {panel}
          {props && tool !== "layer" && <div className={styles.divider}>{props}</div>}
          <div className={styles.divider}>
            <HistoryPanel ed={ed} participants={room.participants} now={now} onConfirm={(entry, changedBy) => setConfirmRevert({ entry, changedBy })} />
          </div>
        </aside>
        {dialogs}
      </section>
    );
  }

  const sheetTitle = sel && liveSelection.length ? "Elemen" : TOOLS.find((t) => t.id === tool)!.label;
  return (
    <section className={styles.mobile} aria-label="Editor" data-testid="editor" data-status={ed.status}>
      <div className={styles.mTop}>{header}</div>
      {banners}
      <div className={styles.mCanvas}>{canvas}</div>
      <div className={cx(styles.dock, !dockOpen && styles.dockClosed)} role="toolbar" aria-label="Alat editor">
        {dockOpen &&
          TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cx(styles.dockItem, tool === t.id && styles.dockOn)}
              aria-pressed={tool === t.id}
              onClick={() => {
                setTool(t.id);
                setPanelOpen(true);
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        <button type="button" className={styles.dockToggle} aria-label={dockOpen ? "Lipat dock alat" : "Buka dock alat"} onClick={() => setDockOpen((v) => !v)}>
          {dockOpen ? <ChevronDown size={18} {...iconProps} /> : <ChevronUp size={18} {...iconProps} />}
        </button>
      </div>
      <BottomSheet open={panelOpen || (!!sel && selection.length > 0)} onClose={() => (setPanelOpen(false), setSelection([]))} title={sheetTitle} snap={snap} onSnapChange={setSnap} modal={false}>
        {sel && selection.length ? props : panel}
        {tool !== "layer" && <div className={styles.divider}>{null}</div>}
      </BottomSheet>
      {dialogs}
    </section>
  );
}
