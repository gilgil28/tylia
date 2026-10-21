import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, FileClock, FileSearch, FileUser, GitCommitHorizontal } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { absoluteTime, relativeTime, shortHash } from "@/app/format";
import { useWorkspace, type RepoLayout } from "@/app/workspace";
import { CommitFileDiff } from "@/features/commit-details/DiffPane";
import { StatusGlyph } from "@/features/commit-details/StatusGlyph";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import { ipc, isIpcError, type FileHistoryEntry } from "@/ipc";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { IconButton } from "@/ui/IconButton";
import { ContextMenu } from "@/ui/Menu";
import { Skeleton } from "@/ui/Skeleton";
import { SplitPane } from "@/ui/SplitPane";

/** Two text lines: subject, then author · date · hash. */
const ROW = 44;
/** A rename or copy adds a third line naming the old path. */
const MOVED_LINE = 18;
const PAGE = 200;
/** Load the next page when the view gets this close to the end. */
const PREFETCH_ROWS = 40;

/** Commits that changed `path` (following renames), and the selected one's diff. */
export function FileHistory({
  repo,
  path,
  rev,
  layout,
}: {
  repo: string;
  path: string;
  rev: string | null;
  layout: RepoLayout;
}) {
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const reveal = useRepoUi((s) => s.reveal);
  const openFile = useRepoUi((s) => s.openFile);
  // History from HEAD follows the refs: new commits appear when they change.
  const refsStamp = useQuery({
    queryKey: ["refs", repo],
    queryFn: () => ipc.getRefs(repo),
    enabled: rev === null,
  }).dataUpdatedAt;
  const query = useInfiniteQuery({
    queryKey: ["file-history", repo, path, rev, rev === null ? refsStamp : 0],
    queryFn: ({ pageParam }) => ipc.getFileHistory(repo, path, rev, pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.more ? pages.reduce((n, p) => n + p.entries.length, 0) : undefined,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const entries = useMemo(() => query.data?.pages.flatMap((p) => p.entries) ?? [], [query.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = entries.find((e) => e.oid === picked) ?? entries[0];

  const actionsFor = (entry: FileHistoryEntry) => ({
    blame: () => openFile({ path: entry.path, mode: "blame", rev: entry.oid }),
    show: () => reveal(entry.oid),
  });

  let list: React.ReactNode;
  if (query.isPending) {
    list = <ListSkeleton />;
  } else if (query.isError) {
    const err = query.error;
    list = (
      <div className="p-3">
        <ErrorPanel
          message={t("fileView.historyFailed")}
          command={isIpcError(err) ? err.command : null}
          stderr={isIpcError(err) ? (err.stderr ?? err.message) : String(err)}
        />
      </div>
    );
  } else if (entries.length === 0) {
    return (
      <EmptyState
        icon={FileClock}
        title={t("fileView.historyEmpty")}
        description={t("fileView.historyEmptyBody")}
        className="flex-1"
      />
    );
  } else {
    list = (
      <EntryList
        path={path}
        entries={entries}
        selected={selected?.oid ?? null}
        onSelect={setPicked}
        onActivate={(e) => actionsFor(e).show()}
        loadingMore={query.isFetchingNextPage}
        onNearEnd={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        menu={(e) => (
          <>
            <ContextMenu.Item icon={GitCommitHorizontal} onSelect={actionsFor(e).show}>
              {t("fileView.showInHistory")}
            </ContextMenu.Item>
            <ContextMenu.Item
              icon={FileUser}
              disabled={e.status === "deleted"}
              onSelect={actionsFor(e).blame}
            >
              {t("fileView.blameAtCommit")}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              icon={Copy}
              onSelect={() => void navigator.clipboard.writeText(e.oid)}
            >
              {t("details.copyHash")}
            </ContextMenu.Item>
          </>
        )}
      />
    );
  }

  return (
    <SplitPane
      className="flex-1"
      size={layout.filesWidth}
      onSizeChange={(filesWidth) => updateLayout(repo, { filesWidth })}
      min={240}
      max={640}
      first={<div className="flex h-full flex-col bg-app">{list}</div>}
      second={
        selected ? (
          <CommitFileDiff
            key={selected.oid}
            repo={repo}
            commit={selected}
            file={selected}
            headerActions={
              <>
                <IconButton
                  icon={FileUser}
                  label={t("fileView.blameAtCommit")}
                  compact
                  disabled={selected.status === "deleted"}
                  onClick={actionsFor(selected).blame}
                />
                <IconButton
                  icon={GitCommitHorizontal}
                  label={t("fileView.showInHistory")}
                  compact
                  onClick={actionsFor(selected).show}
                />
              </>
            }
          />
        ) : (
          <EmptyState icon={FileSearch} title={t("fileView.selectCommit")} className="h-full" />
        )
      }
    />
  );
}

function EntryList({
  path,
  entries,
  selected,
  onSelect,
  onActivate,
  loadingMore,
  onNearEnd,
  menu,
}: {
  path: string;
  entries: FileHistoryEntry[];
  selected: string | null;
  onSelect: (oid: string) => void;
  onActivate: (entry: FileHistoryEntry) => void;
  loadingMore: boolean;
  onNearEnd: () => void;
  menu: (entry: FileHistoryEntry) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [menuEntry, setMenuEntry] = useState<FileHistoryEntry | null>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW + (movedFrom(entries[i]!) ? MOVED_LINE : 0),
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const lastVisible = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastVisible >= entries.length - PREFETCH_ROWS) onNearEnd();
  }, [lastVisible, entries.length, onNearEnd]);
  // Keyboard focus starts in the list.
  useEffect(() => {
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  const index = entries.findIndex((e) => e.oid === selected);
  const pick = (i: number) => {
    const entry = entries[Math.max(0, Math.min(entries.length - 1, i))];
    if (!entry) return;
    onSelect(entry.oid);
    virtualizer.scrollToIndex(entries.indexOf(entry));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW) - 1);
    const next: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      PageDown: index + page,
      PageUp: index - page,
      Home: 0,
      End: entries.length - 1,
    };
    if (e.key in next) pick(next[e.key]!);
    else if (e.key === "Enter" && entries[index]) onActivate(entries[index]);
    else return;
    e.preventDefault();
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          ref={scrollRef}
          role="listbox"
          aria-label={t("fileView.historyLabel", { path })}
          aria-activedescendant={index >= 0 ? `${id}-${index}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
            const entry = row ? entries[Number(row.dataset.index)] : undefined;
            if (!entry) return e.preventDefault();
            onSelect(entry.oid);
            setMenuEntry(entry);
          }}
          className="group/list relative min-h-0 flex-1 overflow-auto outline-none"
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const entry = entries[item.index]!;
              const isSelected = item.index === index;
              return (
                <div
                  key={entry.oid}
                  id={`${id}-${item.index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-index={item.index}
                  onMouseDown={(e) => e.button === 0 && onSelect(entry.oid)}
                  onDoubleClick={() => onActivate(entry)}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  className={cn(
                    "absolute inset-x-0 top-0 flex items-center gap-2 px-3",
                    isSelected
                      ? "bg-selected group-focus/list:bg-selected-strong"
                      : "hover:bg-hover",
                  )}
                >
                  <EntryRow entry={entry} selected={isSelected} />
                </div>
              );
            })}
          </div>
          {loadingMore && (
            <p className="sticky bottom-0 flex h-7 items-center bg-panel px-3 text-small text-fg-muted">
              {t("fileView.loadingMore")}
            </p>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content>{menuEntry && menu(menuEntry)}</ContextMenu.Content>
    </ContextMenu.Root>
  );
}

/** "Renamed from …" / "Copied from …" when the commit moved the file. */
function movedFrom(entry: FileHistoryEntry): string | null {
  if (!entry.oldPath || entry.oldPath === entry.path) return null;
  return entry.status === "copied"
    ? t("fileView.copiedFrom", { path: entry.oldPath })
    : t("fileView.renamedFrom", { path: entry.oldPath });
}

function EntryRow({ entry, selected }: { entry: FileHistoryEntry; selected: boolean }) {
  const moved = movedFrom(entry);
  return (
    <>
      {entry.status ? (
        <StatusGlyph status={entry.status} />
      ) : (
        <span
          title={t("fileView.mergeUnchanged")}
          aria-label={t("fileView.mergeUnchanged")}
          className="size-4 shrink-0"
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-fg" title={entry.subject}>
          {entry.subject}
        </span>
        {/* Muted text loses contrast on the selection tint. */}
        <span
          className={cn(
            "flex min-w-0 items-baseline gap-1.5 text-small",
            selected ? "text-fg-secondary" : "text-fg-muted",
          )}
        >
          <span
            className="max-w-40 shrink-0 truncate"
            title={`${entry.authorName} <${entry.authorEmail}>`}
          >
            {entry.authorName}
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums" title={absoluteTime(entry.time)}>
            {relativeTime(entry.time)}
          </span>
          <span aria-hidden>·</span>
          <code className="shrink-0">{shortHash(entry.oid)}</code>
        </span>
        {moved && (
          <span className="truncate text-small text-info" title={moved}>
            {moved}
          </span>
        )}
      </span>
    </>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col pt-1">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex flex-col justify-center gap-2 px-3" style={{ height: ROW }}>
          <Skeleton className={cn("h-2.5", i % 2 ? "w-3/5" : "w-4/5")} />
          <Skeleton className="h-2 w-2/5" />
        </div>
      ))}
    </div>
  );
}
