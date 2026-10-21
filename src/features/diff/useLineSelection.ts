import type { Virtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import type { Hunk } from "@/ipc/bindings/Hunk";

import type { DiffMode, DiffRow, Side } from "./rows";
import { lineKey, parseLineKey, rangeKeys, type ChangeKind } from "./selection";

/** Within this distance of the top or bottom edge, a drag scrolls the diff. */
const EDGE_PX = 32;
/** Fastest auto-scroll, in px per frame. */
const MAX_SCROLL_PX = 24;

const EMPTY: ReadonlySet<string> = new Set();

interface Drag {
  pointerId: number;
  origin: string;
  /** The line the pointer was last over. */
  target: string;
  /** Selects, or deselects when the drag started on a selected line. */
  select: boolean;
  /** Side by side, a drag stays in the column it started in. */
  side: Side;
  only: ChangeKind | undefined;
  /** The selection before the drag; the dragged range is applied to it. */
  base: ReadonlySet<string>;
  clientY: number;
}

interface Options {
  hunks: readonly Hunk[];
  rows: readonly DiffRow[];
  mode: DiffMode;
  scrollRef: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  selection: ReadonlySet<string> | undefined;
  onSelectionChange: ((next: Set<string>) => void) | undefined;
}

/**
 * Pointer and keyboard handlers for the diff's scroll area that select changed lines from
 * their gutters (`data-line-key`): click toggles, Shift-click adds the range from the last
 * clicked line, press-and-drag selects or deselects every line passed over (scrolling at
 * the edges), Escape clears. Undefined when the diff isn't selectable.
 */
export function useLineSelection({
  hunks,
  rows,
  mode,
  scrollRef,
  virtualizer,
  selection = EMPTY,
  onSelectionChange,
}: Options) {
  const anchor = useRef<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);

  // Keys from another diff mean nothing here.
  useEffect(() => {
    anchor.current = null;
    drag.current = null;
  }, [hunks]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  if (!onSelectionChange) return undefined;

  const kindOf = (key: string): ChangeKind | undefined => {
    const at = parseLineKey(key);
    const kind = at && hunks[at.hunk]?.lines[at.line]?.kind;
    return kind === "add" || kind === "del" ? kind : undefined;
  };

  const apply = (d: Drag) => {
    const next = new Set(d.base);
    for (const key of rangeKeys(hunks, d.origin, d.target, d.only)) {
      if (d.select) next.add(key);
      else next.delete(key);
    }
    onSelectionChange(next);
  };

  /** The line at a viewport y, clamped to the visible rows; null on headers and gaps. */
  const lineAt = (clientY: number, side: Side): string | null => {
    const el = scrollRef.current!;
    const top = el.getBoundingClientRect().top;
    const y = Math.min(Math.max(clientY - top, 0), el.clientHeight - 1) + el.scrollTop;
    const item = virtualizer.getVirtualItemForOffset(y);
    const row = item && rows[item.index];
    if (!row) return null;
    // Side by side, a row empty on the drag's side still marks how far the drag reached.
    const cell =
      row.kind === "line"
        ? row.cell
        : row.kind === "pair"
          ? (row[side] ?? row[side === "old" ? "new" : "old"])
          : null;
    return cell && lineKey(row.hunk, cell.lineIndex);
  };

  const extend = (d: Drag) => {
    const target = lineAt(d.clientY, d.side);
    if (!target || target === d.target) return;
    d.target = target;
    apply(d);
  };

  // Reads only refs, so a frame scheduled by an earlier render is still correct; the
  // scroll it causes extends the drag through `onScroll`.
  const autoScroll = () => {
    const d = drag.current;
    const el = scrollRef.current;
    frame.current = 0;
    if (!d || !el) return;
    const top = el.getBoundingClientRect().top;
    const above = top + EDGE_PX - d.clientY;
    const below = d.clientY - (top + el.clientHeight - EDGE_PX);
    const depth = Math.max(above, below);
    if (depth <= 0) return;
    el.scrollTop += Math.sign(below - above) * Math.min(MAX_SCROLL_PX, Math.ceil(depth / 2));
    frame.current = requestAnimationFrame(autoScroll);
  };

  const end = () => {
    drag.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  return {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button !== 0) return;
      const key = (e.target as Element).closest<HTMLElement>("[data-line-key]")?.dataset.lineKey;
      const kind = key && kindOf(key);
      if (!key || !kind) return;
      const from = anchor.current;
      if (e.shiftKey && from) {
        // Shift-click would otherwise extend any text selection in the code to here.
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        const only = mode === "split" && kindOf(from) === kind ? kind : undefined;
        onSelectionChange(new Set([...selection, ...rangeKeys(hunks, from, key, only)]));
        return;
      }
      anchor.current = key;
      const d: Drag = {
        pointerId: e.pointerId,
        origin: key,
        target: key,
        select: !selection.has(key),
        side: kind === "del" ? "old" : "new",
        only: mode === "split" ? kind : undefined,
        base: selection,
        clientY: e.clientY,
      };
      drag.current = d;
      e.currentTarget.setPointerCapture(e.pointerId);
      apply(d);
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.clientY = e.clientY;
      extend(d);
      if (!frame.current) frame.current = requestAnimationFrame(autoScroll);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onScroll() {
      if (drag.current) extend(drag.current);
    },
    onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      if (e.key !== "Escape" || selection.size === 0) return;
      e.stopPropagation();
      onSelectionChange(new Set());
    },
  };
}
