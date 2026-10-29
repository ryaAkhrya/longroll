import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, openPerson } from "./kit";

/**
 * P10-A — restart service realtime (kill -9 pohon proses) di tengah VOTING dan di tengah STUDIO, dengan Neon `development`
 * sebagai satu-satunya sumber state (DEC-088). Hanya jalan bila P10_SELF_REALTIME=1 (spec mengelola proses realtime sendiri)
 * dan DATABASE_URL tersedia di apps/realtime/.env. Grace dibuat 40 dtk agar klien sempat tersambung ulang (backoff ≤ 8 dtk).
 * Room diakhiri lewat UI dan ditunggu bubar supaya tidak ada data tersisa di Neon.
 */
const enabled = process.env.P10_SELF_REALTIME === "1";
const ROOT = path.resolve(__dirname, "../../../..");

let rt: ChildProcess | undefined;

async function waitHealth(timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch("http://localhost:4000/api/health");
      if (r.ok) return Date.now() - t0;
    } catch {
      /* belum siap */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error("realtime tidak sehat");
    await new Promise((r) => setTimeout(r, 200));
  }
}

function startRealtime() {
  rt = spawn("npm run start -w @longroll/realtime", {
    cwd: ROOT,
    shell: true,
    stdio: "ignore",
    env: { ...process.env, PORT: "4000", ALLOWED_ORIGINS: "http://localhost:3000", ROOM_GRACE_PERIOD_SECONDS: "40", PARTICIPANT_HOLD_SECONDS: "20", RATE_LIMIT_SALT: `p10r-${Date.now()}` },
  });
  return waitHealth();
}

function killRealtime() {
  if (!rt?.pid) return;
  try {
    execFileSync("taskkill", ["/PID", String(rt.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* sudah mati */
  }
  rt = undefined;
}

test.afterAll(() => killRealtime());

test("restart realtime saat VOTING dan STUDIO: klien tersambung ulang, state utuh dari Neon, room tuntas bubar", async ({ browser }, info) => {
  test.skip(!enabled, "butuh P10_SELF_REALTIME=1 (proses realtime dikelola spec) + DATABASE_URL Neon development");
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup");
  test.setTimeout(300_000);
  await startRealtime();

  const people = [await openPerson(browser, info, "Nadia", { camera: false }), await openPerson(browser, info, "Raka", { camera: false }), await openPerson(browser, info, "Sasa", { camera: false })];
  const [A, B, C] = people as [(typeof people)[number], (typeof people)[number], (typeof people)[number]];
  const code = await createRoom(A.page, "Nadia", false);
  await joinRoom(B.page, code, "Raka", false);
  await joinRoom(C.page, code, "Sasa", false);
  for (const p of people) await expect(p.page.getByText("3 dari 4 udah masuk")).toBeVisible({ timeout: 10_000 });

  // ── restart #1: tengah VOTING (2 dari 3 sudah memilih) ──
  await A.page.getByRole("button", { name: "Mulai vote mode" }).click();
  await A.page.getByRole("radio", { name: /^Photo Grid\./ }).click();
  await B.page.getByRole("radio", { name: /^Photo Grid\./ }).click();
  await expect(C.page.getByRole("radio", { name: /^Photo Grid\..*2 suara/ })).toBeVisible({ timeout: 10_000 });

  killRealtime();
  await A.page.waitForTimeout(2_500);
  const tUp = Date.now();
  const bootMs = await startRealtime();
  // Klien menyambung ulang sendiri; suara 2 tetap ada (dipulihkan dari Neon), bukan mulai dari nol.
  await expect(A.page.getByRole("radio", { name: /^Photo Grid\..*2 suara/ })).toBeVisible({ timeout: 30_000 });
  const resumeMs = Date.now() - tUp;
  test.info().annotations.push({ type: "restart-voting", description: `boot ${bootMs} ms, klien pulih ${resumeMs} ms (target ≤ 10000 ms setelah proses naik)` });
  console.log(`[restart-voting] boot=${bootMs}ms resume=${resumeMs}ms`);

  await C.page.getByRole("radio", { name: /^Photo Grid\./ }).click();
  for (const p of people) await expect(p.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 20_000 });

  // ── restart #2: tengah STUDIO (frame bersama sudah dipasang) ──
  await B.page.getByRole("button", { name: "Frame", exact: true }).filter({ visible: true }).first().click();
  await B.page.getByRole("option", { name: /^Scrapbook/ }).click();
  await B.page.getByRole("button", { name: "Pasang buat semua" }).click();
  const out = (pg: typeof A.page) => pg.getByRole("img", { name: /^(Hasil sementara|Pratinjau)/ }).first();
  await expect(out(A.page)).toHaveAttribute("data-frame", "builtin/scrapbook@1", { timeout: 10_000 });

  killRealtime();
  await A.page.waitForTimeout(2_500);
  const t2 = Date.now();
  await startRealtime();
  await expect(out(A.page)).toHaveAttribute("data-frame", "builtin/scrapbook@1", { timeout: 30_000 });
  await expect(out(C.page)).toHaveAttribute("data-frame", "builtin/scrapbook@1", { timeout: 30_000 });
  console.log(`[restart-studio] resume=${Date.now() - t2}ms`);
  for (const p of people) expect(p.watch.pageErrors, `pageerror ${p.watch.name}`).toEqual([]);

  // ── akhir: semua keluar → grace 40 dtk → bubar (tidak ada sisa di Neon) ──
  for (const p of people) {
    await p.page.getByRole("button", { name: "Keluar dari room" }).filter({ visible: true }).first().click();
    await p.page.getByRole("button", { name: "Keluar", exact: true }).click();
    await p.page.waitForURL("http://localhost:3000/");
    await p.ctx.close();
  }
  const late = await openPerson(browser, info, "Telat", { camera: false });
  await late.page.waitForTimeout(43_000);
  await late.page.goto(`/r/${code}`);
  await expect(late.page.getByRole("heading", { name: /udah bubar/ })).toBeVisible();
  await late.ctx.close();
});
