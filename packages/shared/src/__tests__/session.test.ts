import { describe, expect, it } from "vitest";
import { canCloseVoting, everyoneVoted, newVoting, resolveVotes } from "../session";
import type { Mode } from "../session";

const all = () => true;
const ALL: Mode[] = ["PHOTO_STRIP", "GROUP_SHOT", "PHOTO_GRID", "FREEFORM_COLLAGE"];

describe("resolveVotes (08 §6) — tabel kasus", () => {
  it("menang tunggal (mayoritas)", () => {
    expect(resolveVotes({ a: "PHOTO_STRIP", b: "PHOTO_STRIP", c: "PHOTO_STRIP", d: "PHOTO_GRID" }, all, ALL)).toMatchObject({
      kind: "winner",
      mode: "PHOTO_STRIP",
      method: "MAJORITY",
    });
  });
  it("unanim", () => {
    expect(resolveVotes({ a: "GROUP_SHOT", b: "GROUP_SHOT" }, all, ALL)).toMatchObject({ kind: "winner", method: "UNANIMOUS" });
  });
  it("seri 2–2 → opsi seri saja, urutan kanonik", () => {
    expect(resolveVotes({ a: "PHOTO_GRID", b: "PHOTO_STRIP", c: "PHOTO_GRID", d: "PHOTO_STRIP" }, all, ALL)).toEqual({
      kind: "tie",
      options: ["PHOTO_STRIP", "PHOTO_GRID"],
      tally: { PHOTO_GRID: 2, PHOTO_STRIP: 2 },
    });
  });
  it("seri 1–1–1–1", () => {
    const r = resolveVotes({ a: "PHOTO_STRIP", b: "GROUP_SHOT", c: "PHOTO_GRID", d: "FREEFORM_COLLAGE" }, all, ALL);
    expect(r).toMatchObject({ kind: "tie", options: ALL });
  });
  it("tanpa suara → none", () => {
    expect(resolveVotes({}, all, ALL)).toEqual({ kind: "none" });
  });
  it("suara peserta LEFT tidak dihitung", () => {
    const left = new Set(["c", "d"]);
    expect(resolveVotes({ a: "PHOTO_GRID", b: "PHOTO_GRID", c: "PHOTO_STRIP", d: "PHOTO_STRIP" }, (p) => !left.has(p), ALL)).toMatchObject({
      kind: "winner",
      mode: "PHOTO_GRID",
    });
  });
  it("suara di luar opsi ronde diabaikan", () => {
    expect(resolveVotes({ a: "GROUP_SHOT", b: "PHOTO_STRIP" }, all, ["PHOTO_STRIP", "PHOTO_GRID"])).toMatchObject({ kind: "winner", mode: "PHOTO_STRIP" });
  });
});

describe("penutupan (DEC-023)", () => {
  it("Tutup vote hanya bila suara > 50% peserta CONNECTED", () => {
    const v = newVoting();
    v.votes = { a: "PHOTO_STRIP", b: "PHOTO_STRIP" };
    expect(canCloseVoting(v, ["a", "b", "c", "d"])).toBe(false); // 2/4 = 50%, bukan > 50%
    expect(canCloseVoting(v, ["a", "b", "c"])).toBe(true);
    expect(canCloseVoting({ ...v, phase: "CLOSING" }, ["a", "b", "c"])).toBe(false);
    expect(canCloseVoting(v, [])).toBe(false);
  });
  it("semua CONNECTED memilih; tanpa peserta terhubung tidak pernah true", () => {
    const v = newVoting();
    v.votes = { a: "PHOTO_STRIP" };
    expect(everyoneVoted(v, ["a"])).toBe(true);
    expect(everyoneVoted(v, ["a", "b"])).toBe(false);
    expect(everyoneVoted(v, [])).toBe(false);
  });
});
