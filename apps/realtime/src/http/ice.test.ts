import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { setLogSilent, setLogSink } from "../log";
import { IceProvider, normalizeIceServers } from "./ice";

const cfg = (env: Record<string, string>) => loadConfig({ STUN_URLS: "stun:stun.example.test:3478", ...env } as never).ice;
const ok = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });

describe("normalizeIceServers", () => {
  it("menerima array (Metered) dan {iceServers} (gaya Twilio/Cloudflare); satu URL atau banyak", () => {
    const a = normalizeIceServers([{ urls: "stun:s.test:3478" }, { urls: ["turn:t.test:80", "turns:t.test:443?transport=tcp"], username: "u", credential: "c" }]);
    expect(a).toEqual([{ urls: ["stun:s.test:3478"] }, { urls: ["turn:t.test:80", "turns:t.test:443?transport=tcp"], username: "u", credential: "c" }]);
    expect(normalizeIceServers({ iceServers: [{ url: "stun:x.test:1" }] })).toEqual([{ urls: ["stun:x.test:1"] }]);
  });
  it("membuang skema berbahaya/tak dikenal, TURN tanpa kredensial, entri rusak, dan membatasi jumlah", () => {
    const out = normalizeIceServers([
      { urls: "javascript:alert(1)" },
      { urls: "http://evil.test" },
      { urls: "turn:t.test:3478" }, // tanpa username/credential
      null,
      "x",
      { urls: ["turn:ok.test:3478"], username: "u", credential: "c" },
    ]);
    expect(out).toEqual([{ urls: ["turn:ok.test:3478"], username: "u", credential: "c" }]);
    expect(normalizeIceServers(Array.from({ length: 40 }, (_, i) => ({ urls: `stun:s${i}.test:1` })))).toHaveLength(12);
    expect(normalizeIceServers("bukan daftar")).toEqual([]);
  });
});

describe("IceProvider.build", () => {
  it("tanpa TURN: STUN saja, turn=false", async () => {
    const r = await new IceProvider(cfg({})).build("pid-1");
    expect(r).toEqual({ iceServers: [{ urls: ["stun:stun.example.test:3478"] }], ttlSec: 3600, turn: false });
  });

  it("secret bersama: kredensial HMAC sementara per peserta", async () => {
    const p = new IceProvider(cfg({ TURN_URLS: "turn:t.test:3478?transport=udp,turns:t.test:443", TURN_SHARED_SECRET: "rahasia" }), () => 1_700_000_000_000);
    const r = await p.build("pid-9");
    const turn = r.iceServers[1]!;
    expect(r.turn).toBe(true);
    expect(turn.username).toBe(`${1_700_000_000 + 3600}:pid-9`);
    expect(turn.credential).toBe(createHmac("sha1", "rahasia").update(turn.username!).digest("base64"));
  });

  it("kredensial statis penyedia (TURN_USERNAME/TURN_CREDENTIAL)", async () => {
    const r = await new IceProvider(cfg({ TURN_URLS: "turns:t.test:443?transport=tcp", TURN_USERNAME: "user", TURN_CREDENTIAL: "pass" })).build("p");
    expect(r.iceServers[1]).toEqual({ urls: ["turns:t.test:443?transport=tcp"], username: "user", credential: "pass" });
    expect(r.turn).toBe(true);
  });

  it("penyedia REST: dinormalisasi, di-cache dan dipakai bersama; satu panggilan untuk banyak peserta serentak", async () => {
    let calls = 0;
    let t = 0;
    const body = [{ urls: "stun:stun.provider.test" }, { urls: ["turn:r.provider.test:80", "turns:r.provider.test:443?transport=tcp"], username: "eph", credential: "tok" }];
    const p = new IceProvider(cfg({ TURN_CREDENTIALS_URL: "https://api.provider.test/creds?apiKey=KUNCI-RAHASIA" }), () => t, async (url) => {
      calls++;
      expect(url).toContain("apiKey=KUNCI-RAHASIA"); // dipakai server-side saja
      return ok(body)();
    });
    const rs = await Promise.all(["a", "b", "c", "d"].map((id) => p.build(id)));
    expect(calls).toBe(1);
    for (const r of rs) {
      expect(r.turn).toBe(true);
      expect(r.iceServers.some((s) => s.username === "eph")).toBe(true);
    }
    t += 5 * 60_000; // masih dalam cache 10 menit
    await p.build("e");
    expect(calls).toBe(1);
    t += 6 * 60_000; // lewat TTL cache → ambil ulang
    await p.build("f");
    expect(calls).toBe(2);
    expect(JSON.stringify(rs)).not.toContain("KUNCI-RAHASIA"); // kunci API tidak pernah dikirim ke klien
  });

  it("penyedia gagal: STUN tetap dikirim, memakai kredensial lama bila ada, dan log tidak membocorkan URL/kunci", async () => {
    const lines: string[] = [];
    setLogSilent(false);
    setLogSink((l) => lines.push(l));
    try {
      let t = 0;
      let fail = false;
      const p = new IceProvider(cfg({ TURN_CREDENTIALS_URL: "https://api.provider.test/creds?apiKey=KUNCI-RAHASIA" }), () => t, async () => {
        if (fail) throw new Error("connect ECONNREFUSED https://api.provider.test/creds?apiKey=KUNCI-RAHASIA");
        return ok([{ urls: ["turn:r.test:80"], username: "eph", credential: "tok" }])();
      });
      expect((await p.build("a")).turn).toBe(true);
      fail = true;
      t += 11 * 60_000;
      const stale = await p.build("b");
      expect(stale.turn).toBe(true); // kredensial lama masih berlaku
      expect(stale.iceServers[0]).toEqual({ urls: ["stun:stun.example.test:3478"] });

      const cold = new IceProvider(cfg({ TURN_CREDENTIALS_URL: "https://api.provider.test/creds?apiKey=KUNCI-RAHASIA" }), () => t, async () => {
        throw new Error("boom https://api.provider.test/creds?apiKey=KUNCI-RAHASIA");
      });
      const r = await cold.build("c");
      expect(r).toMatchObject({ turn: false, iceServers: [{ urls: ["stun:stun.example.test:3478"] }] });
      expect(lines.join("\n")).toContain("ice.provider_failed");
      expect(lines.join("\n")).not.toMatch(/KUNCI-RAHASIA|api\.provider\.test/);
    } finally {
      setLogSink(null);
      setLogSilent(true);
    }
  });

  it("respons penyedia tidak valid / HTTP error diperlakukan sebagai kegagalan (bukan daftar kosong palsu)", async () => {
    const bad = new IceProvider(cfg({ TURN_CREDENTIALS_URL: "https://x.test/k" }), Date.now, async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect((await bad.build("a")).turn).toBe(false);
    const junk = new IceProvider(cfg({ TURN_CREDENTIALS_URL: "https://x.test/k" }), Date.now, ok([{ urls: "http://evil.test" }]));
    expect((await junk.build("a")).turn).toBe(false);
  });
});
