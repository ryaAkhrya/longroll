# 14 — Data Model & Events

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Status | Kontrak **PROPOSED**. Bentuk final ditetapkan saat implementasi fase terkait; perubahan yang tidak kompatibel menaikkan versi MAJOR dokumen ini. |

Contoh di bawah adalah **dokumentasi** (pseudo-TypeScript), bukan kode produksi.

## 1. Konvensi

| Aspek | Aturan |
|---|---|
| ID | `roomId`, `sessionId`, `attemptId`, `frameId`, `elementId`: UUIDv7 (string). `participantId`: UUIDv4. `code`: 6 karakter (DEC-022). |
| Waktu | `*Ms` = epoch milidetik **waktu server**. |
| Nama event | `domain.aksi` huruf kecil (`vote.cast`). C→S = intent; S→C = fakta. |
| Versi state | `roomVersion: number` bertambah setiap event yang mengubah state room. |
| Urutan | Setiap pesan S→C non-volatile punya `seq` (bertambah per room). |
| Bahasa kode error | `UPPER_SNAKE_CASE` (§8.3). |

## 2. Room

```ts
type RoomStatus = 'ACTIVE' | 'GRACE' | 'EXPIRING' | 'EXPIRED';

interface Room {
  roomId: string;
  code: string;                 // 'BOBA27'
  status: RoomStatus;
  createdAtMs: number;
  emptySinceMs: number | null;  // diisi saat CONNECTED = 0 (mulai grace)
  expiresAtMs: number | null;   // null secara default; hanya diisi jika batas umur DEC-052 disetujui
  participants: Record<string, Participant>;   // termasuk LEFT untuk referensi foto
  activeSessionId: string | null;
  sessionOrder: string[];       // urutan sesi
  roomVersion: number;
  lastSeq: number;
}
```

Batas: peserta non-`LEFT` ≤ 4 (REQ-ROOM-06, CONFIRMED); sesi ≤ 20 (DEC-053, PROPOSED safeguard). Tidak ada batas umur room secara default (DEC-052 OPEN).

## 3. Participant & store klien

```ts
type ConnectionState = 'CONNECTED' | 'RECONNECTING' | 'LEFT';
type CameraState = 'live' | 'off' | 'permission' | 'none' | 'in_use';
type PlayerColor = 'P1' | 'P2' | 'P3' | 'P4';

interface Participant {
  participantId: string;
  displayName: string;          // DEC-043, sudah disanitasi
  color: PlayerColor;           // DEC-044
  joinedAtMs: number;
  connection: ConnectionState;
  disconnectedAtMs: number | null;
  camera: CameraState;
  ready: boolean;               // DEC-069
  mirrored: boolean;
  cameraPresentation: CameraPresentation;   // hanya pemilik yang boleh menulis
  tokenHash: string;            // SERVER ONLY — tidak pernah dikirim ke klien
}

interface CameraPresentation {
  zoom: number;                 // 1..2 (atau sesuai dukungan)
  offset: { x: number; y: number };   // -1..1 relatif
  brightness: number;           // -1..1
  warmth: number;               // -1..1
}
```

Store klien (07 §14):

```ts
interface ClientStore {
  room: RoomView;                 // read-only, dari server (tanpa field SERVER ONLY)
  me: { participantId: string };
  local: {
    deviceId?: string; facing: 'user' | 'environment';
    permission: 'prompt' | 'granted' | 'denied' | 'unavailable' | 'in_use';
    clockOffsetMs: number;
    ui: { openPanel?: 'frame' | 'layout' | 'camera' | 'filter'; focusMode: boolean };
  };
  pending: Map<string /*clientEventId*/, PendingIntent>;
}
```

## 4. HTTP API

Semua respons JSON. Endpoint yang butuh token membaca **cookie** `lr_p_{roomId}` (HttpOnly, DEC-082) dan memvalidasi `Origin`. Mode fallback: header `Authorization: Bearer <participantToken>`.

| Method & path | Auth | Request | Respons sukses | Error |
|---|---|---|---|---|
| `POST /api/rooms` | — | `{ displayName }` | `201 { roomCode, roomId, participantId, color, wsUrl }` + `Set-Cookie` token (fallback: `participantToken` di body) | `400 NAME_INVALID`, `429 RATE_LIMITED` |
| `GET /api/rooms/{code}/preview` | — | — | `200 { exists: true, status, participantCount, initials: string[] }` | `404 ROOM_NOT_FOUND`, `410 ROOM_EXPIRED`, `429` |
| `POST /api/rooms/{code}/join` | — | `{ displayName }` | `200 { roomId, participantId, color, wsUrl }` + `Set-Cookie` token (fallback: `participantToken` di body) | `404`, `409 ROOM_FULL`, `410`, `400 NAME_INVALID`, `429` |
| `GET /api/turn-credentials` | token | — | `200 { iceServers: RTCIceServer[], ttlSec }` | `401` |
| `POST /api/rooms/{code}/frames` | token | `{ fileName, contentType, bytes }` | `200 { frameId, uploadUrl, expiresInSec }` | `400 FRAME_UNSUPPORTED`, `413 FRAME_TOO_LARGE`, `409 FRAME_QUOTA`, `429` |
| `POST /api/rooms/{code}/frames/{frameId}/complete` | token | — | `200 { frame: FrameTemplate }` | `422 FRAME_DECODE_FAILED`, `422 FRAME_DIMENSIONS` |
| `GET /api/health` | — | — | `200 { ok: true }` | — |

`preview` **tidak** mengembalikan nama lengkap, foto, atau feed (15 §4).

## 5. WebSocket

### 5.1 Envelope

```ts
// Client → Server
interface C2S<T = unknown> { type: string; clientEventId?: string; payload: T }
// Server → Client
interface S2C<T = unknown> { type: string; seq?: number; roomVersion?: number; atMs: number; payload: T; replyTo?: string }
```

- Autentikasi terjadi saat **upgrade** WebSocket memakai cookie + cek `Origin`; gagal → upgrade ditolak (`401`). Mode fallback: pesan pertama klien `auth { participantToken }`, timeout 5 detik → close `4401`.
- Volatile (tanpa `seq`, tidak di-replay): `cursor.move`, `editor.awareness`, `presence.activity`, `time.pong`.
- Ack: setiap intent dengan `clientEventId` dibalas `ack { replyTo, ok, error? }`.

### 5.2 Event room & presence (P02)

| Arah | Type | Payload |
|---|---|---|
| C→S | `auth` | `{ participantToken }` (hanya mode fallback) |
| S→C | `auth.ok` | `{ participantId, room: RoomView, serverTimeMs }` |
| C→S | `room.resume` | `{ lastSeq }` |
| S→C | `room.snapshot` | `{ room: RoomView, activeSession?: SessionView, lastSeq }` |
| S→C | `participant.joined` / `participant.left` | `{ participant: ParticipantView }` / `{ participantId }` |
| S→C | `presence.update` | `{ participantId, connection?, camera?, ready?, mirrored? }` |
| C→S | `presence.set` | `{ camera?, ready?, mirrored?, cameraPresentation? }` (hanya untuk diri sendiri) |
| C→S / S→C | `cursor.move` | `{ surface: 'vote'|'studio'|'editor', x, y, label? }` (volatile) |
| C→S | `participant.leave` | `{}` |
| S→C | `session.replaced` | `{}` (tab lain mengambil alih) |
| S→C | `room.expiring` | `{ reason: 'GRACE'|'MAX_LIFETIME', atMs }` (`MAX_LIFETIME` hanya jika DEC-052 disetujui) |
| S→C | `room.expired` | `{}` |
| C→S / S→C | `time.ping` / `time.pong` | `{ t1 }` / `{ t1, ts }` |

### 5.3 Signaling WebRTC (P03)

| Arah | Type | Payload |
|---|---|---|
| C→S→C | `rtc.offer` | `{ to, from, sdp }` |
| C→S→C | `rtc.answer` | `{ to, from, sdp }` |
| C→S→C | `rtc.ice` | `{ to, from, candidate }` |
| C→S→C | `rtc.restart` | `{ to, from }` |

Server memvalidasi bahwa `to` dan `from` adalah peserta room yang sama, dan `from` = pengirim terautentikasi. SDP/kandidat tidak dicatat di log.

## 6. Voting & sesi (P04)

```ts
type Mode = 'PHOTO_STRIP' | 'GROUP_SHOT' | 'PHOTO_GRID' | 'FREEFORM_COLLAGE';
type SessionState = 'VOTING' | 'STUDIO' | 'CAPTURING' | 'EDITING' | 'FINAL' | 'CLOSED';
type VotingPhase = 'OPEN' | 'CLOSING' | 'RESOLVING' | 'TIE_ROUND' | 'RANDOM_PICK' | 'LOCKED';

interface Session {
  sessionId: string;
  index: number;                     // 1-based
  state: SessionState;
  createdAtMs: number; createdBy: string;
  voting: Voting;
  mode: Mode | null;                 // ditulis sekali saat LOCKED (REQ-VOTE-06)
  studio: StudioState | null;        // 10 §1
  shots: Shot[];
  editorDocKey: string | null;
  result: SessionResult | null;      // 12 §2
  eventLog: SessionLogEntry[];       // termasuk hasil acak seri
}

interface Voting {
  phase: VotingPhase;
  round: 1 | 2;
  options: Mode[];                   // round 2 = opsi seri
  votes: Record<string /*participantId*/, Mode>;
  closingAtMs: number | null;        // jendela 5 s DEC-023
  closedBy: string | null;
  result: { mode: Mode; method: 'UNANIMOUS' | 'MAJORITY' | 'RANDOM'; tally: Record<Mode, number> } | null;
}
```

| Arah | Type | Payload | Error |
|---|---|---|---|
| C→S | `session.create` | `{}` | `SESSION_LIMIT`, `SESSION_ACTIVE_NOT_FINAL` |
| S→C | `session.invite` | `{ sessionId, index, from }` | — |
| S→C | `session.state` | `{ sessionId, state, mode? }` | — |
| C→S | `vote.cast` | `{ sessionId, round, mode }` | `VOTING_CLOSED`, `INVALID_OPTION` |
| C→S | `vote.close` | `{ sessionId, round }` | `CLOSE_NOT_ALLOWED` (belum mayoritas) |
| S→C | `vote.state` | `{ round, phase, votes, canClose, closingAtMs }` | — |
| S→C | `vote.tie` | `{ round: 2, options }` | — |
| S→C | `vote.resolved` | `{ mode, method, tally }` | — |
| C→S | `studio.update` | `{ sessionId, patch: StudioPatch, baseVersion }` | `MODE_LOCKED`, `STRUCTURE_LOCKED` (DEC-065), `INVALID_PATCH` |
| S→C | `studio.updated` | `{ patch, by, version }` | — |

### 6.1 Studio & binding (DEC-087, RECOMMENDED; DEC-061 OPEN)

```ts
type ParticipantSlot = 'P1' | 'P2' | 'P3' | 'P4';
type BindingStrategy = 'PER_SHOT_GROUP' | 'PER_PARTICIPANT_SHOT' | 'FREEFORM';

type SlotBinding =
  | { kind: 'CELL'; shotIndex: number; participantSlot: ParticipantSlot }   // foto individual
  | { kind: 'SHOT_GROUP'; shotIndex: number; arrangement: 'ROW' | 'COLUMN' | 'GRID' | 'BLEND' } // komposit grup
  | { kind: 'FREE' };                                                       // item bebas (collage)

interface LayoutSlot {
  id: string; x: number; y: number; w: number; h: number;
  rotation: number; radius: number; z: number;
  fit: 'cover'; focal?: { x: number; y: number };
  binding: SlotBinding;
}

interface LayoutSpec {
  canvas: { preset: string; widthPx: number; heightPx: number };  // sisi terpanjang ≤ 8192 (safeguard DEC-042)
  shotCount: number;                  // safeguard 1..MAX_SHOTS (8)
  slots: LayoutSlot[];                // BindingPlan aktif (10 §5)
}

interface StudioState {               // sama dengan 10 §1
  version: number;
  layout: LayoutSpec;
  bindingStrategy: BindingStrategy;   // default per mode = OPEN (DEC-061); terkunci setelah shot 1 (DEC-065)
  frame: { frameId: string; source: 'BUILTIN' | 'CUSTOM' } | null;
  style: { bgColor: string; gap: number; cornerRadius: number; filterPreset: string | null };
  countdownSec: number;
}
```

- Validator bersama (`packages/shared`) memastikan: `cells = shotCount × pesertaWajib ≤ 32`, setiap `CELL`/`SHOT_GROUP` merujuk `shotIndex < shotCount`, dan strategi `PER_SHOT_GROUP` tidak memakai binding `CELL` (dan sebaliknya). Pelanggaran → `INVALID_PATCH { reason: 'SAFEGUARD' | 'BINDING', limit? }`.
- Semua angka batas dibaca dari konfigurasi terpusat, bukan literal di kode (DEC-042).

## 7. Capture (P06)

```ts
type ShotState = 'IDLE' | 'COUNTDOWN' | 'REVIEW' | 'DONE';
type ParticipantShotStatus =
  | 'PENDING' | 'CAPTURING' | 'UPLOADING' | 'DECIDING' | 'RETAKE_COUNTDOWN'
  | 'ACCEPTED' | 'SKIPPED' | 'NOT_REQUIRED' | 'MISSING' | 'FAILED';
type AttemptStatus = 'CREATED' | 'UPLOADING' | 'READY' | 'REJECTED' | 'FAILED';

interface Shot {
  index: number;
  state: ShotState;
  t0ServerMs: number | null;
  armedBy: string | null;
  required: string[];                                   // participantIds wajib (DEC-028)
  slotOf: Record<string, ParticipantSlot>;              // participantId → P1..P4 saat shot diambil (resolusi binding, DEC-087)
  perParticipant: Record<string, ShotParticipantState>;
  doneAtMs: number | null;
}

interface ShotParticipantState {
  status: ParticipantShotStatus;
  attempts: string[];                // attemptId urut waktu
  currentAttemptId: string | null;
  acceptedAttemptId: string | null;  // INVARIANT: hanya diubah oleh pemilik (09 §9.4)
  retakeT0ServerMs: number | null;
}

interface Attempt {
  attemptId: string;
  sessionId: string; shotIndex: number;
  ownerId: string;
  ownerNameAtCapture: string; ownerColor: PlayerColor;
  status: AttemptStatus;
  createdAtMs: number; capturedAtServerMs: number | null; late: boolean;
  mirrored: boolean;
  previewKey: string | null; fullKey: string | null;     // object storage keys
  width: number | null; height: number | null; bytes: number | null; sha256: string | null;
}
```

| Arah | Type | Payload | Error |
|---|---|---|---|
| C→S | `shot.arm` | `{ sessionId, shotIndex, confirmNotReady?: boolean }` | `ALREADY_ARMED`, `SHOT_DONE`, `NOT_IN_STUDIO`, `CONFIRM_REQUIRED` (ada yang belum siap) |
| S→C | `shot.countdown` | `{ shotIndex, t0ServerMs, required, initiatedBy, countdownSec }` | — |
| C→S | `shot.hold` | `{ sessionId, shotIndex }` | `TOO_LATE` |
| S→C | `shot.cancelled` | `{ shotIndex, by }` | — |
| C→S | `attempt.prepare` | `{ sessionId, shotIndex, kind: 'shot'|'retake'|'makeup' }` | `NOT_REQUIRED`, `SHOT_DONE` |
| S→C | `attempt.prepared` (reply) | `{ attemptId, uploadUrls: { preview, full }, maxBytes }` | — |
| C→S | `attempt.uploaded` | `{ attemptId, part: 'preview'|'full', bytes, width, height, sha256, capturedAtServerMs }` | `UPLOAD_MISMATCH` |
| S→C | `attempt.ready` | `{ participantId, attemptId, previewUrl, expiresAtMs }` | — |
| C→S | `capture.accept` | `{ sessionId, shotIndex, attemptId }` | `FORBIDDEN_NOT_OWNER`, `ATTEMPT_REJECTED`, `SHOT_DONE` |
| C→S | `capture.retake` | `{ sessionId, shotIndex, attemptId }` | `FORBIDDEN_NOT_OWNER`, `SHOT_DONE` |
| C→S | `capture.reopen` | `{ sessionId, shotIndex }` (DEC-079) | `SHOT_DONE` |
| S→C | `retake.started` | `{ participantId, rejectedAttemptId, rejectedPreviewUrl, t0ServerMs, attemptNo }` | — |
| S→C | `shot.participant` | `{ shotIndex, participantId, status, acceptedAttemptId? }` | — |
| C→S | `shot.skip` | `{ sessionId, shotIndex, participantId }` | `SKIP_NOT_ALLOWED` (< 15 s putus) |
| C→S | `nudge` | `{ participantId }` (DEC-080) | `RATE_LIMITED` |
| S→C | `shot.done` | `{ shotIndex, accepted: Record<participantId, attemptId|null> }` | — |

## 8. Idempotensi, validasi, error

### 8.1 Idempotensi

- Setiap intent yang mengubah state membawa `clientEventId` (UUID dibuat klien). Actor menyimpan 200 `clientEventId` terakhir per peserta; duplikat dibalas dengan hasil yang sama tanpa efek ganda.
- `attempt.uploaded` idempoten pada `(attemptId, part, sha256)`.
- `capture.accept` atas attempt yang sudah accepted = sukses tanpa perubahan.
- Retry klien: maks. 3× dengan backoff, `clientEventId` yang sama.

### 8.2 Validasi server (minimal)

| Area | Validasi |
|---|---|
| Semua intent | Token valid; peserta `CONNECTED`; room `ACTIVE`; ukuran pesan ≤ 64 KB (kecuali `editor.update` ≤ 256 KB) |
| Kepemilikan | `presence.set` hanya untuk diri sendiri; `capture.*` hanya oleh `ownerId` |
| State | Event hanya diterima di state sesi yang sesuai (misal `vote.cast` hanya `VOTING`) |
| Angka | Rentang safeguard DEC-042 untuk layout (shot ≤ 8, cell ≤ 32, grid ≤ 32 & sisi ≤ 8, output ≤ 8192 px); NaN/Infinity ditolak |
| Teks | Display name & teks editor: panjang dibatasi, kontrol karakter dibuang; dirender sebagai teks (escape) |

### 8.3 Kode error

`AUTH_REQUIRED`, `AUTH_INVALID`, `ROOM_NOT_FOUND`, `ROOM_EXPIRED`, `ROOM_FULL`, `NAME_INVALID`, `RATE_LIMITED`, `FORBIDDEN_NOT_OWNER`, `VOTING_CLOSED`, `INVALID_OPTION`, `CLOSE_NOT_ALLOWED`, `MODE_LOCKED`, `STRUCTURE_LOCKED`, `INVALID_PATCH`, `ALREADY_ARMED`, `TOO_LATE`, `CONFIRM_REQUIRED`, `NOT_IN_STUDIO`, `NOT_REQUIRED`, `SHOT_DONE`, `ATTEMPT_REJECTED`, `UPLOAD_MISMATCH`, `SKIP_NOT_ALLOWED`, `SESSION_LIMIT`, `SESSION_ACTIVE_NOT_FINAL`, `FRAME_*` (10 §9), `DOC_TOO_LARGE`, `READ_ONLY`, `ROOM_STORAGE_LIMIT` (DEC-085), `SERVICE_UNAVAILABLE`.

## 9. Editor (P07)

| Arah | Type | Payload |
|---|---|---|
| C→S | `editor.sync` | `{ sessionId, stateVector: base64 }` |
| S→C | `editor.sync` | `{ sessionId, update: base64 }` (diff) |
| C→S / S→C | `editor.update` | `{ sessionId, update: base64 }` |
| C→S / S→C | `editor.awareness` | `{ sessionId, update: base64 }` (volatile) |
| C→S | `session.finalize` | `{ sessionId }` → server mengirim `session.state FINAL` + `result.render.request {to}` |
| C→S | `session.reopen` | `{ sessionId }` (Balik edit) |
| C→S | `result.preview.uploaded` | `{ sessionId, bytes, sha256 }` |

Model dokumen: 11 §2.

## 10. Hasil & galeri (P08)

```ts
interface SessionResult {
  sessionId: string; index: number; mode: Mode; title: string;
  finalizedAtMs: number; finalizedBy: string;
  frameRef: string; outputPreset: string;
  docSnapshotKey: string; previewKey: string | null;
  acceptedAttempts: { shotIndex: number; participantId: string; attemptId: string;
                      participantNameAtCapture: string; color: PlayerColor }[];
  participants: { participantId: string; name: string; color: PlayerColor }[];
}

interface GalleryView {
  sessions: { sessionId: string; index: number; mode: Mode; title: string;
              finalizedAtMs: number; previewUrl: string | null; expiresAtMs: number }[];
  perPerson?: { sessionId: string; participantId: string; attemptId: string; previewUrl: string }[];
  // TIDAK ADA field untuk attempt REJECTED (REQ-GAL-07)
}
```

| Arah | Type | Payload |
|---|---|---|
| C→S | `gallery.get` | `{}` |
| S→C | `gallery.view` | `GalleryView` |
| C→S | `asset.urls` | `{ keys: string[] }` → `{ urls: Record<key, {url, expiresAtMs}> }` (hanya key milik room ini) |

## 11. Metadata aset sementara

```ts
interface TempAsset {
  key: string;                 // rooms/{roomId}/...
  roomId: string;
  kind: 'attempt_preview' | 'attempt_full' | 'frame' | 'result_preview' | 'doc_snapshot';
  createdAtMs: number;
  deleteAfter: 'SHOT_DONE_IF_REJECTED' | 'ROOM_EXPIRED';
  bytes: number;
}
```

Indeks aset per room disimpan di Redis (`room:{id}:assets` set) supaya cleanup bisa memverifikasi semua objek terhapus (15 §8).

## 12. Status lifecycle (ringkasan)

| Entitas | Status |
|---|---|
| Room | `ACTIVE → GRACE → EXPIRING → EXPIRED` (07 §12) |
| Participant | `CONNECTED ↔ RECONNECTING → LEFT` (07 §7) |
| Session | `VOTING → STUDIO → CAPTURING → EDITING ↔ FINAL → CLOSED` (08 §8) |
| Voting | `OPEN → (CLOSING) → RESOLVING → (TIE_ROUND → RESOLVING → RANDOM_PICK) → LOCKED` |
| Shot | `IDLE → COUNTDOWN → REVIEW → DONE` |
| Attempt | `CREATED → UPLOADING → READY → (REJECTED)`, atau `FAILED` |

## 13. Reconnect & versioning

- Klien menyimpan `lastSeq`. Saat resume: server mengirim event `seq > lastSeq` dari ring buffer (500 event), atau `room.snapshot` jika tidak tersedia.
- Klien mengabaikan event dengan `seq ≤ lastSeq` (duplikat).
- `studio.update` membawa `baseVersion`; jika server sudah di versi lebih baru, patch tetap diterapkan per field (LWW) dan klien menerima `studio.updated` yang benar.
- Versi protokol: `auth` menyertakan `protocolVersion`. Server menolak versi yang tidak didukung dengan `4426 UPGRADE_REQUIRED` → klien memuat ulang aplikasi.
