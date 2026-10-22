import { describe, expect, it } from "vitest";

import { nextSelection } from "./multiSelect";

const all = () => true;

describe("history multi-select", () => {
  it("a plain click selects one row", () => {
    expect(nextSelection({ rows: [1, 2, 3], anchor: 1 }, 5, "replace", all)).toEqual({
      rows: [5],
      primary: 5,
      anchor: 5,
    });
  });

  it("Ctrl/Cmd+click adds and removes rows, keeping at least one", () => {
    const added = nextSelection({ rows: [4], anchor: 4 }, 1, "toggle", all);
    expect(added).toEqual({ rows: [1, 4], primary: 1, anchor: 1 });
    const removed = nextSelection({ rows: added.rows, anchor: 1 }, 1, "toggle", all);
    expect(removed).toEqual({ rows: [4], primary: 4, anchor: 1 });
    expect(nextSelection({ rows: [4], anchor: 4 }, 4, "toggle", all).rows).toEqual([4]);
  });

  it("Shift extends from the anchor in either direction, skipping rows that aren't commits", () => {
    const commits = (row: number) => row !== 0;
    expect(nextSelection({ rows: [3], anchor: 3 }, 6, "range", commits)).toEqual({
      rows: [3, 4, 5, 6],
      primary: 6,
      anchor: 3,
    });
    expect(nextSelection({ rows: [3, 4, 5, 6], anchor: 3 }, 0, "range", commits)).toEqual({
      rows: [1, 2, 3],
      primary: 0,
      anchor: 3,
    });
    // Without an anchor, Shift+click is a plain click.
    expect(nextSelection({ rows: [], anchor: null }, 2, "range", commits).rows).toEqual([2]);
  });
});
