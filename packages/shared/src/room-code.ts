import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./config";

/** Huruf besar, buang karakter di luar alfabet DEC-022, potong ke 6. Validasi UI saja. */
export function normalizeRoomCode(input: string): string {
  let out = "";
  for (const ch of input.toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === ROOM_CODE_LENGTH) break;
  }
  return out;
}

export function isCompleteRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && normalizeRoomCode(code) === code;
}
