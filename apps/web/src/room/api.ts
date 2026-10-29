import type {
  ErrorCode,
  ErrorResponse,
  FrameCompleteResponse,
  FramePrepareRequest,
  FramePrepareResponse,
  FrameUrlResponse,
  IceServersResponse,
  PreviewResponse,
  SessionResponse,
} from "@longroll/shared";

/** Base URL realtime service. Cookie kredensial HttpOnly milik host ini dikirim otomatis (credentials: include). */
export const REALTIME_URL = (process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "NETWORK",
    readonly body: ErrorResponse | null = null,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${REALTIME_URL}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = data as ErrorResponse | null;
    throw new ApiError(res.status, err?.error ?? "SERVICE_UNAVAILABLE", err);
  }
  return data as T;
}

const room = (code: string) => `/api/rooms/${encodeURIComponent(code)}`;

export const api = {
  createRoom: (displayName: string) => call<SessionResponse>("POST", "/api/rooms", { displayName }),
  preview: (code: string) => call<PreviewResponse>("GET", `${room(code)}/preview`),
  join: (code: string, displayName: string) => call<SessionResponse>("POST", `${room(code)}/join`, { displayName }),
  /** Validasi cookie + rotasi token + perpanjang umur cookie. 401 → belum/tidak lagi jadi peserta. */
  session: (code: string) => call<SessionResponse>("POST", `${room(code)}/session`),
  leave: (code: string) => call<{ ok: true }>("POST", `${room(code)}/leave`),
  /** STUN/TURN untuk WebRTC; butuh cookie kredensial room. */
  iceServers: (code: string) => call<IceServersResponse>("GET", `${room(code)}/turn-credentials`, undefined, 5_000),
  /** Frame custom (P05): presign → PUT langsung → complete (validasi server) → signed URL baca. */
  framePrepare: (code: string, body: FramePrepareRequest) => call<FramePrepareResponse>("POST", `${room(code)}/frames`, body),
  frameComplete: (code: string, frameId: string) => call<FrameCompleteResponse>("POST", `${room(code)}/frames/${encodeURIComponent(frameId)}/complete`),
  frameUrl: (code: string, frameId: string) => call<FrameUrlResponse>("GET", `${room(code)}/frames/${encodeURIComponent(frameId)}/url`),
};

/** PUT file ke URL presigned dengan progres (XHR: fetch belum punya progres upload). Tanpa cookie. */
export function uploadToUrl(url: string, headers: Record<string, string>, file: Blob, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let code: ErrorCode = "SERVICE_UNAVAILABLE";
        try {
          code = (JSON.parse(xhr.responseText) as ErrorResponse).error ?? code;
        } catch {
          /* respons S3 berupa XML */
        }
        reject(new ApiError(xhr.status, xhr.status === 413 ? "FRAME_TOO_LARGE" : code));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK"));
    xhr.send(file);
  });
}
