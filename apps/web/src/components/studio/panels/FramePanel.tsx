"use client";

import { Check, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FRAME_CATEGORY_LABEL, FRAME_CATEGORY_ORDER } from "@longroll/shared";
import type { FrameCategory, FrameRef, FrameTemplate, Mode, ParticipantView, StudioState } from "@longroll/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ChipButton } from "@/components/ui/Chip";
import { Tag } from "@/components/ui/Tag";
import { iconProps } from "@/components/ui/icon-props";
import { cx } from "@/lib/cx";
import { StudioCanvas } from "../canvas";
import styles from "./panels.module.css";

/** Thumbnail baru dibuat saat mendekati layar (tiap thumbnail = 2 kanvas Konva; 25+ frame tidak boleh dibuat sekaligus). */
function LazyMount({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser tanpa IntersectionObserver: tampilkan langsung (tanpa lazy)
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <div ref={ref} className={styles.lazy}>
      {seen ? children : null}
    </div>
  );
}

interface FramePanelProps {
  studio: StudioState;
  frames: { ref: FrameRef; template: FrameTemplate }[];
  participants: ParticipantView[];
  meId: string | null;
  code: string;
  /** Mode sesi: frame bawaan yang tidak cocok dengan mode ini tidak ditampilkan (frame custom tidak dibatasi). */
  mode?: Mode;
  /** frameId yang sedang dilihat (pratinjau lokal). */
  previewId: string | null;
  onPreview: (ref: FrameRef, template: FrameTemplate) => void;
  onApply: () => void;
  onUpload: () => void;
  /** frameId → peserta lain yang sedang melihatnya (presence "lagi lihat X"). */
  viewers: Map<string, ParticipantView[]>;
  compact?: boolean;
  dateMs?: number;
}

/**
 * SCR-09 Frame (V1): pratinjau LOKAL (tidak mengubah orang lain, tapi presence dikirim) vs
 * **Pasang buat semua** (perubahan bersama + toast). Grid thumbnail = listbox.
 */
export function FramePanel(props: FramePanelProps) {
  const { studio, frames, previewId, viewers } = props;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<FrameCategory | "ALL">("ALL");
  const applied = studio.frame?.frameId ?? null;
  // Hanya frame yang cocok dengan mode (+ frame yang sedang terpasang, apa pun modenya) dan hanya kategori yang punya isi.
  const usable = useMemo(() => frames.filter((f) => f.template.category === "CUSTOM" || !props.mode || f.template.modes.includes(props.mode) || f.ref.frameId === applied), [frames, props.mode, applied]);
  const categories = useMemo(() => FRAME_CATEGORY_ORDER.filter((c) => usable.some((f) => f.template.category === c)), [usable]);
  const shown = useMemo(
    () => usable.filter((f) => (cat === "ALL" || f.template.category === cat) && f.template.name.toLocaleLowerCase("id").includes(q.trim().toLocaleLowerCase("id"))),
    [usable, cat, q],
  );
  const previewing = frames.find((f) => f.ref.frameId === (previewId ?? applied));
  const canApply = !!previewing && previewing.ref.frameId !== applied;

  return (
    <div className={cx(styles.panel, props.compact && styles.compact)}>
      <header className={styles.head}>
        <h2 className={styles.title}>Frame</h2>
        <Tag kind="bareng" />
        <Button variant="ghost" size="sm" className={styles.headAction} icon={<Upload size={15} {...iconProps} />} onClick={props.onUpload}>
          Upload
        </Button>
      </header>
      <label className={styles.search}>
        <Search size={16} {...iconProps} aria-hidden="true" />
        <input type="search" placeholder="Cari frame…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari frame" />
      </label>
      <div className={styles.chips} role="group" aria-label="Kategori frame">
        {(["ALL", ...categories] as (FrameCategory | "ALL")[]).map((c) => (
          <ChipButton key={c} selected={cat === c} onClick={() => setCat(c)}>
            {c === "ALL" ? `Semua (${usable.length})` : FRAME_CATEGORY_LABEL[c]}
          </ChipButton>
        ))}
      </div>
      <ul className={styles.thumbs} role="listbox" aria-label="Daftar frame">
        {shown.map(({ ref, template }) => {
          const selected = (previewId ?? applied) === ref.frameId;
          const lookers = viewers.get(ref.frameId) ?? [];
          return (
            <li
              key={ref.frameId}
              role="option"
              aria-selected={selected}
              aria-label={`${template.name}, ${FRAME_CATEGORY_LABEL[template.category]}${applied === ref.frameId ? ", dipakai" : ""}`}
              tabIndex={0}
              className={cx(styles.thumb, selected && styles.thumbOn)}
              onClick={() => props.onPreview(ref, template)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onPreview(ref, template);
                }
              }}
            >
              <div className={styles.thumbArt}>
                <LazyMount>
                  <StudioCanvas studio={{ ...studio, frame: ref }} template={template} participants={props.participants} meId={props.meId} code={props.code} label={`Contoh ${template.name}`} dateMs={props.dateMs} className={styles.thumbCanvas} />
                </LazyMount>
                {selected && (
                  <span className={styles.check} aria-hidden="true">
                    <Check size={14} {...iconProps} />
                  </span>
                )}
                {lookers.length > 0 && (
                  <span className={styles.lookers} aria-label={`${lookers.map((p) => p.displayName).join(", ")} lagi lihat`}>
                    {lookers.map((p) => (
                      <Avatar key={p.participantId} name={p.displayName} color={p.color} size={20} ring />
                    ))}
                  </span>
                )}
              </div>
              <span className={styles.thumbName}>{template.name}</span>
              <span className={styles.thumbCat}>{FRAME_CATEGORY_LABEL[template.category]}</span>
            </li>
          );
        })}
        {shown.length === 0 && <li className={styles.emptyList}>{cat === "CUSTOM" ? "Belum ada frame upload. Coba Upload frame." : "Frame tidak ditemukan. Coba kata lain atau pilih kategori Semua."}</li>}
      </ul>
      <footer className={styles.foot}>
        <Button variant="secondary" size="lg" icon={<Upload size={16} {...iconProps} />} onClick={props.onUpload} className={styles.desktopOnly}>
          Upload frame
        </Button>
        <Button variant="primary" size="lg" fullWidth disabled={!canApply} onClick={props.onApply}>
          {canApply ? (props.compact ? `Pasang ${previewing!.template.name} buat semua` : "Pasang buat semua") : "Udah dipasang"}
        </Button>
      </footer>
    </div>
  );
}
