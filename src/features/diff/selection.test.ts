import { describe, expect, it } from "vitest";

import type { DiffLine } from "@/ipc/bindings/DiffLine";
import type { Hunk } from "@/ipc/bindings/Hunk";

import { countByHunk, lineKey, parseLineKey, rangeKeys, selectableKeys } from "./selection";

/** A hunk from `" ctx"`, `"-del"`, `"+add"` lines; line numbers don't matter here. */
function hunk(lines: string[]): Hunk {
  const parsed: DiffLine[] = lines.map((raw) => {
    const kind = raw[0] === "+" ? "add" : raw[0] === "-" ? "del" : "context";
    return {
      kind,
      oldLine: null,
      newLine: null,
      text: raw.slice(1),
      noNewline: false,
      emphasis: [],
    };
  });
  return { heading: "", oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines: parsed };
}

const hunks = [
  hunk([" a", "-b", "+c", " d"]), // changed: 0:1, 0:2
  hunk([" e"]), // nothing to select
  hunk(["-f", "-g", "+h", " i", "+j"]), // changed: 2:0, 2:1, 2:2, 2:4
];

describe("lineKey / parseLineKey", () => {
  it("round-trips", () => {
    expect(lineKey(3, 17)).toBe("3:17");
    expect(parseLineKey("3:17")).toEqual({ hunk: 3, line: 17 });
  });

  it("rejects anything else", () => {
    for (const bad of ["", "3", "3:", ":1", "a:1", "1:-1", "1:2:3", " 1:2"]) {
      expect(parseLineKey(bad)).toBeNull();
    }
  });
});

describe("selectableKeys", () => {
  it("lists changed lines only", () => {
    expect(selectableKeys(hunks[0]!, 0)).toEqual(["0:1", "0:2"]);
    expect(selectableKeys(hunks[1]!, 1)).toEqual([]);
    expect(selectableKeys(hunks[2]!, 2)).toEqual(["2:0", "2:1", "2:2", "2:4"]);
  });
});

describe("rangeKeys", () => {
  it("includes both ends and skips context", () => {
    expect(rangeKeys(hunks, "2:0", "2:4")).toEqual(["2:0", "2:1", "2:2", "2:4"]);
    expect(rangeKeys(hunks, "0:2", "0:2")).toEqual(["0:2"]);
  });

  it("is the same in either direction and crosses hunks in display order", () => {
    const expected = ["0:2", "2:0", "2:1"];
    expect(rangeKeys(hunks, "0:2", "2:1")).toEqual(expected);
    expect(rangeKeys(hunks, "2:1", "0:2")).toEqual(expected);
  });

  it("accepts context lines as ends", () => {
    expect(rangeKeys(hunks, "0:0", "1:0")).toEqual(["0:1", "0:2"]);
    expect(rangeKeys(hunks, "0:3", "2:3")).toEqual(["2:0", "2:1", "2:2"]);
  });

  it("keeps one kind when asked", () => {
    expect(rangeKeys(hunks, "0:0", "2:4", "del")).toEqual(["0:1", "2:0", "2:1"]);
    expect(rangeKeys(hunks, "0:0", "2:4", "add")).toEqual(["0:2", "2:2", "2:4"]);
  });

  it("never fails on keys that no longer exist", () => {
    expect(rangeKeys(hunks, "nope", "0:1")).toEqual([]);
    expect(rangeKeys(hunks, "2:2", "9:9")).toEqual(["2:2", "2:4"]);
    expect(rangeKeys(hunks, "0:99", "0:100")).toEqual([]);
    expect(rangeKeys([], "0:0", "5:5")).toEqual([]);
  });
});

describe("countByHunk", () => {
  it("counts selected lines per hunk", () => {
    expect(countByHunk(new Set(["0:1", "2:0", "2:4", "bogus"]))).toEqual(
      new Map([
        [0, 1],
        [2, 2],
      ]),
    );
    expect(countByHunk([]).size).toBe(0);
  });
});
