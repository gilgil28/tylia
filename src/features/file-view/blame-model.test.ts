import { describe, expect, it } from "vitest";

import type { BlameCommit, BlameLine } from "@/ipc";

import { ageRanks, ageTint, groupStarts } from "./blame-model";

const commit = (authorTime: number, uncommitted = false): BlameCommit => ({
  oid: String(authorTime).padStart(40, "0"),
  authorName: "Ada",
  authorEmail: "ada@example.com",
  authorTime,
  summary: "s",
  path: "a.rs",
  previous: null,
  uncommitted,
});

const line = (c: number, n: number): BlameLine => ({
  commit: c,
  originalLine: n,
  line: n,
  text: "",
});

describe("groupStarts", () => {
  it("marks the first line of each run of one commit", () => {
    const lines = [line(0, 1), line(0, 2), line(1, 3), line(0, 4), line(0, 5)];
    expect(groupStarts(lines)).toEqual([true, false, true, true, false]);
    expect(groupStarts([])).toEqual([]);
  });
});

describe("ageRanks", () => {
  it("ranks by time, oldest 0 and newest 1, uncommitted newest", () => {
    const commits = [commit(300), commit(100), commit(1_000_000), commit(0, true), commit(100)];
    expect(ageRanks(commits)).toEqual([0.5, 0, 1, 1, 0]);
  });

  it("treats a single commit as recent", () => {
    expect(ageRanks([commit(5)])).toEqual([1]);
  });
});

describe("ageTint", () => {
  it("spans a faint to a full tint", () => {
    expect(ageTint(0)).toBe(25);
    expect(ageTint(1)).toBe(100);
  });
});
