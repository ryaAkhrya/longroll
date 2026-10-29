import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RtcSignal, RtcSignalType } from "@longroll/shared";
import { classifyCandidate, countCandidate, diagnosePeer, emptyCounts, turnTransports } from "../diagnose";
import type { PeerDiag } from "../diagnose";
import { FALLBACK_ICE_SERVERS, MeshTransport } from "../transport";

/**
 * Peer simulasi: `RTCPeerConnection` palsu yang meniru negosiasi (offer/answer), pertukaran kandidat ICE, dan hasil konektivitas
 * yang dikendalikan tes (langsung / hanya lewat relay / gagal). Membuktikan LOGIKA transport (urutan sinyal, rebuild, retry,
 * fallback ICE, diagnosis). TIDAK membuktikan konektivitas lintas NAT di jaringan nyata.
 */
type Mode = "direct" | "needs-relay" | "fail";
let mode: Mode = "direct";
const created: FakePC[] = [];
let seq = 0;

class FakeTrack {
  readyState = "live";
  muted = false;
  constructor(readonly kind: string) {}
}
class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

interface FakeTransceiver {
  sender: { track: unknown; replaceTrack(t: unknown): Promise<void>; getParameters(): { encodings: object[] }; setParameters(): Promise<void> };
  receiver: { track: FakeTrack };
  direction: string;
}

class FakePC {
  readonly id = ++seq;
  signalingState = "stable";
  iceConnectionState = "new";
  connectionState = "new";
  iceGatheringState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: { track: FakeTrack; transceiver: FakeTransceiver }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;
  onicecandidateerror: (() => void) | null = null;
  private tcv: FakeTransceiver[] = [];
  private remoteCandidates = 0;
  private gathered = false;
  readonly turn: boolean;
  readonly relayOnly: boolean;
  closed = false;

  constructor(readonly config: { iceServers?: { urls: string | string[] }[]; iceTransportPolicy?: string }) {
    created.push(this);
    this.turn = (config.iceServers ?? []).some((s) => [s.urls].flat().some((u) => /^turns?:/i.test(u)));
    this.relayOnly = config.iceTransportPolicy === "relay";
  }

  addTransceiver(kind: string, init: { direction: string }) {
    const t = this.makeTransceiver(kind, init.direction);
    queueMicrotask(() => this.onnegotiationneeded?.());
    return t;
  }
  private makeTransceiver(kind: string, direction: string): FakeTransceiver {
    const sender = {
      track: null as unknown,
      replaceTrack: async (tr: unknown) => {
        sender.track = tr;
      },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async () => undefined,
    };
    const t: FakeTransceiver = { sender, receiver: { track: new FakeTrack(kind) }, direction };
    this.tcv.push(t);
    return t;
  }
  getTransceivers() {
    return this.tcv;
  }
  async setLocalDescription(desc?: { type: string; sdp: string }) {
    const type = desc?.type ?? (this.signalingState === "have-remote-offer" ? "answer" : "offer");
    this.localDescription = { type, sdp: `fake-${this.id}` };
    this.signalingState = type === "offer" ? "have-local-offer" : "stable";
    this.onsignalingstatechange?.();
    this.gather();
    this.maybeConnect();
  }
  async setRemoteDescription(desc: { type: string; sdp: string }) {
    this.remoteDescription = desc;
    if (desc.type === "offer") {
      this.signalingState = "have-remote-offer";
      if (this.tcv.length === 0) this.makeTransceiver("video", "recvonly");
    } else {
      this.signalingState = "stable";
    }
    this.onsignalingstatechange?.();
    const t = this.tcv[0]!;
    this.ontrack?.({ track: t.receiver.track, transceiver: t });
    this.maybeConnect();
  }
  async addIceCandidate() {
    this.remoteCandidates++;
    this.maybeConnect();
  }
  restartIce() {
    this.gathered = false;
    queueMicrotask(() => this.onnegotiationneeded?.());
  }
  /** Kandidat lokal: host (kecuali relay-only), srflx bila ada STUN, relay bila ada TURN. Lalu akhir-kandidat. */
  private gather() {
    if (this.gathered) return;
    this.gathered = true;
    this.iceGatheringState = "gathering";
    const hasStun = (this.config.iceServers ?? []).some((s) => [s.urls].flat().some((u) => /^stuns?:/i.test(u)));
    const lines: string[] = [];
    if (!this.relayOnly) lines.push(`candidate:1 1 udp 2122 a${this.id}.local 5000 typ host`);
    if (!this.relayOnly && hasStun) lines.push("candidate:2 1 udp 1686 203.0.113.9 5001 typ srflx raddr 0.0.0.0 rport 0");
    if (this.turn) lines.push("candidate:3 1 udp 41 198.51.100.7 5002 typ relay raddr 0.0.0.0 rport 0");
    queueMicrotask(() => {
      for (const c of lines) this.onicecandidate?.({ candidate: { candidate: c, toJSON: () => ({ candidate: c, sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "u" }) } });
      this.iceGatheringState = "complete";
      this.onicegatheringstatechange?.();
      this.onicecandidate?.({ candidate: null });
    });
  }
  private maybeConnect() {
    if (this.closed || !this.localDescription || !this.remoteDescription || this.remoteCandidates === 0 || this.iceConnectionState === "connected") return;
    const ok = mode === "direct" || (mode === "needs-relay" && this.turn);
    this.iceConnectionState = ok ? "connected" : "checking";
    this.connectionState = ok ? "connected" : "connecting";
    setTimeout(() => {
      if (this.closed) return;
      this.oniceconnectionstatechange?.();
      this.onconnectionstatechange?.();
    }, 0);
    // Seperti browser nyata: ICE baru dinyatakan "failed" JAUH setelah batas tunggu UI (di sini 600 ms vs 300 ms).
    if (!ok && mode === "fail") {
      setTimeout(() => {
        if (this.closed) return;
        this.iceConnectionState = "failed";
        this.connectionState = "failed";
        this.oniceconnectionstatechange?.();
        this.onconnectionstatechange?.();
      }, 600);
    }
  }
  async getStats() {
    const m = new Map<string, Record<string, unknown>>();
    m.set("t", { type: "transport", selectedCandidatePairId: "p" });
    m.set("p", { type: "candidate-pair", localCandidateId: "l", remoteCandidateId: "r", availableOutgoingBitrate: 900_000 });
    m.set("l", { type: "local-candidate", candidateType: this.turn && mode === "needs-relay" ? "relay" : "host", protocol: "udp" });
    m.set("r", { type: "remote-candidate", candidateType: "host" });
    m.set("v", { type: "inbound-rtp", kind: "video", bytesReceived: 5000, framesDecoded: 30 });
    return m;
  }
  close() {
    this.closed = true;
    this.signalingState = "closed";
  }
}

beforeEach(() => {
  mode = "direct";
  created.length = 0;
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePC;
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeStream;
});
afterEach(() => {
  delete (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
});

const FAST = { disconnectMs: 50, connectTimeoutMs: 300, statsIntervalMs: 1_000_000, iceFetchMs: 120 };
const STUN = [{ urls: ["stun:stun.example:3478"] }];
const WITH_TURN = [...STUN, { urls: ["turn:turn.example:3478?transport=udp", "turns:turn.example:443?transport=tcp"], username: "u", credential: "c" }];

interface Node {
  id: string;
  t: MeshTransport;
}
/** Jaringan sinyal in-memory: meniru server (menambahkan `from`, asinkron, jatuh bila tujuan tak ada). */
function mesh(ids: string[], opts: { ice?: () => Promise<RTCIceServer[]>; forceRelay?: () => boolean } = {}) {
  const nodes = new Map<string, Node>();
  const log: string[] = [];
  /** Riwayat status UI per (node → peer), tanpa duplikat berurutan: untuk memastikan kartu tidak berkedip. */
  const hist = new Map<string, string[]>();
  const make = (id: string) => {
    const t = new MeshTransport({
      selfId: id,
      signal: (type: RtcSignalType, payload: RtcSignal) => {
        log.push(`${id}>${payload.to}:${type}`);
        setTimeout(() => nodes.get(payload.to)?.t.handleSignal(type, { ...payload, from: id }), 0);
      },
      getIceServers: opts.ice ?? (async () => STUN as RTCIceServer[]),
      onChange: () => {
        for (const p of nodes.get(id)?.t.peerIds() ?? []) {
          const st = nodes.get(id)?.t.peerInfo(p)?.status ?? "none";
          const h = hist.get(`${id}>${p}`) ?? [];
          if (h[h.length - 1] !== st) h.push(st);
          hist.set(`${id}>${p}`, h);
        }
      },
      forceRelay: opts.forceRelay,
      timings: FAST,
    });
    nodes.set(id, { id, t });
    return t;
  };
  for (const id of ids) make(id);
  const start = () => {
    for (const [id, n] of nodes) {
      const others = ids.filter((x) => x !== id);
      n.t.sync(others, others);
    }
  };
  return { nodes, log, hist, start, make };
}
const until = async (fn: () => boolean, ms = 3_000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const allConnected = (n: Node) => n.t.peerIds().length > 0 && n.t.peerIds().every((p) => n.t.peerInfo(p)?.status === "connected" && !!n.t.peerInfo(p)?.stream);

describe("diagnose (murni)", () => {
  it("klasifikasi kandidat: jenis, protokol, mDNS; tanpa alamat", () => {
    expect(classifyCandidate("candidate:1 1 udp 2122 abc.local 5000 typ host")).toEqual({ type: "host", proto: "udp", mdns: true });
    expect(classifyCandidate("a=candidate:2 1 tcp 1 1.2.3.4 9 typ srflx raddr 0.0.0.0 rport 0")).toEqual({ type: "srflx", proto: "tcp", mdns: false });
    expect(classifyCandidate("candidate:3 1 udp 41 5.6.7.8 5002 typ relay").type).toBe("relay");
    expect(classifyCandidate("sampah").type).toBe("unknown");
    const c = emptyCounts();
    countCandidate(c, "candidate:1 1 udp 2122 x.local 5000 typ host");
    countCandidate(c, "candidate:2 1 udp 1 1.2.3.4 9 typ srflx");
    expect(c).toMatchObject({ host: 1, srflx: 1, udp: 2, mdns: 1 });
    expect(JSON.stringify(c)).not.toMatch(/1\.2\.3\.4/);
  });

  it("transport TURN diringkas tanpa host/kredensial", () => {
    expect(turnTransports(["stun:a:1", "turn:t:3478?transport=udp", "turn:t:3478?transport=tcp", "turns:t:443?transport=tcp"])).toEqual(["tcp", "tls", "udp"]);
  });

  const base = (o: Partial<PeerDiag> = {}): PeerDiag => ({
    peer: "abcd",
    polite: false,
    ageMs: 20_000,
    signalingState: "have-local-offer",
    iceGatheringState: "complete",
    iceConnectionState: "checking",
    connectionState: "connecting",
    uiStatus: "connecting",
    local: { ...emptyCounts(), host: 1, srflx: 1, udp: 2 },
    remote: { ...emptyCounts(), host: 1, srflx: 1, udp: 2 },
    signals: { offerOut: 1, offerIn: 0, answerOut: 0, answerIn: 1, iceOut: 2, iceIn: 2, restartOut: 0, restartIn: 0 },
    iceErrors: [],
    track: { received: true, readyState: "live", muted: true },
    selected: null,
    media: null,
    connectedOnce: false,
    rebuilds: 0,
    ...o,
  });

  it("verdict: NAT simetris/CGNAT → butuh TURN bila belum ada", () => {
    const v = diagnosePeer(base({ iceConnectionState: "failed", uiStatus: "failed" }), { turnConfigured: false });
    expect(v.code).toBe("nat-traversal-failed");
    expect(v.needsTurn).toBe(true);
    expect(diagnosePeer(base({ iceConnectionState: "failed" }), { turnConfigured: true }).needsTurn).toBe(false);
  });
  it("verdict: hanya host (STUN diblokir)", () => {
    const v = diagnosePeer(base({ local: { ...emptyCounts(), host: 2, udp: 2 } }), { turnConfigured: false });
    expect(v.code).toBe("stun-blocked");
  });
  it("verdict: sinyal hilang (tanpa answer / tanpa kandidat peer)", () => {
    expect(diagnosePeer(base({ signals: { ...base().signals, answerIn: 0 } }), { turnConfigured: false }).code).toBe("no-answer");
    expect(diagnosePeer(base({ remote: emptyCounts() }), { turnConfigured: false }).code).toBe("no-remote-candidates");
  });
  it("verdict: tersambung langsung / relay / tanpa media / tak diputar", () => {
    const ok = base({ iceConnectionState: "connected", connectionState: "connected", media: { bytesReceived: 9, framesDecoded: 1, bytesSent: 9 } });
    expect(diagnosePeer({ ...ok, selected: { local: "srflx", remote: "srflx", proto: "udp" } }, { turnConfigured: false }).code).toBe("ok-direct");
    expect(diagnosePeer({ ...ok, selected: { local: "relay", remote: "host", proto: "udp" } }, { turnConfigured: true }).code).toBe("ok-relay");
    expect(diagnosePeer({ ...ok, media: { bytesReceived: 0, framesDecoded: 0, bytesSent: 9 } }, { turnConfigured: false }).code).toBe("no-media");
    expect(diagnosePeer(ok, { turnConfigured: false, playing: false }).code).toBe("track-not-playing");
  });
  it("verdict: tanpa kandidat lokal sama sekali", () => {
    expect(diagnosePeer(base({ local: emptyCounts() }), { turnConfigured: false }).code).toBe("no-local-candidates");
  });
});

describe("MeshTransport dengan peer simulasi", () => {
  it("2 peer: offer → answer → ICE → tersambung, track diterima, penghitung sinyal benar", async () => {
    const m = mesh(["a1", "b2"]);
    m.start();
    await until(() => [...m.nodes.values()].every(allConnected));
    // a1 < b2 → a1 impolite (offer), b2 polite (answer).
    const a = m.nodes.get("a1")!.t.diagnostics()[0]!;
    const b = m.nodes.get("b2")!.t.diagnostics()[0]!;
    expect(a.polite).toBe(false);
    expect(b.polite).toBe(true);
    expect(a.signals.offerOut).toBe(1);
    expect(a.signals.answerIn).toBe(1);
    expect(b.signals.offerIn).toBe(1);
    expect(b.signals.answerOut).toBe(1);
    expect(a.signals.iceOut).toBeGreaterThan(0);
    expect(a.remote.host + a.remote.srflx).toBeGreaterThan(0);
    expect(a.track.received).toBe(true);
    expect(diagnosePeer(a, { turnConfigured: false, playing: true }).code).toBe("ok-direct");
    for (const n of m.nodes.values()) n.t.close();
  });

  it("4 peer full mesh: setiap peserta terhubung ke 3 lainnya", async () => {
    const ids = ["p1", "p2", "p3", "p4"];
    const m = mesh(ids);
    m.start();
    await until(() => [...m.nodes.values()].every(allConnected), 5_000);
    for (const n of m.nodes.values()) expect(n.t.peerIds()).toHaveLength(3);
    // Hanya satu offer per pasangan (6 pasangan), tidak ada badai negosiasi.
    expect(m.log.filter((l) => l.endsWith(":rtc.offer"))).toHaveLength(6);
    for (const n of m.nodes.values()) n.t.close();
  });

  it("daftar ICE menggantung → timeout lalu STUN cadangan; peer tetap terbentuk (antrean tidak terblokir)", async () => {
    const hang = () => new Promise<RTCIceServer[]>(() => undefined);
    const m = mesh(["a1", "b2"], { ice: hang });
    m.start();
    await until(() => [...m.nodes.values()].every(allConnected), 4_000);
    const t = m.nodes.get("a1")!.t;
    expect(t.iceMeta.source).toBe("fallback-stun");
    expect(created[0]!.config.iceServers).toEqual(FALLBACK_ICE_SERVERS);
    for (const n of m.nodes.values()) n.t.close();
  });

  it("daftar ICE error → STUN cadangan, bukan daftar kosong", async () => {
    const m = mesh(["a1", "b2"], { ice: async () => Promise.reject(new Error("net")) });
    m.start();
    await until(() => [...m.nodes.values()].every(allConnected), 4_000);
    expect(created.every((pc) => (pc.config.iceServers ?? []).length > 0)).toBe(true);
    for (const n of m.nodes.values()) n.t.close();
  });

  it("jaringan memblokir koneksi langsung: UI 'failed' dalam batas waktu + verdict butuh TURN; retry setelah jaringan pulih", async () => {
    mode = "fail";
    const m = mesh(["a1", "b2"]);
    m.start();
    const a = m.nodes.get("a1")!.t;
    await until(() => a.peerInfo("b2")?.status === "failed");
    // Upaya otomatis (rebuild) berjalan terus, tetapi kartu TIDAK kembali ke "connecting" setelah gagal (tombol "Coba lagi" tetap ada).
    await new Promise((r) => setTimeout(r, 1_800));
    const seen = m.hist.get("a1>b2")!;
    expect(seen.slice(seen.indexOf("failed"))).toEqual(["failed"]);
    expect(a.diagnostics()[0]!.rebuilds).toBeGreaterThan(0);
    const d = a.diagnostics()[0]!;
    expect(diagnosePeer(d, { turnConfigured: false }).needsTurn).toBe(true);
    mode = "direct";
    a.retry("b2");
    await until(() => allConnected(m.nodes.get("a1")!) && allConnected(m.nodes.get("b2")!), 4_000);
    for (const n of m.nodes.values()) n.t.close();
  });

  it("fallback TURN: tanpa TURN gagal, dengan TURN tersambung lewat relay", async () => {
    mode = "needs-relay";
    const noTurn = mesh(["a1", "b2"]);
    noTurn.start();
    await until(() => noTurn.nodes.get("a1")!.t.peerInfo("b2")?.status === "failed");
    for (const n of noTurn.nodes.values()) n.t.close();

    const withTurn = mesh(["c1", "d2"], { ice: async () => WITH_TURN as RTCIceServer[] });
    withTurn.start();
    await until(() => [...withTurn.nodes.values()].every(allConnected), 4_000);
    const t = withTurn.nodes.get("c1")!.t;
    expect(t.iceSummary).toMatchObject({ stun: 1, turn: 1, turnTransports: ["tls", "udp"] });
    await new Promise((r) => setTimeout(r, 0));
    for (const n of withTurn.nodes.values()) n.t.close();
  });

  it("paksa relay (uji TURN): tanpa TURN → tak ada kandidat → failed; dengan TURN → tersambung", async () => {
    mode = "needs-relay";
    const bad = mesh(["a1", "b2"], { forceRelay: () => true });
    bad.start();
    await until(() => bad.nodes.get("a1")!.t.peerInfo("b2")?.status === "failed");
    const d = bad.nodes.get("a1")!.t.diagnostics()[0]!;
    expect(created[0]!.config.iceTransportPolicy).toBe("relay");
    expect(d.local.host + d.local.srflx).toBe(0);
    expect(diagnosePeer(d, { turnConfigured: false, forceRelay: true }).code).toBe("relay-unavailable");
    for (const n of bad.nodes.values()) n.t.close();

    const good = mesh(["c1", "d2"], { forceRelay: () => true, ice: async () => WITH_TURN as RTCIceServer[] });
    good.start();
    await until(() => [...good.nodes.values()].every(allConnected), 4_000);
    expect(good.nodes.get("c1")!.t.iceSummary.policy).toBe("relay");
    for (const n of good.nodes.values()) n.t.close();
  });

  it("reload satu peserta: PC dibangun ulang, video pulih, dan PC lama ditutup", async () => {
    const m = mesh(["a1", "b2"]);
    m.start();
    await until(() => [...m.nodes.values()].every(allConnected));
    // b2 "reload": transport lama ditutup, instans baru dibuat; a1 melihat b2 CONNECTED lagi.
    m.nodes.get("b2")!.t.close();
    const b2 = m.make("b2");
    b2.sync(["a1"], ["a1"]);
    m.nodes.get("a1")!.t.peerReconnected("b2");
    await until(() => allConnected(m.nodes.get("b2")!) && allConnected(m.nodes.get("a1")!), 4_000);
    expect(created.filter((pc) => pc.closed).length).toBeGreaterThan(0);
    for (const n of m.nodes.values()) n.t.close();
  });

  it("sinyal ICE tanpa peer dijatuhkan tanpa error (race saat join)", async () => {
    const m = mesh(["a1", "b2"]);
    const t = m.nodes.get("b2")!.t;
    await expect(t.handleSignal("rtc.ice", { to: "b2", pc: "x", from: "a1", candidate: { candidate: "candidate:1 1 udp 1 x.local 1 typ host", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "u" } } as RtcSignal)).resolves.toBeUndefined();
    expect(t.peerIds()).toHaveLength(0);
    t.close();
  });
});
