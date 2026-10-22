// Selecting several history rows: plain click replaces, Ctrl/Cmd+click toggles a row, Shift
// extends a range from the anchor. Rows are indices; `selectable` leaves out rows that aren't
// commits (the uncommitted-changes row).

export type SelectHow = "replace" | "toggle" | "range";

export interface RowSelection {
  /** Selected rows, ascending (history order, newest first). */
  rows: number[];
  /** The focused row: the details pane and single-commit actions use it. */
  primary: number;
  /** Where the next Shift range starts. */
  anchor: number;
}

export function nextSelection(
  current: { rows: number[]; anchor: number | null },
  index: number,
  how: SelectHow,
  selectable: (row: number) => boolean,
): RowSelection {
  if (how === "range" && current.anchor !== null) {
    const [lo, hi] = current.anchor < index ? [current.anchor, index] : [index, current.anchor];
    const rows: number[] = [];
    for (let row = lo; row <= hi; row++) if (selectable(row)) rows.push(row);
    return { rows, primary: index, anchor: current.anchor };
  }
  if (how === "toggle") {
    if (current.rows.includes(index)) {
      const rows = current.rows.filter((row) => row !== index);
      // The last row can't be unselected: one commit stays selected.
      if (rows.length === 0) return { rows: [index], primary: index, anchor: index };
      return { rows, primary: rows[0]!, anchor: index };
    }
    const rows = [...current.rows, index].sort((a, b) => a - b);
    return { rows, primary: index, anchor: index };
  }
  return { rows: [index], primary: index, anchor: index };
}
