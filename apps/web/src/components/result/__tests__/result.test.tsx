import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GalleryView, RoomView } from "@longroll/shared";
import type { RoomClient } from "@/room/client";
import { LeaveDialog } from "@/components/room/LeaveDialog";
import { ToastProvider } from "@/components/ui/Toast";
import { ExportPanel } from "../ExportPanel";
import { GALLERY_RETENTION_COPY, GalleryScreen } from "../GalleryScreen";
import { InviteDialog } from "../InviteDialog";

type Controller = Parameters<typeof ExportPanel>[0]["exp"];

function controller(over: Partial<Controller> = {}): Controller {
  return {
    phase: "idle",
    progress: 0,
    message: null,
    driveError: null,
    driveFile: null,
    doc: "ready",
    prepared: null,
    reload: vi.fn(),
    format: "png",
    setFormat: vi.fn(),
    preset: "ASLI",
    setPreset: vi.fn(),
    size: { width: 600, height: 1800, scale: 1, offsetX: 0, offsetY: 0, reduced: false, dpi: null },
    tiled: false,
    effectiveFormat: "png",
    warnings: [],
    elementCount: 4,
    fileName: "LONGROLL_BOBA27_sesi1_2026-10-29.png",
    driveConfigured: true,
    driveConnected: false,
    download: vi.fn(),
    saveToDrive: vi.fn(),
    continueDrive: vi.fn(),
    disconnectDrive: vi.fn(),
    cancel: vi.fn(),
    busy: false,
    ...over,
  } as Controller;
}

beforeEach(() => {
  // jsdom tidak punya matchMedia; layar desktop (Modal) dipakai untuk dialog.
  window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

describe("ExportPanel (SCR-17)", () => {
  it("Unduh = aksi utama, Simpan ke Google Drive = sekunder; ukuran & nama file tampil; preset Asli / Cetak 300 dpi / Story", async () => {
    const exp = controller();
    render(<ExportPanel exp={exp} />);
    expect(screen.getByTestId("export-download")).toBeEnabled();
    expect(screen.getByTestId("export-drive")).toBeEnabled();
    expect(screen.getByTestId("export-size")).toHaveTextContent("600 × 1800 px");
    expect(screen.getByText("LONGROLL_BOBA27_sesi1_2026-10-29.png")).toBeInTheDocument();
    for (const name of ["Asli", "Cetak 300 dpi", "Story"]) expect(screen.getByRole("radio", { name: new RegExp(name) })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Story/ }));
    expect(exp.setPreset).toHaveBeenCalledWith("STORY");
    await userEvent.click(screen.getByTestId("export-download"));
    expect(exp.download).toHaveBeenCalledOnce();
  });

  it("OAuth belum dikonfigurasi → tombol Drive nonaktif dengan alasan jelas (tidak memalsukan fitur)", () => {
    render(<ExportPanel exp={controller({ driveConfigured: false })} />);
    expect(screen.getByTestId("export-drive")).toBeDisabled();
    expect(screen.getByText(/belum aktif di versi ini/)).toBeInTheDocument();
    expect(screen.getByTestId("export-download")).toBeEnabled();
  });

  it("tiling → JPG nonaktif + penjelasan; peringatan kualitas tampil sebagai banner (bukan penolakan)", () => {
    render(<ExportPanel exp={controller({ tiled: true, warnings: [{ code: "SMALL_CELL", elementId: "a", message: "Foto Nadia cuma 100 px di ukuran ini. Coba ukuran lebih besar." }, { code: "UPSCALE", elementId: "b", message: "x" }] })} />);
    expect(screen.getByRole("button", { name: "JPG" })).toBeDisabled();
    expect(screen.getByText("Ukuran sebesar ini cuma bisa PNG.")).toBeInTheDocument();
    expect(screen.getByText(/Foto Nadia cuma 100 px/)).toBeInTheDocument();
    expect(screen.getByText(/\+1 foto lain/)).toBeInTheDocument();
    expect(screen.getByTestId("export-download")).toBeEnabled();
  });

  it("rendering → progres 'Nyetak versi … 58%' (role=progressbar) dan semua tombol terkunci", () => {
    render(<ExportPanel exp={controller({ phase: "rendering", progress: 0.58, busy: true, preset: "CETAK_300" })} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "58");
    expect(screen.getByText(/Nyetak versi Cetak 300 dpi… 58%/)).toBeInTheDocument();
    expect(screen.getByTestId("export-download")).toBeDisabled();
    expect(screen.getByTestId("export-drive")).toBeDisabled();
  });

  it("drive_done → 'Tersimpan di Drive: nama' + tautan Buka (noopener); drive terhubung → 'Putuskan Google Drive'", async () => {
    const exp = controller({ phase: "drive_done", driveFile: { id: "1", name: "LONGROLL_X.png", webViewLink: "https://drive.google.com/file/d/1/view" }, driveConnected: true });
    render(<ExportPanel exp={exp} />);
    expect(screen.getByText(/Tersimpan di Drive:/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Buka/ });
    expect(link).toHaveAttribute("href", "https://drive.google.com/file/d/1/view");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    await userEvent.click(screen.getByRole("button", { name: "Putuskan Google Drive" }));
    expect(exp.disconnectDrive).toHaveBeenCalledOnce();
  });

  it("galat Drive: token kedaluwarsa → tombol Lanjut; kuota penuh → tombol Unduh; popup diblokir → Coba lagi", async () => {
    const expired = controller({ phase: "drive_error", driveError: "TOKEN_EXPIRED", message: "Akses Drive habis. Lanjut buat izinkan lagi." });
    const { unmount } = render(<ExportPanel exp={expired} />);
    await userEvent.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(expired.continueDrive).toHaveBeenCalledOnce();
    unmount();

    const quota = controller({ phase: "drive_error", driveError: "QUOTA", message: "Drive penuh. Kosongin sedikit atau unduh ke perangkat aja." });
    const r2 = render(<ExportPanel exp={quota} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Drive penuh. Kosongin sedikit atau unduh ke perangkat aja.");
    await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Unduh" }));
    expect(quota.download).toHaveBeenCalledOnce();
    r2.unmount();

    const popup = controller({ phase: "drive_error", driveError: "POPUP_BLOCKED", message: "Izinkan popup buat longroll.app lalu coba lagi." });
    render(<ExportPanel exp={popup} />);
    await userEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(popup.saveToDrive).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------- Galeri
function gallery(): GalleryView {
  const mk = (i: number) => ({
    sessionId: `s${i}`,
    index: i,
    mode: "Photo Strip",
    title: `Sesi ${i}`,
    finalizedAtMs: Date.UTC(2026, 9, 29, 3, i),
    version: 1,
    dateMs: Date.UTC(2026, 9, 29),
    state: i === 2 ? ("FINAL" as const) : ("CLOSED" as const),
    previewUrl: i === 1 ? "https://storage.example/p1.webp" : null,
    expiresAtMs: Date.now() + 600_000,
    participants: [
      { participantId: "pa", name: "Nadia", color: "P1" },
      { participantId: "pb", name: "Raka", color: "P2" },
    ],
  });
  const ph = (sessionId: string, shotIndex: number, pid: string, name: string, color: string, n: number) => ({ sessionId, shotIndex, participantId: pid, participantName: name, color, attemptId: `att${n}`, previewUrl: `https://storage.example/a${n}.jpg`, expiresAtMs: Date.now() + 600_000 });
  return { sessions: [mk(1), mk(2)], perPerson: [ph("s1", 0, "pa", "Nadia", "P1", 1), ph("s1", 0, "pb", "Raka", "P2", 2), ph("s2", 0, "pa", "Nadia", "P1", 3)] };
}

function galleryClient(data: GalleryView | "fail") {
  const sendIntent = vi.fn(async (type: string) => (type === "gallery.get" ? (data === "fail" ? { ok: false, error: "SERVICE_UNAVAILABLE" } : { ok: true, data }) : { ok: true }));
  return { client: { sendIntent, code: "BOBA27" } as unknown as RoomClient, sendIntent };
}
const roomView = { activeSession: null, sessionCount: 2, participants: [], customFrames: [] } as unknown as RoomView;

function renderGallery(client: RoomClient, onNew = vi.fn()) {
  return render(
    <ToastProvider>
      <GalleryScreen client={client} room={roomView} onBack={vi.fn()} onNewSession={onNew} />
    </ToastProvider>,
  );
}

describe("GalleryScreen (SCR-18)", () => {
  it("banner retensi memakai copy PERSIS dari 12 §1; chip Semua / Sesi n / Per orang", async () => {
    const { client } = galleryClient(gallery());
    renderGallery(client);
    await screen.findByTestId("gallery-sessions");
    expect(GALLERY_RETENTION_COPY.strong).toBe("Galeri ini sementara.");
    expect(GALLERY_RETENTION_COPY.rest).toBe("Setelah semua keluar dan room kedaluwarsa, foto dan datanya dihapus. Unduh yang kamu suka sebelum itu.");
    expect(screen.getByRole("status")).toHaveTextContent("Galeri ini sementara. Setelah semua keluar dan room kedaluwarsa, foto dan datanya dihapus. Unduh yang kamu suka sebelum itu.");
    const chips = within(screen.getByRole("group", { name: "Filter galeri" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["Semua", "Sesi 1", "Sesi 2", "Per orang"]);
  });

  it("TIDAK ada UI take gagal di mana pun: tanpa chip/teks/rute 'gagal', 'ditolak', 'rejected', 'retake' (REQ-GAL-07/08)", async () => {
    const { client } = galleryClient(gallery());
    const { container } = renderGallery(client);
    await screen.findByTestId("gallery-sessions");
    await userEvent.click(screen.getByRole("button", { name: "Per orang" }));
    await screen.findByTestId("gallery-people");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/gagal|ditolak|rejected|retake|ulang|take/i);
    expect(container.querySelector("a[href*='fail'], a[href*='reject']")).toBeNull();
    // yang tampil hanya foto yang dikirim server (ACCEPTED): 3 foto, dikelompokkan per orang
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "Nadia" }).querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Raka" }).querySelectorAll("img")).toHaveLength(1);
  });

  it("filter sesi menampilkan hanya sesi itu beserta foto ACCEPTED-nya; 'Unduh semua (.zip)' tampil jelas tidak tersedia", async () => {
    const { client } = galleryClient(gallery());
    renderGallery(client);
    await screen.findByTestId("gallery-sessions");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Sesi 2" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article", { name: "Sesi 2" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Foto Nadia, shot 1/ })).toBeInTheDocument();
    const zip = screen.getByRole("button", { name: /Unduh semua \(\.zip\)/ });
    expect(zip).toBeDisabled();
    expect(screen.getByText(/Segera hadir/)).toBeInTheDocument();
  });

  it("pratinjau belum siap → placeholder (bukan gambar rusak); gagal memuat → banner dengan Coba lagi yang memanggil ulang; Sesi baru memanggil handler", async () => {
    const ok = galleryClient(gallery());
    const onNew = vi.fn();
    const r1 = renderGallery(ok.client, onNew);
    await screen.findByTestId("gallery-sessions");
    expect(screen.getByRole("img", { name: "Hasil sesi 1" })).toHaveAttribute("src", "https://storage.example/p1.webp");
    expect(screen.queryByRole("img", { name: "Hasil sesi 2" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sesi baru/ }));
    expect(onNew).toHaveBeenCalledOnce();
    r1.unmount();

    const bad = galleryClient("fail");
    renderGallery(bad.client);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Galeri belum bisa dimuat."));
    const before = bad.sendIntent.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(bad.sendIntent.mock.calls.length).toBe(before + 1));
  });

  it("room tanpa hasil → pesan kosong, bukan layar rusak", async () => {
    const { client } = galleryClient({ sessions: [], perPerson: [] });
    renderGallery(client);
    expect(await screen.findByText(/Belum ada hasil/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- SCR-19 & peserta terakhir (DEC-057)
describe("InviteDialog (SCR-19)", () => {
  it("tombol 'Ikut, ayo vote' dan 'Bentar' memanggil handler masing-masing", async () => {
    const onJoin = vi.fn();
    const onLater = vi.fn();
    render(<InviteDialog open from="Nadia" index={3} onJoin={onJoin} onLater={onLater} />);
    expect(screen.getByRole("dialog", { name: "Nadia mulai sesi 3" })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("invite-later"));
    await userEvent.click(screen.getByTestId("invite-join"));
    expect(onLater).toHaveBeenCalledOnce();
    expect(onJoin).toHaveBeenCalledOnce();
  });
});

describe("LeaveDialog: peserta terakhir (DEC-057)", () => {
  const base = { open: true, onClose: vi.fn(), onConfirm: vi.fn(async () => undefined), graceMinutes: 2 };
  it("terakhir + ada hasil → 'Unduh semua dulu' tampil dan membuka galeri; bukan terakhir / tanpa hasil → tidak tampil", async () => {
    const onDownloadAll = vi.fn();
    const { unmount } = render(<LeaveDialog {...base} isLast hasResults onDownloadAll={onDownloadAll} />);
    expect(screen.getByText(/Kamu orang terakhir/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("leave-download-all"));
    expect(onDownloadAll).toHaveBeenCalledOnce();
    unmount();
    const a = render(<LeaveDialog {...base} isLast={false} hasResults onDownloadAll={onDownloadAll} />);
    expect(screen.queryByTestId("leave-download-all")).toBeNull();
    a.unmount();
    render(<LeaveDialog {...base} isLast hasResults={false} onDownloadAll={onDownloadAll} />);
    expect(screen.queryByTestId("leave-download-all")).toBeNull();
  });
});
