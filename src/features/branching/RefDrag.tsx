// Drag a branch badge onto the current branch's row → Merge / Rebase (pointer events: the
// webview's native drag-and-drop is taken by file drops).

import { GitMerge, GitPullRequestArrow } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { t } from "@/i18n";
import { cn } from "@/ui/cn";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/Popover";

/** Pointer travel before a press on a badge becomes a drag. */
const DRAG_THRESHOLD = 5;

interface Dragging {
  name: string;
  x: number;
  y: number;
  over: boolean;
}

export interface Dropped {
  name: string;
  x: number;
  y: number;
}

/**
 * Starts on a pointer-down over a local or remote branch badge (not the current branch).
 * `isTarget` says whether the element under the pointer accepts the drop.
 */
export function useRefDrag(
  isTarget: (el: Element | null) => boolean,
  onDrop: (d: Dropped) => void,
) {
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const press = useRef<{ name: string; x: number; y: number } | null>(null);
  const latest = useRef({ isTarget, onDrop });
  useEffect(() => {
    latest.current = { isTarget, onDrop };
  });

  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      const over = latest.current.isTarget(document.elementFromPoint(e.clientX, e.clientY));
      setDragging({ name: p.name, x: e.clientX, y: e.clientY, over });
    };
    const up = (e: globalThis.PointerEvent) => {
      if (dragging?.over)
        latest.current.onDrop({ name: dragging.name, x: e.clientX, y: e.clientY });
      press.current = null;
      setDragging(null);
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      press.current = null;
      setDragging(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", cancel);
    };
  }, [dragging]);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const badge = (e.target as HTMLElement).closest<HTMLElement>("[data-ref-kind]");
    const kind = badge?.dataset.refKind;
    if (!badge || (kind !== "local" && kind !== "remote") || badge.dataset.refCurrent) return;
    press.current = { name: badge.dataset.refName!, x: e.clientX, y: e.clientY };
  };

  const ghost = dragging && (
    <div
      className={cn(
        "pointer-events-none fixed z-50 rounded-badge px-2 py-1 text-small shadow-float",
        dragging.over ? "bg-accent-fill text-on-accent" : "bg-elevated text-fg",
      )}
      style={{ left: dragging.x + 12, top: dragging.y + 12 }}
    >
      {dragging.over
        ? t("drag.drop", { name: dragging.name })
        : t("drag.hint", { name: dragging.name })}
    </div>
  );

  return { onPointerDown, ghost, dragging: !!dragging };
}

/** The Merge / Rebase choice where a branch was dropped. */
export function DropMenu({
  drop,
  current,
  onMerge,
  onRebase,
  onClose,
}: {
  drop: Dropped;
  current: string;
  onMerge: () => void;
  onRebase: () => void;
  onClose: () => void;
}) {
  const anchor = useRef({
    getBoundingClientRect: () => DOMRect.fromRect({ x: drop.x, y: drop.y, width: 0, height: 0 }),
  });
  const item =
    "flex h-7 w-full items-center gap-2 rounded-control px-2 text-left outline-none hover:bg-hover focus-visible:bg-hover";
  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent align="start" className="min-w-56 p-1" role="menu">
        <button
          type="button"
          role="menuitem"
          className={item}
          autoFocus
          onClick={() => {
            onClose();
            onMerge();
          }}
        >
          <GitMerge size={16} strokeWidth={1.75} aria-hidden className="opacity-80" />
          {t("menu.mergeInto", { name: drop.name, branch: current })}
        </button>
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onClose();
            onRebase();
          }}
        >
          <GitPullRequestArrow size={16} strokeWidth={1.75} aria-hidden className="opacity-80" />
          {t("menu.rebaseOnto", { branch: current, name: drop.name })}
        </button>
      </PopoverContent>
    </Popover>
  );
}
