/**
 * Simpan ke Google Drive (12 §6, DEC-040): Google Identity Services (token model), scope `drive.file`,
 * token hanya di memori tab. Semua I/O (fetch, GIS, penyimpanan lokal, jeda) disuntikkan supaya alur — termasuk
 * penolakan consent, token kedaluwarsa, kuota penuh, dan retry jaringan — teruji tanpa akun Google / browser.
 * LONGROLL tidak menerima atau menyimpan token, email, atau daftar file Drive.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_FOLDER_NAME = "LONGROLL";
export const DRIVE_MULTIPART_LIMIT = 5 * 1024 * 1024;
/** Kelipatan 256 KiB (syarat Drive untuk potongan resumable). */
export const DRIVE_CHUNK = 2 * 1024 * 1024;
export const DRIVE_MAX_RETRIES = 3;
const FOLDER_KEY = "lr:drive:folder";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FILES = "https://www.googleapis.com/drive/v3/files";

export type DriveErrorCode = "NOT_CONFIGURED" | "POPUP_BLOCKED" | "CONSENT_DENIED" | "TOKEN_EXPIRED" | "QUOTA" | "NETWORK" | "GIS_LOAD" | "FAILED";

export const DRIVE_MESSAGES: Record<DriveErrorCode, string> = {
  NOT_CONFIGURED: "Simpan ke Drive belum tersedia di versi ini.",
  POPUP_BLOCKED: "Izinkan popup buat longroll.app lalu coba lagi.",
  CONSENT_DENIED: "Gak jadi nyimpen ke Drive.",
  TOKEN_EXPIRED: "Akses Drive habis. Lanjut buat izinkan lagi.",
  QUOTA: "Drive penuh. Kosongin sedikit atau unduh ke perangkat aja.",
  NETWORK: "Koneksi putus waktu upload. Coba lagi.",
  GIS_LOAD: "Gagal memuat Google. Cek koneksi lalu coba lagi.",
  FAILED: "Gagal nyimpen ke Drive. Coba lagi.",
};

export class DriveError extends Error {
  constructor(
    readonly code: DriveErrorCode,
    message?: string,
  ) {
    super(message ?? DRIVE_MESSAGES[code]);
  }
}

// ---- bentuk minimal Google Identity Services (token model)
export interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}
export interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
export interface GisApi {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    callback: (r: GisTokenResponse) => void;
    error_callback?: (e: { type?: string }) => void;
  }): GisTokenClient;
  revoke(token: string, done?: () => void): void;
}

export interface DriveEnv {
  /** null/"" = belum dikonfigurasi (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`). */
  clientId: string | null | undefined;
  loadGis: () => Promise<GisApi>;
  fetch: typeof fetch;
  /** Preferensi lokal (hanya ID folder; BUKAN token). */
  store: { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void };
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string | null;
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

interface Token {
  value: string;
  expiresAtMs: number;
}

export class DriveClient {
  /** Token HANYA di memori instance ini (tab). */
  private token: Token | null = null;
  private gis: GisApi | null = null;

  constructor(private readonly env: DriveEnv) {}

  get configured(): boolean {
    return !!this.env.clientId;
  }

  get connected(): boolean {
    return !!this.token && this.token.expiresAtMs - 30_000 > this.env.now();
  }

  /**
   * Muat skrip GIS lebih awal (saat panel export tampil) supaya `connect()` dapat memanggil `requestAccessToken`
   * secara sinkron di dalam gesture klik. Menunggu jaringan dulu membuat Safari iOS/Chrome Android memblokir popup.
   */
  preload(): void {
    if (this.gis || !this.env.clientId) return;
    this.env.loadGis().then(
      (gis) => (this.gis ??= gis),
      () => undefined, // gagal dimuat: connect() akan mencoba lagi dan melaporkan GIS_LOAD
    );
  }

  /** Harus dipanggil dari gesture pengguna (popup). */
  async connect(): Promise<void> {
    if (!this.env.clientId) throw new DriveError("NOT_CONFIGURED");
    if (!this.gis) {
      try {
        this.gis = await this.env.loadGis();
      } catch {
        throw new DriveError("GIS_LOAD");
      }
    }
    const gis = this.gis;
    const clientId = this.env.clientId;
    this.token = await new Promise<Token>((resolve, reject) => {
      const client = gis.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (r) => {
          if (r.error || !r.access_token) reject(new DriveError(r.error === "access_denied" ? "CONSENT_DENIED" : "FAILED"));
          else resolve({ value: r.access_token, expiresAtMs: this.env.now() + Number(r.expires_in ?? 3600) * 1000 });
        },
        error_callback: (e) => reject(new DriveError(e.type === "popup_failed_to_open" ? "POPUP_BLOCKED" : "CONSENT_DENIED")),
      });
      client.requestAccessToken();
    });
  }

  /** "Putuskan Google Drive": cabut token & lupakan folder. */
  async revoke(): Promise<void> {
    const t = this.token;
    this.token = null;
    this.env.store.remove(FOLDER_KEY);
    if (t && this.gis) await new Promise<void>((resolve) => this.gis!.revoke(t.value, () => resolve()));
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    if (!this.token) throw new DriveError("TOKEN_EXPIRED");
    return { Authorization: `Bearer ${this.token.value}`, ...extra };
  }

  /** fetch + klasifikasi galat; retry jaringan ≤ 3× dengan backoff. */
  private async call(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new DOMException("dibatalkan", "AbortError");
      let res: Response;
      try {
        res = await this.env.fetch(url, { ...init, signal });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        if (attempt >= DRIVE_MAX_RETRIES) throw new DriveError("NETWORK");
        await this.env.sleep(500 * 2 ** attempt);
        continue;
      }
      if (res.status === 401) {
        this.token = null;
        throw new DriveError("TOKEN_EXPIRED");
      }
      if (res.status === 403) {
        const body = (await res.clone().json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
        const reasons = body?.error?.errors?.map((e) => e.reason) ?? [];
        if (reasons.includes("storageQuotaExceeded")) throw new DriveError("QUOTA");
        // Drive membalas pembatasan laju dengan 403 (bukan hanya 429): coba lagi dengan backoff.
        if (reasons.includes("rateLimitExceeded") || reasons.includes("userRateLimitExceeded")) {
          if (attempt >= DRIVE_MAX_RETRIES) throw new DriveError("NETWORK");
          await this.env.sleep(500 * 2 ** attempt);
          continue;
        }
        throw new DriveError("FAILED");
      }
      if (res.status >= 500 || res.status === 429) {
        if (attempt >= DRIVE_MAX_RETRIES) throw new DriveError("NETWORK");
        await this.env.sleep(500 * 2 ** attempt);
        continue;
      }
      return res;
    }
  }

  /** Folder "LONGROLL" yang dibuat aplikasi ini (drive.file hanya melihat yang ia buat). */
  async ensureFolder(signal?: AbortSignal): Promise<string> {
    const cached = this.env.store.get(FOLDER_KEY);
    if (cached) {
      const r = await this.call(`${FILES}/${encodeURIComponent(cached)}?fields=id,trashed`, { headers: this.headers() }, signal);
      if (r.ok) {
        const f = (await r.json()) as { id: string; trashed?: boolean };
        if (!f.trashed) return f.id;
      }
      this.env.store.remove(FOLDER_KEY);
    }
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const list = await this.call(`${FILES}?q=${q}&fields=files(id)&pageSize=1`, { headers: this.headers() }, signal);
    if (list.ok) {
      const found = ((await list.json()) as { files?: { id: string }[] }).files?.[0];
      if (found) {
        this.env.store.set(FOLDER_KEY, found.id);
        return found.id;
      }
    }
    const created = await this.call(
      `${FILES}?fields=id`,
      { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }) },
      signal,
    );
    if (!created.ok) throw new DriveError("FAILED");
    const id = ((await created.json()) as { id: string }).id;
    this.env.store.set(FOLDER_KEY, id);
    return id;
  }

  /** Unggah file; multipart < 5 MB, resumable ≥ 5 MB (potongan 2 MB, lanjut dari offset terakhir). */
  async upload(blob: Blob, name: string, opts: UploadOptions = {}): Promise<DriveFile> {
    if (!this.connected) throw new DriveError("TOKEN_EXPIRED");
    const parent = await this.ensureFolder(opts.signal);
    const meta = { name, parents: [parent] };
    const fields = "id,name,webViewLink";
    if (blob.size < DRIVE_MULTIPART_LIMIT) {
      const boundary = `lr${this.env.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
      const res = await this.call(`${UPLOAD}?uploadType=multipart&fields=${fields}`, { method: "POST", headers: this.headers({ "Content-Type": `multipart/related; boundary=${boundary}` }), body }, opts.signal);
      if (!res.ok) throw new DriveError("FAILED");
      opts.onProgress?.(1);
      return this.asFile(await res.json());
    }
    const init = await this.call(
      `${UPLOAD}?uploadType=resumable&fields=${fields}`,
      { method: "POST", headers: this.headers({ "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": blob.type, "X-Upload-Content-Length": String(blob.size) }), body: JSON.stringify(meta) },
      opts.signal,
    );
    const session = init.headers.get("Location");
    if (!init.ok || !session) throw new DriveError("FAILED");
    let offset = 0;
    while (offset < blob.size) {
      const end = Math.min(blob.size, offset + DRIVE_CHUNK);
      const res = await this.call(
        session,
        { method: "PUT", headers: { "Content-Range": `bytes ${offset}-${end - 1}/${blob.size}` }, body: blob.slice(offset, end) },
        opts.signal,
      );
      if (res.status === 308) {
        const range = res.headers.get("Range");
        const m = range?.match(/bytes=0-(\d+)/);
        offset = m ? Number(m[1]) + 1 : end;
      } else if (res.ok) {
        opts.onProgress?.(1);
        return this.asFile(await res.json());
      } else throw new DriveError("FAILED");
      opts.onProgress?.(Math.min(0.99, offset / blob.size));
    }
    throw new DriveError("FAILED");
  }

  private asFile(j: unknown): DriveFile {
    const f = j as Partial<DriveFile>;
    if (!f.id) throw new DriveError("FAILED");
    return { id: f.id, name: f.name ?? "", webViewLink: f.webViewLink ?? null };
  }
}

// ---- lingkungan browser nyata
const GIS_SRC = "https://accounts.google.com/gsi/client";

export function loadGisScript(): Promise<GisApi> {
  const w = window as unknown as { google?: { accounts?: { oauth2?: GisApi } } };
  const ready = () => w.google?.accounts?.oauth2 ?? null;
  const have = ready();
  if (have) return Promise.resolve(have);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => {
      const g = ready();
      if (g) resolve(g);
      else reject(new Error("GIS tidak tersedia"));
    };
    s.onerror = () => reject(new Error("GIS gagal dimuat"));
    document.head.appendChild(s);
  });
}

export function browserDriveEnv(clientId: string | null | undefined): DriveEnv {
  return {
    clientId,
    loadGis: loadGisScript,
    fetch: (...a) => fetch(...a),
    store: {
      get: (k) => {
        try {
          return localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          localStorage.setItem(k, v);
        } catch {
          /* abaikan */
        }
      },
      remove: (k) => {
        try {
          localStorage.removeItem(k);
        } catch {
          /* abaikan */
        }
      },
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  };
}
