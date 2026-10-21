// Pure geometry for the commit graph canvas (DESIGN §4.11). Rows come from Rust
// (`GraphRow`): edges are drawn between a row's top edge, its centre (the dot) and its
// bottom edge.

import type { Edge } from "@/ipc";

export interface GraphMetrics {
  rowHeight: number;
  laneWidth: number;
  /** Space left of lane 0. */
  padding: number;
  lineWidth: number;
  dotRadius: number;
}

export const COMFORTABLE: GraphMetrics = {
  rowHeight: 30,
  laneWidth: 14,
  padding: 8,
  lineWidth: 2,
  dotRadius: 4,
};

export const COMPACT: GraphMetrics = {
  rowHeight: 24,
  laneWidth: 12,
  padding: 8,
  lineWidth: 1.5,
  dotRadius: 3.5,
};

/** Lanes beyond this are not drawn (a fade marks the cut). */
export const MAX_LANES = 12;

export function laneX(lane: number, m: GraphMetrics): number {
  return m.padding + lane * m.laneWidth + m.laneWidth / 2;
}

/** Width of the graph column for rows that use up to `lanes` lanes. */
export function graphWidth(lanes: number, m: GraphMetrics): number {
  return m.padding * 2 + Math.min(Math.max(lanes, 1), MAX_LANES) * m.laneWidth;
}

/** A segment as a cubic Bézier (straight when x is unchanged). */
export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Control points; equal x means a straight vertical line. */
  c0: [number, number];
  c1: [number, number];
  color: number;
}

/** Segment for an edge in a row whose top is at `top`. */
export function edgeSegment(edge: Edge, rowLane: number, top: number, m: GraphMetrics): Segment {
  const mid = top + m.rowHeight / 2;
  const bottom = top + m.rowHeight;
  let x0: number, y0: number, x1: number, y1: number;
  switch (edge.kind) {
    case "top":
      [x0, y0, x1, y1] = [laneX(edge.from, m), top, laneX(rowLane, m), mid];
      break;
    case "bottom":
      [x0, y0, x1, y1] = [laneX(rowLane, m), mid, laneX(edge.to, m), bottom];
      break;
    case "through":
      [x0, y0, x1, y1] = [laneX(edge.from, m), top, laneX(edge.to, m), bottom];
      break;
  }
  // Vertical tangents at both ends: the curve leaves and enters lanes straight.
  const cy = (y0 + y1) / 2;
  return { x0, y0, x1, y1, c0: [x0, cy], c1: [x1, cy], color: edge.color };
}

/** Rows `[first, last]` intersecting a viewport, with `overscan` extra rows each side. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
  overscan = 2,
): [number, number] {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(
    rowCount - 1,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );
  return [first, last];
}
