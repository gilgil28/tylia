// Line selection for staging. A key names one line of the rendered diff as
// `${hunkIndex}:${lineIndex}` (indices into `diff.content.hunks` / `hunk.lines`); only added
// and removed lines are selectable.

import type { Hunk } from "@/ipc/bindings/Hunk";

export type ChangeKind = "add" | "del";

export function lineKey(hunk: number, line: number): string {
  return `${hunk}:${line}`;
}

/** The indices in a key, or null if it isn't one. */
export function parseLineKey(key: string): { hunk: number; line: number } | null {
  const match = /^(\d+):(\d+)$/.exec(key);
  return match ? { hunk: Number(match[1]), line: Number(match[2]) } : null;
}

/** Keys of a hunk's changed lines, in order. */
export function selectableKeys(hunk: Hunk, hunkIndex: number): string[] {
  const keys: string[] = [];
  hunk.lines.forEach((line, i) => {
    if (line.kind !== "context") keys.push(lineKey(hunkIndex, i));
  });
  return keys;
}

/**
 * Keys of the changed lines from one line to another (either direction, both included),
 * across hunks, in display order. The ends may be context lines; `only` keeps one kind
 * (a side-by-side column). Keys that don't parse give nothing.
 */
export function rangeKeys(
  hunks: readonly Hunk[],
  fromKey: string,
  toKey: string,
  only?: ChangeKind,
): string[] {
  const a = parseLineKey(fromKey);
  const b = parseLineKey(toKey);
  if (!a || !b) return [];
  const [start, end] = a.hunk < b.hunk || (a.hunk === b.hunk && a.line <= b.line) ? [a, b] : [b, a];
  const keys: string[] = [];
  for (let h = start.hunk; h <= end.hunk && h < hunks.length; h++) {
    const lines = hunks[h]!.lines;
    const last = h === end.hunk ? Math.min(end.line, lines.length - 1) : lines.length - 1;
    for (let l = h === start.hunk ? start.line : 0; l <= last; l++) {
      const kind = lines[l]!.kind;
      if (kind !== "context" && (!only || kind === only)) keys.push(lineKey(h, l));
    }
  }
  return keys;
}

/** How many lines are selected in each hunk (hunks with none are absent). */
export function countByHunk(selection: Iterable<string>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const key of selection) {
    const parsed = parseLineKey(key);
    if (parsed) counts.set(parsed.hunk, (counts.get(parsed.hunk) ?? 0) + 1);
  }
  return counts;
}
