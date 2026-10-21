import { describe, expect, it } from "vitest";

import { fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches subsequences and rejects missing characters", () => {
    expect(fuzzyMatch("nb", "New branch")).not.toBeNull();
    expect(fuzzyMatch("xyz", "New branch")).toBeNull();
    expect(fuzzyMatch("", "anything")?.score).toBe(0);
  });

  it("ranks contiguous and word-start matches higher", () => {
    const contiguous = fuzzyMatch("push", "Push")!.score;
    const scattered = fuzzyMatch("push", "Pull … use shortcuts…")?.score ?? -1;
    expect(contiguous).toBeGreaterThan(scattered);
    const wordStarts = fuzzyMatch("sb", "Switch branch")!.score;
    const inside = fuzzyMatch("sb", "Isabel")!.score;
    expect(wordStarts).toBeGreaterThan(inside);
  });

  it("doesn't lose a match by jumping to a later word start", () => {
    // "t" could jump to "to", leaving no "c" for "switch".
    expect(fuzzyMatch("switch parser", "Switch to feature/parser")).not.toBeNull();
  });

  it("returns the matched indices for highlighting", () => {
    expect(fuzzyMatch("fet", "Fetch")!.indices).toEqual([0, 1, 2]);
    expect(fuzzyMatch("sb", "Switch branch")!.indices).toEqual([0, 7]);
    expect(fuzzyMatch("fb", "feature/branch")!.indices).toEqual([0, 8]);
  });
});
