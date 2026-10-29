"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import { FONT_STACK, PLACEHOLDER_TINT, STUDIO_LIMITS, acceptedForCell, buildScene, formatDate } from "@longroll/shared";
import { AttemptImage } from "@/capture/AttemptImage";
import type { CaptureState, FrameTemplate, ParticipantView, Scene, SceneDecor, SceneSlot, SlotGeometry, StudioState } from "@longroll/shared";
import { VideoView } from "@/components/media/VideoView";
import { useMedia } from "@/media/MediaProvider";
import { cx } from "@/lib/cx";
import { patternImage, useFrameImage } from "./assets";
import styles from "./StudioCanvas.module.css";

export interface StudioCanvasProps {
  studio: StudioState;
  template: FrameTemplate | null;
  participants: ParticipantView[];
  meId: string | null;
  /** Kode room (untuk signed URL artwork frame custom). */
  code: string | null;
  /** Feed live di slot (studio) vs placeholder pastel (thumbnail frame). */
  live?: boolean;
  /** Mode edit slot (drag/resize + snapping). */
  editable?: boolean;
  onSlotsChange?: (slots: SlotGeometry[]) => void;
  selectedSlotId?: string | null;
  onSelectSlot?: (id: string | null) => void;
  label: string;
  /** P06: foto accepted per sel (shot DONE) menggantikan feed live di slotnya. */
  capture?: CaptureState | null;
  className?: string;
  /** Tanggal dekor (default: hari ini). */
  dateMs?: number;
}

const MARK_COLORS = ["#F2AE8C", "#E2C24E", "#7DC49D", "#A893E0"];

/**
 * Kanvas studio berlapis (10 §1, DEC-039): Konva bawah (Background + Photo placeholder) → video DOM di
 * slot (09 §6, ringan untuk HP) → Konva atas (FrameOverlay + Decor + edit slot). Semua koordinat base px
 * dari satu `Scene`; tampilan = skala seragam `fit: contain`.
 */
export function StudioCanvas(props: StudioCanvasProps) {
  const { studio, template, participants, meId, code, live = false, editable = false, label } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(false);
  const [drafts, setDrafts] = useState<{ v: number; map: Record<string, SlotGeometry> }>({ v: -1, map: {} });
  const [guides, setGuides] = useState<number[][]>([]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Geometri draf (drag berjalan) hanya berlaku untuk versi studio yang sama; versi baru dari server menang.
  const draftMap = useMemo(() => (drafts.v === studio.version ? drafts.map : {}), [drafts, studio.version]);
  const effective = useMemo<StudioState>(() => {
    if (!Object.keys(draftMap).length) return studio;
    return { ...studio, layout: { ...studio.layout, slots: studio.layout.slots.map((s) => (draftMap[s.id] ? { ...s, ...draftMap[s.id] } : s)) } };
  }, [studio, draftMap]);

  const names = useMemo(() => {
    const byColor = new Map(participants.filter((p) => p.connection !== "LEFT").map((p) => [p.color, p.displayName]));
    return studio.participantSlots.map((s) => byColor.get(s) ?? "");
  }, [participants, studio.participantSlots]);
  const [mountMs] = useState(() => Date.now());
  const dateText = formatDate(props.dateMs ?? mountMs);
  const scene = useMemo(() => buildScene(effective, template, { names, dateText }), [effective, template, names, dateText]);
  const overlayFrameId = scene.overlay?.frameId ?? null;
  const { img: overlayImg, failed: overlayFailed } = useFrameImage(overlayFrameId ? code : null, overlayFrameId);

  const scale = box.w > 0 ? Math.min(box.w / scene.width, box.h > 0 ? box.h / scene.height : Infinity) : 0;
  const dw = scene.width * scale;
  const dh = scene.height * scale;

  const commitSlot = (g: SlotGeometry) => {
    setDrafts({ v: studio.version, map: { ...draftMap, [g.id]: g } });
    props.onSlotsChange?.([g]);
  };

  return (
    <div ref={wrapRef} className={cx(styles.wrap, props.className)}>
      {scale > 0 && (
        <div
          className={styles.canvas}
          style={{ width: dw, height: dh }}
          role="img"
          aria-label={label}
          data-studio-version={studio.version}
          data-slots={scene.slots.length}
          data-frame={studio.frame?.frameId ?? "none"}
          data-filter={studio.style.filterPreset}
        >
          <Stage width={dw} height={dh} className={styles.layer} listening={false}>
            <Layer scaleX={scale} scaleY={scale} listening={false}>
              <Background scene={scene} scale={scale} />
            </Layer>
            <Layer scaleX={scale} scaleY={scale} listening={false}>
              {scene.slots.map((s) => (
                <SlotBase key={s.id} slot={s} />
              ))}
            </Layer>
          </Stage>

          {live && <Photos scene={scene} scale={scale} participants={participants} meId={meId} code={code} capture={props.capture ?? null} />}
          {!live && <div className={styles.thumbFilter} style={{ backdropFilter: scene.filter === "none" ? undefined : scene.filter }} />}

          <Stage width={dw} height={dh} className={cx(styles.layer, !editable && styles.passive)}>
            <Layer scaleX={scale} scaleY={scale} listening={false}>
              {scene.slots.map((s) =>
                s.stroke ? (
                  <Group key={s.id} {...center(s)}>
                    <Rect x={s.photo.x} y={s.photo.y} width={s.photo.w} height={s.photo.h} cornerRadius={s.photo.radius} stroke={s.stroke.color} strokeWidth={s.stroke.width} />
                  </Group>
                ) : null,
              )}
              {scene.overlay && overlayImg && (
                <Shape
                  opacity={scene.overlay.opacity}
                  sceneFunc={(ctx) => {
                    for (const o of scene.overlay!.ops) ctx.drawImage(overlayImg, o.sx, o.sy, o.sw, o.sh, o.dx, o.dy, o.dw, o.dh);
                  }}
                />
              )}
              {scene.decor.map((d, i) => (
                <Decor key={`${fontsReady}-${i}`} d={d} />
              ))}
            </Layer>
            {editable && (
              <EditLayer
                scene={scene}
                scale={scale}
                selected={props.selectedSlotId ?? null}
                onSelect={props.onSelectSlot}
                onCommit={commitSlot}
                onGuides={setGuides}
                allowRotate={studio.layout.arrangement === "SCATTER" || studio.bindingStrategy === "FREEFORM"}
              />
            )}
            {guides.length > 0 && (
              <Layer scaleX={scale} scaleY={scale} listening={false}>
                {guides.map((g, i) => (
                  <Line key={i} points={g} stroke="#E5484D" strokeWidth={1 / scale} dash={[4 / scale, 4 / scale]} />
                ))}
              </Layer>
            )}
          </Stage>
          {overlayFailed && <p className={styles.assetError}>Frame gagal dimuat</p>}
        </div>
      )}
    </div>
  );
}

function center(s: SceneSlot) {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2, offsetX: s.w / 2, offsetY: s.h / 2, rotation: s.rotation };
}

export function Background({ scene, scale }: { scene: Scene; scale: number }) {
  const bg = scene.background;
  const W = scene.width;
  const H = scene.height;
  if (bg.kind === "solid") return <Rect width={W} height={H} fill={bg.color} />;
  if (bg.kind === "linear") {
    const rad = (bg.angle * Math.PI) / 180;
    return (
      <Rect
        width={W}
        height={H}
        fillLinearGradientStartPoint={{ x: W / 2 - (Math.cos(rad) * W) / 2, y: H / 2 - (Math.sin(rad) * H) / 2 }}
        fillLinearGradientEndPoint={{ x: W / 2 + (Math.cos(rad) * W) / 2, y: H / 2 + (Math.sin(rad) * H) / 2 }}
        fillLinearGradientColorStops={[0, bg.from, 1, bg.to]}
      />
    );
  }
  // Konva menerima canvas sebagai pola walau tipenya HTMLImageElement.
  const pattern = (patternImage(bg, scale) ?? undefined) as unknown as HTMLImageElement | undefined;
  return (
    <>
      {bg.kind === "dots" && bg.bgTo ? (
        <Rect width={W} height={H} fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: W, y: H }} fillLinearGradientColorStops={[0, bg.bg, 1, bg.bgTo]} />
      ) : (
        <Rect width={W} height={H} fill={bg.bg} />
      )}
      <Rect width={W} height={H} fillPatternImage={pattern} fillPatternRepeat="repeat" />
    </>
  );
}

function SlotBase({ slot: s }: { slot: SceneSlot }) {
  return (
    <Group {...center(s)}>
      {(s.frameFill || s.shadow) && (
        <Rect
          width={s.w}
          height={s.h}
          fill={s.frameFill ?? "transparent"}
          shadowColor="#000"
          shadowOpacity={s.shadow ? 0.22 : 0}
          shadowBlur={s.shadow ? s.w * 0.04 : 0}
          shadowOffsetY={s.shadow ? s.w * 0.015 : 0}
        />
      )}
      <Group x={s.photo.x} y={s.photo.y} clipFunc={(ctx) => roundRect(ctx, s.photo.w, s.photo.h, s.photo.radius)}>
        {s.tiles.map((t, i) => (
          <Rect key={i} x={t.x} y={t.y} width={t.w} height={t.h} fill={t.participantSlot ? PLACEHOLDER_TINT[t.participantSlot] : "#D9D4DE"} />
        ))}
      </Group>
    </Group>
  );
}

function roundRect(ctx: Konva.Context, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(rr, 0);
  ctx.arcTo(w, 0, w, h, rr);
  ctx.arcTo(w, h, 0, h, rr);
  ctx.arcTo(0, h, 0, 0, rr);
  ctx.arcTo(0, 0, w, 0, rr);
  ctx.closePath();
}

export function Decor({ d }: { d: SceneDecor }) {
  if (d.kind === "rect") return <Rect x={d.x + d.w / 2} y={d.y + d.h / 2} offsetX={d.w / 2} offsetY={d.h / 2} width={d.w} height={d.h} fill={d.fill} cornerRadius={d.radius} rotation={d.rotation} opacity={d.opacity} />;
  if (d.kind === "mark") {
    const s = d.size / 4;
    return (
      <Group x={d.x} y={d.y - d.size * 0.9}>
        <Rect width={s * 1.6} height={d.size * 1.8} cornerRadius={s * 0.5} fill={d.color} />
        {MARK_COLORS.map((c, i) => (
          <Rect key={c} x={s * 0.3} y={s * 0.3 + i * s * 1.05} width={s} height={s * 0.8} cornerRadius={s * 0.15} fill={c} />
        ))}
      </Group>
    );
  }
  const boxW = Math.max(40, d.text.length * d.size * 0.8);
  const x = d.align === "left" ? d.x : d.align === "right" ? d.x - boxW : d.x - boxW / 2;
  return (
    <Text
      x={d.rotation ? d.x : x}
      y={d.y}
      width={d.rotation ? undefined : boxW}
      offsetY={d.size / 2}
      text={d.text}
      fontFamily={FONT_STACK[d.font]}
      fontStyle={d.italic ? "italic" : "normal"}
      fontSize={d.size}
      fill={d.color}
      align={d.align}
      rotation={d.rotation}
    />
  );
}

/** Feed live per sub-tile: video DOM (bukan Konva) supaya decode tetap di jalur video browser (RK-01). */
function Photos({ scene, scale, participants, meId, code, capture }: { scene: Scene; scale: number; participants: ParticipantView[]; meId: string | null; code: string | null; capture: CaptureState | null }) {
  const media = useMedia();
  const byColor = new Map(participants.filter((p) => p.connection !== "LEFT").map((p) => [p.color as string, p]));
  return (
    <div className={styles.photos} aria-hidden="true">
      {[...scene.slots]
        .sort((a, b) => a.z - b.z)
        .map((s) => (
          <div
            key={s.id}
            className={styles.slot}
            style={{ left: s.x * scale, top: s.y * scale, width: s.w * scale, height: s.h * scale, transform: s.rotation ? `rotate(${s.rotation}deg)` : undefined }}
          >
            <div
              className={styles.photo}
              style={{ left: s.photo.x * scale, top: s.photo.y * scale, width: s.photo.w * scale, height: s.photo.h * scale, borderRadius: s.photo.radius * scale }}
            >
              {s.tiles.map((t, i) => {
                const acceptedId = t.participantSlot && capture ? acceptedForCell(capture, t.shotIndex, t.participantSlot) : null;
                if (acceptedId && code) {
                  // Shot selesai: foto accepted milik peserta (bukan feed live) — slot menampilkan hasil nyata.
                  return (
                    <div
                      key={i}
                      className={styles.tile}
                      data-accepted={acceptedId}
                      style={{ left: t.x * scale, top: t.y * scale, width: t.w * scale, height: t.h * scale, filter: scene.filter === "none" ? undefined : scene.filter }}
                    >
                      <AttemptImage code={code} attemptId={acceptedId} alt={`Foto shot ${t.shotIndex + 1}`} />
                    </div>
                  );
                }
                const p = t.participantSlot ? byColor.get(t.participantSlot) : undefined;
                if (!p) return null;
                const self = p.participantId === meId;
                const stream = self ? (media.local.status === "live" ? media.local.stream : null) : (media.remote(p.participantId)?.stream ?? null);
                if (!stream) return null;
                const mask = t.blend
                  ? `linear-gradient(to right, ${t.blend.left ? "transparent 0%, #000 14%" : "#000 0%"}, ${t.blend.right ? "#000 86%, transparent 100%" : "#000 100%"})`
                  : undefined;
                return (
                  <div
                    key={i}
                    className={styles.tile}
                    data-participant={p.color}
                    style={{ left: t.x * scale, top: t.y * scale, width: t.w * scale, height: t.h * scale, filter: scene.filter === "none" ? undefined : scene.filter, maskImage: mask, WebkitMaskImage: mask }}
                  >
                    <VideoView stream={stream} mirrored={self ? media.local.mirrored : p.mirrored} presentation={self ? media.local.presentation : p.cameraPresentation} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

interface EditLayerProps {
  scene: Scene;
  scale: number;
  selected: string | null;
  onSelect?: (id: string | null) => void;
  onCommit: (g: SlotGeometry) => void;
  onGuides: (g: number[][]) => void;
  allowRotate: boolean;
}

/** Edit slot (10 §7): drag, handle 8 arah (`Shift` = jaga rasio), snapping ≤ 6 base px ke tepi/pusat kanvas & slot lain. */
function EditLayer({ scene, scale, selected, onSelect, onCommit, onGuides, allowRotate }: EditLayerProps) {
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Rect>());
  useEffect(() => {
    const node = selected ? nodes.current.get(selected) : undefined;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [selected, scene]);

  const snapTargets = (id: string) => {
    const xs = [0, scene.width / 2, scene.width];
    const ys = [0, scene.height / 2, scene.height];
    for (const s of scene.slots) {
      if (s.id === id) continue;
      xs.push(s.x, s.x + s.w / 2, s.x + s.w);
      ys.push(s.y, s.y + s.h / 2, s.y + s.h);
    }
    return { xs, ys };
  };

  const onDragMove = (s: SceneSlot, node: Konva.Rect) => {
    const { xs, ys } = snapTargets(s.id);
    const w = node.width() * node.scaleX();
    const h = node.height() * node.scaleY();
    let cx = node.x();
    let cy = node.y();
    const lines: number[][] = [];
    const snap = (pos: number, size: number, targets: number[]): [number, number | null] => {
      for (const edge of [pos - size / 2, pos, pos + size / 2]) {
        for (const t of targets) if (Math.abs(edge - t) <= STUDIO_LIMITS.SNAP_PX) return [pos + (t - edge), t];
      }
      return [pos, null];
    };
    const [sx, gx] = snap(cx, w, xs);
    const [sy, gy] = snap(cy, h, ys);
    cx = sx;
    cy = sy;
    node.position({ x: cx, y: cy });
    if (gx !== null) lines.push([gx, 0, gx, scene.height]);
    if (gy !== null) lines.push([0, gy, scene.width, gy]);
    onGuides(lines);
  };

  const commit = (s: SceneSlot, node: Konva.Rect) => {
    const w = Math.max(STUDIO_LIMITS.MIN_SLOT_PX, node.width() * node.scaleX());
    const h = Math.max(STUDIO_LIMITS.MIN_SLOT_PX, node.height() * node.scaleY());
    node.scale({ x: 1, y: 1 });
    node.size({ width: w, height: h });
    node.offset({ x: w / 2, y: h / 2 });
    onGuides([]);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    onCommit({ id: s.id, x: r2(node.x() - w / 2), y: r2(node.y() - h / 2), w: r2(w), h: r2(h), ...(allowRotate ? { rotation: r2(node.rotation()) } : {}) });
  };

  return (
    <Layer scaleX={scale} scaleY={scale}>
      <Rect width={scene.width} height={scene.height} onMouseDown={() => onSelect?.(null)} onTap={() => onSelect?.(null)} />
      {scene.slots.map((s) => (
        <Fragment key={s.id}>
          <Rect
            ref={(n) => {
              if (n) nodes.current.set(s.id, n);
              else nodes.current.delete(s.id);
            }}
            name={`slot-${s.id}`}
            x={s.x + s.w / 2}
            y={s.y + s.h / 2}
            offsetX={s.w / 2}
            offsetY={s.h / 2}
            width={s.w}
            height={s.h}
            rotation={s.rotation}
            fill="rgba(255,255,255,0.001)"
            stroke={selected === s.id ? "#FFFFFF" : "rgba(255,255,255,0.75)"}
            strokeWidth={(selected === s.id ? 2 : 1.25) / scale}
            dash={selected === s.id ? undefined : [6 / scale, 4 / scale]}
            draggable
            onMouseDown={() => onSelect?.(s.id)}
            onTap={() => onSelect?.(s.id)}
            onDragMove={(e) => onDragMove(s, e.target as Konva.Rect)}
            onDragEnd={(e) => commit(s, e.target as Konva.Rect)}
            onTransformEnd={(e) => commit(s, e.target as Konva.Rect)}
          />
        </Fragment>
      ))}
      <Transformer
        ref={trRef}
        rotateEnabled={allowRotate}
        keepRatio={false}
        ignoreStroke
        anchorSize={10}
        anchorCornerRadius={2}
        borderStroke="#FFFFFF"
        anchorStroke="#3B2350"
        boundBoxFunc={(oldBox, box) => (box.width * 1 < STUDIO_LIMITS.MIN_SLOT_PX * scale || box.height < STUDIO_LIMITS.MIN_SLOT_PX * scale ? oldBox : box)}
      />
    </Layer>
  );
}
