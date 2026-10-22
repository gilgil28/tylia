import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, ArrowDown, ArrowUp, GitCommitHorizontal, SearchX, SquarePen } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { shortHash, timeLabel } from "@/app/format";
import { useRegisterActions } from "@/app/actions";
import { useSettings } from "@/app/settings";
import { useDebounced } from "@/app/useDebounced";
import { isMod } from "@/app/keyboard";
import { useWorkspace, type ColumnId, type RepoLayout } from "@/app/workspace";
import { useBranchDialog } from "@/features/branching/dialog-store";
import { CommitItems, CommitsItems, useMenuContext } from "@/features/branching/menus";
import { DropMenu, useRefDrag, type Dropped } from "@/features/branching/RefDrag";
import { COMFORTABLE, COMPACT, graphWidth, MAX_LANES } from "@/features/graph/geometry";
import { GraphCanvas } from "@/features/graph/GraphCanvas";
import { useRepoUi } from "@/features/repo/repo-store";
import { plural, t } from "@/i18n";
import { ipc, isIpcError, type HistoryRow, type RefsSnapshot, type WorkingStatus } from "@/ipc";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ContextMenu } from "@/ui/Menu";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { RefBadgeList, type RefInfo } from "@/ui/RefBadge";
import { SkeletonRows } from "@/ui/Skeleton";
import { toast } from "@/ui/Toast";

import { CommitGraphOffer } from "./CommitGraphOffer";
import type { HistoryStream } from "./history-stream";
import { nextSelection, type SelectHow } from "./multiSelect";
import { refsByCommit } from "./ref-badges";

const COLUMN_LABELS: Record<ColumnId, string> = {
  graph: t("history.graph"),
  description: t("history.description"),
  author: t("history.author"),
  date: t("history.date"),
  hash: t("history.hash"),
};
const DEFAULT_WIDTHS: Record<Exclude<ColumnId, "graph" | "description">, number> = {
  author: 168,
  date: 128,
  hash: 84,
};
const MIN_COLUMN = 56;
const MIN_DESCRIPTION = 160;
type ResizableColumn = Exclude<ColumnId, "graph">;
/** Two presses on a handle within this time reset the column. `dblclick` is handled too, but
 * doesn't always fire after a captured drag. */
const DOUBLE_PRESS_MS = 400;

type Item = { kind: "uncommitted" } | { kind: "commit"; row: HistoryRow };

interface HistoryViewProps {
  repo: string;
  stream: HistoryStream;
  refs: RefsSnapshot | undefined;
  status: WorkingStatus | undefined;
  layout: RepoLayout;
  /** Enter on a row: move focus to the details. */
  onActivate: () => void;
  /** This repository's tab is visible (its actions are registered). */
  active: boolean;
}

/** Longest first-parent path followed for the hover highlight. */
const MAX_PATH = 5000;

export function HistoryView({
  repo,
  stream,
  refs,
  status,
  layout,
  onActivate,
  active,
}: HistoryViewProps) {
  const metrics = useSettings((s) => s.settings.density) === "compact" ? COMPACT : COMFORTABLE;
  const rowHeight = metrics.rowHeight;
  const selection = useRepoUi((s) => s.selection);
  const select = useRepoUi((s) => s.select);
  const selectedOids = useRepoUi((s) => s.selectedOids);
  const selectMany = useRepoUi((s) => s.selectMany);
  const search = useRepoUi((s) => s.search);
  const setSearch = useRepoUi((s) => s.setSearch);
  const setView = useRepoUi((s) => s.setView);
  const revealOid = useRepoUi((s) => s.revealOid);
  const revealed = useRepoUi((s) => s.revealed);
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const scrollRef = useRef<HTMLDivElement>(null);

  const badges = useMemo(() => (refs ? refsByCommit(refs) : new Map<string, RefInfo[]>()), [refs]);
  const headOid = refs?.head.oid ?? null;
  const changed = status?.entries.length ?? 0;
  const menuCtx = useMenuContext(repo, refs, status);
  const openDialog = useBranchDialog((s) => s.open);
  // The row the context menu is for: a commit, or the uncommitted-changes row.
  const [menuRow, setMenuRow] = useState<
    { oid: string; subject: string } | "uncommitted" | "several" | null
  >(null);
  const [dropped, setDropped] = useState<Dropped | null>(null);

  // Search: matching commit ids from the backend (hash prefixes also match loaded rows).
  const query = useDebounced(search.query.trim(), 250);
  const searchResult = useQuery({
    queryKey: ["search", repo, layout.scope, search.field, query],
    queryFn: () =>
      ipc.searchHistory(repo, { scope: layout.scope, order: "date" }, search.field, query),
    enabled: query !== "",
    retry: false,
  });
  const searching = query !== "";

  // Search results; otherwise rows are addressed by index (no per-batch copy of 100k rows).
  const filtered = useMemo(() => {
    if (!searching) return null;
    const matches = new Set(searchResult.data ?? []);
    const lower = query.toLowerCase();
    return stream.rows.filter(
      (r) => matches.has(r.oid) || (search.field === "hash" && r.oid.startsWith(lower)),
    );
    // stream.version tracks row changes inside the (mutable) stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.version, stream.rows, searching, searchResult.data, query, search.field]);
  const offset = !searching && changed > 0 ? 1 : 0;
  const count = filtered ? filtered.length : stream.rows.length + offset;
  const itemAt = useCallback(
    (i: number): Item | undefined => {
      if (filtered) {
        const row = filtered[i];
        return row && { kind: "commit", row };
      }
      if (i < offset) return { kind: "uncommitted" };
      const row = stream.rows[i - offset];
      return row && { kind: "commit", row };
    },
    // stream.version: rows are appended in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, offset, stream.rows, stream.version],
  );

  // Drag a branch badge onto the current branch's row to merge or rebase.
  const refDrag = useRefDrag((el) => {
    if (!refs?.head.branch || status?.operation) return false;
    const row = el?.closest<HTMLElement>("[data-index]");
    const it = row ? itemAt(Number(row.dataset.index)) : undefined;
    return it?.kind === "commit" && it.row.oid === headOid;
  }, setDropped);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  let selectedIndex = -1;
  if (selection?.kind === "commit") {
    selectedIndex = filtered
      ? filtered.findIndex((r) => r.oid === selection.oid)
      : (stream.index.get(selection.oid) ?? -1 - offset) + offset;
  }

  const selectIndex = useCallback(
    (index: number) => {
      const it = itemAt(index);
      if (!it) return;
      // The uncommitted-changes row opens the Changes view.
      if (it.kind === "uncommitted") setView("changes");
      else {
        select({ kind: "commit", oid: it.row.oid });
        virtualizer.scrollToIndex(index);
      }
    },
    [itemAt, select, setView, virtualizer],
  );

  // Several commits: Ctrl/Cmd+click toggles, Shift+click / Shift+↑↓ extend from the anchor.
  const several = new Set(selectedOids);
  const rowOf = (oid: string) =>
    filtered
      ? filtered.findIndex((r) => r.oid === oid)
      : (stream.index.get(oid) ?? -1 - offset) + offset;
  const anchor = useRef<string | null>(null);
  const pick = (index: number, how: SelectHow) => {
    const it = itemAt(index);
    if (how === "replace" || it?.kind !== "commit" || selectedIndex < 0) {
      if (it?.kind === "commit") anchor.current = it.row.oid;
      selectIndex(index);
      return;
    }
    const rows = selectedOids.length > 1 ? selectedOids.map(rowOf) : [selectedIndex];
    const anchorRow = anchor.current ? rowOf(anchor.current) : selectedIndex;
    const next = nextSelection(
      { rows: rows.filter((r) => r >= 0), anchor: anchorRow >= 0 ? anchorRow : null },
      index,
      how,
      (row) => itemAt(row)?.kind === "commit",
    );
    const oidAt = (row: number) => {
      const at = itemAt(row);
      return at?.kind === "commit" ? at.row.oid : null;
    };
    anchor.current = oidAt(next.anchor);
    const oids = next.rows.map(oidAt).filter((o): o is string => o !== null);
    selectMany(oids, oidAt(next.primary) ?? oids[0]!);
    virtualizer.scrollToIndex(index);
  };

  // Hover: underline the hovered commit's first-parent path in the graph.
  const [hovered, setHovered] = useState<string | null>(null);
  const highlight = useMemo(() => {
    const start = hovered ? stream.index.get(hovered) : undefined;
    if (start === undefined || filtered) return null;
    const rows = [start];
    let row = stream.rows[start];
    while (row?.parents[0] && rows.length < MAX_PATH) {
      const next = stream.index.get(row.parents[0]);
      if (next === undefined) break;
      rows.push(next);
      row = stream.rows[next];
    }
    return { rows, color: stream.rows[start]!.graph.color };
    // stream.version: rows are appended in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, filtered, stream.index, stream.rows, stream.version]);

  // Jump along the graph from the selected commit.
  const selectedRow = selection?.kind === "commit" ? stream.index.get(selection.oid) : undefined;
  const jump = (oid: string | undefined) => {
    if (!oid) return;
    const index = stream.index.get(oid);
    if (index !== undefined) selectIndex(index + offset);
  };
  const childOf = (oid: string) => {
    // Children come before their parent in the stream; prefer a first-parent child.
    const index = stream.index.get(oid) ?? 0;
    let other: string | undefined;
    for (let i = index - 1; i >= 0; i--) {
      const r = stream.rows[i]!;
      if (r.parents[0] === oid) return r.oid;
      if (!other && r.parents.includes(oid)) other = r.oid;
    }
    return other;
  };
  const current = selectedRow !== undefined ? stream.rows[selectedRow] : undefined;
  useRegisterActions(
    `history:${repo}`,
    [
      {
        id: "history.parent",
        title: t("history.jumpParent"),
        group: "history",
        icon: ArrowDown,
        shortcut: "Alt+Down",
        disabled: !current?.parents[0] || stream.index.get(current.parents[0]) === undefined,
        run: () => jump(current?.parents[0]),
      },
      {
        id: "history.child",
        title: t("history.jumpChild"),
        group: "history",
        icon: ArrowUp,
        shortcut: "Alt+Up",
        disabled: !current || selectedRow === 0,
        run: () => current && jump(childOf(current.oid)),
      },
    ],
    active,
  );

  // Select the first commit once rows arrive.
  useEffect(() => {
    if (selection === null && count > offset && !revealOid) selectIndex(offset);
  }, [selection, count, offset, revealOid, selectIndex]);

  // Reveal a commit chosen in the sidebar, once it has streamed in.
  useEffect(() => {
    if (!revealOid) return;
    const index = stream.index.get(revealOid);
    if (index !== undefined) {
      const at = index + offset;
      select({ kind: "commit", oid: revealOid });
      virtualizer.scrollToIndex(at, { align: "center" });
      revealed();
    } else if (stream.done) {
      revealed();
      toast({
        kind: "error",
        title: t("history.notInView"),
        action:
          layout.scope === "head"
            ? { label: t("history.showAll"), run: () => updateLayout(repo, { scope: "all" }) }
            : undefined,
      });
    }
  }, [
    revealOid,
    stream.version,
    stream.index,
    stream.done,
    offset,
    select,
    virtualizer,
    revealed,
    layout.scope,
    updateLayout,
    repo,
  ]);

  // Graph column width: the widest row in the visible window (DESIGN §4.11).
  const range = virtualizer.getVirtualItems();
  let lanes = 1;
  for (const v of range) {
    const it = itemAt(v.index);
    if (it?.kind === "commit") lanes = Math.max(lanes, it.row.graph.width);
  }
  const showGraph = !searching && !layout.hiddenColumns.includes("graph");
  // Past the lane cap, one extra column shows the dots of commits on hidden lanes.
  const graphPx =
    lanes > MAX_LANES
      ? graphWidth(MAX_LANES, metrics) + metrics.laneWidth
      : graphWidth(lanes, metrics);
  const headRow = headOid ? stream.index.get(headOid) : undefined;

  const columns = (["graph", "description", "author", "date", "hash"] as const).filter(
    (c) => c === "description" || (c === "graph" ? showGraph : !layout.hiddenColumns.includes(c)),
  );
  // Every column has its own width. Description fills the remaining space until the user
  // resizes a column; from then on it keeps its own width too, and an empty filler column
  // takes up any space left, so resizing one column never changes another.
  const descriptionPx = layout.columnWidths.description;
  const pxOf = (c: ColumnId) =>
    c === "graph"
      ? graphPx
      : c === "description"
        ? (descriptionPx ?? MIN_DESCRIPTION)
        : (layout.columnWidths[c] ?? DEFAULT_WIDTHS[c]);
  const template = columns.map((c) =>
    c === "description" && descriptionPx === undefined
      ? `minmax(${MIN_DESCRIPTION}px, 1fr)`
      : `${pxOf(c)}px`,
  );
  if (descriptionPx !== undefined) template.push("minmax(0, 1fr)");
  const gridStyle: CSSProperties = { gridTemplateColumns: template.join(" ") };
  const contentWidth = columns.reduce((sum, c) => sum + pxOf(c), 0);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const last = count - 1;
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / rowHeight) - 1);
    const cur = selectedIndex < 0 ? -1 : selectedIndex;
    // Arrow keys stay on commits; the uncommitted row is opened with the mouse or sidebar.
    const next: Record<string, number> = {
      ArrowDown: Math.min(last, cur + 1),
      ArrowUp: Math.max(offset, cur - 1),
      PageDown: Math.min(last, cur + page),
      PageUp: Math.max(offset, cur - page),
      Home: offset,
      End: last,
    };
    if (e.key in next) {
      e.preventDefault();
      pick(next[e.key]!, e.shiftKey ? "range" : "replace");
    } else if (e.key === "Escape" && selectedOids.length > 1 && selectedIndex >= 0) {
      e.preventDefault();
      selectIndex(selectedIndex);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onActivate();
    }
  };

  const setHidden = (c: ColumnId, hidden: boolean) =>
    updateLayout(repo, {
      hiddenColumns: hidden
        ? [...layout.hiddenColumns, c]
        : layout.hiddenColumns.filter((x) => x !== c),
    });

  const headerRef = useRef<HTMLDivElement>(null);
  const lastPress = useRef<{ column: ColumnId; time: number } | null>(null);

  /** Drag a column's right edge: only that column changes width. */
  const startResize = (c: ResizableColumn) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const now = e.timeStamp;
    const prev = lastPress.current;
    lastPress.current = { column: c, time: now };
    if (prev?.column === c && now - prev.time < DOUBLE_PRESS_MS) {
      lastPress.current = null;
      resetWidth(c);
      return;
    }
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const cell = (id: ColumnId) =>
      headerRef.current?.querySelector<HTMLElement>(`[data-column="${id}"]`);
    const startX = e.clientX;
    const start = cell(c)?.getBoundingClientRect().width ?? pxOf(c);
    // Freeze the description at its current width so it stops absorbing changes.
    const frozen = {
      ...layout.columnWidths,
      description: Math.round(
        layout.columnWidths.description ??
          cell("description")?.getBoundingClientRect().width ??
          MIN_DESCRIPTION,
      ),
    };
    const min = c === "description" ? MIN_DESCRIPTION : MIN_COLUMN;
    const move = (ev: globalThis.PointerEvent) => {
      const w = Math.max(min, Math.round(start + ev.clientX - startX));
      updateLayout(repo, { columnWidths: { ...frozen, [c]: w } });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  /** Double-click a handle: back to the default width (description: fill the space). */
  const resetWidth = (c: ResizableColumn) => {
    const rest = { ...layout.columnWidths };
    delete rest[c];
    updateLayout(repo, { columnWidths: rest });
  };

  const header = (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {/* Scrolled horizontally in step with the rows (see onScroll below). */}
        <div
          ref={headerRef}
          role="rowgroup"
          className="shrink-0 overflow-hidden border-b border-line-subtle bg-panel"
        >
          <div
            role="row"
            style={{ ...gridStyle, minWidth: contentWidth }}
            className="grid h-7 items-center text-caption font-medium text-fg-muted"
          >
            {columns.map((c) => (
              <div
                key={c}
                role="columnheader"
                // Just the column's name (not its resize handle's label too).
                aria-label={c === "graph" ? undefined : COLUMN_LABELS[c]}
                data-column={c}
                className="relative flex h-full min-w-0 items-center px-2"
              >
                <span className="truncate">{c === "graph" ? "" : COLUMN_LABELS[c]}</span>
                {c !== "graph" && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t("history.resizeColumn", { column: COLUMN_LABELS[c] })}
                    onPointerDown={startResize(c)}
                    onDoubleClick={() => resetWidth(c)}
                    className="absolute top-1 -right-1 bottom-1 z-10 w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-1 after:w-px after:bg-line-subtle hover:after:bg-line-strong"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Label>{t("history.columns")}</ContextMenu.Label>
        {(["graph", "author", "date", "hash"] as const).map((c) => (
          <ContextMenu.CheckboxItem
            key={c}
            checked={!layout.hiddenColumns.includes(c)}
            onCheckedChange={(v) => setHidden(c, !v)}
          >
            {COLUMN_LABELS[c]}
          </ContextMenu.CheckboxItem>
        ))}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );

  let body: React.ReactNode;
  if (stream.error && stream.rows.length === 0) {
    const err = stream.error;
    body = (
      <div className="p-4">
        <ErrorPanel
          message={t("history.loadFailed")}
          command={isIpcError(err) ? err.command : null}
          stderr={isIpcError(err) ? (err.stderr ?? err.message) : String(err)}
        />
      </div>
    );
  } else if (!stream.done && stream.rows.length === 0) {
    body = <SkeletonRows count={14} className="pt-1" />;
  } else if (count === 0) {
    body = searching ? (
      searchResult.isError ? (
        <div className="p-4">
          <ErrorPanel
            message={t("search.failed")}
            stderr={String(
              (searchResult.error as { message?: string })?.message ?? searchResult.error,
            )}
          />
        </div>
      ) : (
        <EmptyState icon={SearchX} title={t("search.none", { query })} className="h-full" />
      )
    ) : (
      <EmptyState
        icon={GitCommitHorizontal}
        title={t("history.empty")}
        description={t("history.emptyBody")}
        className="h-full"
      />
    );
  }

  return (
    <div
      role="grid"
      aria-label={t("history.label")}
      aria-rowcount={count + 1}
      className="flex h-full min-h-0 flex-col bg-app"
    >
      {header}
      {body ?? (
        <div
          ref={scrollRef}
          role="rowgroup"
          aria-label={t("history.rows")}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (headerRef.current) headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          className="group/list relative min-h-0 flex-1 overflow-auto outline-none"
        >
          {showGraph && (
            <div className="sticky top-0 z-10 h-0">
              <GraphCanvas
                scrollRef={scrollRef}
                rowCount={stream.rows.length}
                row={(i) => {
                  const r = stream.rows[i];
                  return r && { graph: r.graph, head: r.oid === headOid };
                }}
                segments={stream.segments}
                offsetRows={offset}
                width={graphPx}
                metrics={metrics}
                pseudoRow={
                  offset === 1
                    ? {
                        lane:
                          headRow === 0
                            ? stream.rows[0]!.graph.lane
                            : (stream.rows[0]?.graph.width ?? 0),
                        connect: headRow === 0,
                      }
                    : null
                }
                highlight={highlight}
              />
            </div>
          )}
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <div
                style={{ height: virtualizer.getTotalSize(), minWidth: contentWidth }}
                className={cn("relative", refDrag.dragging && "cursor-grabbing")}
                onMouseLeave={() => setHovered(null)}
                onPointerDown={refDrag.onPointerDown}
                onContextMenu={(e) => {
                  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
                  const it = el ? itemAt(Number(el.dataset.index)) : undefined;
                  // Not on a row: no menu (and no browser menu either).
                  if (!it || !menuCtx) return e.preventDefault();
                  // Inside a multi-selection: a menu for all of them.
                  if (it.kind === "commit" && several.has(it.row.oid)) {
                    setMenuRow("several");
                    return;
                  }
                  selectIndex(Number(el!.dataset.index));
                  setMenuRow(
                    it.kind === "commit"
                      ? { oid: it.row.oid, subject: it.row.subject }
                      : "uncommitted",
                  );
                }}
              >
                {range.map((v) => {
                  const it = itemAt(v.index)!;
                  const selected =
                    v.index === selectedIndex || (it.kind === "commit" && several.has(it.row.oid));
                  return (
                    <div
                      key={it.kind === "commit" ? it.row.oid : "uncommitted"}
                      role="row"
                      aria-selected={selected}
                      data-index={v.index}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        // Shift+click would also select text.
                        if (e.shiftKey) e.preventDefault();
                        pick(v.index, e.shiftKey ? "range" : isMod(e) ? "toggle" : "replace");
                      }}
                      onMouseEnter={() => setHovered(it.kind === "commit" ? it.row.oid : null)}
                      onDoubleClick={onActivate}
                      style={{
                        ...gridStyle,
                        height: rowHeight,
                        transform: `translateY(${v.start}px)`,
                      }}
                      className={cn(
                        "absolute inset-x-0 top-0 grid items-center",
                        selected
                          ? "bg-selected group-focus/list:bg-selected-strong"
                          : "hover:bg-hover",
                      )}
                    >
                      {columns.map((c) =>
                        it.kind === "uncommitted" ? (
                          <UncommittedCell key={c} column={c} count={changed} />
                        ) : (
                          <CommitCell
                            key={c}
                            column={c}
                            row={it.row}
                            badges={badges.get(it.row.oid)}
                          />
                        ),
                      )}
                    </div>
                  );
                })}
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Content>
              {menuCtx && menuRow === "uncommitted" && (
                <>
                  <ContextMenu.Item icon={SquarePen} onSelect={() => setView("changes")}>
                    {t("history.showChanges")}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    icon={Archive}
                    onSelect={() => openDialog(repo, { mode: "stash" })}
                  >
                    {t("history.stashChanges")}
                  </ContextMenu.Item>
                </>
              )}
              {menuCtx && menuRow === "several" && (
                <CommitsItems ctx={menuCtx} M={ContextMenu} oids={selectedOids} />
              )}
              {menuCtx && menuRow && menuRow !== "uncommitted" && menuRow !== "several" && (
                <CommitItems
                  ctx={menuCtx}
                  M={ContextMenu}
                  oid={menuRow.oid}
                  subject={menuRow.subject}
                />
              )}
            </ContextMenu.Content>
          </ContextMenu.Root>
          {refDrag.ghost}
          {dropped && menuCtx && (
            <DropMenu
              drop={dropped}
              current={menuCtx.current}
              onMerge={() => void menuCtx.b.merge(dropped.name, dropped.name)}
              onRebase={() =>
                openDialog(repo, { mode: "rebase", onto: dropped.name, label: dropped.name })
              }
              onClose={() => setDropped(null)}
            />
          )}
        </div>
      )}
      <CommitGraphOffer
        repo={repo}
        commits={stream.rows.length}
        done={stream.done}
        dismissed={layout.commitGraphDismissed}
        active={active}
      />
      {searching && count > 0 && (
        <div className="flex h-7 shrink-0 items-center border-t border-line-subtle bg-panel px-3 text-small text-fg-secondary">
          <span aria-live="polite">{plural("count.commits", count)}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSearch({ query: "" })}
          >
            {t("search.clear")}
          </Button>
        </div>
      )}
    </div>
  );
}

function CommitCell({
  column,
  row,
  badges,
}: {
  column: ColumnId;
  row: HistoryRow;
  badges: RefInfo[] | undefined;
}) {
  const dateFormat = useSettings((st) => st.settings.dateFormat);
  switch (column) {
    case "graph":
      return <div role="gridcell" />;
    case "description":
      return (
        <div role="gridcell" className="flex min-w-0 items-center gap-2 px-2">
          {badges && (
            <RefBadgeList refs={badges.map((b) => ({ ...b, lane: row.graph.color + 1 }))} />
          )}
          <span className="truncate text-fg" title={row.subject}>
            {row.subject}
          </span>
        </div>
      );
    case "author":
      return (
        <div
          role="gridcell"
          className="flex min-w-0 items-center gap-2 px-2 text-fg-secondary"
          title={`${row.authorName} <${row.authorEmail}>`}
        >
          <Avatar name={row.authorName} email={row.authorEmail} />
          <span className="truncate">{row.authorName}</span>
        </div>
      );
    case "date": {
      const time = timeLabel(row.time, dateFormat);
      return (
        <div
          role="gridcell"
          className="truncate px-2 text-fg-secondary tabular-nums"
          title={time.title}
        >
          {time.text}
        </div>
      );
    }
    case "hash":
      return (
        <div role="gridcell" className="min-w-0 truncate px-2">
          <code className="text-small text-fg-muted">{shortHash(row.oid)}</code>
        </div>
      );
  }
}

function UncommittedCell({ column, count }: { column: ColumnId; count: number }) {
  if (column !== "description") return <div role="gridcell" />;
  return (
    <div role="gridcell" className="flex min-w-0 items-center gap-2 px-2">
      <span className="truncate text-fg-secondary italic">{t("history.uncommitted")}</span>
      <Badge>{plural("count.files", count)}</Badge>
    </div>
  );
}
