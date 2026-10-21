// Turns parsed hunks (from Rust) into the flat row lists the virtualized views render.

import type { DiffLine } from "@/ipc/bindings/DiffLine";
import type { Hunk } from "@/ipc/bindings/Hunk";

export type DiffMode = "unified" | "split";

export type Side = "old" | "new";

/**
 * A diff line placed on one side, with its index into that side's text (`hunkSides`) and
 * into `hunk.lines`.
 */
export interface LineCell {
  line: DiffLine;
  side: Side;
  index: number;
  lineIndex: number;
}

/** Every row belongs to a hunk; a gap row sits before the hunk it names. */
export type DiffRow =
  | { kind: "gap"; hunk: number; count: number }
  | { kind: "hunk"; hunk: number }
  | { kind: "line"; hunk: number; cell: LineCell }
  | { kind: "pair"; hunk: number; old: LineCell | null; new: LineCell | null };

/** The old (context + removed) and new (context + added) text of a hunk, line by line. */
export function hunkSides(hunk: Hunk): Record<Side, string[]> {
  const sides: Record<Side, string[]> = { old: [], new: [] };
  for (const line of hunk.lines) {
    if (line.kind !== "add") sides.old.push(line.text);
    if (line.kind !== "del") sides.new.push(line.text);
  }
  return sides;
}

/**
 * Unchanged lines hidden before hunk `i` (since the previous hunk, or the start of the
 * file). A range with zero lines (`+5,0`) names the line *before* the change.
 */
export function unchangedBefore(hunks: readonly Hunk[], i: number): number {
  const hunk = hunks[i];
  if (!hunk) return 0;
  const before = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;
  const prev = hunks[i - 1];
  if (!prev) return Math.max(0, before);
  const prevEnd = prev.newLines === 0 ? prev.newStart : prev.newStart + prev.newLines - 1;
  return Math.max(0, before - prevEnd);
}

/** Walks a hunk's lines, numbering each side's text as `hunkSides` does. */
function cells(hunk: Hunk): { old: LineCell | null; new: LineCell | null }[] {
  let oldIndex = 0;
  let newIndex = 0;
  return hunk.lines.map((line, lineIndex) => ({
    old: line.kind === "add" ? null : { line, side: "old", index: oldIndex++, lineIndex },
    new: line.kind === "del" ? null : { line, side: "new", index: newIndex++, lineIndex },
  }));
}

function withHeaders(
  hunks: readonly Hunk[],
  body: (hunk: Hunk, i: number) => DiffRow[],
): DiffRow[] {
  const rows: DiffRow[] = [];
  hunks.forEach((hunk, i) => {
    const count = unchangedBefore(hunks, i);
    if (count > 0) rows.push({ kind: "gap", hunk: i, count });
    rows.push({ kind: "hunk", hunk: i });
    for (const row of body(hunk, i)) rows.push(row);
  });
  return rows;
}

/** One row per line; context lines read from the new side. */
export function unifiedRows(hunks: readonly Hunk[]): DiffRow[] {
  return withHeaders(hunks, (hunk, i) =>
    cells(hunk).map(({ old, new: next }) => ({ kind: "line", hunk: i, cell: (next ?? old)! })),
  );
}

/**
 * Old and new side by side. Within each run of changes, removed and added lines pair up in
 * order; the longer side's leftovers face an empty cell.
 */
export function splitRows(hunks: readonly Hunk[]): DiffRow[] {
  return withHeaders(hunks, (hunk, i) => {
    const rows: DiffRow[] = [];
    let dels: LineCell[] = [];
    let adds: LineCell[] = [];
    const flush = () => {
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        rows.push({ kind: "pair", hunk: i, old: dels[k] ?? null, new: adds[k] ?? null });
      }
      dels = [];
      adds = [];
    };
    for (const cell of cells(hunk)) {
      if (cell.old && cell.new) {
        flush();
        rows.push({ kind: "pair", hunk: i, ...cell });
      } else if (cell.old) dels.push(cell.old);
      else if (cell.new) adds.push(cell.new);
    }
    flush();
    return rows;
  });
}

/** Line-number columns worth showing in unified view: an added file has no old numbers. */
export function numberColumns(hunks: readonly Hunk[]): Side[] {
  const columns: Side[] = [];
  if (hunks.some((h) => h.oldLines > 0)) columns.push("old");
  if (hunks.some((h) => h.newLines > 0)) columns.push("new");
  return columns;
}

/** Digits needed for the largest line number in either column. */
export function lineNumberDigits(hunks: readonly Hunk[]): number {
  let max = 1;
  for (const h of hunks) max = Math.max(max, h.oldStart + h.oldLines, h.newStart + h.newLines);
  return String(max).length;
}

/** Matches `tab-size` on the code cells. */
export const TAB_WIDTH = 4;

function columns(text: string): number {
  let col = 0;
  for (const ch of text) col = ch === "\t" ? col + TAB_WIDTH - (col % TAB_WIDTH) : col + 1;
  return col;
}

/** The widest line on a side (tabs expanded), used to size the horizontal scroll range. */
export function widestLine(hunks: readonly Hunk[], side: Side | "both"): string {
  let widest = "";
  let width = 0;
  for (const h of hunks) {
    for (const line of h.lines) {
      if (side === "old" && line.kind === "add") continue;
      if (side === "new" && line.kind === "del") continue;
      // Cheap pre-check: a line can't be wider than its tab-expanded upper bound.
      if (line.text.length * TAB_WIDTH <= width) continue;
      const w = columns(line.text);
      if (w > width) {
        width = w;
        widest = line.text;
      }
    }
  }
  return widest;
}

/** Diff line height as a multiple of `--text-diff` (§4.4). */
const DIFF_LINE_HEIGHT = 1.6;
/** `--text-diff` at the default UI font size, used until the real size is measured. */
export const DEFAULT_DIFF_FONT_PX = 12.5;
/** Hunk headers fit a compact 24px button (§4.5); gap rows are a compact control. */
const HUNK_ROW_HEIGHT = 28;
const GAP_ROW_HEIGHT = 24;

/** Whole-pixel line row height for a measured `--text-diff`, so rows never blur. */
export function lineRowHeight(fontPx: number): number {
  return Math.round(fontPx * DIFF_LINE_HEIGHT);
}

export function rowHeight(row: DiffRow, lineHeight: number): number {
  if (row.kind === "hunk") return HUNK_ROW_HEIGHT;
  if (row.kind === "gap") return GAP_ROW_HEIGHT;
  return lineHeight;
}
