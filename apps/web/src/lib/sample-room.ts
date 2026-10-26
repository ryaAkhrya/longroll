import type { RoomView } from "@longroll/shared";

/**
 * Data contoh STATIS untuk kerangka layout (mode dev `?preview=...`). Bukan data room sungguhan;
 * P02 menggantinya dengan state dari server. Kode memakai alfabet DEC-022 (tanpa O/0/I/1).
 */
export const SAMPLE_ROOM: RoomView = {
  code: "BUBA27",
  participants: [
    { id: "p1", displayName: "Nadia", color: "P1", isSelf: true, status: "online", statusText: "Kamu · kamera nyala" },
    { id: "p2", displayName: "Raka", color: "P2", isSelf: false, status: "online", statusText: "Kamera nyala" },
    { id: "p3", displayName: "Sasa", color: "P3", isSelf: false, status: "pending", statusText: "Ngizinin kamera…" },
  ],
};

export type RoomPreview = "create" | "join" | "lobby" | "expired";

export function parsePreview(value: string | string[] | undefined): RoomPreview | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "create" || v === "join" || v === "lobby" || v === "expired" ? v : null;
}
