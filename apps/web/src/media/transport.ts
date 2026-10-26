import type { RtcSignal, RtcSignalType } from "@longroll/shared";
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
  pendingCandidates: RTCIceCandidateInit[];
  status: PeerStatus;
  relay: boolean;
  createdAt: number;
  connectedOnce: boolean;
  failures: number;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  connectTimer: ReturnType<typeof setTimeout> | null;
}

export interface MeshOptions {
  selfId: string;
  /** Kirim sinyal volatile lewat WebSocket room. */
  signal: (type: RtcSignalType, payload: RtcSignal) => void;
  getIceServers: () => Promise<RTCIceServer[]>;
  onChange: () => void;
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
  /** Jejak debug (dev): jenis event saja, tanpa SDP/kandidat. */
  readonly trace: string[] = [];
  private log(msg: string) {
    if (process.env.NODE_ENV === "production") return;
    this.trace.push(`${Date.now() % 100000} ${msg}`);
    if (this.trace.length > 300) this.trace.shift();
  }

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
      if (peer) peer.failures = 0;
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
        await this.createPeer(from, "initial");
        return;
      }
      if (peer.polite) {
        // Peer impolite meminta ulang: cukup tunggu offer barunya.
        return;
      }
      if (peer.remotePcId === payload.pc && (peer.pc.connectionState === "connected" || peer.pc.connectionState === "connecting")) {
        peer.pc.restartIce();
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
      await this.onDescription(peer, payload.sdp!);
      return;
    }

    if (!peer) return;
    if (type === "rtc.answer") {
      if (payload.rpc && payload.rpc !== peer.pcId) return; // jawaban untuk PC lama
      peer.remotePcId = payload.pc;
      await this.onDescription(peer, payload.sdp!);
      return;
    }

    if (type === "rtc.ice") {
      if (payload.rpc && payload.rpc !== peer.pcId) return;
      if (peer.remotePcId && peer.remotePcId !== payload.pc) return;
      if (!payload.candidate) return;
      if (!peer.pc.remoteDescription) {
        peer.pendingCandidates.push(payload.candidate);
        return;
      }
      try {
        await peer.pc.addIceCandidate(payload.candidate);
      } catch {
        /* kandidat basi/ditolak saat ignoreOffer: abaikan */
      }
    }
  }

  close() {
    this.closed = true;
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
    if (type !== "rtc.ice") this.log(`out ${type} to=${peer.id.slice(0, 4)} pc=${peer.pcId.slice(0, 4)} rpc=${payload.rpc?.slice(0, 4)}`);
    this.opts.signal(type, payload);
  }

  private async createPeer(id: string, reason: "initial" | "from-offer" | "rebuild"): Promise<Peer | undefined> {
    if (this.closed) return;
    const iceServers = await this.opts.getIceServers().catch(() => [] as RTCIceServer[]);
    if (this.closed) return;
    const existing = this.peers.get(id);
    if (existing && reason !== "rebuild") return existing;
    const pc = new RTCPeerConnection({ iceServers });
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
      pendingCandidates: [],
      status: "connecting",
      relay: false,
      createdAt: Date.now(),
      connectedOnce: false,
      failures: existing?.failures ?? 0,
      disconnectTimer: null,
      connectTimer: null,
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
      this.send(peer, "rtc.ice", { candidate: candidate ? (candidate.toJSON() as RtcSignal["candidate"]) : null });
    };
    pc.ontrack = (ev) => {
      if (this.peers.get(id) !== peer) return;
      peer.stream = new MediaStream([ev.track]);
      if (!peer.transceiver) peer.transceiver = ev.transceiver;
      this.emit(id, peer.stream);
    };
    pc.onconnectionstatechange = () => this.onConnectionState(peer);
    pc.oniceconnectionstatechange = () => this.onConnectionState(peer);

    peer.connectTimer = setTimeout(() => {
      if (this.peers.get(id) === peer && peer.status === "connecting") {
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
    }
    return this.createPeer(id, fromOffer ? "from-offer" : "rebuild").then((p) => {
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
      const pending = peer.pendingCandidates.splice(0);
      for (const c of pending) await pc.addIceCandidate(c).catch(() => undefined);
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
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
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
        let selectedPairId: string | null = null;
        report.forEach((s) => {
          if (s.type === "transport" && s.selectedCandidatePairId) selectedPairId = s.selectedCandidatePairId as string;
        });
        report.forEach((s) => {
          const isSelected = selectedPairId ? s.id === selectedPairId : s.type === "candidate-pair" && s.nominated && s.state === "succeeded";
          if (s.type !== "candidate-pair" || !isSelected) return;
          if (typeof s.availableOutgoingBitrate === "number") minBps = Math.min(minBps ?? Infinity, s.availableOutgoingBitrate);
          const local = report.get(s.localCandidateId as string);
          peer.relay = local?.candidateType === "relay";
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
