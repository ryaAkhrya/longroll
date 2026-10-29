import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "./types";

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * Adapter S3-compatible (Neon Object Storage, Cloudflare R2, MinIO, AWS S3). Bucket PRIVAT; klien
 * hanya mendapat presigned URL berumur pendek. PUT presigned menandatangani Content-Type &
 * Content-Length yang dideklarasikan; ukuran aktual tetap diperiksa ulang saat `complete`.
 *
 * Status: belum diverifikasi terhadap bucket nyata di P05 (butuh bucket + kredensial yang dibuat
 * pemilik proyek). Lihat HANDOFF_P05.md.
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly kind = "s3";
  private readonly client: S3Client;

  constructor(private readonly cfg: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Storage lambat/mati tidak boleh menahan actor tanpa batas: timeout + retry terbatas (backoff SDK).
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 20_000 },
      // Penyedia S3-compatible tidak selalu mendukung checksum CRC32 default SDK baru.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async listRoomIds() {
    const ids: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: "rooms/", Delimiter: "/", ContinuationToken: token }));
      for (const p of r.CommonPrefixes ?? []) {
        const m = /^rooms\/([^/]+)\/$/.exec(p.Prefix ?? "");
        if (m) ids.push(m[1]!);
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return ids;
  }

  async deleteMany(keys: string[]) {
    if (!keys.length) return;
    const r = await this.client.send(new DeleteObjectsCommand({ Bucket: this.cfg.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
    if (r.Errors?.length) throw new Error(`S3 delete gagal: ${r.Errors.length} objek`);
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string, maxBytes: number) {
    const size = await this.size(key);
    if (size === null || size > maxBytes) return null;
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    return r.Body ? new Uint8Array(await r.Body.transformToByteArray()) : null;
  }

  async size(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return r.ContentLength ?? null;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async presignPut(key: string, opts: { contentType: string; bytes: number; expiresSec: number }) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: opts.contentType, ContentLength: opts.bytes }),
      { expiresIn: opts.expiresSec, signableHeaders: new Set(["content-type", "content-length"]) },
    );
    return { url, headers: { "Content-Type": opts.contentType } };
  }

  presignGet(key: string, expiresSec: number) {
    // Respons ditandatangani: tampil inline sebagai gambar, cache privat singkat (URL sendiri sudah kedaluwarsa ≤ 10 menit).
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, ResponseContentDisposition: "inline", ResponseCacheControl: "private, max-age=300" }),
      { expiresIn: expiresSec },
    );
  }
}
