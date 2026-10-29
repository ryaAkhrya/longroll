import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CAMERA_PRESENTATION } from "@longroll/shared";
import type { AckPayload, Attempt, CaptureState, ParticipantView, RoomView, SessionView, Shot, ShotParticipantState } from "@longroll/shared";
import { applyEvent } from "@/room/client";
import type { RoomClient } from "@/room/client";
import { CountdownOverlay } from "@/components/capture/CountdownOverlay";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import type { CaptureController } from "../useCapture";
import type { CapturedPhoto } from "../captureFrame";

vi.mock("../attemptUrls", () => ({ attemptUrl: vi.fn(async (_c: string, id: string) => `https://storage.test/${id}.jpg`), forgetAttempt: vi.fn() }));
const uploadToUrl = vi.fn();
vi.mock("@/room/api", async () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  }
  return { ApiError, uploadToUrl: (...a: unknown[]) => uploadToUrl(...a), REALTIME_URL: "http://rt.test", api: {} };
});
// Impor setelah mock agar uploadAttempt memakai versi tiruan.
const { uploadAttempt } = await import("../upload");
const { ApiError } = (await import("@/room/api")) as unknown as { ApiError: new (status: number, code: string) => Error };

const ps = (status: ShotParticipantState["status"], over: Partial<ShotParticipantState> = {}): ShotParticipantState => ({
  status,
  attempts: [],
  currentAttemptId: null,
  acceptedAttemptId: null,
  retakeT0ServerMs: null,
  statusAtMs: 0,
  ...over,
});
const attempt = (id: string, owner: string, no: number, status: Attempt["status"], withParts = true): Attempt => ({
  attemptId: id,
  shotIndex: 0,
  ownerId: owner,
  ownerNameAtCapture: owner,
  ownerColor: "P1",
  attemptNo: no,
  kind: "shot",
  status,
  createdAtMs: 0,
  capturedAtServerMs: 0,
  late: false,
  mirrored: false,
  preview: withParts ? { bytes: 1, width: 320, height: 240, sha256: "a".repeat(64) } : null,
  full: withParts ? { bytes: 1, width: 1280, height: 960, sha256: "b".repeat(64) } : null,
  purged: false,
});
const person = (id: string, name: string, color: ParticipantView["color"], over: Partial<ParticipantView> = {}): ParticipantView => ({
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
  ...over,
});

const noAck = async (): Promise<AckPayload> => ({ ok: true });
function controller(over: Partial<CaptureController> = {}): CaptureController {
  return {
    shot: null,
    mine: null,
    doneCount: 0,
    shotCount: 4,
    required: [],
    saving: null,
    needsMakeup: false,
    confirmNotReady: null,
    dismissConfirm: () => undefined,
    canArm: true,
    doneBanner: null,
    waiting: false,
    setWaiting: () => undefined,
    arm: noAck,
    hold: noAck,
    accept: vi.fn(noAck),
    retake: vi.fn(noAck),
    reopen: vi.fn(noAck),
    skip: vi.fn(noAck),
    nudge: vi.fn(noAck),
    setCountdown: noAck,
    ...over,
  };
}

describe("applyEvent: capture.state", () => {
  const session = { sessionId: "s1", capture: null } as unknown as SessionView;
  const room = { participants: [], activeSession: session, customFrames: [], lastSeq: 1, roomVersion: 1 } as unknown as RoomView;
  const cap: CaptureState = { eligible: {}, shotCount: 2, shots: [], attempts: {}, bytesUsed: 0 };
  it("mengganti capture sesi aktif; sesi lain diabaikan", () => {
    expect(applyEvent(room, { type: "capture.state", seq: 2, payload: { sessionId: "s1", capture: cap } }).activeSession!.capture).toBe(cap);
    expect(applyEvent(room, { type: "capture.state", seq: 2, payload: { sessionId: "lain", capture: cap } }).activeSession!.capture).toBeNull();
  });
});

describe("CountdownOverlay (SCR-13)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());
  const shot = (t0: number): Shot => ({ index: 1, state: "COUNTDOWN", t0ServerMs: t0, armedBy: "a", armedAtMs: 0, countdownSec: 5, required: ["a"], slotOf: {}, perParticipant: {}, doneAtMs: null, heldBy: null });

  it("angka dari t0ServerMs + offset jam; caption dimulai sama; aria-live hanya 3 detik terakhir; Tunggu! memanggil hold", async () => {
    vi.setSystemTime(10_000);
    const hold = vi.fn();
    // Jam klien 2 s di belakang server (offset +2000): t0 server = 17_000 → sisa 5 s dari sudut pandang klien.
    render(<CountdownOverlay shot={shot(17_000)} initiatorName="Raka" shotCount={4} clockOffsetMs={2000} onHold={hold} />);
    expect(screen.getByTestId("countdown")).toHaveAttribute("data-count", "5");
    expect(screen.getByText("Dimulai sama Raka · shot 2 dari 4")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(""); // > 3: tidak diumumkan
    await vi.advanceTimersByTimeAsync(2100);
    expect(screen.getByTestId("countdown")).toHaveAttribute("data-count", "3");
    expect(screen.getByRole("status")).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "Tunggu!" }));
    expect(hold).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByTestId("capture-saving")).toHaveTextContent("Nyimpen foto…");
  });
});

describe("ReviewScreen (SCR-14/15): tanpa auto-accept", () => {
  const me = person("a", "Nadia", "P1");
  const bimo = person("b", "Bimo", "P2");
  const raka = person("c", "Raka", "P3");
  const mk = (statusA: ShotParticipantState["status"], extra: Partial<Record<string, ShotParticipantState>> = {}) => {
    const attempts = { a1: attempt("a1", "a", 1, "READY"), c1: attempt("c1", "c", 1, "REJECTED"), c2: attempt("c2", "c", 2, "UPLOADING", false) };
    const shot: Shot = {
      index: 1,
      state: "REVIEW",
      t0ServerMs: 1,
      armedBy: "a",
      armedAtMs: 0,
      countdownSec: 5,
      required: ["a", "b", "c"],
      slotOf: { a: "P1", b: "P2", c: "P3" },
      perParticipant: {
        a: ps(statusA, { attempts: ["a1"], currentAttemptId: "a1", acceptedAttemptId: statusA === "ACCEPTED" ? "a1" : null }),
        b: ps("ACCEPTED", { attempts: ["b1"], currentAttemptId: "b1", acceptedAttemptId: "b1" }),
        c: ps("RETAKE_COUNTDOWN", { attempts: ["c1"], retakeT0ServerMs: Date.now() + 3000 }),
        ...extra,
      },
      doneAtMs: null,
      heldBy: null,
    };
    const capture: CaptureState = { eligible: { a: "P1", b: "P2", c: "P3" }, shotCount: 4, shots: [shot], attempts: { ...attempts, b1: attempt("b1", "b", 1, "READY") }, bytesUsed: 0 };
    return { shot, capture };
  };
  const view = (cap: CaptureController, shot: Shot, capture: CaptureState) =>
    render(<ReviewScreen cap={cap} code="ROOM27" capture={capture} shot={shot} participants={[me, bimo, raka]} meId="a" clockOffsetMs={0} />);

  it("DECIDING: Pakai ini hanya menerima lewat klik; tidak ada timer/ring/teks otomatis; peserta lain melihat retake Raka", async () => {
    const { shot, capture } = mk("DECIDING");
    const cap = controller({ shot, mine: shot.perParticipant.a!, required: [me, bimo, raka] });
    const { container } = view(cap, shot, capture);
    expect(screen.getByRole("heading", { name: /Pakai ini atau ulang\?/ })).toBeInTheDocument();
    expect(screen.getByText("Gak ada batas waktu. Temen-temen lihat kalau kamu ngulang.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/otomatis|auto|diem|detik lagi|progress/i);
    expect(container.querySelector('[role="progressbar"], progress')).toBeNull();
    expect(cap.accept).not.toHaveBeenCalled(); // tidak ada penerimaan tanpa aksi
    // kartu Raka: thumbnail ditolak + live + countdown retake + chip percobaan
    const card = screen.getByTestId("other-P3");
    expect(within(card).getByText(/Take 1 · diulang/)).toBeInTheDocument();
    expect(within(card).getByText("LIVE")).toBeInTheDocument();
    expect(within(card).getByText(/Ngulang · percobaan 2/)).toBeInTheDocument();
    expect(within(screen.getByTestId("other-P2")).getByText("Udah pakai")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pakai ini" }));
    expect(cap.accept).toHaveBeenCalledWith("a1");
    await userEvent.click(screen.getByRole("button", { name: "Ulang" }));
    expect(cap.retake).toHaveBeenCalledWith("a1");
  });

  it("tombol nonaktif bila attempt belum READY (full menyusul); setelah accept: SCR-15 Nunggu + Ganti pilihanku + Colek", async () => {
    const pending = mk("DECIDING");
    pending.capture.attempts.a1 = attempt("a1", "a", 1, "UPLOADING", false);
    pending.capture.attempts.a1!.preview = { bytes: 1, width: 320, height: 240, sha256: "a".repeat(64) };
    const c1 = controller({ shot: pending.shot, mine: pending.shot.perParticipant.a!, required: [me, bimo, raka] });
    const first = view(c1, pending.shot, pending.capture);
    expect(screen.getByRole("button", { name: "Pakai ini" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ulang" })).toBeDisabled();
    first.unmount();

    const { shot, capture } = mk("ACCEPTED");
    const cap = controller({ shot, mine: shot.perParticipant.a!, required: [me, bimo, raka] });
    view(cap, shot, capture);
    expect(screen.getByTestId("review-title")).toHaveTextContent("Kamu udah oke. Nunggu Raka…");
    await userEvent.click(screen.getByRole("button", { name: "Ganti pilihanku" }));
    expect(cap.reopen).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Colek Raka" }));
    expect(cap.nudge).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("button", { name: "Colek Bimo" })).toBeNull(); // sudah memutuskan
  });

  it("peserta terputus ≥ 15 detik: Lanjut tanpa {nama}; sebelumnya tidak ada", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    const { shot, capture } = mk("DECIDING", { c: ps("MISSING") });
    const cap = (r: ParticipantView) => controller({ shot, mine: shot.perParticipant.a!, required: [me, bimo, r] });
    const early = { ...raka, connection: "RECONNECTING" as const, disconnectedAtMs: 95_000 };
    const late = { ...raka, connection: "RECONNECTING" as const, disconnectedAtMs: 80_000 };
    const first = render(<ReviewScreen cap={cap(early)} code="ROOM27" capture={capture} shot={shot} participants={[me, bimo, early]} meId="a" clockOffsetMs={0} />);
    expect(screen.queryByRole("button", { name: /Lanjut tanpa/ })).toBeNull();
    first.unmount();
    const c2 = cap(late);
    render(<ReviewScreen cap={c2} code="ROOM27" capture={capture} shot={shot} participants={[me, bimo, late]} meId="a" clockOffsetMs={0} />);
    await userEvent.click(screen.getByRole("button", { name: "Lanjut tanpa Raka" }));
    expect(c2.skip).toHaveBeenCalledWith("c");
    vi.restoreAllMocks();
  });

  it("MISSING / FAILED: 'Ambil fotomu' / 'Coba lagi' memicu retake tanpa attemptId (bukan penerimaan)", async () => {
    const { shot, capture } = mk("MISSING");
    const cap = controller({ shot, mine: shot.perParticipant.a!, needsMakeup: true, required: [me, bimo, raka] });
    view(cap, shot, capture);
    await userEvent.click(screen.getByRole("button", { name: "Ambil fotomu" }));
    expect(cap.retake).toHaveBeenCalledWith();
    expect(cap.accept).not.toHaveBeenCalled();
  });
});

describe("uploadAttempt (09 §7.2, §11)", () => {
  const blob = (n: number) => ({ blob: new Blob([new Uint8Array(n)]), width: 10, height: 10, sha256: "c".repeat(64) });
  const photo = (): CapturedPhoto => ({ full: blob(100), preview: blob(10), capturedAtServerMs: 5, recompress: vi.fn(async () => blob(50)) });
  const prepared = { attemptId: "att-1", uploadUrls: { preview: { url: "u-p", headers: {} }, full: { url: "u-f", headers: {} } }, maxBytes: { preview: 1, full: 1 }, expiresInSec: 600 };
  const fakeClient = (script: (type: string, payload: unknown) => AckPayload) => ({ sendIntent: vi.fn(async (t: string, p: unknown) => script(t, p)) }) as unknown as RoomClient & { sendIntent: ReturnType<typeof vi.fn> };
  const sleep = async () => undefined;
  beforeEach(() => uploadToUrl.mockReset());

  it("preview dulu lalu full; attempt.uploaded memuat bytes/dimensi/sha256 klaim", async () => {
    uploadToUrl.mockResolvedValue(undefined);
    const client = fakeClient((t) => (t === "attempt.prepare" ? { ok: true, data: prepared } : { ok: true }));
    const out = await uploadAttempt({ client, sessionId: "s", shotIndex: 0, kind: "shot", photo: photo(), sleep });
    expect(out).toEqual({ ok: true, attemptId: "att-1" });
    expect(uploadToUrl.mock.calls.map((c) => c[0])).toEqual(["u-p", "u-f"]);
    const uploaded = client.sendIntent.mock.calls.filter((c) => c[0] === "attempt.uploaded").map((c) => c[1] as { part: string; bytes: number; sha256: string });
    expect(uploaded.map((u) => u.part)).toEqual(["preview", "full"]);
    expect(uploaded[1]).toMatchObject({ bytes: 100, sha256: "c".repeat(64) });
  });

  it("gagal 3× (+1 percobaan awal) → FAILED tanpa hang; berhasil di percobaan ke-3 → lanjut", async () => {
    const client = fakeClient((t) => (t === "attempt.prepare" ? { ok: true, data: prepared } : { ok: true }));
    uploadToUrl.mockRejectedValue(new ApiError(0, "NETWORK"));
    expect(await uploadAttempt({ client, sessionId: "s", shotIndex: 0, kind: "shot", photo: photo(), sleep })).toMatchObject({ ok: false, reason: "FAILED", attemptId: "att-1" });
    expect(uploadToUrl).toHaveBeenCalledTimes(4);
    uploadToUrl.mockReset();
    uploadToUrl.mockRejectedValueOnce(new ApiError(0, "NETWORK")).mockRejectedValueOnce(new ApiError(0, "NETWORK")).mockResolvedValue(undefined);
    expect(await uploadAttempt({ client, sessionId: "s", shotIndex: 0, kind: "shot", photo: photo(), sleep })).toMatchObject({ ok: true });
  });

  it("storage menolak ukuran (413) → kompres ulang 0.85 sekali lalu coba lagi", async () => {
    const p = photo();
    const client = fakeClient((t) => (t === "attempt.prepare" ? { ok: true, data: prepared } : { ok: true }));
    uploadToUrl.mockImplementation(async (url: string, _h: unknown, b: Blob) => {
      if (url === "u-f" && b.size === 100) throw new ApiError(413, "FRAME_TOO_LARGE");
    });
    expect(await uploadAttempt({ client, sessionId: "s", shotIndex: 0, kind: "shot", photo: p, sleep })).toMatchObject({ ok: true });
    expect(p.recompress).toHaveBeenCalledOnce();
  });

  it("respons basi (ATTEMPT_REJECTED / SHOT_DONE) menghentikan upload; prepare TOO_LATE dicoba ulang sebentar; jam maju di server", async () => {
    uploadToUrl.mockResolvedValue(undefined);
    const stale = fakeClient((t) => (t === "attempt.prepare" ? { ok: true, data: prepared } : { ok: false, error: "ATTEMPT_REJECTED" }));
    expect(await uploadAttempt({ client: stale, sessionId: "s", shotIndex: 0, kind: "retake", photo: photo(), sleep })).toMatchObject({ ok: false, reason: "STALE" });
    let n = 0;
    const early = fakeClient((t) => (t === "attempt.prepare" ? (n++ < 2 ? { ok: false, error: "TOO_LATE" } : { ok: true, data: prepared }) : { ok: true }));
    expect(await uploadAttempt({ client: early, sessionId: "s", shotIndex: 0, kind: "shot", photo: photo(), sleep })).toMatchObject({ ok: true });
    const notRequired = fakeClient(() => ({ ok: false, error: "NOT_REQUIRED" }));
    expect(await uploadAttempt({ client: notRequired, sessionId: "s", shotIndex: 0, kind: "shot", photo: photo(), sleep })).toMatchObject({ ok: false, reason: "STALE" });
  });
});
