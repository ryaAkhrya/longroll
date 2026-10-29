"use client";

import { Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import {
  DOODLE_COLORS,
  DOODLE_WIDTHS,
  FILTER_PRESETS,
  STICKER_CATALOG,
  STICKER_CATEGORY_LABEL,
  TEXT_COLORS,
  TEXT_FONT_LABEL,
  TEXT_FONT_STYLES,
  elementLabel,
} from "@longroll/shared";
import type { CropRect, ElementView, FilterPresetId, HistoryEntry, ParticipantView, StickerAsset } from "@longroll/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ChipButton } from "@/components/ui/Chip";
import { Slider } from "@/components/ui/Slider";
import { Tag } from "@/components/ui/Tag";
import { iconProps } from "@/components/ui/icon-props";
import type { EditorController } from "@/editor/useEditor";
import { cx } from "@/lib/cx";
import styles from "./EditorPanels.module.css";

export function PanelHead({ title, bareng = true }: { title: string; bareng?: boolean }) {
  return (
    <header className={styles.head}>
      <h2 className={styles.title}>{title}</h2>
      {bareng && <Tag kind="bareng" />}
    </header>
  );
}

function StickerGlyph({ a }: { a: StickerAsset }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      {a.parts.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ?? "none"} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function StickerPanel({ ed }: { ed: EditorController }) {
  const [cat, setCat] = useState<StickerAsset["category"] | "all">("all");
  const list = STICKER_CATALOG.filter((s) => cat === "all" || s.category === cat);
  return (
    <div className={styles.panel}>
      <PanelHead title="Stiker" />
      <div className={styles.chips} role="group" aria-label="Kategori stiker">
        {(["all", "bentuk", "dekor", "seru"] as const).map((c) => (
          <ChipButton key={c} selected={cat === c} onClick={() => setCat(c)}>
            {c === "all" ? "Semua" : STICKER_CATEGORY_LABEL[c]}
          </ChipButton>
        ))}
      </div>
      <ul className={styles.stickers} aria-label="Daftar stiker">
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" className={styles.sticker} aria-label={`Tambah stiker ${s.name}`} disabled={ed.readOnly} onClick={() => ed.addSticker(s.id)} draggable>
              <StickerGlyph a={s} />
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.note}>Ketuk buat nempel di tengah kanvas, lalu geser. Set stiker sementara (orisinal LONGROLL).</p>
      {ed.full && <p className={styles.warn}>Kanvasnya udah penuh banget.</p>}
    </div>
  );
}

export function TextPanel({ ed }: { ed: EditorController }) {
  return (
    <div className={styles.panel}>
      <PanelHead title="Teks" />
      <div className={styles.row}>
        {TEXT_FONT_STYLES.map((f) => (
          <Button key={f} variant="secondary" size="md" disabled={ed.readOnly} onClick={() => ed.addText("teks kamu", f)} className={styles[`font_${f}`]}>
            + {TEXT_FONT_LABEL[f]}
          </Button>
        ))}
      </div>
      <p className={styles.note}>Ketuk dua kali teks buat ngedit isinya.</p>
    </div>
  );
}

export function DoodlePanel({ color, width, onColor, onWidth }: { color: string; width: number; onColor: (c: string) => void; onWidth: (w: number) => void }) {
  return (
    <div className={styles.panel}>
      <PanelHead title="Coret" />
      <div className={styles.swatches} role="radiogroup" aria-label="Warna coretan">
        {DOODLE_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={cx(styles.dot, color === c && styles.dotOn)} style={{ background: c }} onClick={() => onColor(c)} />
        ))}
      </div>
      <div className={styles.row} role="radiogroup" aria-label="Tebal coretan">
        {DOODLE_WIDTHS.map((w) => (
          <button key={w} type="button" role="radio" aria-checked={width === w} aria-label={`Tebal ${w}`} className={cx(styles.width, width === w && styles.widthOn)} onClick={() => onWidth(w)}>
            <span style={{ height: w, width: 28, borderRadius: w }} />
          </button>
        ))}
      </div>
      <p className={styles.note}>1 jari menggambar, 2 jari geser/zoom kanvas. Coretanmu langsung kelihatan sama temen-temenmu.</p>
    </div>
  );
}

export function FilterPanel({ ed, selected }: { ed: EditorController; selected: ElementView | null }) {
  const photo = selected?.type === "photo" ? selected : null;
  const current = (photo ? (photo.filter as FilterPresetId | null) : ed.meta?.globalFilter) ?? null;
  const pick = (id: FilterPresetId) => {
    const value = id === "ASLI" ? null : id;
    if (photo) ed.update(photo.id, { filter: value }, "filter foto");
    else ed.setGlobalFilter(value);
  };
  return (
    <div className={styles.panel}>
      <PanelHead title="Filter" />
      <p className={styles.note}>{photo ? `Filter foto ${String(photo.ownerName)} (mengalahkan filter semua).` : "Filter buat semua foto. Pilih satu foto di kanvas buat filter khusus."}</p>
      <div className={styles.filters} role="radiogroup" aria-label="Filter">
        {FILTER_PRESETS.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={(current ?? "ASLI") === f.id} className={cx(styles.filter, (current ?? "ASLI") === f.id && styles.filterOn)} disabled={ed.readOnly} onClick={() => pick(f.id)}>
            <span className={styles.swatch} style={{ filter: f.css === "none" ? undefined : f.css }} aria-hidden="true" />
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FramePanel({ ed, frames, current }: { ed: EditorController; frames: { id: string; name: string; ref: Parameters<EditorController["setFrame"]>[0] }[]; current: string | null }) {
  return (
    <div className={styles.panel}>
      <PanelHead title="Frame" />
      <ul className={styles.frameList} aria-label="Daftar frame">
        {frames.map((f) => (
          <li key={f.id}>
            <button type="button" className={cx(styles.frameItem, current === f.id && styles.frameOn)} aria-pressed={current === f.id} disabled={ed.readOnly} onClick={() => ed.setFrame(f.ref, f.name)}>
              {f.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Panel Layer: alternatif aksesibel kanvas — panah geser 4 px (Shift 20), `[` / `]` urutan, Delete hapus (11 §12). */
export function LayerPanel({ ed, selection, onSelect }: { ed: EditorController; selection: string[]; onSelect: (ids: string[]) => void }) {
  const list = [...ed.elements].reverse();
  const onKey = (e: KeyboardEvent<HTMLLIElement>, el: ElementView) => {
    if (ed.readOnly) return;
    const step = e.shiftKey ? 20 : 4;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      ed.commit(el.id, { x: Number(el.x) + dx, y: Number(el.y) + dy, scaleX: Number(el.scaleX), scaleY: Number(el.scaleY), rotation: Number(el.rotation) });
    };
    if (e.key === "ArrowLeft") move(-step, 0);
    else if (e.key === "ArrowRight") move(step, 0);
    else if (e.key === "ArrowUp") move(0, -step);
    else if (e.key === "ArrowDown") move(0, step);
    else if (e.key === "[") ed.z(el.id, "down");
    else if (e.key === "]") ed.z(el.id, "up");
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      ed.remove(el.id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect([el.id]);
    }
  };
  return (
    <div className={styles.panel}>
      <PanelHead title="Layer" />
      <ul className={styles.layers} role="listbox" aria-label="Layer, teratas dulu" aria-multiselectable="false">
        {list.map((el) => (
          <li
            key={el.id}
            role="option"
            aria-selected={selection.includes(el.id)}
            tabIndex={0}
            className={cx(styles.layer, selection.includes(el.id) && styles.layerOn, !!el.hidden && styles.layerHidden)}
            onClick={() => onSelect([el.id])}
            onKeyDown={(e) => onKey(e, el)}
            data-element={el.id}
          >
            <span className={styles.layerName}>{elementLabel(el)}</span>
            <span className={styles.layerBy}>{ed.nameOf(String(el.createdBy))}</span>
            <button type="button" className={styles.iconBtn} aria-label={el.hidden ? "Tampilkan" : "Sembunyikan"} disabled={ed.readOnly} onClick={(e) => (e.stopPropagation(), ed.update(el.id, { hidden: !el.hidden }, el.hidden ? "tampilkan" : "sembunyikan"))}>
              {el.hidden ? <EyeOff size={15} {...iconProps} /> : <Eye size={15} {...iconProps} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function timeAgo(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s} dtk` : s < 3600 ? `${Math.round(s / 60)} mnt` : `${Math.round(s / 3600)} jam`;
}

export function HistoryPanel({ ed, participants, now, onConfirm }: { ed: EditorController; participants: ParticipantView[]; now: number; onConfirm: (entry: HistoryEntry, changedBy?: string) => void }) {
  const rows = [...ed.history].reverse().slice(0, 60);
  return (
    <div className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>Riwayat</h2>
        <span className={styles.note}>siapa aja bisa balikin</span>
      </header>
      <ul className={styles.history} aria-label="Riwayat perubahan">
        {rows.length === 0 && <li className={styles.note}>Belum ada perubahan.</li>}
        {rows.map((h) => {
          const p = participants.find((x) => x.participantId === h.by);
          return (
            <li key={h.id} className={styles.histRow}>
              {p ? <Avatar name={p.displayName} color={p.color} size={22} /> : <span className={styles.ghost} />}
              <span className={styles.histText}>
                <strong>{p?.displayName ?? "Seseorang"}</strong> {h.label}
              </span>
              <time className={styles.histTime}>{timeAgo(h.at, now)}</time>
              <Button
                size="sm"
                variant="ghost"
                disabled={ed.readOnly}
                aria-label={`Balikin: ${h.label}`}
                onClick={() => {
                  const r = ed.revert(h.id);
                  if (!r.ok && r.reason === "CHANGED") onConfirm(h, r.changedBy);
                }}
              >
                Balikin
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Properti elemen terpilih (kontekstual per tipe, 06 §6): teks, stiker, foto (crop & zoom), doodle + layer. */
export function PropsPanel({ ed, el, textRef }: { ed: EditorController; el: ElementView; textRef: RefObject<HTMLTextAreaElement | null> }) {
  const set = (patch: Record<string, unknown>, label: string) => ed.update(el.id, patch, label);
  const crop = el.type === "photo" ? (el.crop as CropRect) : null;
  const zoom = Number(el.zoom ?? 1);
  const applyZoom = (z: number, cx = crop ? crop.x + crop.w / 2 : 0.5, cy = crop ? crop.y + crop.h / 2 : 0.5) => {
    if (!crop) return;
    // Zoom di sekitar pusat crop: rasio kotak tetap (tanpa distorsi).
    const w = Math.min(1, crop.w * (zoom / z));
    const h = Math.min(1, crop.h * (zoom / z));
    const x = Math.max(0, Math.min(1 - w, cx - w / 2));
    const y = Math.max(0, Math.min(1 - h, cy - h / 2));
    set({ crop: { x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4, w: Math.round(w * 1e4) / 1e4, h: Math.round(h * 1e4) / 1e4 }, zoom: z }, "crop foto");
  };
  return (
    <div className={styles.panel} data-testid="props-panel">
      <header className={styles.head}>
        <h2 className={styles.title}>{elementLabel(el)}</h2>
        <Tag kind="bareng" />
      </header>
      {el.type === "text" && (
        <>
          <label className={styles.field}>
            <span>Isi teks</span>
            <textarea ref={textRef} className={styles.textarea} defaultValue={String(el.content ?? "")} key={`${el.id}:${String(el.content)}`} maxLength={500} rows={2} disabled={ed.readOnly} onBlur={(e) => ed.editText(el.id, e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.currentTarget.blur()} />
          </label>
          <div className={styles.row} role="radiogroup" aria-label="Gaya teks">
            {TEXT_FONT_STYLES.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={el.fontStyle === f} className={cx(styles.seg, el.fontStyle === f && styles.segOn)} onClick={() => set({ fontStyle: f }, `gaya teks ${TEXT_FONT_LABEL[f]}`)}>
                {TEXT_FONT_LABEL[f]}
              </button>
            ))}
          </div>
          <div className={styles.swatches} role="radiogroup" aria-label="Warna teks">
            {TEXT_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={el.color === c} aria-label={c} className={cx(styles.dot, el.color === c && styles.dotOn)} style={{ background: c }} onClick={() => set({ color: c }, "warna teks")} />
            ))}
          </div>
          <Slider label="Ukuran" value={Number(el.fontSize)} min={16} max={240} step={2} onChange={(v) => set({ fontSize: Math.round(v) }, "ukuran teks")} format={(v) => `${Math.round(v)}`} />
        </>
      )}
      {el.type === "photo" && crop && (
        <>
          <p className={styles.note}>Foto {String(el.ownerName)} · sumber asli tidak berubah, hanya tampilannya.</p>
          <Slider label="Zoom" value={zoom} min={1} max={4} step={0.05} onChange={(v) => applyZoom(v)} format={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Geser ←→" value={crop.x + crop.w / 2} min={crop.w / 2} max={1 - crop.w / 2 || 1} step={0.01} onChange={(v) => applyZoom(zoom, v, crop.y + crop.h / 2)} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Geser ↑↓" value={crop.y + crop.h / 2} min={crop.h / 2} max={1 - crop.h / 2 || 1} step={0.01} onChange={(v) => applyZoom(zoom, crop.x + crop.w / 2, v)} format={(v) => `${Math.round(v * 100)}%`} />
          <Button variant="secondary" size="md" onClick={() => set({ flipX: !el.flipX }, "balik foto")} disabled={ed.readOnly}>
            Balik horizontal
          </Button>
        </>
      )}
      {el.type === "sticker" && (
        <div className={styles.swatches} role="radiogroup" aria-label="Warna stiker">
          {["#F2778F", "#F2C94C", "#7DC49D", "#A893E0", "#FFFFFF", "#1B1720"].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={el.tint === c} aria-label={c} className={cx(styles.dot, el.tint === c && styles.dotOn)} style={{ background: c }} onClick={() => set({ tint: c }, "warna stiker")} />
          ))}
        </div>
      )}
      <Slider label="Transparansi" value={Number(el.opacity)} min={0.1} max={1} step={0.05} onChange={(v) => set({ opacity: Math.round(v * 100) / 100 }, "transparansi")} format={(v) => `${Math.round(v * 100)}%`} />
      <div className={styles.row}>
        <Button variant="secondary" size="sm" onClick={() => ed.z(el.id, "front")} disabled={ed.readOnly}>Depan</Button>
        <Button variant="secondary" size="sm" onClick={() => ed.z(el.id, "up")} disabled={ed.readOnly}>Naik</Button>
        <Button variant="secondary" size="sm" onClick={() => ed.z(el.id, "down")} disabled={ed.readOnly}>Turun</Button>
        <Button variant="secondary" size="sm" onClick={() => ed.z(el.id, "back")} disabled={ed.readOnly}>Belakang</Button>
      </div>
      <div className={styles.row}>
        {el.type !== "photo" && (
          <Button variant="secondary" size="sm" icon={<Copy size={15} {...iconProps} />} onClick={() => ed.duplicate(el.id)} disabled={ed.readOnly}>
            Duplikat
          </Button>
        )}
        <Button variant="danger" size="sm" icon={<Trash2 size={15} {...iconProps} />} onClick={() => ed.remove(el.id)} disabled={ed.readOnly}>
          Hapus
        </Button>
      </div>
    </div>
  );
}

export function useTextRef() {
  return useRef<HTMLTextAreaElement | null>(null);
}
