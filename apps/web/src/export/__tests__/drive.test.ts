import { describe, expect, it, vi } from "vitest";
import { DRIVE_CHUNK, DRIVE_MESSAGES, DRIVE_MULTIPART_LIMIT, DRIVE_SCOPE, DriveClient, DriveError } from "../drive";
import type { DriveEnv, GisApi, GisTokenResponse } from "../drive";

/** Google & Drive dipalsukan sepenuhnya: tidak ada jaringan, tidak ada akun, tidak ada popup. */
function harness(opts: { clientId?: string | null; gis?: "ok" | "denied" | "popup" | "error" | "load-fail"; responses?: (Response | Error)[] } = {}) {
  const store = new Map<string, string>();
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...(opts.responses ?? [])];
  const revoked: string[] = [];
  let tokenClientCfg: { scope: string; client_id: string } | null = null;
  const gis: GisApi = {
    initTokenClient: (cfg) => {
      tokenClientCfg = cfg;
      return {
        requestAccessToken: () => {
          const mode = opts.gis ?? "ok";
          if (mode === "popup") cfg.error_callback?.({ type: "popup_failed_to_open" });
          else if (mode === "error") cfg.error_callback?.({ type: "popup_closed" });
          else if (mode === "denied") cfg.callback({ error: "access_denied" } as GisTokenResponse);
          else cfg.callback({ access_token: "ya29.SECRET", expires_in: 3600 });
        },
      };
    },
    revoke: (_t, done) => (revoked.push(_t), done?.()),
  };
  let now = 1_000_000;
  const env: DriveEnv = {
    clientId: opts.clientId === undefined ? "client-id.apps.googleusercontent.com" : opts.clientId,
    loadGis: async () => {
      if (opts.gis === "load-fail") throw new Error("offline");
      return gis;
    },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`respons tak terduga untuk ${url}`);
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as typeof fetch,
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), remove: (k) => void store.delete(k) },
    sleep: async () => undefined,
    now: () => now,
  };
  return { env, store, calls, revoked, cfg: () => tokenClientCfg, advance: (ms: number) => (now += ms) };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const png = (bytes = 100) => new Blob([new Uint8Array(bytes)], { type: "image/png" });
const folderFound = () => json({ files: [{ id: "folder1" }] });
const uploaded = () => json({ id: "file1", name: "LONGROLL_X.png", webViewLink: "https://drive.google.com/file/d/file1/view" });

describe("Google Drive (12 §6): sambungan & consent", () => {
  it("scope HANYA drive.file; token tidak pernah masuk penyimpanan lokal", async () => {
    const h = harness();
    const d = new DriveClient(h.env);
    expect(d.connected).toBe(false);
    await d.connect();
    expect(d.connected).toBe(true);
    expect(h.cfg()).toMatchObject({ scope: DRIVE_SCOPE, client_id: "client-id.apps.googleusercontent.com" });
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
    expect([...h.store.values()].join("|")).not.toContain("ya29");
  });

  it("tanpa client id → NOT_CONFIGURED (tidak memuat Google, tidak memalsukan keberhasilan)", async () => {
    const h = harness({ clientId: "" });
    const d = new DriveClient(h.env);
    expect(d.configured).toBe(false);
    await expect(d.connect()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("consent ditolak / popup diblokir / skrip Google gagal dimuat → kode galat yang tepat, pesan 12 §6", async () => {
    await expect(new DriveClient(harness({ gis: "denied" }).env).connect()).rejects.toMatchObject({ code: "CONSENT_DENIED", message: "Gak jadi nyimpen ke Drive." });
    await expect(new DriveClient(harness({ gis: "popup" }).env).connect()).rejects.toMatchObject({ code: "POPUP_BLOCKED", message: "Izinkan popup buat longroll.app lalu coba lagi." });
    await expect(new DriveClient(harness({ gis: "error" }).env).connect()).rejects.toMatchObject({ code: "CONSENT_DENIED" });
    await expect(new DriveClient(harness({ gis: "load-fail" }).env).connect()).rejects.toMatchObject({ code: "GIS_LOAD" });
  });

  it("token kedaluwarsa menurut waktu → connected=false (gesture baru diperlukan)", async () => {
    const h = harness();
    const d = new DriveClient(h.env);
    await d.connect();
    h.advance(3_600_000);
    expect(d.connected).toBe(false);
    await expect(d.upload(png(), "a.png")).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("putuskan: gis.revoke dipanggil dengan token, token & ID folder dilupakan", async () => {
    const h = harness({ responses: [folderFound(), uploaded()] });
    const d = new DriveClient(h.env);
    await d.connect();
    await d.upload(png(), "a.png");
    expect(h.store.get("lr:drive:folder")).toBe("folder1");
    await d.revoke();
    expect(h.revoked).toEqual(["ya29.SECRET"]);
    expect(d.connected).toBe(false);
    expect(h.store.size).toBe(0);
  });
});

describe("Google Drive: folder LONGROLL", () => {
  it("mencari folder buatan aplikasi; membuat bila tidak ada; menyimpan ID; memakai cache bila masih valid", async () => {
    const h = harness({ responses: [json({ files: [] }), json({ id: "newFolder" }), uploaded(), json({ id: "newFolder", trashed: false }), uploaded()] });
    const d = new DriveClient(h.env);
    await d.connect();
    await d.upload(png(), "a.png");
    const create = h.calls[1]!;
    expect(create.init.method).toBe("POST");
    expect(JSON.parse(String(create.init.body))).toMatchObject({ name: "LONGROLL", mimeType: "application/vnd.google-apps.folder" });
    expect(h.calls[0]!.url).toContain("trashed%3Dfalse");
    expect(h.store.get("lr:drive:folder")).toBe("newFolder");
    await d.upload(png(), "b.png"); // cache: hanya verifikasi folder, tanpa pencarian ulang
    expect(h.calls[3]!.url).toContain("/files/newFolder");
  });

  it("folder tersimpan sudah dibuang ke tempat sampah → dicari/dibuat ulang", async () => {
    const h = harness({ responses: [json({ id: "old", trashed: true }), json({ files: [] }), json({ id: "fresh" }), uploaded()] });
    h.store.set("lr:drive:folder", "old");
    const d = new DriveClient(h.env);
    await d.connect();
    await d.upload(png(), "a.png");
    expect(h.store.get("lr:drive:folder")).toBe("fresh");
  });
});

describe("Google Drive: unggah", () => {
  it("< 5 MB → multipart: metadata (nama + folder) dan isi file dalam satu permintaan, dengan header Bearer", async () => {
    const h = harness({ responses: [folderFound(), uploaded()] });
    const d = new DriveClient(h.env);
    await d.connect();
    const progress: number[] = [];
    const file = await d.upload(png(2000), "LONGROLL_X.png", { onProgress: (f) => progress.push(f) });
    expect(file).toEqual({ id: "file1", name: "LONGROLL_X.png", webViewLink: "https://drive.google.com/file/d/file1/view" });
    const up = h.calls[1]!;
    expect(up.url).toContain("/upload/drive/v3/files?uploadType=multipart");
    expect((up.init.headers as Record<string, string>).Authorization).toBe("Bearer ya29.SECRET");
    expect((up.init.headers as Record<string, string>)["Content-Type"]).toMatch(/^multipart\/related; boundary=/);
    const text = await (up.init.body as Blob).text();
    expect(text).toContain('"name":"LONGROLL_X.png"');
    expect(text).toContain('"parents":["folder1"]');
    expect(progress.at(-1)).toBe(1);
  });

  it("≥ 5 MB → resumable: sesi dibuka, dikirim per potongan 2 MB (kelipatan 256 KiB), 308 dilanjutkan dari offset server", async () => {
    const size = DRIVE_MULTIPART_LIMIT + 123;
    expect(DRIVE_CHUNK % 262_144).toBe(0);
    const h = harness({
      responses: [
        folderFound(),
        new Response(null, { status: 200, headers: { Location: "https://upload.example/session1" } }),
        new Response(null, { status: 308, headers: { Range: `bytes=0-${DRIVE_CHUNK - 1}` } }),
        new Response(null, { status: 308, headers: { Range: `bytes=0-${2 * DRIVE_CHUNK - 1}` } }),
        uploaded(),
      ],
    });
    const d = new DriveClient(h.env);
    await d.connect();
    const progress: number[] = [];
    await d.upload(new Blob([new Uint8Array(size)], { type: "image/png" }), "big.png", { onProgress: (f) => progress.push(f) });
    expect(h.calls[1]!.url).toContain("uploadType=resumable");
    expect(h.calls.slice(2).map((c) => (c.init.headers as Record<string, string>)["Content-Range"])).toEqual([`bytes 0-${DRIVE_CHUNK - 1}/${size}`, `bytes ${DRIVE_CHUNK}-${2 * DRIVE_CHUNK - 1}/${size}`, `bytes ${2 * DRIVE_CHUNK}-${size - 1}/${size}`]);
    expect(h.calls[2]!.url).toBe("https://upload.example/session1");
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });

  it("jaringan putus: retry maks. 3× lalu berhasil; lebih dari 3× → NETWORK", async () => {
    const ok = harness({ responses: [folderFound(), new TypeError("net"), new TypeError("net"), new TypeError("net"), uploaded()] });
    const d1 = new DriveClient(ok.env);
    await d1.connect();
    await expect(d1.upload(png(), "a.png")).resolves.toMatchObject({ id: "file1" });
    expect(ok.calls).toHaveLength(5); // folder + 1 + 3 retry

    const bad = harness({ responses: [folderFound(), new TypeError("net"), new TypeError("net"), new TypeError("net"), new TypeError("net")] });
    const d2 = new DriveClient(bad.env);
    await d2.connect();
    await expect(d2.upload(png(), "a.png")).rejects.toMatchObject({ code: "NETWORK", message: DRIVE_MESSAGES.NETWORK });
    expect(bad.calls).toHaveLength(5);
  });

  it("5xx diperlakukan sebagai gangguan sementara (retry), 429 juga", async () => {
    const h = harness({ responses: [folderFound(), new Response("", { status: 503 }), new Response("", { status: 429 }), uploaded()] });
    const d = new DriveClient(h.env);
    await d.connect();
    await expect(d.upload(png(), "a.png")).resolves.toMatchObject({ id: "file1" });
  });

  it("403 rateLimitExceeded/userRateLimitExceeded diulang dengan backoff (bukan gagal); setelah batas retry → NETWORK", async () => {
    const rl = (reason: string) => json({ error: { errors: [{ reason }] } }, 403);
    const h = harness({ responses: [folderFound(), rl("rateLimitExceeded"), rl("userRateLimitExceeded"), uploaded()] });
    const d = new DriveClient(h.env);
    await d.connect();
    await expect(d.upload(png(), "a.png")).resolves.toMatchObject({ id: "file1" });
    const bad = harness({ responses: [folderFound(), rl("rateLimitExceeded"), rl("rateLimitExceeded"), rl("rateLimitExceeded"), rl("rateLimitExceeded")] });
    const d2 = new DriveClient(bad.env);
    await d2.connect();
    await expect(d2.upload(png(), "a.png")).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("preload GIS: connect() berikutnya memanggil requestAccessToken SINKRON (tetap di dalam gesture klik, popup tidak diblokir)", async () => {
    const h = harness();
    const d = new DriveClient(h.env);
    d.preload();
    await Promise.resolve();
    await Promise.resolve();
    let sync = false;
    const p = d.connect();
    sync = h.cfg() !== null; // initTokenClient dipanggil di tick yang sama, tanpa menunggu jaringan
    await p;
    expect(sync).toBe(true);
    // Tanpa client id → preload tidak melakukan apa pun.
    const none = harness({ clientId: null });
    new DriveClient(none.env).preload();
  });

  it("galat tidak membocorkan token: pesan DriveError berasal dari tabel statis", async () => {
    const h = harness({ responses: [folderFound(), json({ error: { message: "Bearer ya29.SECRET invalid" } }, 400)] });
    const d = new DriveClient(h.env);
    await d.connect();
    const err = await d.upload(png(), "a.png").catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(String(err.message)).not.toContain("ya29");
    expect(JSON.stringify(err)).not.toContain("ya29");
  });

  it("401 → TOKEN_EXPIRED dan token dibuang (UI menampilkan tombol Lanjut); sambungan ulang lalu unggah berhasil", async () => {
    const h = harness({ responses: [folderFound(), new Response("", { status: 401 }), folderFound(), uploaded()] });
    const d = new DriveClient(h.env);
    await d.connect();
    await expect(d.upload(png(), "a.png")).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    expect(d.connected).toBe(false);
    await d.connect();
    await expect(d.upload(png(), "a.png")).resolves.toMatchObject({ id: "file1" });
  });

  it("403 storageQuotaExceeded → QUOTA ('Drive penuh…'); 403 lain → FAILED", async () => {
    const quota = harness({ responses: [folderFound(), json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, 403)] });
    const d = new DriveClient(quota.env);
    await d.connect();
    await expect(d.upload(png(), "a.png")).rejects.toMatchObject({ code: "QUOTA", message: "Drive penuh. Kosongin sedikit atau unduh ke perangkat aja." });
    const other = harness({ responses: [folderFound(), json({ error: { errors: [{ reason: "forbidden" }] } }, 403)] });
    const d2 = new DriveClient(other.env);
    await d2.connect();
    await expect(d2.upload(png(), "a.png")).rejects.toMatchObject({ code: "FAILED" });
  });

  it("dibatalkan lewat AbortSignal tidak dianggap galat Drive", async () => {
    const h = harness({ responses: [folderFound(), uploaded()] });
    const d = new DriveClient(h.env);
    await d.connect();
    const ac = new AbortController();
    ac.abort();
    await expect(d.upload(png(), "a.png", { signal: ac.signal })).rejects.not.toBeInstanceOf(DriveError);
  });

  it("semua pesan galat berbahasa Indonesia dan tidak memuat token", () => {
    for (const m of Object.values(DRIVE_MESSAGES)) {
      expect(m.length).toBeGreaterThan(5);
      expect(m).not.toMatch(/ya29|Bearer/);
    }
    void vi;
  });
});
