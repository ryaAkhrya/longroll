/**
 * Diagnostik WebRTC aman: hanya jumlah/jenis kandidat, state, dan penghitung sinyal. Tidak pernah memuat SDP, alamat IP,
 * kredensial TURN, token, atau nama pengguna. Fungsi di file ini murni (mudah diuji); pengumpulan data ada di transport.ts.
 */
export type CandType = "host" | "srflx" | "prflx" | "relay" | "unknown";
export type CandCounts = Record<CandType, number> & { udp: number; tcp: number; mdns: number };

export const emptyCounts = (): CandCounts => ({ host: 0, srflx: 0, prflx: 0, relay: 0, unknown: 0, udp: 0, tcp: 0, mdns: 0 });

/**
 * Jenis kandidat dari string `candidate:` (RFC 5245): "... <addr> <port> typ srflx ...".
 * Alamat sengaja TIDAK dikembalikan; hanya apakah host-nya nama mDNS (.local) untuk membedakan host tersamar.
 */
export function classifyCandidate(line: string): { type: CandType; proto: "udp" | "tcp" | null; mdns: boolean } {
  const parts = line.trim().replace(/^a=/, "").replace(/^candidate:/, "").split(/\s+/);
  const typ = /\styp\s+(host|srflx|prflx|relay)\b/.exec(` ${parts.join(" ")}`)?.[1] as CandType | undefined;
  const proto = parts[2]?.toLowerCase();
  return {
    type: typ ?? "unknown",
    proto: proto === "udp" || proto === "tcp" ? proto : null,
    mdns: (parts[4] ?? "").endsWith(".local"),
  };
}

export function countCandidate(c: CandCounts, line: string) {
  const k = classifyCandidate(line);
  c[k.type]++;
  if (k.proto) c[k.proto]++;
  if (k.mdns) c.mdns++;
}

export interface PeerDiag {
  /** 4 karakter pertama id peserta. */
  peer: string;
  polite: boolean;
  ageMs: number;
  signalingState: string;
  iceGatheringState: string;
  iceConnectionState: string;
  connectionState: string;
  uiStatus: string;
  local: CandCounts;
  remote: CandCounts;
  signals: { offerOut: number; offerIn: number; answerOut: number; answerIn: number; iceOut: number; iceIn: number; restartOut: number; restartIn: number };
  iceErrors: { code: number; text: string; host: string }[];
  track: { received: boolean; readyState: string | null; muted: boolean | null };
  selected: { local: CandType; remote: CandType; proto: string | null } | null;
  media: { bytesReceived: number; framesDecoded: number; bytesSent: number } | null;
  connectedOnce: boolean;
  rebuilds: number;
}

export interface Verdict {
  code:
    | "ok-direct"
    | "ok-relay"
    | "no-local-candidates"
    | "stun-blocked"
    | "no-answer"
    | "no-remote-candidates"
    | "nat-traversal-failed"
    | "no-media"
    | "track-not-playing"
    | "connecting"
    | "ice-failed-with-relay"
    | "relay-unavailable";
  text: string;
  needsTurn: boolean;
}

/** Hipotesis penyebab dari data yang ada. Bukan bukti mutlak: dipakai untuk mengarahkan pemeriksaan. */
export function diagnosePeer(d: PeerDiag, opts: { turnConfigured: boolean; playing?: boolean; forceRelay?: boolean }): Verdict {
  const failed = d.iceConnectionState === "failed" || d.connectionState === "failed" || d.uiStatus === "failed";
  const connected = d.iceConnectionState === "connected" || d.iceConnectionState === "completed" || d.connectionState === "connected";

  if (connected) {
    const relayed = d.selected?.local === "relay" || d.selected?.remote === "relay";
    if (d.media && d.media.bytesReceived === 0 && d.ageMs > 8_000) {
      return { code: "no-media", text: "ICE tersambung tetapi tidak ada byte video diterima: periksa kamera sisi pengirim atau track yang belum dipublish.", needsTurn: false };
    }
    if (d.track.received && opts.playing === false) {
      return { code: "track-not-playing", text: "Track diterima tetapi video belum diputar (autoplay/format). Bukan masalah jaringan.", needsTurn: false };
    }
    return relayed
      ? { code: "ok-relay", text: "Tersambung lewat relay (TURN).", needsTurn: false }
      : { code: "ok-direct", text: "Tersambung langsung (tanpa relay).", needsTurn: false };
  }

  const gatherDone = d.iceGatheringState === "complete";
  if (opts.forceRelay && d.local.relay === 0 && (gatherDone || d.ageMs > 8_000)) {
    return {
      code: "relay-unavailable",
      text: "Mode paksa-relay aktif tetapi tidak ada kandidat relay: TURN belum dikonfigurasi, tak terjangkau, atau kredensial/port salah. Cek TURN_URLS/TURN_CREDENTIALS_URL di server.",
      needsTurn: !opts.turnConfigured,
    };
  }
  if (gatherDone && d.local.host + d.local.srflx + d.local.prflx + d.local.relay === 0) {
    return { code: "no-local-candidates", text: "Tidak ada kandidat ICE lokal: WebRTC diblokir (kebijakan browser/ekstensi/VPN) atau tidak ada antarmuka jaringan.", needsTurn: false };
  }
  if (d.signals.offerOut > 0 && d.signals.answerIn === 0 && !d.polite && d.ageMs > 8_000) {
    return { code: "no-answer", text: "Offer terkirim tetapi tidak ada jawaban: sinyal tidak sampai ke peer (peer offline/belum siap) atau dijatuhkan server.", needsTurn: false };
  }
  if (d.remote.host + d.remote.srflx + d.remote.prflx + d.remote.relay === 0 && d.ageMs > 8_000) {
    return { code: "no-remote-candidates", text: "Tidak ada kandidat ICE dari peer: sinyal ICE peer tidak sampai, atau peer tidak punya jaringan yang bisa dipakai.", needsTurn: false };
  }
  if (failed || d.ageMs > 15_000) {
    if (gatherDone && d.local.srflx === 0 && d.local.relay === 0) {
      return {
        code: "stun-blocked",
        text: "Hanya kandidat host, tanpa kandidat publik (srflx): UDP ke server STUN diblokir atau STUN tidak terjangkau. Butuh TURN (idealnya TLS/443).",
        needsTurn: !opts.turnConfigured,
      };
    }
    if (d.local.relay > 0) {
      return { code: "ice-failed-with-relay", text: "Gagal walau ada kandidat relay: periksa kredensial/port TURN dan kandidat relay sisi peer.", needsTurn: false };
    }
    return {
      code: "nat-traversal-failed",
      text: "Kandidat ada di kedua sisi tetapi koneksi langsung gagal: pola khas NAT simetris/CGNAT/firewall. Butuh relay TURN.",
      needsTurn: !opts.turnConfigured,
    };
  }
  return { code: "connecting", text: "Masih menyambung.", needsTurn: false };
}

export interface DiagReport {
  generatedAt: string;
  app: string;
  browser: string;
  network: { effectiveType: string | null; online: boolean };
  ice: { stun: number; turn: number; turnTransports: string[]; source: "server" | "fallback-stun" | "none"; policy: "all" | "relay"; fetchMs: number | null };
  socket: string;
  peers: (PeerDiag & { verdict: Verdict; playing: boolean | null })[];
  events: string[];
}

/** Ringkas jenis transport dari URL TURN (tanpa host/kredensial). */
export function turnTransports(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    if (!/^turns?:/i.test(u)) continue;
    const tls = /^turns:/i.test(u);
    const t = /transport=(udp|tcp)/i.exec(u)?.[1]?.toLowerCase();
    out.add(tls ? "tls" : (t ?? "udp"));
  }
  return [...out].sort();
}

/** Nama browser kasar (tanpa versi lengkap/UA mentah). */
export function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/(CriOS|Chrome)\//.test(ua)) return /Mobile|Android/.test(ua) ? "Chrome mobile" : "Chrome";
  if (/Safari\//.test(ua)) return /iPhone|iPad/.test(ua) ? "Safari iOS" : "Safari";
  return "lain";
}
