"use client";

import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import { decodePoints, drawBackground, drawElementBody, drawFrameLayers, elementBounds } from "@longroll/shared";
import type { DrawResources, EditorMeta, ElementView, FilterPresetId, FrameTemplate, StudioState } from "@longroll/shared";
import { attemptUrl } from "@/capture/attemptUrls";
import { useFrameImage } from "@/components/studio/canvas/assets";
import type { AwarenessState } from "@/editor/provider";
import { cx } from "@/lib/cx";
import { sceneFor } from "@/render/model";
import { asCtx, makeResources, rawContext } from "@/render/resources";
import styles from "./EditorCanvas.module.css";

export type Tool = "select" | "doodle";

export interface PeerView {
  id: string;
  name: string;
  /** Warna pemain (P1..P4) untuk outline/kursor. */
  color: string;
  state: AwarenessState;
}

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

interface Props {
  code: string;
  elements: ElementView[];
  meta: EditorMeta;
  layoutJson: { studio: StudioState } | null;
  template: FrameTemplate | null;
  names: string[];
  dateMs: number;
  selection: string[];
  tool: Tool;
  doodle: { color: string; width: number };
  peers: PeerView[];
  zoom: number;
  readOnly: boolean;
  showCursors: boolean;
  label: string;
  onSelect: (ids: string[]) => void;
  onCommit: (id: string, t: Transform) => void;
  onEditText: (id: string) => void;
  onDoodle: (points: [number, number][]) => void;
  onLocalAwareness: (patch: Partial<AwarenessState>) => void;
  onZoom: (z: number) => void;
}

/** Warna pemain sebagai nilai literal (kanvas tidak memahami var CSS). */
const PLAYER_HEX: Record<string, string> = { P1: "#F2AE8C", P2: "#E2C24E", P3: "#7DC49D", P4: "#A893E0" };

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(code: string, attemptId: string): Promise<HTMLImageElement> {
  const key = `${code}:${attemptId}`;
  const hit = imgCache.get(key);
  if (hit) return hit;
  const p = attemptUrl(code, attemptId, "edit").then(
    (url) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("foto gagal dimuat"));
        img.src = url;
      }),
  );
  p.catch(() => imgCache.delete(key));
  imgCache.set(key, p);
  return p;
}

function usePhotoImage(code: string, attemptId: string): { img: HTMLImageElement | null; failed: boolean; retry: () => void } {
  const [state, setState] = useState<{ key: string; img: HTMLImageElement | null; failed: boolean }>({ key: "", img: null, failed: false });
  const [nonce, setNonce] = useState(0);
  const key = `${attemptId}:${nonce}`;
  useEffect(() => {
    let alive = true;
    loadImage(code, attemptId).then(
      (img) => alive && setState({ key, img, failed: false }),
      () => alive && setState({ key, img: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [code, attemptId, key]);
  return { ...(state.key === key ? { img: state.img, failed: state.failed } : { img: null, failed: false }), retry: () => (imgCache.delete(`${code}:${attemptId}`), setNonce((n) => n + 1)) };
}

/** Kotak hit/seleksi elemen di koordinat lokal (pusat 0,0; coretan memakai kotak titiknya + toleransi sentuh). */
function hitRect(e: ElementView): { x: number; y: number; w: number; h: number } {
  if (e.type === "doodle") {
    const pts = decodePoints(String(e.points ?? "")) ?? [];
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const pad = Math.max(12, Number(e.width) / 2);
    const x0 = Math.min(...xs, 0) - pad;
    const y0 = Math.min(...ys, 0) - pad;
    return { x: x0, y: y0, w: Math.max(...xs, 0) + pad - x0, h: Math.max(...ys, 0) + pad - y0 };
  }
  const b = elementBounds(e);
  return { x: -b.w / 2, y: -b.h / 2, w: b.w, h: b.h };
}

/**
 * Badan elemen digambar oleh `drawElementBody` (paket shared) — fungsi yang sama dengan export. Konva hanya
 * menyediakan transformasi grup, hit-test, dan Transformer.
 */
function BodyShape({ e, res, global, note, onRetry }: { e: ElementView; res: DrawResources; global: FilterPresetId | null; note?: string; onRetry?: () => void }) {
  const r = hitRect(e);
  return (
    <Shape
      x={r.x}
      y={r.y}
      width={r.w}
      height={r.h}
      onClick={onRetry}
      onTap={onRetry}
      sceneFunc={(ctx) => {
        const raw = rawContext(ctx);
        // Titik asal tubuh = pusat elemen; Shape berada di (r.x, r.y) sehingga digeser balik.
        raw.save();
        raw.translate(-r.x, -r.y);
        drawElementBody(asCtx(raw), e, res, global);
        if (note) {
          raw.fillStyle = "rgba(255,255,255,0.75)";
          raw.font = "600 22px sans-serif";
          raw.textAlign = "center";
          raw.textBaseline = "middle";
          raw.fillText(note, 0, 0);
        }
        raw.restore();
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        ctx.rect(0, 0, r.w, r.h);
        ctx.closePath();
        ctx.fillShape(shape);
      }}
      fill="rgba(0,0,0,0.001)"
    />
  );
}

function PhotoShape({ e, code, global, res }: { e: ElementView; code: string; global: FilterPresetId | null; res: DrawResources }) {
  const { img, failed, retry } = usePhotoImage(code, String(e.attemptId));
  // Gambar foto ini disuntikkan lewat resources khusus elemen; foto lain tidak relevan untuk badan ini.
  const own = useMemo<DrawResources>(() => ({ ...res, photo: (id) => (id === String(e.attemptId) ? img : null) }), [res, img, e.attemptId]);
  return <BodyShape e={e} res={own} global={global} note={img ? undefined : failed ? "Foto gagal dimuat · ketuk ulang" : "Memuat foto…"} onRetry={failed ? retry : undefined} />;
}

interface NodeProps {
  e: ElementView;
  code: string;
  global: FilterPresetId | null;
  res: DrawResources;
  draggable: boolean;
  override?: { x: number; y: number; rotation: number; scaleX: number; scaleY: number };
  locks: PeerView[];
  onSelect: (id: string) => void;
  onDragMove: (id: string, node: Konva.Node) => void;
  onDragEnd: (id: string, node: Konva.Node) => void;
  onDblClick: (id: string) => void;
  nodeRef: (id: string, n: Konva.Group | null) => void;
}

function ElementNode({ e, code, global, res, draggable, override, locks, onSelect, onDragMove, onDragEnd, onDblClick, nodeRef }: NodeProps) {
  const b = elementBounds(e);
  const t = override ?? { x: Number(e.x), y: Number(e.y), rotation: Number(e.rotation), scaleX: Number(e.scaleX), scaleY: Number(e.scaleY) };
  return (
    <Group
      ref={(n) => nodeRef(e.id, n)}
      id={e.id}
      x={t.x}
      y={t.y}
      rotation={t.rotation}
      scaleX={t.scaleX}
      scaleY={t.scaleY}
      opacity={Number(e.opacity)}
      draggable={draggable}
      onMouseDown={() => onSelect(e.id)}
      onTouchStart={() => onSelect(e.id)}
      onDragMove={(ev) => onDragMove(e.id, ev.target)}
      onDragEnd={(ev) => onDragEnd(e.id, ev.target)}
      onDblClick={() => e.type === "text" && onDblClick(e.id)}
      onDblTap={() => e.type === "text" && onDblClick(e.id)}
    >
      {e.type === "photo" ? <PhotoShape e={e} code={code} global={global} res={res} /> : <BodyShape e={e} res={res} global={global} />}
      {locks.map((p, i) => (
        <Rect key={p.id} x={-b.w / 2 - 4 - i * 3} y={-b.h / 2 - 4 - i * 3} width={b.w + 8 + i * 6} height={b.h + 8 + i * 6} stroke={PLAYER_HEX[p.color] ?? "#fff"} strokeWidth={3} listening={false} cornerRadius={4} />
      ))}
    </Group>
  );
}

/**
 * Kanvas editor (11 §10): Background → foto → frame (overlay+dekor) → elemen lain → overlay (kursor, outline
 * soft-lock, coretan live). Drag/resize/rotasi = transient via awareness, COMMIT satu transaksi saat dilepas.
 * `fit: contain` + zoom tampilan tidak mengubah koordinat dokumen.
 */
export function EditorCanvas(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const lastAware = useRef(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = p.meta.canvas.w;
  const H = p.meta.canvas.h;
  const fit = box.w > 0 && box.h > 0 ? Math.min((box.w - 24) / W, (box.h - 24) / H) : 0;
  const scale = fit * p.zoom;
  const offX = (box.w - W * scale) / 2;
  const offY = (box.h - H * scale) / 2;

  const scene = useMemo(() => sceneFor(p.meta, p.layoutJson, p.template, p.names, p.dateMs), [p.meta, p.layoutJson, p.template, p.names, p.dateMs]);
  const overlayId = scene?.overlay?.frameId ?? null;
  const { img: overlayImg } = useFrameImage(overlayId ? p.code : null, overlayId);

  const res = useMemo(() => makeResources({ photo: () => null, overlay: overlayImg, scale }), [overlayImg, scale]);
  const visible = p.elements.filter((e) => !e.hidden);
  const below = visible.filter((e) => e.type === "photo");
  const above = visible.filter((e) => e.type !== "photo");
  const overrides = useMemo(() => {
    const m = new Map<string, NonNullable<AwarenessState["transient"]>>();
    for (const peer of p.peers) if (peer.state.transient) m.set(peer.state.transient.id, peer.state.transient);
    return m;
  }, [p.peers]);
  const locksFor = (id: string) => p.peers.filter((peer) => peer.state.selection?.includes(id));
  const draggable = p.tool === "select" && !p.readOnly;

  // Transformer menempel pada elemen terpilih (satu).
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const n = p.selection.length === 1 && p.tool === "select" && !p.readOnly ? nodes.current.get(p.selection[0]!) : undefined;
    tr.nodes(n ? [n] : []);
    tr.getLayer()?.batchDraw();
  }, [p.selection, p.tool, p.readOnly, p.elements]);

  const aware = useCallback(
    (patch: Partial<AwarenessState>, force = false) => {
      const now = Date.now();
      if (!force && now - lastAware.current < 50) return;
      lastAware.current = now;
      p.onLocalAwareness(patch);
    },
    [p],
  );

  const nodeRef = useCallback((id: string, n: Konva.Group | null) => {
    if (n) nodes.current.set(id, n);
    else nodes.current.delete(id);
  }, []);

  const select = (id: string) => {
    if (p.tool !== "select") return;
    p.onSelect([id]);
    p.onLocalAwareness({ selection: [id] });
  };
  const readTransform = (n: Konva.Node): Transform => ({
    x: Math.round(n.x() * 100) / 100,
    y: Math.round(n.y() * 100) / 100,
    scaleX: Math.max(0.05, Math.min(20, Math.round(n.scaleX() * 1000) / 1000)),
    scaleY: Math.max(0.05, Math.min(20, Math.round(n.scaleY() * 1000) / 1000)),
    rotation: Math.round(n.rotation() * 100) / 100,
  });
  const transient = (id: string, n: Konva.Node) => aware({ dragging: true, transient: { id, ...readTransform(n) } });
  const commit = (id: string, n: Konva.Node) => {
    p.onCommit(id, readTransform(n));
    p.onLocalAwareness({ dragging: false, transient: undefined });
  };

  // Coret: pointer events di stage; 1 jari menggambar, 2 jari = pan/zoom tampilan (bukan dokumen).
  const toDoc = (): [number, number] | null => {
    const st = stageRef.current;
    const pos = st?.getPointerPosition();
    return st && pos ? [(pos.x - st.x()) / st.scaleX(), (pos.y - st.y()) / st.scaleY()] : null;
  };
  const touches = useRef(0);
  const pinch = useRef<{ d: number; z: number; a: number; rot: number; sx: number; sy: number } | null>(null);
  const onDown = (ev: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const te = ev.evt as TouchEvent;
    touches.current = te.touches?.length ?? 1;
    if (touches.current > 1) {
      setDraft(null);
      return;
    }
    if (p.tool === "doodle" && !p.readOnly) {
      const pt = toDoc();
      if (pt) setDraft([pt]);
    } else if (ev.target === ev.target.getStage() || ev.target.name() === "bg") {
      p.onSelect([]);
      p.onLocalAwareness({ selection: [] });
    }
  };
  const onMove = (ev: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const te = ev.evt as TouchEvent;
    const pt = toDoc();
    if (te.touches && te.touches.length === 2) {
      const [a, b] = [te.touches[0]!, te.touches[1]!];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ang = (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
      const node = p.selection.length === 1 ? nodes.current.get(p.selection[0]!) : undefined;
      if (!pinch.current) pinch.current = { d, z: p.zoom, a: ang, rot: node?.rotation() ?? 0, sx: node?.scaleX() ?? 1, sy: node?.scaleY() ?? 1 };
      const ratio = d / pinch.current.d;
      if (node && p.tool === "select") {
        // Pinch/rotate elemen terpilih; rotasi snap 0/90 ±4° (06 §8).
        node.scaleX(pinch.current.sx * ratio);
        node.scaleY(pinch.current.sy * ratio);
        let r = pinch.current.rot + (ang - pinch.current.a);
        for (const snap of [0, 90, 180, -90, -180, 270]) if (Math.abs(((r - snap + 540) % 360) - 180) > 176) r = snap;
        node.rotation(r);
        transient(p.selection[0]!, node);
      } else p.onZoom(Math.max(0.5, Math.min(3, pinch.current.z * ratio)));
      return;
    }
    if (p.tool === "doodle" && draft && pt) {
      const last = draft[draft.length - 1]!;
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 3) return;
      const next = [...draft, pt].slice(-4000);
      setDraft(next);
      aware({ doodleDraft: { color: p.doodle.color, width: p.doodle.width, points: next.slice(-120) } });
    } else if (pt && p.showCursors) aware({ cursor: { x: Math.round(pt[0]), y: Math.round(pt[1]) } });
  };
  const onUp = () => {
    const had = pinch.current;
    pinch.current = null;
    if (had && p.selection.length === 1) {
      const n = nodes.current.get(p.selection[0]!);
      if (n) commit(p.selection[0]!, n);
    }
    if (p.tool === "doodle" && draft && draft.length > 1) p.onDoodle(draft);
    if (draft) {
      setDraft(null);
      p.onLocalAwareness({ doodleDraft: undefined });
    }
  };

  const peerCursors = p.showCursors ? p.peers.filter((x) => x.state.cursor) : [];
  const stageW = Math.max(1, box.w);
  const stageH = Math.max(1, box.h);

  return (
    <div ref={wrapRef} className={cx(styles.wrap, p.tool === "doodle" && styles.draw)} data-testid="editor-canvas" data-elements={visible.length} data-zoom={p.zoom} role="application" aria-label={p.label}>
      {scale > 0 && (
        <Stage
          ref={stageRef}
          width={stageW}
          height={stageH}
          x={offX}
          y={offY}
          scaleX={scale}
          scaleY={scale}
          draggable={p.zoom > 1 && p.tool === "select"}
          onMouseDown={onDown}
          onTouchStart={onDown}
          onMouseMove={onMove}
          onTouchMove={onMove}
          onMouseUp={onUp}
          onTouchEnd={onUp}
          onMouseLeave={onUp}
          className={styles.stage}
        >
          <Layer listening={false}>
            <Shape
              sceneFunc={(ctx) => {
                const raw = rawContext(ctx);
                if (scene) drawBackground(asCtx(raw), scene, res);
                else {
                  raw.fillStyle = p.meta.frameStyle.bgColor;
                  raw.fillRect(0, 0, W, H);
                }
              }}
            />
          </Layer>
          <Layer>
            <Rect name="bg" width={W} height={H} fill="rgba(0,0,0,0.001)" />
            {below.map((e) => (
              <ElementNode key={e.id} e={e} code={p.code} global={p.meta.globalFilter} res={res} draggable={draggable} override={overrides.get(e.id)} locks={locksFor(e.id)} onSelect={select} onDragMove={transient} onDragEnd={commit} onDblClick={p.onEditText} nodeRef={nodeRef} />
            ))}
          </Layer>
          <Layer listening={false}>
            {scene && <Shape sceneFunc={(ctx) => drawFrameLayers(asCtx(rawContext(ctx)), scene, res, p.meta.frameStyle.overlayOpacity)} />}
          </Layer>
          <Layer>
            {above.map((e) => (
              <ElementNode key={e.id} e={e} code={p.code} global={p.meta.globalFilter} res={res} draggable={draggable} override={overrides.get(e.id)} locks={locksFor(e.id)} onSelect={select} onDragMove={transient} onDragEnd={commit} onDblClick={p.onEditText} nodeRef={nodeRef} />
            ))}
            <Transformer
              ref={trRef}
              rotateEnabled
              keepRatio
              rotationSnaps={[0, 90, 180, 270]}
              rotationSnapTolerance={4}
              anchorSize={11}
              anchorCornerRadius={3}
              borderStroke="#3B2350"
              anchorStroke="#3B2350"
              anchorFill="#FFFFFF"
              onTransform={() => p.selection[0] && nodes.current.get(p.selection[0]) && transient(p.selection[0], nodes.current.get(p.selection[0])!)}
              onTransformEnd={() => p.selection[0] && nodes.current.get(p.selection[0]) && commit(p.selection[0], nodes.current.get(p.selection[0])!)}
            />
          </Layer>
          <Layer listening={false}>
            {draft && draft.length > 1 && <Line points={draft.flat()} stroke={p.doodle.color} strokeWidth={p.doodle.width} lineCap="round" lineJoin="round" tension={0.35} />}
            {p.peers.map((peer) =>
              peer.state.doodleDraft && peer.state.doodleDraft.points.length > 1 ? (
                <Line key={peer.id} points={peer.state.doodleDraft.points.flat()} stroke={peer.state.doodleDraft.color} strokeWidth={peer.state.doodleDraft.width} lineCap="round" lineJoin="round" tension={0.35} opacity={0.75} />
              ) : null,
            )}
            {peerCursors.map((peer) => (
              <Group key={peer.id} x={peer.state.cursor!.x} y={peer.state.cursor!.y} scaleX={1 / Math.max(scale, 0.05) * 1.0} scaleY={1 / Math.max(scale, 0.05) * 1.0}>
                <Line points={[0, 0, 0, 17, 4.5, 13, 8, 20, 10.5, 19, 7, 12, 12, 12]} closed fill={PLAYER_HEX[peer.color] ?? "#fff"} stroke="#fff" strokeWidth={1.4} />
                <Group x={14} y={18}>
                  <Rect width={Math.max(40, (peer.state.cursorLabel ?? peer.name).length * 6.6 + 14)} height={19} cornerRadius={6} fill={PLAYER_HEX[peer.color] ?? "#fff"} />
                  <Text text={peer.state.cursorLabel ? `${peer.name} · ${peer.state.cursorLabel}` : peer.name} x={7} y={4} fontSize={11} fontStyle="bold" fill="#1B1720" />
                </Group>
              </Group>
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
