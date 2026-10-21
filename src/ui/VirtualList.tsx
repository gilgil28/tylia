import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "./cn";

interface VirtualListProps<T> {
  items: T[];
  /** Fixed row height in px (the density's `--row-h`). */
  rowHeight: number;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  /** Enter or double-click. */
  onActivate?: (index: number) => void;
  "aria-label": string;
  className?: string;
}

/**
 * Windowed list for long data (history, file lists). Arrow keys, Page Up/Down, Home and End
 * move the selection; the selected row is tinted more strongly while the list has focus.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  getKey,
  renderRow,
  selectedIndex,
  onSelect,
  onActivate,
  className,
  ...aria
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  useEffect(() => {
    if (selectedIndex !== null) virtualizer.scrollToIndex(selectedIndex);
  }, [selectedIndex, virtualizer]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    const last = items.length - 1;
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / rowHeight) - 1);
    const current = selectedIndex ?? -1;
    const next: Record<string, number> = {
      ArrowDown: Math.min(last, current + 1),
      ArrowUp: Math.max(0, current - 1),
      PageDown: Math.min(last, current + page),
      PageUp: Math.max(0, current - page),
      Home: 0,
      End: last,
    };
    if (e.key in next) {
      e.preventDefault();
      onSelect(next[e.key]!);
    } else if (e.key === "Enter" && selectedIndex !== null) {
      e.preventDefault();
      onActivate?.(selectedIndex);
    }
  };

  return (
    <div
      ref={scrollRef}
      role="listbox"
      tabIndex={0}
      aria-activedescendant={selectedIndex !== null ? `${idPrefix}-${selectedIndex}` : undefined}
      onKeyDown={onKeyDown}
      className={cn("group/list relative h-full overflow-auto outline-none", className)}
      {...aria}
    >
      <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index]!;
          const selected = row.index === selectedIndex;
          return (
            <div
              key={getKey(item, row.index)}
              id={`${idPrefix}-${row.index}`}
              role="option"
              aria-selected={selected}
              onMouseDown={() => onSelect(row.index)}
              onDoubleClick={() => onActivate?.(row.index)}
              style={{ height: rowHeight, transform: `translateY(${row.start}px)` }}
              className={cn(
                "absolute inset-x-0 top-0 flex items-center px-2",
                selected ? "bg-selected group-focus/list:bg-selected-strong" : "hover:bg-hover",
              )}
            >
              {renderRow(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
