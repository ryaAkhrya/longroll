import { render, renderHook, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomClient } from "@/room/client";
import { InviteDialog } from "../InviteDialog";
import { EXPORT_BUSY, EXPORT_IDLE, inviteActivity, peerStatus, reduceActivity, useInviteStatus } from "../inviteStatus";

const SID = "11111111-1111-4111-8111-111111111111";
const OLD = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

describe("status peserta SCR-19", () => {
  it("reducer: Ikut / Bentar untuk sesi yang benar; sesi lain & payload rusak diabaikan; unduh sementara", () => {
    let m = reduceActivity({}, SID, { participantId: "p1", activity: inviteActivity(SID, "join") });
    m = reduceActivity(m, SID, { participantId: "p2", activity: inviteActivity(SID, "later") });
    m = reduceActivity(m, SID, { participantId: "p3", activity: inviteActivity(OLD, "join") }); // sesi lama
    m = reduceActivity(m, SID, { participantId: "p4", activity: "bebas:<script>" });
    m = reduceActivity(m, SID, null);
    m = reduceActivity(m, SID, { participantId: 5, activity: "x" });
    expect(peerStatus(m.p1)).toBe("join");
    expect(peerStatus(m.p2)).toBe("later");
    expect(peerStatus(m.p3)).toBe("pending");
    expect(peerStatus(m.p4)).toBe("pending");

    m = reduceActivity(m, SID, { participantId: "p2", activity: EXPORT_BUSY });
    expect(peerStatus(m.p2)).toBe("download"); // Bentar sambil mengunduh → "Lagi unduh…" (08 §3: Bentar = sedang mengunduh)
    m = reduceActivity(m, SID, { participantId: "p2", activity: EXPORT_IDLE });
    expect(peerStatus(m.p2)).toBe("later");
    m = reduceActivity(m, SID, { participantId: "p5", activity: EXPORT_BUSY });
    expect(peerStatus(m.p5)).toBe("download");
    m = reduceActivity(m, SID, { participantId: "p5", activity: EXPORT_IDLE });
    expect(peerStatus(m.p5)).toBe("pending");
  });

  it("hook: mendengar presence.activity dan menyiarkan jawaban sendiri berkala", () => {
    vi.useFakeTimers();
    let listener: ((t: string, p: unknown) => void) | null = null;
    const client = { onSignal: vi.fn((fn) => ((listener = fn), () => undefined)), sendVolatile: vi.fn() } as unknown as RoomClient;
    const { result } = renderHook(() => useInviteStatus(client, SID, "later"));
    expect(client.sendVolatile).toHaveBeenCalledWith("presence.activity", { activity: inviteActivity(SID, "later") });
    act(() => listener!("presence.activity", { participantId: "p1", activity: inviteActivity(SID, "join") }));
    expect(result.current.p1?.answer).toBe("join");
    act(() => void vi.advanceTimersByTime(8_100));
    expect((client.sendVolatile as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
    vi.useRealTimers();
  });

  it("tanpa jawaban sendiri, tidak ada yang disiarkan", () => {
    const client = { onSignal: vi.fn(() => () => undefined), sendVolatile: vi.fn() } as unknown as RoomClient;
    renderHook(() => useInviteStatus(client, SID, null));
    expect(client.sendVolatile).not.toHaveBeenCalled();
  });

  it("dialog menampilkan daftar status persis seperti spesifikasi (Ikut / Bentar / Lagi unduh… / Belum jawab)", () => {
    render(
      <InviteDialog
        open
        from="Nadia"
        index={2}
        peers={[
          { participantId: "a", name: "Nadia", color: "P1", status: "join" },
          { participantId: "b", name: "Raka", color: "P2", status: "download" },
          { participantId: "c", name: "Sasa", color: "P3", status: "pending" },
          { participantId: "d", name: "Dimas", color: "P4", status: "later" },
        ]}
        onJoin={() => undefined}
        onLater={() => undefined}
      />,
    );
    const list = screen.getByTestId("invite-peers");
    expect(list).toHaveTextContent("Nadia");
    for (const label of ["Ikut", "Lagi unduh…", "Belum jawab", "Bentar"]) expect(list).toHaveTextContent(label);
    expect(screen.getByTestId("invite-join")).toHaveTextContent("Ikut, ayo vote");
  });

  it("tanpa peers → tidak ada daftar (kompatibel dengan pemakaian lama)", () => {
    render(<InviteDialog open from="Nadia" index={2} onJoin={() => undefined} onLater={() => undefined} />);
    expect(screen.queryByTestId("invite-peers")).toBeNull();
  });
});
