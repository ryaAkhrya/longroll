import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createRoom, joinRoom, newPage } from "./helpers";

/**
 * P04 (AC-P04-1/2/6/7/10, TC-VOTE-*) dengan 4 konteks browser: peserta bukan pembuat memulai voting,
 * suara realtime, Tutup vote setelah mayoritas dengan jendela 5 s (ganti suara masih diterima),
 * reload saat voting, hasil identik, masuk studio otomatis dengan mode terkunci. Tanpa kamera.
 */
const card = (page: Page, name: string) => page.getByRole("radio", { name: new RegExp(`^${name}\.`) });

test("4 peserta: mulai vote, suara, reload, Tutup vote + jendela 5 s, hasil, studio", async ({ browser }) => {
  test.setTimeout(90_000);
  const ps = await Promise.all([0, 1, 2, 3].map(() => newPage(browser)));
  const [a, b, c, d] = ps.map((p) => p.page) as [Page, Page, Page, Page];
  const code = await createRoom(a, "Nadia", false);
  await joinRoom(b, code, "Raka", false);
  await joinRoom(c, code, "Sasa", false);
  await joinRoom(d, code, "Bimo", false);
  for (const p of [a, b, c, d]) await expect(p.getByText("4 dari 4 udah masuk")).toBeVisible();

  // AC-P04-10: Sasa (bukan pembuat) memulai.
  await c.getByRole("button", { name: "Mulai vote mode" }).click();
  for (const p of [a, b, c, d]) await expect(p.getByRole("heading", { name: /Mau foto model apa/ })).toBeVisible();
  await expect(a.getByText(/Sasa mulai vote mode/)).toBeVisible();
  await expect(a.getByText("Sisa waktu")).toHaveCount(0); // tanpa timer voting (DEC-046)

  await card(a, "Photo Strip").click();
  await card(b, "Photo Strip").click();
  await expect(card(d, "Photo Strip")).toHaveAccessibleName(/2 suara/);
  // 2 dari 4 belum mayoritas → tidak ada Tutup vote.
  await expect(d.getByRole("button", { name: "Tutup vote", exact: true })).toHaveCount(0);

  // Reload saat voting: state & suara pulih.
  await b.reload();
  await expect(b.getByRole("heading", { name: /Mau foto model apa/ })).toBeVisible();
  await expect(card(b, "Photo Strip")).toHaveAttribute("aria-checked", "true");

  await card(c, "Group Shot").click();
  await expect(d.getByText(/3 dari 4 udah vote/).filter({ visible: true })).toBeVisible();
  await d.getByRole("button", { name: "Tutup vote", exact: true }).filter({ visible: true }).click();
  for (const p of [a, b, c]) await expect(p.getByText(/Bimo nutup vote dalam/).filter({ visible: true })).toBeVisible();
  // Jendela 5 s: ganti suara masih diterima.
  await card(a, "Group Shot").click();
  await card(b, "Group Shot").click();

  for (const p of [a, b, c, d]) await expect(p.getByRole("heading", { name: /Group Shot menang/ })).toBeVisible({ timeout: 8_000 });
  // Otomatis masuk studio ≤ 3 s; mode terkunci identik.
  for (const p of [a, b, c, d]) {
    await expect(p.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 6_000 });
    await expect(p.getByLabel("dikunci").first()).toBeVisible();
  }
  await expect(a.getByRole("button", { name: /^Ambil foto, hitung mundur/ })).toBeEnabled();

  // Reload di studio → kembali ke studio (bukan voting).
  await c.reload();
  await expect(c.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 10_000 });
  for (const p of ps) await p.ctx.close();
});
