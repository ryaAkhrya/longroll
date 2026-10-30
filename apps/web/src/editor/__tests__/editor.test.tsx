import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSticker, addText, createEditorDoc, createSeededDoc, elementsMap, fromBase64, initStudio, listElements, toBase64, validateDoc, commitTransform } from "@longroll/shared";
import type { AckPayload, ElementView, ParticipantView } from "@longroll/shared";
import { DEFAULT_CAMERA_PRESENTATION } from "@longroll/shared";
import { HistoryPanel, LayerPanel, PropsPanel } from "@/components/editor/EditorPanels";
import type { EditorController } from "../useEditor";
import type { RoomClient } from "@/room/client";
import { ConflictTracker } from "../conflict";
import { EditorSession } from "../provider";

// ---------------------------------------------------------------- ConflictTracker
describe("ConflictTracker (11 §5)", () => {
  it("remote menimpa properti yang sama dalam 10 detik → toast; properti lain / lewat 10 detik / diri sendiri → tidak", () => {
    const t = new ConflictTracker();
    t.noteLocal("e1", ["x", "y"], 1000);
    expect(t.onRemote([{ elementId: "e1", props: ["x"], deleted: false, by: "raka" }], 4000, "me")).toEqual([{ kind: "overwritten", elementId: "e1", by: "raka", props: ["x"] }]);
    expect(t.onRemote([{ elementId: "e1", props: ["color"], deleted: false, by: "raka" }], 9000, "me")).toEqual([]);
    const t2 = new ConflictTracker();
    t2.noteLocal("e1", ["x"], 1000);
    expect(t2.onRemote([{ elementId: "e1", props: ["x"], deleted: false, by: "raka" }], 12_000, "me")).toEqual([]); // jendela 10 s lewat
    expect(t2.onRemote([{ elementId: "e1", props: ["x"], deleted: false, by: "me" }], 2000, "me")).toEqual([]);
  });

  it("toast untuk elemen sama digabung maks. 1 per 3 detik; hapus remote atas elemen yang baru diedit → toast 'deleted'", () => {
    const t = new ConflictTracker();
    t.noteLocal("e1", ["x"], 1000);
    t.noteLocal("e2", ["content"], 1000);
    const c = (id: string, deleted = false) => [{ elementId: id, props: deleted ? [] : ["x"], deleted, by: "bimo" }];
    expect(t.onRemote(c("e1"), 1500, "me")).toHaveLength(1);
    expect(t.onRemote(c("e1"), 2500, "me")).toHaveLength(0);
    expect(t.onRemote(c("e1"), 4600, "me")).toHaveLength(1);
    expect(t.onRemote(c("e2", true), 2000, "me")).toEqual([{ kind: "deleted", elementId: "e2", by: "bimo", props: ["content"] }]);
  });
});

// ---------------------------------------------------------------- EditorSession (provider)
function fakeClient() {
  let connected = true;
  const signal = new Set<(t: string, p: unknown) => void>();
  const subs = new Set<() => void>();
  const server = createEditorDoc();
  const state = { sent: [] as { type: string; payload: Record<string, unknown> }[], volatile: [] as { type: string; payload: unknown }[], rejectNext: null as AckPayload | null };
  const client = {
    get connected() {
      return connected;
    },
    getSnapshot: () => ({ status: connected ? "open" : "reconnecting", me: "me" }),
    subscribe: (fn: () => void) => (subs.add(fn), () => subs.delete(fn)),
    onSignal: (fn: (t: string, p: unknown) => void) => (signal.add(fn), () => signal.delete(fn)),
    sendVolatile: (type: string, payload: unknown) => (state.volatile.push({ type, payload }), connected),
    sendIntent: vi.fn(async (type: string, payload: Record<string, unknown>): Promise<AckPayload> => {
      state.sent.push({ type, payload });
      if (state.rejectNext) {
        const r = state.rejectNext;
        state.rejectNext = null;
        return r;
      }
      if (type === "editor.sync") {
        const upd = Y.encodeStateAsUpdate(server, fromBase64(payload.stateVector as string));
        return { ok: true, data: { update: toBase64(upd), stateVector: toBase64(Y.encodeStateVector(server)), readOnly: false } };
      }
      if (type === "editor.update") Y.applyUpdate(server, fromBase64(payload.update as string), "remote");
      return { ok: true };
    }),
  };
  return {
    client: client as unknown as RoomClient,
    server,
    state,
    setConnected(v: boolean) {
      connected = v;
      for (const fn of subs) fn();
    },
    emit(type: string, payload: unknown) {
      for (const fn of signal) fn(type, payload);
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("EditorSession: sync Yjs ↔ room (11 §8)", () => {
  it("sinkron dua langkah saat tersambung; update lokal dikirim; update remote diterapkan; awareness volatile dibatasi ≤ 20 Hz", async () => {
    const f = fakeClient();
    const es = new EditorSession(f.client, "s1", { id: "me", name: "Nadia" });
    es.start();
    await flush();
    expect(f.state.sent[0]!.type).toBe("editor.sync");
    expect(es.status).toBe("ready");
    const id = addSticker(es.doc, es.ctx, "heart", { x: 1, y: 1 });
    await flush();
    expect(f.state.sent.filter((s) => s.type === "editor.update")).toHaveLength(1);
    expect(elementsMap(f.server).has(id)).toBe(true);
    // remote
    const other = createEditorDoc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(es.doc));
    const rid = addText(other, { participantId: "raka", name: "R", origin: {} }, { x: 5, y: 5 }, "halo");
    f.emit("editor.update", { sessionId: "s1", update: toBase64(Y.encodeStateAsUpdate(other, Y.encodeStateVector(es.doc))) });
    expect(elementsMap(es.doc).get(rid)!.get("content")!.toString()).toBe("halo");
    f.emit("editor.update", { sessionId: "lain", update: "AAAA" }); // sesi lain diabaikan
    // awareness: banyak panggilan → paling banyak ~20/detik
    vi.useFakeTimers();
    f.state.volatile.length = 0;
    for (let i = 0; i < 100; i++) {
      es.setAwareness({ cursor: { x: i, y: i } });
      vi.advanceTimersByTime(10);
    }
    expect(f.state.volatile.length).toBeLessThanOrEqual(22);
    expect(f.state.volatile.length).toBeGreaterThan(5);
    vi.useRealTimers();
    es.destroy();
  });

  it("offline: operasi lokal tetap jalan dan diantre; saat tersambung kembali dikirim dan digabung (tanpa kehilangan)", async () => {
    const f = fakeClient();
    const es = new EditorSession(f.client, "s1", { id: "me", name: "Nadia" });
    es.start();
    await flush();
    f.setConnected(false);
    expect(es.status).toBe("offline");
    const a = addSticker(es.doc, es.ctx, "star", { x: 1, y: 1 });
    const b = addSticker(es.doc, es.ctx, "dot", { x: 2, y: 2 });
    await flush();
    expect(f.state.sent.filter((s) => s.type === "editor.update")).toHaveLength(0); // tertahan
    // Sementara itu orang lain mengedit di server
    const other = createEditorDoc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(f.server));
    const rid = addText(other, { participantId: "raka", name: "R", origin: {} }, { x: 9, y: 9 }, "saat offline");
    Y.applyUpdate(f.server, Y.encodeStateAsUpdate(other));
    f.setConnected(true);
    await flush();
    await flush();
    for (const id of [a, b, rid]) {
      expect(elementsMap(es.doc).has(id)).toBe(true);
      expect(elementsMap(f.server).has(id)).toBe(true);
    }
    expect(es.status).toBe("ready");
    es.destroy();
  });

  it("update ditolak server → editor.reset membangun ulang dokumen dari state server yang sah; handler dipanggil", async () => {
    const f = fakeClient();
    const es = new EditorSession(f.client, "s1", { id: "me", name: "Nadia" });
    const onReset = vi.fn();
    es.setHandlers({ onReset });
    es.start();
    await flush();
    const id = addSticker(es.doc, es.ctx, "heart", { x: 1, y: 1 });
    await flush();
    f.state.rejectNext = { ok: false, error: "INVALID_PATCH", reason: "SCHEMA" };
    elementsMap(es.doc).get(id)!.set("x", Number.NaN);
    await flush();
    const before = es.doc;
    f.emit("editor.reset", { sessionId: "s1", update: toBase64(Y.encodeStateAsUpdate(f.server)) });
    expect(es.doc).not.toBe(before);
    expect(Number(elementsMap(es.doc).get(id)!.get("x"))).toBe(1);
    expect(onReset).toHaveBeenCalledOnce();
    es.destroy();
  });

  it("READ_ONLY dari server menghentikan pengiriman (status readonly)", async () => {
    const f = fakeClient();
    const es = new EditorSession(f.client, "s1", { id: "me", name: "Nadia" });
    es.start();
    await flush();
    f.state.rejectNext = { ok: false, error: "READ_ONLY" };
    addSticker(es.doc, es.ctx, "heart", { x: 1, y: 1 });
    await flush();
    expect(es.status).toBe("readonly");
    const n = f.state.sent.length;
    addSticker(es.doc, es.ctx, "star", { x: 1, y: 1 });
    await flush();
    expect(f.state.sent.length).toBe(n);
    es.destroy();
  });

  it("konflik: remote mengubah properti yang baru kamu atur → onConflict; StrictMode: start-destroy-start aman", async () => {
    const f = fakeClient();
    const es = new EditorSession(f.client, "s1", { id: "me", name: "Nadia" });
    const onConflict = vi.fn();
    es.setHandlers({ onConflict });
    es.start();
    es.destroy();
    es.start();
    await flush();
    const id = addSticker(es.doc, es.ctx, "heart", { x: 1, y: 1 });
    commitTransform(es.doc, es.ctx, id, { x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0 });
    await flush();
    const other = createEditorDoc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(es.doc));
    commitTransform(other, { participantId: "raka", name: "R", origin: { r: 1 } }, id, { x: 99, y: 99, scaleX: 1, scaleY: 1, rotation: 0 });
    f.emit("editor.update", { sessionId: "s1", update: toBase64(Y.encodeStateAsUpdate(other, Y.encodeStateVector(es.doc))) });
    expect(onConflict).toHaveBeenCalledOnce();
    expect(onConflict.mock.calls[0]![0][0]).toMatchObject({ kind: "overwritten", elementId: id, by: "raka" });
    es.destroy();
  });
});

// ---------------------------------------------------------------- panel Layer & Riwayat & Properti
const person = (id: string, name: string, color: ParticipantView["color"]): ParticipantView => ({
  participantId: id,
  displayName: name,
  color,
  joinedAtMs: 0,
  connection: "CONNECTED",
  disconnectedAtMs: null,
  camera: "live",
  ready: true,
  mirrored: false,
  cameraPresentation: DEFAULT_CAMERA_PRESENTATION,
});

function controller(elements: ElementView[], over: Partial<EditorController> = {}): EditorController {
  const noop = vi.fn();
  return {
    es: {} as never,
    status: "ready",
    readOnly: false,
    elements,
    meta: null,
    layoutJson: null,
    history: [],
    peers: [],
    canUndo: false,
    canRedo: false,
    full: false,
    undo: noop,
    redo: noop,
    center: () => ({ x: 0, y: 0 }),
    addSticker: vi.fn(() => null),
    addText: vi.fn(() => null),
    addDoodle: vi.fn(() => null),
    commit: vi.fn(),
    update: vi.fn(),
    editText: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(() => null),
    z: vi.fn(),
    setFrame: vi.fn(),
    setGlobalFilter: vi.fn(),
    setGlobalAdjust: vi.fn(),
    setPhotoAdjust: vi.fn(),
    revert: vi.fn(() => ({ ok: true as const })),
    nameOf: (id) => id,
    ...over,
  };
}

function seededElements() {
  const studio = initStudio("PHOTO_STRIP", ["P1", "P2"]);
  const accepted: [string, string][] = [];
  const shots = Array.from({ length: studio.layout.shotCount }, (_, s) => ({
    index: s,
    state: "DONE" as const,
    t0ServerMs: 1,
    armedBy: "a",
    armedAtMs: 0,
    countdownSec: 5,
    required: ["a", "b"],
    slotOf: { a: "P1" as const, b: "P2" as const },
    perParticipant: Object.fromEntries(["a", "b"].map((p) => [p, { status: "ACCEPTED" as const, attempts: [`x${s}${p}`], currentAttemptId: `x${s}${p}`, acceptedAttemptId: `x${s}${p}`, retakeT0ServerMs: null, statusAtMs: 0 }])),
    doneAtMs: 1,
    heldBy: null,
  }));
  accepted.push(...shots.flatMap((s) => ["a", "b"].map((p) => [`x${s.index}${p}`, p] as [string, string])));
  const doc = createSeededDoc({ studio, capture: { eligible: { a: "P1", b: "P2" }, shotCount: shots.length, shots, attempts: {}, bytesUsed: 0 }, names: { a: "A", b: "B" }, srcDims: () => ({ w: 1600, h: 1200 }) });
  expect(validateDoc(doc, { acceptedAttempts: new Map(accepted) })).toBeNull();
  return { doc, elements: listElements(doc) };
}

describe("Panel editor (aksesibilitas & kontrol)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("Layer: listbox keyboard — panah geser 4 px (Shift 20), [ ] urutan, Delete hapus, Enter pilih; hanya saat tidak read-only", async () => {
    const { elements } = seededElements();
    const el = elements.find((e) => e.type === "photo")!;
    const ed = controller(elements);
    const onSelect = vi.fn();
    render(<LayerPanel ed={ed} selection={[]} onSelect={onSelect} />);
    expect(screen.getByRole("listbox", { name: /Layer/ })).toBeInTheDocument();
    const row = document.querySelector(`[data-element='${el.id}']`) as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(ed.commit).toHaveBeenLastCalledWith(el.id, expect.objectContaining({ x: Number(el.x) + 4, y: Number(el.y) }));
    fireEvent.keyDown(row, { key: "ArrowDown", shiftKey: true });
    expect(ed.commit).toHaveBeenLastCalledWith(el.id, expect.objectContaining({ y: Number(el.y) + 20 }));
    fireEvent.keyDown(row, { key: "[" });
    expect(ed.z).toHaveBeenLastCalledWith(el.id, "down");
    fireEvent.keyDown(row, { key: "]" });
    expect(ed.z).toHaveBeenLastCalledWith(el.id, "up");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith([el.id]);
    fireEvent.keyDown(row, { key: "Delete" });
    expect(ed.remove).toHaveBeenCalledWith(el.id);
  });

  it("Layer read-only: tombol keyboard tidak mengubah apa pun", () => {
    const { elements } = seededElements();
    const ed = controller(elements, { readOnly: true });
    render(<LayerPanel ed={ed} selection={[]} onSelect={vi.fn()} />);
    const row = document.querySelector(`[data-element='${elements[0]!.id}']`) as HTMLElement;
    fireEvent.keyDown(row, { key: "ArrowRight" });
    fireEvent.keyDown(row, { key: "Delete" });
    expect(ed.commit).not.toHaveBeenCalled();
    expect(ed.remove).not.toHaveBeenCalled();
  });

  it("Riwayat: siapa pun bisa Balikin; entri sudah diubah lagi → meminta konfirmasi (CHANGED)", async () => {
    const entry = { id: "h1", at: Date.now(), by: "b", label: "nempel heart", elementId: "e", before: null, after: { x: 1 } };
    const revert = vi.fn().mockReturnValueOnce({ ok: false, reason: "CHANGED", changedBy: "c" }).mockReturnValue({ ok: true });
    const ed = controller([], { history: [entry], revert });
    const onConfirm = vi.fn();
    render(<HistoryPanel ed={ed} participants={[person("b", "Raka", "P2"), person("c", "Sasa", "P3")]} now={Date.now()} onConfirm={onConfirm} />);
    expect(screen.getByText("siapa aja bisa balikin")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Balikin: nempel heart" }));
    expect(onConfirm).toHaveBeenCalledWith(entry, "c");
    await userEvent.click(screen.getByRole("button", { name: "Balikin: nempel heart" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Properti foto: zoom mengubah crop dengan rasio tetap (tanpa distorsi); teks: isi diedit lewat textarea; foto sumber tak bisa diduplikasi di UI", async () => {
    const { elements } = seededElements();
    const photo = elements.find((e) => e.type === "photo")!;
    const ed = controller(elements);
    const ref = { current: null };
    const { rerender } = render(<PropsPanel ed={ed} el={photo} textRef={ref} />);
    expect(screen.queryByRole("button", { name: "Duplikat" })).toBeNull();
    const slider = screen.getByRole("slider", { name: "Zoom" });
    fireEvent.change(slider, { target: { value: "2" } });
    const call = (ed.update as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    const crop = (call[1] as { crop: { w: number; h: number } }).crop;
    const before = photo.crop as { w: number; h: number };
    expect(crop.w / crop.h).toBeCloseTo(before.w / before.h, 3);
    expect(crop.w).toBeCloseTo(before.w / 2, 3);
    const doc = createEditorDoc();
    const tid = addText(doc, { participantId: "a", name: "A", origin: {} }, { x: 1, y: 1 }, "halo");
    const text = listElements(doc).find((e) => e.id === tid)!;
    rerender(<PropsPanel ed={ed} el={text} textRef={ref} />);
    const area = screen.getByRole("textbox", { name: "Isi teks" });
    await userEvent.clear(area);
    await userEvent.type(area, "baru");
    fireEvent.blur(area);
    expect(ed.editText).toHaveBeenLastCalledWith(tid, "baru");
    expect(screen.getByRole("button", { name: "Duplikat" })).toBeInTheDocument();
  });
});
