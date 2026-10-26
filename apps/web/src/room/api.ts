import type { ErrorCode, ErrorResponse, PreviewResponse, SessionResponse } from "@longroll/shared";

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

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${REALTIME_URL}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
};
