import type { RtcSignal, RtcSignalType } from "@longroll/shared";
import { countCandidate, emptyCounts, turnTransports } from "./diagnose";
import type { CandType, PeerDiag } from "./diagnose";
import { rtcDebugEnabled } from "./debugFlag";
import { encodingFor, nextQuality } from "./quality";
import type { QualityState } from "./quality";

/**
 * Antarmuka transport media (13 §4). `publishLocal` menerima `MediaStreamTrack` generik sebagai titik
 * ekstensi DEC-076 (voice chat OPEN): P03 hanya mem-publish track VIDEO; tidak ada track audio.
 * Implementasi SFU kelak cukup memenuhi antarmuka yang sama.
 */
export interface MediaTransport {
  publishLocal(track: MediaStreamTrack | null): void;
  onRemoteTrack(cb: (participantId: string, stream: MediaStream | null) => void): () => void;
  setQuality(level: number): void;
}

export type PeerStatus = "connecting" | "connected" | "reconnecting" | "failed";

export interface PeerInfo {
  status: PeerStatus;
  stream: MediaStream | null;
  relay: boolean;
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  pcId: string;
  remotePcId: string | null;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  transceiver: RTCRtpTransceiver | null;
  stream: MediaStream | null;
  /** pcId lawan yang meminta offer baru (rtc.restart) saat offer kita masih berjalan. */
  restartPc: string | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  status: PeerStatus;
  relay: boolean;
  createdAt: number;
  connectedOnce: boolean;
  failures: number;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  connectTimer: ReturnType<typeof setTimeout> | null;
  diag: PeerDiagState;
}

/** Penghitung diagnostik per peer: hanya angka/jenis, tidak pernah SDP, alamat, atau kredensial. */
interface PeerDiagState {
  local: ReturnType<typeof emptyCounts>;
  remote: ReturnType<typeof emptyCounts>;
  signals: PeerDiag["signals"];
  iceErrors: PeerDiag["iceErrors"];
  selected: PeerDiag["selected"];
  media: PeerDiag["media"];
  rebuilds: number;
  events: string[];
}

const newDiagState = (rebuilds = 0): PeerDiagState => ({
  local: emptyCounts(),
  remote: emptyCounts(),
  signals: { offerOut: 0, offerIn: 0, answerOut: 0, answerIn: 0, iceOut: 0, iceIn: 0, restartOut: 0, restartIn: 0 },
  iceErrors: [],
  selected: null,
  media: null,
  rebuilds,
  events: [],
});

/** STUN publik cadangan bila daftar ICE dari server tak terjangkau (timeout/error): tanpa ini hanya kandidat host dan NAT mana pun gagal. */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

export interface IceMeta {
  source: "server" | "fallback-stun" | "none";
  fetchMs: number | null;
}

export interface MeshOptions {
  selfId: string;
  /** Kirim sinyal volatile lewat WebSocket room. */
  signal: (type: RtcSignalType, payload: RtcSignal) => void;
  getIceServers: () => Promise<RTCIceServer[]>;
  onChange: () => void;
  /** Uji TURN: true = hanya kandidat relay (butuh diagnostik aktif). Dibaca tiap membuat PC. */
  forceRelay?: () => boolean;
  /** Tes: konfigurasi waktu. */
  timings?: Partial<typeof DEFAULT_TIMINGS>;
}

const DEFAULT_TIMINGS = {
  /** 09 §5.2: `disconnected` 3 s → restartIce. */
  disconnectMs: 3_000,
  /** P03 §12: skeleton maks. 15 s sebelum state error. */
  connectTimeoutMs: 15_000,
  /** 09 §5.2: rebuild PC saat `failed` maks. 3×. */
  maxRebuilds: 3,
  statsIntervalMs: 2_000,
  /** Batas menunggu daftar ICE sebelum jatuh ke STUN cadangan: antrean transport serial, fetch menggantung memblokir SEMUA peer. */
  iceFetchMs: 6_000,
};

/** Peserta dengan participantId lebih kecil adalah pihak "impolite" yang membuat offer (09 §5). */
export function isPolite(selfId: string, peerId: string): boolean {
  return selfId > peerId;
}

function newPcId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

/** Metrik klien (13 §12): tanpa SDP, kandidat, atau data pribadi. */
export const rtcMetrics = { connectMs: [] as number[], failedTotal: 0, relayPeers: 0 };

/**
 * Full mesh (DEC-034): satu RTCPeerConnection per peer, satu transceiver video `sendrecv` per pasangan.
 * Hanya pihak impolite yang memulai offer; pola perfect negotiation tetap dipakai untuk renegosiasi
 * (ICE restart) agar aman terhadap tabrakan. `pc`/`rpc` membedakan PC baru setelah reload dari PC lama.
 */
export class MeshTransport implements MediaTransport {
  private readonly peers = new Map<string, Peer>();
  private readonly listeners = new Set<(participantId: string, stream: MediaStream | null) => void>();
  private localTrack: MediaStreamTrack | null = null;
  private quality: QualityState = { level: 0, goodStreak: 0 };
  private manualQuality: number | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly t: typeof DEFAULT_TIMINGS;
  /** Jejak debug (dev, atau produksi dengan ?rtcdebug=1): jenis event saja, tanpa SDP/kandidat/alamat. */
  readonly trace: string[] = [];
  private readonly debug = process.env.NODE_ENV !== "production" || rtcDebugEnabled();
  /** Sumber & lama pengambilan daftar ICE terakhir (untuk laporan diagnostik). */
  iceMeta: IceMeta = { source: "none", fetchMs: null };
  iceSummary = { stun: 0, turn: 0, turnTransports: [] as string[], policy: "all" as "all" | "relay" };
  private log(msg: string) {
    if (!this.debug) return;
    this.trace.push(`${Date.now() % 100000} ${msg}`);
    if (this.trace.length > 300) this.trace.shift();
  }
  /** Catat event per peer (ring 40) dengan waktu relatif sejak PC dibuat. */
  private note(peer: Peer, msg: string) {
    if (!this.debug) return;
    peer.diag.events.push(`+${Date.now() - peer.createdAt}ms ${msg}`);
    if (peer.diag.events.length > 40) peer.diag.events.shift();
  }

  /**
   * Kandidat ICE yang tiba sebelum deskripsi (offer/answer) PC pengirimnya diproses, atau sebelum peer ada: disimpan per `pc`
   * pengirim dan dimasukkan saat deskripsi dengan `pc` yang sama diterapkan. Sebelumnya kandidat seperti ini dibuang permanen
   * (pc tak cocok) dan satu sisi gagal tersambung.
   */
  private readonly earlyIce = new Map<string, { pc: string; c: RTCIceCandidateInit; at: number }[]>();
  private static readonly EARLY_ICE_MAX = 64;
  private static readonly EARLY_ICE_TTL_MS = 30_000;
  /** Tunggu jawaban atas offer yang sedang berjalan sebelum menuruti `rtc.restart` dengan membangun ulang PC. */
  private static readonly RESTART_GRACE_MS = 4_000;

  /** Semua operasi peer & sinyal diserialkan: urutan offer → ice terjaga walau ada rebuild async. */
  private tail: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(() => (this.closed ? (undefined as T) : fn()));
    this.tail = next.catch(() => undefined);
    return next;
  }

  constructor(private readonly opts: MeshOptions) {
    this.t = { ...DEFAULT_TIMINGS, ...opts.timings };
    this.statsTimer = setInterval(() => void this.sampleStats(), this.t.statsIntervalMs);
  }

  // ------------------------------------------------------------ API publik

  get qualityLevel() {
    return this.manualQuality ?? this.quality.level;
  }

  peerInfo(id: string): PeerInfo | null {
    const p = this.peers.get(id);
    return p ? { status: p.status, stream: p.stream, relay: p.relay } : null;
  }

  peerIds() {
    return Array.from(this.peers.keys());
  }

  onRemoteTrack(cb: (participantId: string, stream: MediaStream | null) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Ganti track lokal di semua peer tanpa renegosiasi (replaceTrack, 09 §2). null = kamera off. */
  publishLocal(track: MediaStreamTrack | null) {
    if (track && track.kind !== "video") return; // P03 video-only; audio = titik ekstensi DEC-076, tidak dipakai.
    this.localTrack = track;
    for (const peer of this.peers.values()) void this.attachLocal(peer);
  }

  setQuality(level: number) {
    this.manualQuality = level;
    for (const peer of this.peers.values()) void this.applyEncoding(peer);
  }

  /**
   * Samakan daftar peer dengan peserta lain yang terhubung. Peer RECONNECTING tidak ada di `connected`
   * tapi juga belum LEFT → PC dipertahankan (bisa pulih); peer yang benar-benar pergi ditutup.
   */
  sync(connected: string[], present: string[]) {
    void this.enqueue(async () => {
      const keep = new Set(present);
      for (const id of Array.from(this.peers.keys())) if (!keep.has(id)) this.closePeer(id);
      for (const id of connected) if (id !== this.opts.selfId && !this.peers.has(id)) await this.createPeer(id, "initial");
    });
  }

  /** Peer baru saja kembali CONNECTED (reload/reconnect): pihak impolite membangun ulang & offer. */
  peerReconnected(id: string) {
    void this.enqueue(async () => {
      const peer = this.peers.get(id);
      if (!peer) await this.createPeer(id, "initial");
      else if (!peer.polite) await this.rebuild(id, false);
    });
  }

  /**
   * Socket sinyal kita baru (re)open: sinyal yang dikirim selama socket tertutup hilang (server membuang
   * sinyal ke peserta tanpa socket). Peer yang belum tersambung dinegosiasikan ulang.
   */
  kick() {
    void this.enqueue(async () => {
      for (const peer of Array.from(this.peers.values())) {
        if (peer.status === "connected") continue;
        if (peer.polite) this.send(peer, "rtc.restart", {});
        else await this.rebuild(peer.id, true);
      }
    });
  }

  /** Paksa ICE restart (uji pemulihan TC-RTC-004; pihak polite meminta lewat sinyal). */
  restartIce(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (peer.polite) this.send(peer, "rtc.restart", {});
    else peer.pc.restartIce();
  }

  /** Tombol "Coba lagi" di kartu: reset hitungan & bangun ulang. */
  retry(id: string) {
    void this.enqueue(async () => {
      const peer = this.peers.get(id);
      if (peer) {
        peer.failures = 0;
        peer.status = "connecting"; // pengguna menekan "Coba lagi": tampilkan upaya baru
      }
      await this.rebuild(id, true);
    });
  }

  handleSignal(type: string, payload: RtcSignal) {
    return this.enqueue(() => this.processSignal(type, payload));
  }

  private async processSignal(type: string, payload: RtcSignal) {
    if (this.closed || !payload?.from || payload.from === this.opts.selfId) return;
    const cur = this.peers.get(payload.from);
    this.log(`in ${type} from=${payload.from.slice(0, 4)} pc=${payload.pc.slice(0, 4)} rpc=${payload.rpc?.slice(0, 4)} mine=${cur?.pcId.slice(0, 4)} remote=${cur?.remotePcId?.slice(0, 4)} sig=${cur?.pc.signalingState}`);
    const from = payload.from;
    let peer = this.peers.get(from);

    if (type === "rtc.restart") {
      if (!peer) {
        peer = await this.createPeer(from, "initial");
        if (peer) peer.diag.signals.restartIn++;
        return;
      }
      peer.diag.signals.restartIn++;
      if (peer.polite) {
        // Peer impolite meminta ulang: cukup tunggu offer barunya.
        return;
      }
      if (peer.remotePcId === payload.pc && (peer.pc.connectionState === "connected" || peer.pc.connectionState === "connecting")) {
        peer.pc.restartIce();
        return;
      }
      if (peer.remotePcId === null && peer.pc.signalingState === "have-local-offer") {
        // Offer kita masih menuju PC lawan (yang baru saja dibuat dan memang memintanya). Membuangnya sekarang membuat offer
        // dan kandidat saling silang di jaringan: satu sisi tersambung, sisi lain gagal. Tunggu jawabannya; bila tak datang, bangun ulang.
        const held = peer;
        held.restartPc = payload.pc;
        this.note(held, "restart ditunda: offer masih berjalan");
        if (held.restartTimer) clearTimeout(held.restartTimer);
        held.restartTimer = setTimeout(() => {
          held.restartTimer = null;
          void this.enqueue(async () => {
            if (this.peers.get(from) === held && held.remotePcId === null && held.restartPc) await this.rebuild(from, false);
          });
        }, MeshTransport.RESTART_GRACE_MS);
        return;
      }
      await this.rebuild(from, false);
      return;
    }

    if (type === "rtc.offer") {
      if (!peer) peer = await this.createPeer(from, "from-offer");
      else if (peer.remotePcId && peer.remotePcId !== payload.pc) peer = await this.rebuild(from, false, true);
      if (!peer) return;
      peer.remotePcId = payload.pc;
      peer.diag.signals.offerIn++;
      this.note(peer, "offer diterima");
      await this.onDescription(peer, payload.sdp!);
      await this.drainEarlyIce(peer, payload.pc);
      return;
    }

    if (!peer) {
      if (type === "rtc.ice" && payload.candidate) this.stashIce(from, payload.pc, payload.candidate);
      this.log(`${type} sebelum peer ada untuk ${from.slice(0, 4)}: ${type === "rtc.ice" ? "disimpan" : "dibuang"}`);
      return;
    }
    if (type === "rtc.answer") {
      if (payload.rpc && payload.rpc !== peer.pcId) return; // jawaban untuk PC lama
      if (peer.restartPc && peer.restartPc !== payload.pc) {
        // Jawaban dari PC lawan yang sudah diganti (ia me-restart dengan pc baru): tak berguna, bangun ulang.
        await this.rebuild(from, false);
        return;
      }
      peer.diag.signals.answerIn++;
      this.note(peer, "answer diterima");
      peer.restartPc = null;
      if (peer.restartTimer) clearTimeout(peer.restartTimer);
      peer.restartTimer = null;
      peer.remotePcId = payload.pc;
      await this.onDescription(peer, payload.sdp!);
      await this.drainEarlyIce(peer, payload.pc);
      return;
    }

    if (type === "rtc.ice") {
      if (payload.rpc && payload.rpc !== peer.pcId) return; // untuk PC kita yang lama
      if (!payload.candidate) return;
      peer.diag.signals.iceIn++;
      countCandidate(peer.diag.remote, payload.candidate.candidate);
      if (peer.remotePcId === payload.pc && peer.pc.remoteDescription) {
        try {
          await peer.pc.addIceCandidate(payload.candidate);
        } catch {
          /* kandidat basi/ditolak saat ignoreOffer: abaikan */
        }
        return;
      }
      // Deskripsi PC pengirim ini belum diterapkan (atau pc berbeda dari yang sedang dipakai): simpan sampai offer/answer-nya tiba.
      this.stashIce(from, payload.pc, payload.candidate);
    }
  }

  private stashIce(from: string, pc: string, c: RTCIceCandidateInit) {
    const now = Date.now();
    const list = (this.earlyIce.get(from) ?? []).filter((e) => now - e.at < MeshTransport.EARLY_ICE_TTL_MS);
    list.push({ pc, c, at: now });
    while (list.length > MeshTransport.EARLY_ICE_MAX) list.shift();
    this.earlyIce.set(from, list);
  }

  private async drainEarlyIce(peer: Peer, pc: string) {
    const list = this.earlyIce.get(peer.id);
    if (!list?.length || !peer.pc.remoteDescription) return;
    const mine = list.filter((e) => e.pc === pc);
    this.earlyIce.set(peer.id, list.filter((e) => e.pc !== pc));
    for (const e of mine) await peer.pc.addIceCandidate(e.c).catch(() => undefined);
    if (mine.length) this.note(peer, `kandidat awal dimasukkan: ${mine.length}`);
  }

  close() {
    this.closed = true;
    this.earlyIce.clear();
    if (this.statsTimer) clearInterval(this.statsTimer);
    for (const id of Array.from(this.peers.keys())) this.closePeer(id);
    this.listeners.clear();
  }

  // ------------------------------------------------------------ internal

  private emit(id: string, stream: MediaStream | null) {
    for (const cb of this.listeners) cb(id, stream);
    this.opts.onChange();
  }

  private send(peer: Peer, type: RtcSignalType, extra: Partial<RtcSignal>) {
    const payload: RtcSignal = { to: peer.id, pc: peer.pcId, ...extra } as RtcSignal;
    if (peer.remotePcId) payload.rpc = peer.remotePcId;
    const sg = peer.diag.signals;
    if (type === "rtc.offer") sg.offerOut++;
    else if (type === "rtc.answer") sg.answerOut++;
    else if (type === "rtc.ice") sg.iceOut++;
    else if (type === "rtc.restart") sg.restartOut++;
    if (type !== "rtc.ice") this.log(`out ${type} to=${peer.id.slice(0, 4)} pc=${peer.pcId.slice(0, 4)} rpc=${payload.rpc?.slice(0, 4)}`);
    this.opts.signal(type, payload);
  }

  /**
   * Daftar ICE dengan batas waktu. Gagal/timeout → STUN publik cadangan (bukan daftar kosong): dengan daftar kosong browser
   * hanya punya kandidat host dan koneksi lintas jaringan mustahil.
   */
  private async loadIceServers(): Promise<RTCIceServer[]> {
    const started = Date.now();
    try {
      const servers = await Promise.race([
        this.opts.getIceServers(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ice-timeout")), this.t.iceFetchMs)),
      ]);
      if (!Array.isArray(servers) || servers.length === 0) throw new Error("ice-empty");
      this.iceMeta = { source: "server", fetchMs: Date.now() - started };
      return servers;
    } catch (err) {
      this.iceMeta = { source: "fallback-stun", fetchMs: Date.now() - started };
      this.log(`ice servers gagal (${err instanceof Error ? err.message : "error"}): pakai STUN cadangan`);
      return FALLBACK_ICE_SERVERS;
    }
  }

  /** Snapshot diagnostik per peer (sanitasi: tanpa SDP/alamat/kredensial). */
  diagnostics(): PeerDiag[] {
    return Array.from(this.peers.values()).map((p) => {
      const track = p.stream?.getVideoTracks()[0] ?? null;
      return {
        peer: p.id.slice(0, 4),
        polite: p.polite,
        ageMs: Date.now() - p.createdAt,
        signalingState: p.pc.signalingState,
        iceGatheringState: p.pc.iceGatheringState,
        iceConnectionState: p.pc.iceConnectionState,
        connectionState: p.pc.connectionState,
        uiStatus: p.status,
        local: { ...p.diag.local },
        remote: { ...p.diag.remote },
        signals: { ...p.diag.signals },
        iceErrors: p.diag.iceErrors.slice(),
        track: { received: !!track, readyState: track?.readyState ?? null, muted: track ? track.muted : null },
        selected: p.diag.selected,
        media: p.diag.media,
        connectedOnce: p.connectedOnce,
        rebuilds: p.diag.rebuilds,
      };
    });
  }

  /** Event terakhir per peer (untuk laporan diagnostik). */
  peerEvents(id: string): string[] {
    return this.peers.get(id)?.diag.events.slice() ?? [];
  }

  private async createPeer(id: string, reason: "initial" | "from-offer" | "rebuild", carry?: Peer): Promise<Peer | undefined> {
    if (this.closed) return;
    const iceServers = await this.loadIceServers();
    if (this.closed) return;
    const existing = this.peers.get(id);
    if (existing && reason !== "rebuild") return existing;
    // Peer pengganti (rebuild) mewarisi riwayat PC sebelumnya: status "failed" tetap terlihat selama upaya otomatis berlanjut
    // (tombol "Coba lagi" tersedia, kartu tidak berkedip kembali ke "Menyambungkan…"), dan hitungan kegagalan/rebuild berlanjut.
    const prev = existing ?? carry;
    const policy: "all" | "relay" = this.opts.forceRelay?.() ? "relay" : "all";
    this.iceSummary = {
      stun: iceServers.filter((s) => [s.urls].flat().some((u) => /^stuns?:/i.test(u))).length,
      turn: iceServers.filter((s) => [s.urls].flat().some((u) => /^turns?:/i.test(u))).length,
      turnTransports: turnTransports(iceServers.flatMap((s) => [s.urls].flat())),
      policy,
    };
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
    const peer: Peer = {
      id,
      pc,
      pcId: newPcId(),
      remotePcId: null,
      polite: isPolite(this.opts.selfId, id),
      makingOffer: false,
      ignoreOffer: false,
      transceiver: null,
      stream: null,
      restartPc: null,
      restartTimer: null,
      status: prev?.status === "failed" ? "failed" : "connecting",
      relay: false,
      createdAt: Date.now(),
      connectedOnce: false,
      failures: prev?.failures ?? 0,
      disconnectTimer: null,
      connectTimer: null,
      diag: newDiagState(prev?.diag.rebuilds ?? 0),
    };
    this.peers.set(id, peer);
    this.log(`create ${id.slice(0, 4)} reason=${reason} pc=${peer.pcId.slice(0, 4)} polite=${peer.polite}`);

    pc.onnegotiationneeded = async () => {
      if (peer.polite || this.peers.get(id) !== peer) return; // hanya pihak impolite yang memulai offer
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.send(peer, "rtc.offer", { sdp: { type: "offer", sdp: pc.localDescription.sdp } });
      } catch {
        /* PC ditutup di tengah jalan */
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (this.peers.get(id) !== peer) return;
      if (candidate) countCandidate(peer.diag.local, candidate.candidate);
      else this.note(peer, `gathering selesai: host=${peer.diag.local.host} srflx=${peer.diag.local.srflx} relay=${peer.diag.local.relay}`);
      this.send(peer, "rtc.ice", { candidate: candidate ? (candidate.toJSON() as RtcSignal["candidate"]) : null });
    };
    pc.onicegatheringstatechange = () => this.note(peer, `iceGathering=${pc.iceGatheringState}`);
    pc.onsignalingstatechange = () => this.note(peer, `signaling=${pc.signalingState}`);
    pc.onicecandidateerror = (ev) => {
      const e = ev as RTCPeerConnectionIceErrorEvent;
      // Host server STUN/TURN saja (tanpa query/kredensial); alamat lokal (`address`) sengaja tidak disimpan.
      let host = "";
      try {
        host = new URL(e.url.replace(/^(stuns?|turns?):/i, "https://")).host;
      } catch {
        host = "";
      }
      if (peer.diag.iceErrors.length < 8) peer.diag.iceErrors.push({ code: e.errorCode, text: String(e.errorText ?? "").slice(0, 80), host });
      this.note(peer, `icecandidateerror ${e.errorCode} ${host}`);
    };
    pc.ontrack = (ev) => {
      if (this.peers.get(id) !== peer) return;
      this.note(peer, `track ${ev.track.kind} readyState=${ev.track.readyState} muted=${ev.track.muted}`);
      peer.stream = new MediaStream([ev.track]);
      if (!peer.transceiver) peer.transceiver = ev.transceiver;
      this.emit(id, peer.stream);
    };
    pc.onconnectionstatechange = () => this.onConnectionState(peer);
    pc.oniceconnectionstatechange = () => this.onConnectionState(peer);

    peer.connectTimer = setTimeout(() => {
      if (this.peers.get(id) === peer && peer.status === "connecting") {
        this.note(peer, `connect timeout ${this.t.connectTimeoutMs}ms`);
        peer.status = "failed";
        rtcMetrics.failedTotal++;
        this.opts.onChange();
      }
    }, this.t.connectTimeoutMs);

    if (!peer.polite) {
      peer.transceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      await this.attachLocal(peer);
    } else if (reason !== "from-offer") {
      // Pihak polite memberi tahu ia siap (atau baru di-reload) agar pihak impolite mengirim offer baru.
      this.send(peer, "rtc.restart", {});
    }
    this.opts.onChange();
    return peer;
  }

  private async rebuild(id: string, manual: boolean, fromOffer = false): Promise<Peer | undefined> {
    const old = this.peers.get(id);
    if (old) {
      this.teardown(old);
      this.peers.delete(id);
      if (!manual) old.failures++;
      old.diag.rebuilds++;
    }
    return this.createPeer(id, fromOffer ? "from-offer" : "rebuild", old).then((p) => {
      if (p && old) p.failures = manual ? 0 : old.failures;
      return p;
    });
  }

  private async onDescription(peer: Peer, sdp: RTCSessionDescriptionInit) {
    const pc = peer.pc;
    const offerCollision = sdp.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;
    try {
      await pc.setRemoteDescription(sdp);
      if (sdp.type === "offer") {
        if (!peer.transceiver) peer.transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === "video") ?? null;
        if (peer.transceiver) {
          peer.transceiver.direction = "sendrecv";
          await this.attachLocal(peer);
        }
        await pc.setLocalDescription();
        if (pc.localDescription) this.send(peer, "rtc.answer", { sdp: { type: "answer", sdp: pc.localDescription.sdp } });
      }
    } catch {
      /* deskripsi basi (PC sudah diganti) */
    }
  }

  private async attachLocal(peer: Peer) {
    const sender = peer.transceiver?.sender;
    if (!sender || peer.pc.signalingState === "closed") return;
    try {
      if (sender.track !== this.localTrack) await sender.replaceTrack(this.localTrack);
      await this.applyEncoding(peer);
    } catch {
      /* PC ditutup */
    }
  }

  private async applyEncoding(peer: Peer) {
    const sender = peer.transceiver?.sender;
    const track = this.localTrack;
    if (!sender || !track || peer.pc.signalingState === "closed") return;
    const settings = track.getSettings();
    const enc = encodingFor(this.qualityLevel, settings.width ?? 640, settings.height ?? 480);
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      Object.assign(params.encodings[0]!, enc);
      (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "maintain-framerate";
      await sender.setParameters(params);
    } catch {
      /* encodings belum siap sebelum negosiasi pertama: dicoba lagi saat terhubung */
    }
  }

  private onConnectionState(peer: Peer) {
    if (this.peers.get(peer.id) !== peer) return;
    const pc = peer.pc;
    this.log(`state ${peer.id.slice(0, 4)} pc=${peer.pcId.slice(0, 4)} conn=${pc.connectionState} ice=${pc.iceConnectionState}`);
    this.note(peer, `conn=${pc.connectionState} ice=${pc.iceConnectionState}`);
    const state = pc.connectionState;
    const ice = pc.iceConnectionState;
    if (state === "connected" || ice === "connected" || ice === "completed") {
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      peer.disconnectTimer = null;
      if (!peer.connectedOnce) {
        peer.connectedOnce = true;
        rtcMetrics.connectMs.push(Date.now() - peer.createdAt);
        void this.applyEncoding(peer);
      }
      if (peer.connectTimer) clearTimeout(peer.connectTimer);
      peer.status = "connected";
      peer.failures = 0;
    } else if (ice === "disconnected") {
      peer.status = "reconnecting";
      if (!peer.disconnectTimer) {
        peer.disconnectTimer = setTimeout(() => {
          peer.disconnectTimer = null;
          if (this.peers.get(peer.id) !== peer || pc.iceConnectionState !== "disconnected") return;
          if (peer.polite) this.send(peer, "rtc.restart", {});
          else pc.restartIce();
        }, this.t.disconnectMs);
      }
    } else if (state === "failed" || ice === "failed") {
      if (peer.failures >= this.t.maxRebuilds) {
        peer.status = "failed";
        rtcMetrics.failedTotal++;
      } else if (peer.polite) {
        peer.failures++;
        this.send(peer, "rtc.restart", {});
      } else {
        void this.enqueue(() => (this.peers.get(peer.id) === peer ? this.rebuild(peer.id, false) : undefined));
        return;
      }
    }
    this.opts.onChange();
  }

  private teardown(peer: Peer) {
    if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
    if (peer.connectTimer) clearTimeout(peer.connectTimer);
    if (peer.restartTimer) clearTimeout(peer.restartTimer);
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    peer.pc.onicegatheringstatechange = null;
    peer.pc.onsignalingstatechange = null;
    peer.pc.onicecandidateerror = null;
    try {
      peer.pc.close();
    } catch {
      /* sudah tertutup */
    }
  }

  private closePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.teardown(peer);
    this.peers.delete(id);
    this.emit(id, null);
  }

  /** Stats tiap 2 s: bitrate keluar terendah → level kualitas; jenis kandidat → rasio relay (TURN). */
  private async sampleStats() {
    if (this.closed || this.peers.size === 0) return;
    let minBps: number | null = null;
    let relayPeers = 0;
    for (const peer of this.peers.values()) {
      if (peer.status !== "connected") continue;
      try {
        const report = await peer.pc.getStats();
        let inBytes = 0;
        let inFrames = 0;
        let outBytes = 0;
        report.forEach((s) => {
          if (s.type === "inbound-rtp" && s.kind === "video") {
            inBytes += Number(s.bytesReceived ?? 0);
            inFrames += Number(s.framesDecoded ?? 0);
          } else if (s.type === "outbound-rtp" && s.kind === "video") outBytes += Number(s.bytesSent ?? 0);
        });
        peer.diag.media = { bytesReceived: inBytes, framesDecoded: inFrames, bytesSent: outBytes };
        let selectedPairId: string | null = null;
        report.forEach((s) => {
          if (s.type === "transport" && s.selectedCandidatePairId) selectedPairId = s.selectedCandidatePairId as string;
        });
        report.forEach((s) => {
          const isSelected = selectedPairId ? s.id === selectedPairId : s.type === "candidate-pair" && s.nominated && s.state === "succeeded";
          if (s.type !== "candidate-pair" || !isSelected) return;
          if (typeof s.availableOutgoingBitrate === "number") minBps = Math.min(minBps ?? Infinity, s.availableOutgoingBitrate);
          const local = report.get(s.localCandidateId as string);
          const remote = report.get(s.remoteCandidateId as string);
          peer.relay = local?.candidateType === "relay";
          peer.diag.selected = {
            local: (local?.candidateType as CandType | undefined) ?? "unknown",
            remote: (remote?.candidateType as CandType | undefined) ?? "unknown",
            proto: (local?.protocol as string | undefined) ?? null,
          };
        });
        if (peer.relay) relayPeers++;
      } catch {
        /* PC tertutup */
      }
    }
    rtcMetrics.relayPeers = relayPeers;
    if (this.manualQuality !== null) return;
    const before = this.quality.level;
    this.quality = nextQuality(this.quality, minBps);
    if (this.quality.level !== before) {
      for (const peer of this.peers.values()) void this.applyEncoding(peer);
      this.opts.onChange();
    }
  }
}
