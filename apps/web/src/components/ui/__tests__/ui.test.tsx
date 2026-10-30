import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BottomSheet } from "../BottomSheet";
import { Button } from "../Button";
import { CodeInput } from "../CodeInput";
import { ToastProvider, useToast } from "../Toast";

describe("Button", () => {
  it("memanggil onClick saat aktif", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Bikin room</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Bikin room" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("tidak memanggil onClick saat loading, dan menandai aria-busy", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Bikin room…
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Bikin room…" });
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("tidak bisa diklik saat disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Mulai
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Mulai" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("CodeInput", () => {
  function Harness({ onComplete }: { onComplete?: (c: string) => void }) {
    const [v, setV] = useState("");
    return <CodeInput value={v} onChange={setV} onComplete={onComplete} />;
  }

  it("menormalkan ke huruf besar dan membuang karakter di luar alfabet DEC-022", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Kode room");
    await userEvent.type(input, "ab0o1i-c2");
    expect(input).toHaveValue("ABC2");
  });

  it("paste 6 karakter langsung terisi dan memanggil onComplete; sisanya dipotong", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const input = screen.getByLabelText("Kode room");
    await userEvent.click(input);
    await userEvent.paste("goja27xyz");
    expect(input).toHaveValue("GJA27X");
    expect(onComplete).toHaveBeenCalledWith("GJA27X");
  });
});

describe("BottomSheet", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Buka</button>
        <BottomSheet open={open} onClose={() => setOpen(false)} title="Alat">
          <button>Isi</button>
        </BottomSheet>
      </>
    );
  }

  it("memindahkan fokus ke judul saat buka dan mengembalikannya ke pemicu saat tutup", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Buka" });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Alat" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alat" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("Toast", () => {
  function Harness() {
    const toast = useToast();
    return <button onClick={() => toast.show({ message: "Link room tersalin" })}>Tampilkan</button>;
  }

  it("menampilkan pesan di region aria-live polite", async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    const region = screen.getByRole("region", { name: "Notifikasi" });
    expect(region).toHaveAttribute("aria-live", "polite");
    await userEvent.click(screen.getByRole("button", { name: "Tampilkan" }));
    expect(region).toHaveTextContent("Link room tersalin");
  });

  function Two() {
    const toast = useToast();
    return (
      <>
        <button onClick={() => toast.show({ message: "Beta masuk room" })}>Pasif</button>
        <button onClick={() => toast.show({ message: "Suaramu gak kekirim", tone: "warn" })}>Peringatan</button>
        <button onClick={() => toast.show({ message: "Dihapus", action: { label: "Balikin", onAction: () => undefined } })}>Aksi</button>
      </>
    );
  }

  it("notifikasi pasif hilang saat pengguna menggulir; peringatan dan yang punya aksi tetap tampil", async () => {
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>,
    );
    const region = screen.getByRole("region", { name: "Notifikasi" });
    await userEvent.click(screen.getByRole("button", { name: "Peringatan" }));
    await userEvent.click(screen.getByRole("button", { name: "Aksi" }));
    await userEvent.click(screen.getByRole("button", { name: "Pasif" }));
    expect(region).toHaveTextContent("Beta masuk room");
    act(() => {
      window.dispatchEvent(new Event("wheel"));
    });
    expect(region).not.toHaveTextContent("Beta masuk room");
    expect(region).toHaveTextContent("Suaramu gak kekirim");
    expect(region).toHaveTextContent("Dihapus");
  });

  it("scroll programatik (reset ke atas saat layar berganti) tidak menutup notifikasi", async () => {
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Pasif" }));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByRole("region", { name: "Notifikasi" })).toHaveTextContent("Beta masuk room");
  });
});
