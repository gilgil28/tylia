// Canvas drawing of the commit graph. Rust sends straight lane runs as segments (half-row
// units) and per-row curves; colours come from the design tokens (`--lane-1..8`,
// `--bg-app`, `--accent`).

import type { GraphCell } from "@/ipc";

import { edgeSegment, laneX, MAX_LANES, type GraphMetrics } from "./geometry";
import type { Segment } from "./segment-index";

export interface GraphColors {
  lanes: string[];
  background: string;
  accent: string;
}

export interface DrawRow {
  graph: GraphCell;
  /** The commit HEAD points at. */
  head: boolean;
}

/** Reads the colour tokens from the document (call again after a theme change). */
export function readColors(): GraphColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    lanes: Array.from({ length: 8 }, (_, i) => v(`--lane-${i + 1}`)),
    background: v("--bg-app"),
    accent: v("--accent"),
  };
}

export interface DrawInput {
  /** Commit row `i` of the stream (not counting the pseudo row). */
  row: (index: number) => DrawRow | undefined;
  /** First and last stream rows to draw. */
  first: number;
  last: number;
  segments: Segment[];
  /** Y of stream row 0's top edge, in canvas pixels (accounts for scroll and pseudo row). */
  originY: number;
  width: number;
  /** Uncommitted changes, drawn above row 0 at `y` (its centre). */
  pseudoRow: { y: number; lane: number; connect: boolean } | null;
  /** Stream rows of a first-parent path to underline faintly (ascending), with its colour. */
  highlight?: { rows: number[]; color: number } | null;
}

/** A soft band under the graph through the dots of `rows` (a first-parent path). */
function drawHighlight(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  m: GraphMetrics,
  color: string,
) {
  const { highlight, row, first, last, originY } = input;
  if (!highlight || highlight.rows.length < 2) return;
  const half = m.rowHeight / 2;
  const point = (i: number) => {
    const lane = Math.min(row(i)?.graph.lane ?? 0, OVERFLOW_LANE);
    return [laneX(lane, m), originY + i * m.rowHeight + half] as const;
  };
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = color;
  ctx.lineWidth = m.laneWidth * 0.9;
  ctx.lineCap = "round";
  ctx.beginPath();
  let started = false;
  for (let k = 0; k < highlight.rows.length; k++) {
    const i = highlight.rows[k]!;
    const next = highlight.rows[k + 1];
    // Only the part that can be on screen (keeping the step that enters it).
    if (i > last + 1 && (k === 0 || highlight.rows[k - 1]! > last + 1)) break;
    if (next !== undefined && next < first - 1) continue;
    const [x, y] = point(i);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    }
    if (next === undefined) break;
    const [nx, ny] = point(next);
    if (nx === x) ctx.lineTo(nx, ny);
    else {
      // Change lanes within the last row before the parent, like the graph's curves.
      const bend = Math.max(y, ny - m.rowHeight);
      ctx.lineTo(x, bend);
      ctx.bezierCurveTo(x, bend + half, nx, ny - half, nx, ny);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Commit dots on lanes past the cap are drawn in this extra column. */
export const OVERFLOW_LANE = MAX_LANES;

export function drawGraph(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  m: GraphMetrics,
  colors: GraphColors,
) {
  const { row, first, last, segments, originY, pseudoRow } = input;
  const lane = (c: number) => colors.lanes[c % colors.lanes.length]!;
  const half = m.rowHeight / 2;
  const capX = laneX(MAX_LANES, m) - m.laneWidth / 2;
  if (input.highlight) drawHighlight(ctx, input, m, lane(input.highlight.color));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = m.lineWidth;

  // Lines are clipped at the lane cap; dots are drawn on top so lines pass behind them.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, capX, ctx.canvas.height);
  ctx.clip();
  for (const [l, color, start, end] of segments) {
    if (l >= MAX_LANES) continue;
    const x = laneX(l, m);
    ctx.strokeStyle = lane(color);
    ctx.beginPath();
    ctx.moveTo(x, originY + start * half);
    ctx.lineTo(x, originY + end * half);
    ctx.stroke();
  }
  for (let i = first; i <= last; i++) {
    const r = row(i);
    if (!r) continue;
    const top = originY + i * m.rowHeight;
    for (const edge of r.graph.curves) {
      if (edge.from >= MAX_LANES && edge.to >= MAX_LANES) continue;
      const s = edgeSegment(edge, r.graph.lane, top, m);
      ctx.strokeStyle = lane(s.color);
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.bezierCurveTo(s.c0[0], s.c0[1], s.c1[0], s.c1[1], s.x1, s.y1);
      ctx.stroke();
    }
  }
  ctx.restore();

  for (let i = first; i <= last; i++) {
    const r = row(i);
    if (!r) continue;
    const overflow = r.graph.lane >= MAX_LANES;
    const x = laneX(overflow ? OVERFLOW_LANE : r.graph.lane, m);
    const y = originY + i * m.rowHeight + half;
    const color = lane(r.graph.color);
    if (r.head) {
      ctx.beginPath();
      ctx.arc(x, y, m.dotRadius + 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = m.lineWidth;
    }
    // Outline in the background colour, then the dot (filled) or ring (merge).
    ctx.beginPath();
    ctx.arc(x, y, m.dotRadius + 2, 0, Math.PI * 2);
    ctx.fillStyle = colors.background;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r.graph.isMerge ? m.dotRadius - 0.75 : m.dotRadius, 0, Math.PI * 2);
    if (r.graph.isMerge) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.stroke();
      ctx.lineWidth = m.lineWidth;
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  if (pseudoRow) {
    // Uncommitted changes: dashed hollow dot, dashed line down into HEAD's dot.
    const x = laneX(Math.min(pseudoRow.lane, OVERFLOW_LANE), m);
    ctx.save();
    ctx.setLineDash([2, 2.5]);
    ctx.strokeStyle = colors.lanes[0]!;
    ctx.lineWidth = 1.5;
    if (pseudoRow.connect) {
      ctx.beginPath();
      ctx.moveTo(x, pseudoRow.y + m.dotRadius);
      ctx.lineTo(x, pseudoRow.y + m.rowHeight - m.dotRadius - 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, pseudoRow.y, m.dotRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
