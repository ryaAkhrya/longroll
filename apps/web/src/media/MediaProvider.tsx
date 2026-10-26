"use client";

import { DEFAULT_CAMERA_PRESENTATION } from "@longroll/shared";
import type { CameraPresentation, CameraState, RtcSignal, RtcSignalType } from "@longroll/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/room/api";
import type { RoomClient } from "@/room/client";
import { useRoomState } from "@/room/hooks";
import {
  CameraError,
  cameraPermissionGranted,
  getPreferredDeviceId,
  listCameras,
  openCamera,
  setPreferredDeviceId,
  stopStream,
} from "./camera";
import type { Facing } from "./camera";
import { MeshTransport } from "./transport";
import type { PeerInfo } from "./transport";

export type LocalStatus = "idle" | "starting" | "live" | "off" | "ended" | "denied" | "unavailable" | "in_use" | "unsupported";

export interface LocalCamera {
  status: LocalStatus;
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  facing: Facing;
  mirrored: boolean;
  presentation: CameraPresentation;
  /** 0 = penuh; > 0 = kualitas diturunkan (badge hanya untuk pemilik). */
  quality: number;
  /** Pengguna memilih masuk tanpa kamera (DEC-068). */
  skipped: boolean;
}

export interface MediaApi {
  local: LocalCamera;
  remote: (participantId: string) => PeerInfo | null;
  enable: (opts?: { deviceId?: string | null }) => Promise<void>;
  disable: () => void;
  skip: () => void;
  switchDevice: (deviceId: string) => Promise<void>;
  flip: () => Promise<void>;
  setMirrored: (mirrored: boolean) => void;
  setPresentation: (cp: CameraPresentation) => void;
  resetPresentation: () => void;
  retryPeer: (participantId: string) => void;
}

const noop = () => undefined;
const noopAsync = async () => undefined;

/** Dipakai di luar room (pratinjau dev/katalog): tanpa kamera, tanpa peer. */
const NO_MEDIA: MediaApi = {
  local: {
    status: "idle",
    stream: null,
    devices: [],
    deviceId: null,
    facing: "user",
    mirrored: false,
    presentation: DEFAULT_CAMERA_PRESENTATION,
    quality: 0,
    skipped: true,
  },
  remote: () => null,
  enable: noopAsync,
  disable: noop,
  skip: noop,
  switchDevice: noopAsync,
  flip: noopAsync,
  setMirrored: noop,
  setPresentation: noop,
  resetPresentation: noop,
  retryPeer: noop,
};

const MediaContext = createContext<MediaApi>(NO_MEDIA);

export function useMedia(): MediaApi {
  return useContext(MediaContext);
}

/** Status lokal → `presence.camera` (14 §3). */
export function presenceCamera(status: LocalStatus, inCheck: boolean): CameraState {
  switch (status) {
    case "live":
      return "live";
    case "starting":
      return "permission";
    case "off":
    case "ended":
      return "off";
    case "in_use":
      return "in_use";
    case "idle":
      return inCheck ? "permission" : "none";
    default:
      return "none";
  }
}

const SEND_PRESENTATION_DEBOUNCE_MS = 150;
const autoKey = (roomId: string) => `lr:camOn:${roomId}`;

function readAuto(roomId: string) {
  try {
    return sessionStorage.getItem(autoKey(roomId)) === "1";
  } catch {
    return false;
  }
}
function writeAuto(roomId: string, on: boolean) {
  try {
    if (on) sessionStorage.setItem(autoKey(roomId), "1");
    else sessionStorage.removeItem(autoKey(roomId));
  } catch {
    /* abaikan */
  }
}

/**
 * Pemilik kamera lokal + transport mesh untuk satu room. Semua kontrol kamera hanya bekerja di perangkat
 * ini; tidak ada pesan jaringan yang bisa menyalakan/mengganti/mematikan kamera klien lain (REQ-CAM-13).
 */
export function MediaProvider({ client, code, inCheck, children }: { client: RoomClient; code: string; inCheck: boolean; children: ReactNode }) {
  const state = useRoomState(client);
  const me = state.me;
  const room = state.room;
  const [local, setLocal] = useState<LocalCamera>({
    status: "idle",
    stream: null,
    devices: [],
    deviceId: null,
    facing: "user",
    mirrored: true,
    presentation: DEFAULT_CAMERA_PRESENTATION,
    quality: 0,
    skipped: false,
  });
  const localRef = useRef(local);
  useEffect(() => {
    localRef.current = local;
  });
  const [tick, setTick] = useState(0);
  const [transport, setTransport] = useState<MeshTransport | null>(null);
  const iceRef = useRef<{ at: number; ttl: number; servers: RTCIceServer[] } | null>(null);

  // ------------------------------------------------------------ transport
  useEffect(() => {
    if (!me) return;
    const t = new MeshTransport({
      selfId: me,
      signal: (type: RtcSignalType, payload: RtcSignal) => {
        client.sendVolatile(type, payload);
      },
      getIceServers: async () => {
        const cached = iceRef.current;
        if (cached && Date.now() - cached.at < (cached.ttl * 1000) / 2) return cached.servers;
        const res = await api.iceServers(code);
        iceRef.current = { at: Date.now(), ttl: res.ttlSec, servers: res.iceServers };
        return res.iceServers;
      },
      onChange: () => {
        setTick((n) => n + 1);
        const q = t.qualityLevel;
        if (q !== localRef.current.quality) setLocal((l) => ({ ...l, quality: q }));
      },
    });
    const off = client.onSignal((type, payload) => {
      if (type.startsWith("rtc.")) void t.handleSignal(type, payload as RtcSignal);
    });
    setTransport(t);
    // Kait uji E2E (dev saja): memicu ICE restart / rebuild dan membaca status peer. Tanpa SDP/kandidat.
    const w = window as unknown as { __lrMedia?: unknown };
    if (process.env.NODE_ENV !== "production") {
      w.__lrMedia = {
        restartIce: (id: string) => t.restartIce(id),
        retry: (id: string) => t.retry(id),
        status: () => Object.fromEntries(t.peerIds().map((id) => [id, t.peerInfo(id)?.status])),
        quality: () => t.qualityLevel,
        trace: () => t.trace.slice(),
      };
    }
    return () => {
      off();
      t.close();
      if (process.env.NODE_ENV !== "production") delete w.__lrMedia;
      setTransport(null);
    };
  }, [client, code, me]);

  // Track lokal → semua peer (replaceTrack, tanpa renegosiasi).
  useEffect(() => {
    if (!transport) return;
    const track = local.status === "live" ? (local.stream?.getVideoTracks()[0] ?? null) : null;
    transport.publishLocal(track);
  }, [transport, local.status, local.stream]);

  // Daftar peer mengikuti presence room; peer yang kembali CONNECTED memicu negosiasi ulang.
  const prevConn = useRef(new Map<string, string>());
  // Socket (re)open → negosiasi ulang peer yang belum tersambung (sinyal saat socket tertutup hilang).
  const wasOpen = useRef(false);
  const everOpen = useRef(false);
  useEffect(() => {
    const open = state.status === "open";
    if (open && !wasOpen.current && everOpen.current) transport?.kick();
    if (open) everOpen.current = true;
    wasOpen.current = open;
  }, [state.status, transport]);

  useEffect(() => {
    if (!transport || !room || !me || state.status !== "open") return;
    const others = room.participants.filter((p) => p.participantId !== me);
    const connected = others.filter((p) => p.connection === "CONNECTED").map((p) => p.participantId);
    const present = others.filter((p) => p.connection !== "LEFT").map((p) => p.participantId);
    for (const p of others) {
      const before = prevConn.current.get(p.participantId);
      if (before === "RECONNECTING" && p.connection === "CONNECTED") transport.peerReconnected(p.participantId);
      prevConn.current.set(p.participantId, p.connection);
    }
    transport.sync(connected, present);
  }, [transport, room, me, state.status]);

  // ------------------------------------------------------------ presence
  const sentCamera = useRef<CameraState | null>(null);
  const cameraNow = presenceCamera(local.status, inCheck && !local.skipped);
  useEffect(() => {
    if (state.status !== "open") {
      sentCamera.current = null;
      return;
    }
    if (sentCamera.current === cameraNow) return;
    sentCamera.current = cameraNow;
    void client.sendIntent("presence.set", { camera: cameraNow, mirrored: localRef.current.mirrored });
  }, [client, cameraNow, state.status]);

  // Ambil cermin & framing tersimpan dari server sekali (reload mempertahankan pengaturan pemilik).
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !room || !me) return;
    const mine = room.participants.find((p) => p.participantId === me);
    if (!mine) return;
    adopted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sinkron satu kali dari snapshot server
    setLocal((l) => ({ ...l, mirrored: mine.mirrored || l.mirrored, presentation: mine.cameraPresentation }));
  }, [room, me]);

  // ------------------------------------------------------------ kamera lokal
  const attachTrackEvents = useCallback((stream: MediaStream) => {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    track.addEventListener("ended", () => {
      if (localRef.current.stream !== stream) return;
      setLocal((l) => ({ ...l, status: "ended", stream: null }));
    });
  }, []);

  const refreshDevices = useCallback(async () => {
    const devices = await listCameras().catch(() => []);
    setLocal((l) => ({ ...l, devices }));
  }, []);

  const enable = useCallback(
    async (opts: { deviceId?: string | null } = {}) => {
      const cur = localRef.current;
      setLocal((l) => ({ ...l, status: "starting", skipped: false }));
      try {
        const deviceId = opts.deviceId !== undefined ? opts.deviceId : (cur.deviceId ?? getPreferredDeviceId());
        const stream = await openCamera({ deviceId, facing: cur.facing });
        stopStream(cur.stream);
        attachTrackEvents(stream);
        const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
        const facing = (settings.facingMode as Facing | undefined) ?? cur.facing;
        setLocal((l) => ({ ...l, status: "live", stream, deviceId: settings.deviceId ?? deviceId ?? null }));
        if (settings.deviceId) setPreferredDeviceId(settings.deviceId);
        if (room) writeAuto(room.roomId, true);
        void refreshDevices();
        if (facing !== cur.facing) setLocal((l) => ({ ...l, facing }));
      } catch (err) {
        const kind = err instanceof CameraError ? err.kind : "in_use";
        setLocal((l) => ({ ...l, status: kind, stream: null }));
      }
    },
    [attachTrackEvents, refreshDevices, room],
  );

  const disable = useCallback(() => {
    stopStream(localRef.current.stream);
    if (room) writeAuto(room.roomId, false);
    setLocal((l) => ({ ...l, status: "off", stream: null }));
  }, [room]);

  const skip = useCallback(() => {
    stopStream(localRef.current.stream);
    setLocal((l) => ({ ...l, status: "idle", stream: null, skipped: true }));
  }, []);

  /** Ganti device: ambil track baru dulu, replaceTrack, baru hentikan yang lama (09 §2). */
  const switchDevice = useCallback(
    async (deviceId: string) => {
      const cur = localRef.current;
      if (cur.status !== "live") return enable({ deviceId });
      try {
        const stream = await openCamera({ deviceId });
        attachTrackEvents(stream);
        const old = cur.stream;
        setLocal((l) => ({ ...l, stream, deviceId }));
        setPreferredDeviceId(deviceId);
        setTimeout(() => stopStream(old), 300);
      } catch (err) {
        const kind = err instanceof CameraError ? err.kind : "in_use";
        setLocal((l) => ({ ...l, status: kind }));
      }
    },
    [attachTrackEvents, enable],
  );

  /** Mobile: depan ↔ belakang via facingMode. Cermin default mengikuti kamera depan (09 §3). */
  const flip = useCallback(async () => {
    const cur = localRef.current;
    const facing: Facing = cur.facing === "user" ? "environment" : "user";
    try {
      // Hentikan dulu: banyak HP tidak bisa membuka dua kamera sekaligus.
      stopStream(cur.stream);
      const stream = await openCamera({ facing });
      attachTrackEvents(stream);
      const mirrored = facing === "user";
      setLocal((l) => ({ ...l, status: "live", stream, facing, deviceId: null, mirrored }));
      void client.sendIntent("presence.set", { mirrored });
    } catch (err) {
      const kind = err instanceof CameraError ? err.kind : "in_use";
      setLocal((l) => ({ ...l, status: kind, stream: null }));
    }
  }, [attachTrackEvents, client]);

  const setMirrored = useCallback(
    (mirrored: boolean) => {
      setLocal((l) => ({ ...l, mirrored }));
      void client.sendIntent("presence.set", { mirrored });
    },
    [client],
  );

  const presTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPresentation = useCallback(
    (cp: CameraPresentation) => {
      setLocal((l) => ({ ...l, presentation: cp }));
      if (presTimer.current) clearTimeout(presTimer.current);
      presTimer.current = setTimeout(() => void client.sendIntent("presence.set", { cameraPresentation: cp }), SEND_PRESENTATION_DEBOUNCE_MS);
    },
    [client],
  );
  const resetPresentation = useCallback(() => setPresentation(DEFAULT_CAMERA_PRESENTATION), [setPresentation]);

  // Reload: bila kamera sebelumnya nyala dan izin sudah granted, nyalakan lagi tanpa layar cek.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || !room || inCheck) return;
    autoTried.current = true;
    if (!readAuto(room.roomId)) return;
    void cameraPermissionGranted().then((ok) => {
      if (ok && localRef.current.status === "idle") void enable();
    });
  }, [room, inCheck, enable]);

  // Lifecycle tab (09 §5.2): mobile di background → kamera off; saat kembali cek track & pulihkan.
  useEffect(() => {
    const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    const onVis = () => {
      const cur = localRef.current;
      if (document.visibilityState === "hidden") {
        if (coarse && cur.status === "live") {
          sentCamera.current = "off";
          void client.sendIntent("presence.set", { camera: "off" });
        }
        return;
      }
      const track = cur.stream?.getVideoTracks()[0];
      if (cur.status === "ended" || (cur.status === "live" && track?.readyState === "ended")) void enable();
      else if (coarse && cur.status === "live") {
        sentCamera.current = "live";
        void client.sendIntent("presence.set", { camera: "live" });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [client, enable]);

  // Bersihkan kamera saat keluar room / unmount.
  useEffect(() => () => stopStream(localRef.current.stream), []);

  const api_ = useMemo<MediaApi>(
    () => ({
      local,
      remote: (id) => transport?.peerInfo(id) ?? null,
      enable,
      disable,
      skip,
      switchDevice,
      flip,
      setMirrored,
      setPresentation,
      resetPresentation,
      retryPeer: (id) => transport?.retry(id),
    }),
    // `tick` memaksa nilai baru saat status/stream peer berubah (state transport ada di luar React).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [local, transport, enable, disable, skip, switchDevice, flip, setMirrored, setPresentation, resetPresentation, tick],
  );

  return <MediaContext.Provider value={api_}>{children}</MediaContext.Provider>;
}
