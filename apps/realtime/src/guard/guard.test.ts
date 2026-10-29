import { describe, expect, it } from "vitest";
import { hashIp } from "../security";
import { errText, metrics, scrub, scrubText } from "../log";
import { LocalUrlSigner } from "../storage/signer";
import { isTransientConnectError } from "../store/db";
import { evaluateAlarms } from "./alarms";
import { ByteBucket, MemoryLimiter, saltForEpoch, SALT_ROTATION_MS } from "./limiter";

describe("MemoryLimiter", () => {
  it("fixed window: melewati batas ditolak, window berikutnya mulai ulang", () => {
    let now = 1_000_000;
    const l = new MemoryLimiter(100, () => now);
    for (let i = 0; i < 3; i++) expect(l.take("k", 3, 10_000).ok).toBe(true);
    const over = l.take("k", 3, 10_000);
    expect(over.ok).toBe(false);
    expect(over.retryAfterSec).toBeGreaterThan(0);
    now += 10_000;
    expect(l.take("k", 3, 10_000).ok).toBe(true);
  });

  it("jumlah kunci dibatasi (memori terbatas) dan kunci terbaru tetap terhitung", () => {
    const l = new MemoryLimiter(50);
    for (let i = 0; i < 5_000; i++) l.take(`ip${i}`, 10, 60_000);
    expect(l.size).toBeLessThanOrEqual(50);
    for (let i = 0; i < 10; i++) l.take("hot", 10, 60_000);
    expect(l.take("hot", 10, 60_000).ok).toBe(false);
  });

  it("4 peserta satu NAT tidak terkena batas umum (dipakai 1 room + sambung ulang)", () => {
    const l = new MemoryLimiter();
    // 4 peserta × (join + session + 30 asset/attempt URL + sambung ulang) ≪ 900/menit.
    let ok = true;
    for (let i = 0; i < 4 * 60; i++) ok = ok && l.take("nat", 900, 60_000).ok;
    expect(ok).toBe(true);
  });
});

describe("salt hash IP berotasi", () => {
  it("salt berubah per epoch, stabil di dalam epoch, IP mentah tak muncul di hash", () => {
    const t0 = 5 * SALT_ROTATION_MS + 1000;
    const a = saltForEpoch("base", t0);
    expect(saltForEpoch("base", t0 + 60_000)).toBe(a);
    const b = saltForEpoch("base", t0 + SALT_ROTATION_MS);
    expect(b).not.toBe(a);
    expect(hashIp("203.0.113.9", a)).not.toBe(hashIp("203.0.113.9", b));
    expect(hashIp("203.0.113.9", a)).not.toContain("203.0.113.9");
  });
});

describe("ByteBucket", () => {
  it("burst diizinkan lalu ditahan sampai terisi ulang", () => {
    let now = 0;
    const b = new ByteBucket(1000, 2000, () => now);
    expect(b.take(2000)).toBe(true);
    expect(b.take(1)).toBe(false);
    now += 1000;
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(false);
  });
});

describe("scrubbing log (NFR-09, TC-SEC-041)", () => {
  it("kunci sensitif disamarkan, URL/DSN/token/IP di nilai disamarkan, UUID roomId tetap", () => {
    const out = scrub({
      roomId: "d39132ba-177d-4c8b-bff0-0b5ce2d517a6",
      displayName: "Nadia",
      token: "abc",
      signedUrl: "https://x/y?sig=1",
      message: "gagal https://h.neon.tech/db?sslmode=1 postgres://u:p@h/db dari 203.0.113.9 token Tm9wZUZha2VUb2tlbkJhc2U2NHVybFZhbHVlMTIzNDU2",
      count: 3,
    });
    expect(out.roomId).toBe("d39132ba-177d-4c8b-bff0-0b5ce2d517a6");
    expect(out.displayName).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.signedUrl).toBe("[redacted]");
    expect(out.count).toBe(3);
    const msg = String(out.message);
    expect(msg).not.toMatch(/neon\.tech|postgres:|203\.0\.113|Tm9wZUZha2U/);
  });

  it("errText membuang URL/rahasia dari pesan error pihak ketiga dan membatasi panjang", () => {
    const e = new Error(`connect ECONNREFUSED 10.0.0.5:5432 postgresql://app:hunter2secret@ep-x.neon.tech/db ${"z".repeat(900)}`);
    const t = errText(e);
    expect(t).not.toContain("hunter2secret");
    expect(t).not.toContain("10.0.0.5");
    expect(t.length).toBeLessThan(400);
    expect(scrubText("nak_live_00000000000000000000000000000000")).toBe("[redacted]");
  });
});

describe("metrics & alarm", () => {
  it("p95 dari observasi dan snapshot", () => {
    metrics.reset();
    for (let i = 1; i <= 100; i++) metrics.observe("cleanup_duration_ms", i);
    expect(metrics.percentile("cleanup_duration_ms", 95)).toBe(95);
    metrics.inc("x_total", 2);
    metrics.gauge("g", 7);
    expect(metrics.snapshot()).toMatchObject({ x_total: 2, g: 7, cleanup_duration_ms_p95: 95 });
    metrics.reset();
  });

  it("alarm: kenaikan counter kegagalan, orphan > 0, cleanup tak tuntas, skew p95 > 300", () => {
    expect(evaluateAlarms({ cleanup_failures_total: 1 }, { cleanup_failures_total: 1 })).toEqual([]);
    const names = evaluateAlarms(
      { cleanup_failures_total: 1 },
      { cleanup_failures_total: 3, storage_orphan_objects: 2, cleanup_unresolved: 1, capture_skew_ms_p95: 400, store_unavailable_total: 5 },
    ).map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["alarm.cleanup_failed", "alarm.storage_orphans", "alarm.cleanup_unresolved", "alarm.capture_skew", "alarm.store_unavailable"]));
  });
});

describe("kesalahan koneksi transien Neon", () => {
  it("cold start/putus dikenali; kesalahan SQL biasa tidak", () => {
    expect(isTransientConnectError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientConnectError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isTransientConnectError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isTransientConnectError(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
  });
});

describe("URL PUT lokal sekali pakai", () => {
  it("pemakaian kedua token yang sama ditolak; token kedaluwarsa tak bisa dipakai", () => {
    const s = new LocalUrlSigner("http://x", "secret");
    const url = s.sign({ k: "rooms/a/attempts/b/full.jpg", m: "PUT", e: Math.floor(Date.now() / 1000) + 60, ct: "image/jpeg", max: 100 });
    const token = url.split("/api/storage/")[1]!;
    expect(s.consume(token)).toBe(true);
    expect(s.consume(token)).toBe(false);
    const old = s.sign({ k: "rooms/a/x", m: "PUT", e: Math.floor(Date.now() / 1000) - 1, ct: "image/jpeg", max: 1 }).split("/api/storage/")[1]!;
    expect(s.consume(old)).toBe(false);
    expect(s.verify(token.slice(0, -2) + "xx")).toBeNull();
  });
});

describe("clientIp & TRUST_PROXY (anti-spoof XFF)", () => {
  const req = (xff: string | undefined, remote = "192.0.2.1") => ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote } }) as never;
  it("tanpa proxy tepercaya XFF diabaikan; dengan N proxy dipakai entri ke-N dari kanan; kiri (palsu) tak pernah dipakai", async () => {
    const { clientIp } = await import("../http/util");
    expect(clientIp(req("1.1.1.1"), 0)).toBe("192.0.2.1");
    expect(clientIp(req("evil, 198.51.100.9"), 1)).toBe("198.51.100.9");
    expect(clientIp(req("evil, 198.51.100.77, 10.0.0.1"), 2)).toBe("198.51.100.77");
    expect(clientIp(req(undefined), 1)).toBe("192.0.2.1");
    expect(clientIp(req("", "192.0.2.5"), 1)).toBe("192.0.2.5");
    expect(clientIp(req("only-one"), 3)).toBe("192.0.2.1"); // rantai lebih pendek dari jumlah proxy → jangan percaya
  });

  it("loadConfig: TRUST_PROXY true=1, angka=N, kosong/false=0, nilai aneh ditolak", async () => {
    const { loadConfig } = await import("../config");
    expect(loadConfig({}).trustProxy).toBe(0);
    expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: "2" }).trustProxy).toBe(2);
    expect(loadConfig({ TRUST_PROXY: "false" }).trustProxy).toBe(0);
    expect(() => loadConfig({ TRUST_PROXY: "banyak" })).toThrow();
  });
});
