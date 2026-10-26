import type { PlayerColor } from "./players";

/** Bentuk ringkas mengikuti 14 §2-§3; dipakai layout lobby. Belum ada logika room (P02). */
export type PresenceStatus = "online" | "pending" | "away";

export interface ParticipantView {
  id: string;
  displayName: string;
  color: PlayerColor;
  isSelf: boolean;
  status: PresenceStatus;
  /** Teks status singkat, mis. "Kamera nyala". */
  statusText: string;
}

export interface RoomView {
  code: string;
  participants: ParticipantView[];
}
