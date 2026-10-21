import { describe, expect, it } from "vitest";

import { COMFORTABLE as m, edgeSegment, graphWidth, laneX, visibleRange } from "./geometry";

describe("graph geometry", () => {
  it("places lanes on a 14px pitch after 8px padding", () => {
    expect(laneX(0, m)).toBe(15);
    expect(laneX(2, m)).toBe(43);
    expect(graphWidth(3, m)).toBe(8 * 2 + 3 * 14);
    expect(graphWidth(40, m)).toBe(graphWidth(12, m));
    expect(graphWidth(0, m)).toBe(graphWidth(1, m));
  });

  it("maps edge kinds to row positions", () => {
    const top = edgeSegment({ from: 1, to: 0, color: 2, kind: "top" }, 0, 60, m);
    expect([top.x0, top.y0, top.x1, top.y1]).toEqual([laneX(1, m), 60, laneX(0, m), 75]);
    const bottom = edgeSegment({ from: 0, to: 2, color: 1, kind: "bottom" }, 0, 60, m);
    expect([bottom.y0, bottom.x1, bottom.y1]).toEqual([75, laneX(2, m), 90]);
    const through = edgeSegment({ from: 3, to: 3, color: 4, kind: "through" }, 0, 0, m);
    expect([through.y0, through.y1]).toEqual([0, 30]);
    // Vertical tangents.
    expect(bottom.c0[0]).toBe(bottom.x0);
    expect(bottom.c1[0]).toBe(bottom.x1);
  });

  it("computes the visible row range with overscan", () => {
    expect(visibleRange(0, 300, 1000, 30)).toEqual([0, 12]);
    expect(visibleRange(3000, 300, 1000, 30)).toEqual([98, 112]);
    expect(visibleRange(29_900, 300, 1000, 30)).toEqual([994, 999]);
  });
});
