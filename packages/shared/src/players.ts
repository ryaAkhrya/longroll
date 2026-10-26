/** Warna pemain (05 §2.3). Hanya untuk identitas orang, bukan tombol aksi. */
export type PlayerColor = "P1" | "P2" | "P3" | "P4";

export const PLAYER_COLORS: readonly PlayerColor[] = ["P1", "P2", "P3", "P4"];

export const PLAYER_COLOR_NAMES: Record<PlayerColor, string> = {
  P1: "Peach",
  P2: "Butter",
  P3: "Mint",
  P4: "Lilac",
};
