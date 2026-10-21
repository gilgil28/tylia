import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { StatusGlyph } from "@/features/commit-details/StatusGlyph";
import { t } from "@/i18n";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { cn } from "@/ui/cn";
import { ContextMenu } from "@/ui/Menu";

import { entryKey, type Area, type ChangedEntry } from "./changes-model";

const ROW = 26;

interface ChangeListProps {
  area: Area;
  entries: ChangedEntry[];
  /** Selected entry keys (see `entryKey`). */
  selected: ReadonlySet<string>;
  /** The entry whose diff is shown. */
  focusKey: string | null;
  onRowPointerDown: (entry: ChangedEntry, e: PointerEvent<HTMLDivElement>) => void;
  /** Stage (unstaged list) or unstage (staged list) these entries. */
  onToggle: (entries: ChangedEntry[]) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** A drag from the other list is over this one. */
  dropActive: boolean;
  /** Context menu items for an entry (it is selected first). */
  menu: (entry: ChangedEntry) => ReactNode;
  action: { label: string; onClick: () => void } | null;
  /** Extra header control (e.g. "Discard all"). */
  extra?: ReactNode;
  empty: ReactNode;
}

/** One of the two lists of the Changes view: unstaged or staged files. */
export function ChangeList({
  area,
  entries,
  selected,
  focusKey,
  onRowPointerDown,
  onToggle,
  onKeyDown,
  dropActive,
  menu,
  action,
  extra,
  empty,
}: ChangeListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 10,
  });
  const focusIndex = entries.findIndex((e) => entryKey(e) === focusKey);
  useEffect(() => {
    if (focusIndex >= 0) virtualizer.scrollToIndex(focusIndex);
  }, [focusIndex, virtualizer]);

  const title = area === "staged" ? t("changes.staged") : t("changes.unstaged");
  return (
    <section
      data-drop-area={area}
      className={cn(
        "flex min-h-0 flex-1 flex-col transition-colors duration-(--dur-fast)",
        dropActive && "bg-selected",
      )}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-3">
        <span className="truncate text-caption font-medium text-fg-muted">
          {title} · {entries.length}
        </span>
        {entries.length > 0 && (
          <span className="flex items-center gap-1">
            {extra}
            {action && (
              <Button size="sm" variant="ghost" onClick={action.onClick}>
                {action.label}
              </Button>
            )}
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-small text-fg-muted">
          {dropActive
            ? area === "staged"
              ? t("changes.dropToStage")
              : t("changes.dropToUnstage")
            : empty}
        </div>
      ) : (
        <div
          ref={scrollRef}
          role="listbox"
          aria-label={title}
          aria-multiselectable
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="group/list relative min-h-0 flex-1 overflow-auto outline-none"
        >
          <div style={{ height: virtualizer.getTotalSize() }} className="relative">
            {virtualizer.getVirtualItems().map((v) => {
              const entry = entries[v.index]!;
              const key = entryKey(entry);
              const isSelected = selected.has(key);
              const slash = entry.path.lastIndexOf("/");
              return (
                <ContextMenu.Root key={key}>
                  <ContextMenu.Trigger asChild>
                    <div
                      role="option"
                      aria-selected={isSelected}
                      title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
                      onPointerDown={(e) => onRowPointerDown(entry, e)}
                      onDoubleClick={() => onToggle([entry])}
                      style={{ height: ROW, transform: `translateY(${v.start}px)` }}
                      className={cn(
                        "absolute inset-x-0 top-0 flex items-center gap-2 px-3",
                        isSelected
                          ? "bg-selected group-focus/list:bg-selected-strong"
                          : "hover:bg-hover",
                        key === focusKey && "shadow-[inset_2px_0_0_var(--accent)]",
                      )}
                    >
                      {/* The checkbox stages/unstages without changing the selection (keyboard:
                          Space on the row, so the checkbox itself is mouse-only). */}
                      <span onPointerDown={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={area === "staged"}
                          onCheckedChange={() => onToggle([entry])}
                          aria-label={area === "staged" ? t("changes.unstage") : t("changes.stage")}
                          presentational
                        />
                      </span>
                      <StatusGlyph status={entry.status} />
                      <span className="truncate text-fg">{entry.path.slice(slash + 1)}</span>
                      {slash > 0 && (
                        <span className="min-w-0 truncate text-small text-fg-muted">
                          {entry.path.slice(0, slash)}
                        </span>
                      )}
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Content>{menu(entry)}</ContextMenu.Content>
                </ContextMenu.Root>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
