import { describe, expect, it } from "vitest";

import { SegmentIndex, type Segment } from "./segment-index";

describe("SegmentIndex", () => {
  it("returns segments overlapping a window, once each", () => {
    const index = new SegmentIndex();
    const long: Segment = [0, 1, 1, 100_000];
    const short: Segment = [1, 2, 10, 20];
    const far: Segment = [2, 3, 5000, 5010];
    index.add([long, short, far]);
    expect(index.query(0, 30)).toEqual([long, short]);
    expect(index.query(20, 40)).toEqual([long]);
    expect(index.query(5005, 5006)).toEqual([long, far]);
    // The long segment spans many buckets but is returned once.
    expect(index.query(0, 2000).filter((s) => s === long)).toHaveLength(1);
  });

  it("includes open segments and replaces them per batch", () => {
    const index = new SegmentIndex();
    index.setOpen([[0, 0, 1, 50]]);
    expect(index.query(10, 12)).toHaveLength(1);
    index.setOpen([[0, 0, 1, 80]]);
    expect(index.query(60, 70)).toEqual([[0, 0, 1, 80]]);
    index.clear();
    expect(index.query(0, 100)).toEqual([]);
  });
});
