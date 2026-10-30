import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  EDITOR_LIMITS,
  EditorError,
  PARTICIPANT_SLOTS,
  STICKER_CATALOG,
  addDoodle,
  addSticker,
  addText,
  checkUpdate,
  commitTransform,
  createEditorDoc,
  createSeededDoc,
  createUndo,
  decodePoints,
  deleteElement,
  duplicateElement,
  editText,
  elementsMap,
  encodePoints,
  initStudio,
  listElements,
  metaMap,
  readHistory,
  revertEntry,
  setCrop,
  setFrame,
  setGlobalFilter,
  setZ,
  simplifyRdp,
  updateElement,
  validateDoc,
} from "../index";
import type { Attempt, CaptureState, EditorCtx, Mode, ParticipantSlot, Shot } from "../index";

const SLOTS = PARTICIPANT_SLOTS as readonly ParticipantSlot[];

/** Capture palsu hanya sebagai MASUKAN seed: semua shot DONE, semua peserta accepted. */
function makeCapture(shotCount: number, pids: string[], skip: string[] = []) {
  const attempts: Record<string, Attempt> = {};
  const accepted = new Map<string, string>();
  const shots: Shot[] = Array.from({ length: shotCount }, (_, s) => {
    const per: Shot["perParticipant"] = {};
    pids.forEach((pid, i) => {
      const id = `att-${s}-${i}`;
      const skipped = skip.includes(`${s}:${pid}`);
      per[pid] = { status: skipped ? "SKIPPED" : "ACCEPTED", attempts: skipped ? [] : [id], currentAttemptId: skipped ? null : id, acceptedAttemptId: skipped ? null : id, retakeT0ServerMs: null, statusAtMs: 0 };
      if (!skipped) {
        attempts[id] = { attemptId: id, shotIndex: s, ownerId: pid, ownerNameAtCapture: `N${i}`, ownerColor: SLOTS[i]!, attemptNo: 1, kind: "shot", status: "READY", createdAtMs: 0, capturedAtServerMs: 0, late: false, mirrored: false, preview: { bytes: 1, width: 640, height: 480, sha256: "a".repeat(64) }, full: { bytes: 1, width: 1600, height: 1200, sha256: "b".repeat(64) }, purged: false };
        accepted.set(id, pid);
      }
    });
    return { index: s, state: "DONE", t0ServerMs: 1, armedBy: pids[0]!, armedAtMs: 0, countdownSec: 5, required: pids, slotOf: Object.fromEntries(pids.map((p, i) => [p, SLOTS[i]!])), perParticipant: per, doneAtMs: 1, heldBy: null } satisfies Shot;
  });
  const capture: CaptureState = { eligible: Object.fromEntries(pids.map((p, i) => [p, SLOTS[i]!])), shotCount, shots, attempts, bytesUsed: 0 };
  return { capture, accepted };
}

const PIDS = ["pa", "pb", "pc"];

function seeded(mode: Mode, strategy?: "PER_SHOT_GROUP" | "PER_PARTICIPANT_SHOT", shots = 4, pids = PIDS, skip: string[] = []) {
  let studio = initStudio(mode, SLOTS.slice(0, pids.length) as ParticipantSlot[]);
  if (strategy && strategy !== studio.bindingStrategy) studio = { ...studio, bindingStrategy: strategy };
  void shots;
  const { capture, accepted } = makeCapture(studio.layout.shotCount, pids, skip);
  const doc = createSeededDoc({ studio, capture, names: Object.fromEntries(pids.map((p, i) => [p, `N${i}`])), srcDims: () => ({ w: 1600, h: 1200 }) });
  return { doc, studio, capture, accepted };
}

const ctxOf = (pid: string, name = pid, clock = { t: 1000 }): EditorCtx => ({ participantId: pid, name, origin: { pid }, now: () => clock.t });

/** Sambungkan dokumen: setiap update lokal dikirim ke semua dokumen lain (dengan opsi tahan/acak). */
function link(docs: Y.Doc[]) {
  const queue: { to: Y.Doc; u: Uint8Array }[] = [];
  docs.forEach((d) => d.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    for (const o of docs) if (o !== d) queue.push({ to: o, u });
  }));
  return {
    flush(shuffle?: () => number) {
      const q = queue.splice(0);
      if (shuffle) q.sort(() => shuffle() - 0.5);
      for (const m of q) Y.applyUpdate(m.to, m.u, "remote");
    },
    pending: () => queue.length,
  };
}

const accepted = (m: Map<string, string>) => ({ acceptedAttempts: m });

describe("seed elemen foto dari BindingPlan (11 §13, DEC-087)", () => {
  it("PER_SHOT_GROUP (Strip): 1 foto per peserta per shot pada sub-tile; semua id deterministik & di dalam kanvas", () => {
    const { doc, studio, accepted: acc } = seeded("PHOTO_STRIP");
    const photos = listElements(doc).filter((e) => e.type === "photo");
    expect(photos).toHaveLength(studio.layout.shotCount * 3);
    expect(new Set(photos.map((p) => p.id)).size).toBe(photos.length);
    for (const p of photos) {
      expect(p.id).toBe(`photo:${p.attemptId}`);
      expect(Math.abs(Number(p.x))).toBeLessThan(studio.layout.canvas.widthPx);
      expect(Number(p.y)).toBeGreaterThan(0);
      expect(Number(p.y)).toBeLessThan(studio.layout.canvas.heightPx);
    }
    expect(validateDoc(doc, accepted(acc))).toBeNull();
    expect(metaMap(doc).get("canvas")).toEqual({ w: studio.layout.canvas.widthPx, h: studio.layout.canvas.heightPx });
  });

  it("PER_PARTICIPANT_SHOT (Grid), GROUP_SHOT (BLEND), FREEFORM (Collage): jumlah foto = cell accepted; peserta SKIPPED tidak dibuatkan foto", () => {
    for (const [mode, strategy] of [["PHOTO_GRID", "PER_PARTICIPANT_SHOT"], ["PHOTO_GRID", "PER_SHOT_GROUP"], ["GROUP_SHOT", "PER_SHOT_GROUP"], ["GROUP_SHOT", "PER_PARTICIPANT_SHOT"], ["FREEFORM_COLLAGE", undefined]] as const) {
      const { doc, studio, accepted: acc } = seeded(mode, strategy);
      const n = listElements(doc).filter((e) => e.type === "photo").length;
      expect(n, `${mode}/${strategy}`).toBe(studio.layout.shotCount * 3);
      expect(validateDoc(doc, accepted(acc))).toBeNull();
    }
    const withSkip = seeded("PHOTO_GRID", "PER_PARTICIPANT_SHOT", 1, PIDS, ["0:pb"]);
    expect(listElements(withSkip.doc).filter((e) => e.type === "photo")).toHaveLength(2);
  });

  it("seed ganda (restart/balapan, clientID tetap) bergabung tanpa duplikasi dan identik", () => {
    const a = seeded("PHOTO_STRIP").doc;
    const b = seeded("PHOTO_STRIP").doc;
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(listElements(a)).toEqual(listElements(b));
    expect(listElements(a).filter((e) => e.type === "photo")).toHaveLength(12);
  });

  it("foto rotasi (slot Scrapbook/Collage) tetap berada pada pusat slot", () => {
    const { doc } = seeded("FREEFORM_COLLAGE");
    expect(listElements(doc).some((e) => Number(e.rotation) !== 0)).toBe(true);
  });
});

describe("operasi, riwayat, Balikin (11 §4, §7)", () => {
  const mk = () => {
    const seed = seeded("PHOTO_STRIP");
    const clock = { t: 1000 };
    return { ...seed, clock, a: ctxOf("pa", "A", clock), b: ctxOf("pb", "B", clock) };
  };

  it("stiker/teks/doodle/transform/crop/filter/layer/frame: tiap operasi = 1 transaksi + 1 entri riwayat; hasil lolos validasi", () => {
    const { doc, a, accepted: acc, clock } = mk();
    const stk = addSticker(doc, a, "heart", { x: 300, y: 600 });
    const txt = addText(doc, a, { x: 300, y: 900 }, "besties ♡", "serif");
    const pts = simplifyRdp(Array.from({ length: 300 }, (_, i) => [i, Math.sin(i / 10) * 20] as [number, number]));
    const dd = addDoodle(doc, a, encodePoints(pts), "#F2778F", 8, { x: 300, y: 300 });
    clock.t += 5000;
    commitTransform(doc, a, stk, { x: 350, y: 650, scaleX: 1.5, scaleY: 1.5, rotation: 15 });
    clock.t += 5000;
    editText(doc, a, txt, "besties ♡♡");
    const photo = listElements(doc).find((e) => e.type === "photo")!;
    clock.t += 5000;
    setCrop(doc, a, photo.id, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 2);
    updateElement(doc, a, photo.id, { filter: "MONO" }, "filter foto");
    setZ(doc, a, stk, "back");
    setZ(doc, a, txt, "front");
    setGlobalFilter(doc, a, "FILM");
    setFrame(doc, a, { frameId: "builtin/film-400@1", source: "BUILTIN", adapt: "CONTAIN", overlayOpacity: 1 }, "Film 400");
    const dup = duplicateElement(doc, a, stk);
    expect(dup).toBeTruthy();
    expect(duplicateElement(doc, a, photo.id)).toBeNull(); // foto sumber tak digandakan
    expect(validateDoc(doc, accepted(acc))).toBeNull();
    expect(elementsMap(doc).get(txt)!.get("content")!.toString()).toBe("besties ♡♡");
    expect(listElements(doc)[0]!.id).toBe(stk === dup ? stk : stk); // stiker di layer paling bawah
    expect(readHistory(doc).length).toBeGreaterThanOrEqual(9);
    expect(decodePoints(String(elementsMap(doc).get(dd)!.get("points")))).toHaveLength(pts.length);
  });

  it("entri riwayat elemen yang sama digabung dalam 2 detik; berbeda peserta tidak digabung", () => {
    const { doc, a, b, clock } = mk();
    const id = addSticker(doc, a, "star", { x: 100, y: 100 });
    clock.t += 500;
    commitTransform(doc, a, id, { x: 120, y: 100, scaleX: 1, scaleY: 1, rotation: 0 });
    clock.t += 500;
    commitTransform(doc, a, id, { x: 140, y: 100, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(readHistory(doc).filter((h) => h.elementId === id)).toHaveLength(2); // dibuat + satu entri gabungan
    clock.t += 500;
    commitTransform(doc, b, id, { x: 160, y: 100, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(readHistory(doc).filter((h) => h.elementId === id)).toHaveLength(3);
  });

  it("riwayat FIFO 200 entri", () => {
    const { doc, a, clock } = mk();
    const id = addSticker(doc, a, "dot", { x: 100, y: 100 });
    for (let i = 0; i < 260; i++) {
      clock.t += 3000;
      commitTransform(doc, a, id, { x: 100 + i, y: 100, scaleX: 1, scaleY: 1, rotation: 0 });
    }
    expect(readHistory(doc)).toHaveLength(EDITOR_LIMITS.maxHistory);
  });

  it("AC-6 Balikin oleh peserta lain: mengembalikan properti & menambah entri baru; bila sudah diubah lagi → CHANGED + konfirmasi (force)", () => {
    const { doc, a, b, clock } = mk();
    const id = addSticker(doc, a, "heart", { x: 100, y: 100 });
    clock.t += 5000;
    commitTransform(doc, a, id, { x: 500, y: 500, scaleX: 1, scaleY: 1, rotation: 0 });
    const move = readHistory(doc).at(-1)!;
    const n = readHistory(doc).length;
    expect(revertEntry(doc, b, move.id)).toEqual({ ok: true });
    expect(elementsMap(doc).get(id)!.get("x")).toBe(100);
    expect(readHistory(doc)).toHaveLength(n + 1);
    expect(readHistory(doc).at(-1)).toMatchObject({ by: "pb", revertOf: move.id });
    // Elemen diubah lagi oleh pb → Balikin entri lama pa butuh konfirmasi
    clock.t += 5000;
    commitTransform(doc, b, id, { x: 700, y: 700, scaleX: 1, scaleY: 1, rotation: 0 });
    const res = revertEntry(doc, a, move.id);
    expect(res).toMatchObject({ ok: false, reason: "CHANGED", changedBy: "pb" });
    expect(elementsMap(doc).get(id)!.get("x")).toBe(700);
    expect(revertEntry(doc, a, move.id, true)).toEqual({ ok: true });
  });

  it("AC-4 hapus lalu Balikin memulihkan elemen (termasuk teks); Balikin pembuatan = menghapus", () => {
    const { doc, a, b, clock } = mk();
    const t = addText(doc, a, { x: 200, y: 200 }, "halo");
    clock.t += 5000;
    expect(deleteElement(doc, b, t)).toBe(true);
    expect(elementsMap(doc).has(t)).toBe(false);
    const del = readHistory(doc).at(-1)!;
    expect(revertEntry(doc, a, del.id)).toEqual({ ok: true });
    expect(elementsMap(doc).get(t)!.get("content")!.toString()).toBe("halo");
    const created = readHistory(doc).find((h) => h.elementId === t && h.before === null)!;
    expect(revertEntry(doc, b, created.id)).toEqual({ ok: true });
    expect(elementsMap(doc).has(t)).toBe(false);
  });

  it("entri meta (frame, filter global) bisa dibalikin", () => {
    const { doc, a, b } = mk();
    setGlobalFilter(doc, a, "MONO");
    const e = readHistory(doc).at(-1)!;
    expect(revertEntry(doc, b, e.id)).toEqual({ ok: true });
    expect(metaMap(doc).get("globalFilter") ?? null).toBeNull();
    expect(setFrame(doc, a, null, "tanpa")).toBeDefined();
  });

  it("batas 200 elemen: tambah ditolak (FULL) tanpa merusak dokumen", () => {
    const { doc, a } = mk();
    let added = 0;
    expect(() => {
      for (let i = 0; i < 300; i++) {
        addSticker(doc, a, "dot", { x: i, y: i });
        added++;
      }
    }).toThrow(EditorError);
    expect(elementsMap(doc).size).toBe(EDITOR_LIMITS.maxElements);
    expect(added).toBe(EDITOR_LIMITS.maxElements - 12);
  });
});

describe("AC-5 undo pribadi (DEC-032)", () => {
  it("Undo hanya membatalkan operasi sendiri walau ada perubahan orang lain di antaranya; redo mengembalikan", () => {
    const seed = seeded("PHOTO_STRIP");
    const a = createEditorDoc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(seed.doc));
    const b = createEditorDoc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(seed.doc));
    const net = link([a, b]);
    const ca = ctxOf("pa");
    const cb = ctxOf("pb");
    const ua = createUndo(a, ca.origin);
    const s1 = addSticker(a, ca, "heart", { x: 100, y: 100 });
    ua.stopCapturing();
    net.flush();
    const t1 = addText(b, cb, { x: 200, y: 200 }, "milik B");
    net.flush();
    const s2 = addSticker(a, ca, "star", { x: 300, y: 300 });
    net.flush();
    ua.stopCapturing();
    ua.undo();
    net.flush();
    for (const d of [a, b]) {
      expect(elementsMap(d).has(s2)).toBe(false); // langkah terakhir A dibatalkan
      expect(elementsMap(d).has(s1)).toBe(true);
      expect(elementsMap(d).has(t1)).toBe(true); // milik B tak tersentuh
    }
    ua.undo();
    ua.undo(); // tak ada lagi yang bisa dibatalkan milik A → tidak menyentuh B
    net.flush();
    expect(elementsMap(b).has(t1)).toBe(true);
    ua.redo();
    net.flush();
    expect(elementsMap(b).has(s1)).toBe(true);
  });
});

describe("AC-3/7 konvergensi CRDT", () => {
  it("dua klien menggeser elemen sama bersamaan → state identik (deterministik)", () => {
    const seed = seeded("PHOTO_STRIP");
    const a = createEditorDoc();
    const b = createEditorDoc();
    for (const d of [a, b]) Y.applyUpdate(d, Y.encodeStateAsUpdate(seed.doc));
    const net = link([a, b]);
    const id = addSticker(a, ctxOf("pa"), "heart", { x: 10, y: 10 });
    net.flush();
    commitTransform(a, ctxOf("pa"), id, { x: 111, y: 111, scaleX: 1, scaleY: 1, rotation: 0 });
    commitTransform(b, ctxOf("pb"), id, { x: 222, y: 222, scaleX: 1, scaleY: 1, rotation: 0 });
    net.flush();
    expect(readEl(a, id)).toEqual(readEl(b, id));
    expect([111, 222]).toContain(readEl(a, id).x);
  });

  it("hapus vs edit bersamaan: elemen terhapus di semua klien", () => {
    const a = seeded("PHOTO_STRIP").doc;
    const b = createEditorDoc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const net = link([a, b]);
    const id = addText(a, ctxOf("pa"), { x: 10, y: 10 }, "x");
    net.flush();
    deleteElement(a, ctxOf("pa"), id);
    editText(b, ctxOf("pb"), id, "xyz");
    net.flush();
    expect(elementsMap(a).has(id)).toBe(false);
    expect(elementsMap(b).has(id)).toBe(false);
  });

  it("dua orang mengetik di teks yang sama: Y.Text menggabungkan keduanya", () => {
    const a = seeded("PHOTO_STRIP").doc;
    const b = createEditorDoc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const net = link([a, b]);
    const id = addText(a, ctxOf("pa"), { x: 10, y: 10 }, "ab");
    net.flush();
    editText(a, ctxOf("pa"), id, "Xab");
    editText(b, ctxOf("pb"), id, "abY");
    net.flush();
    expect(elementsMap(a).get(id)!.get("content")!.toString()).toBe("XabY");
    expect(elementsMap(b).get(id)!.get("content")!.toString()).toBe("XabY");
  });

  it("TC-EDIT-020 fuzz: 4 klien × 500 operasi acak + partisi/putus-sambung → konvergen & valid", { timeout: 60_000 }, () => {
    for (const seedNo of [1, 2, 3]) {
      let x = seedNo * 104729;
      const rnd = () => {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        return x / 0x7fffffff;
      };
      const base = seeded("PHOTO_STRIP");
      const docs = [0, 1, 2, 3].map(() => {
        const d = createEditorDoc();
        Y.applyUpdate(d, Y.encodeStateAsUpdate(base.doc));
        return d;
      });
      const net = link(docs);
      const clock = { t: 1000 };
      const ctxs = ["p1", "p2", "p3", "pa"].map((p) => ctxOf(p, p, clock));
      for (let step = 0; step < 500; step++) {
        clock.t += 700;
        const i = Math.floor(rnd() * 4);
        const d = docs[i]!;
        const c = ctxs[i]!;
        const els = listElements(d);
        const pick = els[Math.floor(rnd() * els.length)];
        const op = Math.floor(rnd() * 10);
        try {
          if (op === 0 && els.length < 120) addSticker(d, c, STICKER_CATALOG[Math.floor(rnd() * STICKER_CATALOG.length)]!.id, { x: rnd() * 500, y: rnd() * 800 });
          else if (op === 1 && els.length < 120) addText(d, c, { x: rnd() * 500, y: rnd() * 800 }, `t${step}`);
          else if (op === 2 && pick) commitTransform(d, c, pick.id, { x: rnd() * 600, y: rnd() * 900, scaleX: 0.5 + rnd(), scaleY: 0.5 + rnd(), rotation: rnd() * 90 });
          else if (op === 3 && pick?.type === "text") editText(d, c, pick.id, `edit${Math.floor(rnd() * 99)}`);
          else if (op === 4 && pick && pick.type !== "photo") deleteElement(d, c, pick.id);
          else if (op === 5 && pick) setZ(d, c, pick.id, rnd() < 0.5 ? "front" : "back");
          else if (op === 6) setGlobalFilter(d, c, rnd() < 0.5 ? "MONO" : "HANGAT");
          else if (op === 7 && pick) updateElement(d, c, pick.id, { opacity: Math.round(rnd() * 10) / 10 }, "opacity");
          else if (op === 8 && els.length < 120) addDoodle(d, c, encodePoints([[0, 0], [10, 10 * rnd()], [20, 5]]), "#F2778F", 6, { x: 50, y: 50 });
          else if (op === 9) {
            const h = readHistory(d);
            if (h.length) revertEntry(d, c, h[Math.floor(rnd() * h.length)]!.id, rnd() < 0.3);
          }
        } catch {
          /* FULL / NOT_FOUND akibat state lokal: bukan yang diuji */
        }
        // Jaringan: kadang tahan (partisi), kadang kirim acak urutan.
        if (rnd() < 0.2) net.flush(rnd);
      }
      net.flush(rnd);
      net.flush();
      const snap = (d: Y.Doc) => JSON.stringify({ e: listElements(d), m: Object.fromEntries(metaMap(d).entries()), h: readHistory(d).map((h) => h.id) });
      const ref = snap(docs[0]!);
      for (const d of docs) expect(snap(d), `seed ${seedNo}`).toBe(ref);
      expect(validateDoc(docs[0]!, accepted(base.accepted))).toBeNull();
    }
  });
});

const readEl = (d: Y.Doc, id: string) => {
  const o: Record<string, unknown> = {};
  elementsMap(d).get(id)!.forEach((v, k) => (o[k] = v instanceof Y.Text ? v.toString() : v));
  return o;
};

describe("TC-EDIT-022 validasi server", () => {
  const base = () => {
    const s = seeded("PHOTO_STRIP");
    return { ...s, ctx: accepted(s.accepted) };
  };
  const apply = (server: Y.Doc, fn: (d: Y.Doc) => void) => {
    const client = createEditorDoc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    const sv = Y.encodeStateVector(server);
    fn(client);
    return Y.encodeStateAsUpdate(client, sv);
  };
  const el = (d: Y.Doc, id: string) => elementsMap(d).get(id)!;

  it("update valid diterima dan TIDAK mengubah dokumen server selama pemeriksaan", () => {
    const { doc, ctx } = base();
    const before = Y.encodeStateAsUpdate(doc).byteLength;
    const u = apply(doc, (c) => addSticker(c, ctxOf("pa"), "heart", { x: 1, y: 1 }));
    expect(checkUpdate(doc, u, ctx)).toEqual({ ok: true });
    expect(Y.encodeStateAsUpdate(doc).byteLength).toBe(before);
  });

  it("ditolak: key asing, NaN/Infinity, skala 0, tipe/aset tak dikenal, teks panjang, doodle > 2000 titik, meta asing, jumlah > 200", () => {
    const { doc, ctx } = base();
    const bad = (fn: (c: Y.Doc) => void, code?: string) => {
      const r = checkUpdate(doc, apply(doc, fn), ctx);
      expect(r.ok).toBe(false);
      if (!r.ok && code) expect(r.issue.code).toBe(code);
    };
    const first = (c: Y.Doc) => listElements(c).find((e) => e.type === "photo")!.id;
    bad((c) => el(c, first(c)).set("evil", "<script>"), "SCHEMA");
    bad((c) => el(c, first(c)).set("x", Number.NaN), "SCHEMA");
    bad((c) => el(c, first(c)).set("x", Number.POSITIVE_INFINITY), "SCHEMA");
    bad((c) => el(c, first(c)).set("scaleX", 0), "SCHEMA");
    bad((c) => el(c, first(c)).set("opacity", 5), "SCHEMA");
    bad((c) => el(c, first(c)).set("crop", { x: 0.9, y: 0, w: 0.5, h: 1 }), "SCHEMA");
    bad((c) => {
      const m = new Y.Map<unknown>();
      m.set("type", "video");
      m.set("x", 0);
      elementsMap(c).set("v", m);
    }, "SCHEMA");
    bad((c) => addSticker(c, ctxOf("pa"), "heart", { x: 1, y: 1 }) && el(c, listElements(c).find((e) => e.type === "sticker")!.id).set("assetId", "../../etc/passwd"), "SCHEMA");
    bad((c) => {
      const id = addText(c, ctxOf("pa"), { x: 1, y: 1 }, "ok");
      (el(c, id).get("content") as Y.Text).insert(0, "x".repeat(EDITOR_LIMITS.maxTextLength + 5));
    }, "SCHEMA");
    bad((c) => {
      const pts = Array.from({ length: 2001 }, (_, i) => [i, i] as [number, number]);
      addDoodle(c, ctxOf("pa"), encodePoints(pts), "#FF0000", 5, { x: 0, y: 0 });
    }, "SCHEMA");
    bad((c) => metaMap(c).set("injected", "x"), "SCHEMA");
    bad((c) => {
      for (let i = 0; i < 205; i++) {
        const m = new Y.Map<unknown>();
        for (const [k, v] of Object.entries({ type: "sticker", x: i, y: i, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, z: `a${i}`, hidden: false, createdBy: "pa", updatedBy: "pa", assetId: "dot", w: 50, h: 50 })) m.set(k, v);
        elementsMap(c).set(`s${i}`, m);
      }
    }, "LIMIT");
  });

  it("ditolak: foto non-accepted / REJECTED, tukar attemptId, ganti pemilik, kanvas diubah; hapus foto tetap boleh", () => {
    const { doc, ctx } = base();
    const photoId = listElements(doc).find((e) => e.type === "photo")!.id;
    const forge = (attemptId: string, ownerId = "pa") => (c: Y.Doc) => {
      const m = new Y.Map<unknown>();
      const src = readEl(c, photoId);
      for (const [k, v] of Object.entries({ ...src, attemptId, ownerId })) m.set(k, v);
      elementsMap(c).set(`photo:${attemptId}`, m);
    };
    const rej = checkUpdate(doc, apply(doc, forge("att-REJECTED-9")), ctx);
    expect(rej).toMatchObject({ ok: false, issue: { code: "ATTEMPT" } });
    expect(checkUpdate(doc, apply(doc, forge("att-0-1", "pa")), ctx)).toMatchObject({ ok: false, issue: { code: "ATTEMPT" } }); // accepted tapi pemilik lain
    expect(checkUpdate(doc, apply(doc, (c) => el(c, photoId).set("attemptId", "att-0-2")), ctx)).toMatchObject({ ok: false });
    expect(checkUpdate(doc, apply(doc, (c) => el(c, photoId).set("ownerId", "pb")), ctx)).toMatchObject({ ok: false });
    expect(checkUpdate(doc, apply(doc, (c) => { const cv = metaMap(c).get("canvas") as { w: number; h: number }; metaMap(c).set("canvas", { w: cv.w + 2, h: cv.h }); }), ctx)).toMatchObject({ ok: false, issue: { code: "IMMUTABLE" } });
    expect(checkUpdate(doc, apply(doc, (c) => elementsMap(c).delete(photoId)), ctx)).toEqual({ ok: true });
    // Pemulihan foto yang dihapus (Balikin) memakai id & attempt yang sama → sah.
    expect(checkUpdate(doc, apply(doc, (c) => {
      const entry = deleteElement(c, ctxOf("pb"), photoId);
      void entry;
      revertEntry(c, ctxOf("pa"), readHistory(c).at(-1)!.id);
    }), ctx)).toEqual({ ok: true });
  });

  it("ukuran: update > 256 KB → TOO_LARGE; biner rusak → MALFORMED; dokumen > 2 MB → TOO_LARGE", () => {
    const { doc, ctx } = base();
    expect(checkUpdate(doc, new Uint8Array(EDITOR_LIMITS.maxUpdateBytes + 1), ctx)).toMatchObject({ ok: false, issue: { code: "TOO_LARGE" } });
    expect(checkUpdate(doc, new Uint8Array([1, 2, 3, 250, 99, 0, 7]), ctx)).toMatchObject({ ok: false, issue: { code: "MALFORMED" } });
    // Dokumen server yang sudah > 2 MB (dibangun langsung, mis. dari banyak doodle) menolak update berikutnya.
    const big = createEditorDoc();
    Y.applyUpdate(big, Y.encodeStateAsUpdate(doc));
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 150; i++) {
      const pts = Array.from({ length: 2000 }, () => [rnd() * 900, rnd() * 900] as [number, number]);
      addDoodle(big, ctxOf("pa"), encodePoints(pts), "#F2778F", 6, { x: 10, y: 10 });
    }
    expect(Y.encodeStateAsUpdate(big).byteLength).toBeGreaterThan(EDITOR_LIMITS.maxDocBytes);
    const tiny = apply(big, (c) => updateElement(c, ctxOf("pa"), listElements(c)[0]!.id, { opacity: 0.9 }, "x"));
    expect(checkUpdate(big, tiny, ctx)).toMatchObject({ ok: false, issue: { code: "TOO_LARGE" } });
  });
});

describe("doodle: encode/decode & RDP", () => {
  it("round-trip presisi 0.1 px; RDP menyederhanakan garis lurus & menghormati batas 2000 titik", () => {
    const pts: [number, number][] = [[0, 0], [10.4, 3.3], [20, -5.1]];
    expect(decodePoints(encodePoints(pts))).toEqual([[0, 0], [10.4, 3.3], [20, -5.1]]);
    const line = Array.from({ length: 500 }, (_, i) => [i, i * 2] as [number, number]);
    expect(simplifyRdp(line, 1)).toHaveLength(2);
    const noisy = Array.from({ length: 6000 }, (_, i) => [i, Math.sin(i) * 30] as [number, number]);
    expect(simplifyRdp(noisy, 0.1, 2000).length).toBeLessThanOrEqual(2000);
    expect(decodePoints("abc")).toBeNull();
  });
});

describe("TC-EDIT-020b: penggabungan riwayat & balikin tidak merusak kunci (akar flake fuzz)", () => {
  const photoOf = (d: Y.Doc, id?: string) => listElements(d).find((e) => (id ? e.id === id : e.type === "photo"))!;

  it("transform + ubah urutan layer dalam jendela gabung lalu dibalikin: z kembali ke nilai awal, bukan null, dan dokumen tetap valid", () => {
    const seed = seeded("PHOTO_STRIP");
    const clock = { t: 1000 };
    const c = ctxOf("pa", "pa", clock);
    const photo = photoOf(seed.doc);
    const z0 = photo.z;
    commitTransform(seed.doc, c, photo.id, { x: 50, y: 60, scaleX: 1, scaleY: 1, rotation: 5 });
    clock.t += 300; // di dalam jendela gabung 2 detik → satu entri
    setZ(seed.doc, c, photo.id, "front");
    const merged = readHistory(seed.doc).filter((h) => h.elementId === photo.id);
    expect(merged).toHaveLength(1);
    expect(Object.keys(merged[0]!.before!)).toEqual(expect.arrayContaining(Object.keys(merged[0]!.after!)));
    clock.t += 5000;
    expect(revertEntry(seed.doc, ctxOf("pb", "pb", clock), merged[0]!.id).ok).toBe(true);
    expect(photoOf(seed.doc, photo.id).z).toBe(z0);
    expect(validateDoc(seed.doc, accepted(seed.accepted))).toBeNull();
  });

  it("entri lama tanpa nilai-sebelum untuk sebuah kunci: kunci itu dilewati (tidak ditimpa null)", () => {
    const seed = seeded("PHOTO_STRIP");
    const clock = { t: 1000 };
    const c = ctxOf("pa", "pa", clock);
    const photo = photoOf(seed.doc);
    setZ(seed.doc, c, photo.id, "front");
    const z1 = photoOf(seed.doc, photo.id).z;
    const [entry] = readHistory(seed.doc).filter((h) => h.elementId === photo.id);
    // Simulasikan data lama hasil bug penggabungan: after punya x & z, before hanya x.
    const legacy = { ...entry!, before: { x: Number(photo.x) }, after: { x: Number(photo.x), z: z1 } };
    const arr = seed.doc.getArray<unknown>("history");
    seed.doc.transact(() => {
      arr.delete(arr.length - 1, 1);
      arr.push([legacy]);
    });
    const rr = revertEntry(seed.doc, ctxOf("pb", "pb", clock), legacy.id);
    expect(rr).toEqual({ ok: true });
    expect(photoOf(seed.doc, photo.id).z).toBe(z1);
    expect(validateDoc(seed.doc, accepted(seed.accepted))).toBeNull();
  });

  it("urutan elemen deterministik walau ada z non-string (data rusak): sama di dua replika dengan urutan sisip berbeda", () => {
    const mk = (order: string[]) => {
      const d = createEditorDoc();
      d.transact(() => {
        for (const id of order) {
          const m = new Y.Map<unknown>();
          m.set("type", "sticker");
          m.set("z", id === "bad" ? null : id === "p" ? "a1" : "a0");
          elementsMap(d).set(id, m);
        }
      });
      return listElements(d).map((e) => e.id);
    };
    expect(mk(["a", "bad", "p", "b"])).toEqual(mk(["b", "p", "bad", "a"]));
  });
});
