import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Binary,
  Copy,
  FileExclamationPoint,
  FileText,
  FileX,
  GitCommitHorizontal,
  History,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useRegisterActions, type Action } from "@/app/actions";
import { absoluteTime, relativeTime, shortHash } from "@/app/format";
import { useFontSize } from "@/features/diff/DiffRows";
import { formatSize } from "@/features/diff/format";
import { detectLanguage } from "@/features/diff/language";
import { DEFAULT_DIFF_FONT_PX, lineRowHeight, TAB_WIDTH } from "@/features/diff/rows";
import { mergeSegments } from "@/features/diff/segments";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import { ipc, isIpcError, type BlameCommit, type BlameLine } from "@/ipc";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { ContextMenu } from "@/ui/Menu";
import { Skeleton } from "@/ui/Skeleton";
import { Tooltip } from "@/ui/Tooltip";

import { ageRanks, ageTint, groupStarts } from "./blame-model";
import { useLineHighlights } from "./useLineHighlights";

/** Width of the commit column (age bar + hash, author, date). */
const GUTTER = 264;
const INSET_FOCUS =
  "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-accent";
// The sticky gutter paints row tints over an opaque base so code can scroll underneath.
const GUTTER_BASE = "bg-app";
const GUTTER_CURRENT = "bg-app bg-[linear-gradient(var(--bg-selected),var(--bg-selected))]";
const GUTTER_SAME = "bg-app bg-[linear-gradient(var(--bg-hover),var(--bg-hover))]";

/** Blame of `path` at `rev` (`null`: the working copy), opening at `line`. */
export function BlameView({
  repo,
  path,
  rev,
  line,
  active,
}: {
  repo: string;
  path: string;
  rev: string | null;
  line: number | null;
  active: boolean;
}) {
  const [force, setForce] = useState(false);
  // The working copy's blame follows the status: refreshed when files change.
  const statusStamp = useQuery({
    queryKey: ["status", repo],
    queryFn: () => ipc.getStatus(repo),
    enabled: rev === null,
  }).dataUpdatedAt;
  const blame = useQuery({
    queryKey: ["blame", repo, path, rev, force, rev === null ? statusStamp : 0],
    queryFn: () => ipc.getBlame(repo, path, rev, force),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });

  if (blame.isPending) return <BlameSkeleton />;
  if (blame.isError) {
    const err = blame.error;
    return (
      <div className="min-h-0 overflow-auto p-4">
        <ErrorPanel
          message={t("fileView.blameFailed")}
          command={isIpcError(err) ? err.command : null}
          stderr={isIpcError(err) ? (err.stderr ?? err.message) : String(err)}
        />
      </div>
    );
  }
  const { content } = blame.data;
  switch (content.kind) {
    case "binary":
      return (
        <EmptyState
          className="flex-1"
          icon={Binary}
          title={t("diff.binaryTitle")}
          description={t("fileView.binaryBody")}
        />
      );
    case "tooLarge":
      return (
        <EmptyState
          className="flex-1"
          icon={FileExclamationPoint}
          title={t("fileView.tooLargeTitle")}
          description={t("fileView.tooLargeBody", { size: formatSize(content.bytes) })}
          actions={
            <Button size="sm" onClick={() => setForce(true)}>
              {t("fileView.blameAnyway")}
            </Button>
          }
        />
      );
    case "missing":
      return (
        <EmptyState
          className="flex-1"
          icon={FileX}
          title={t("fileView.missingTitle")}
          description={
            rev
              ? t("fileView.missingCommit", { path, hash: shortHash(rev) })
              : t("fileView.missingWorking", { path })
          }
        />
      );
    case "lines":
      if (content.lines.length === 0) {
        return <EmptyState className="flex-1" icon={FileText} title={t("fileView.emptyFile")} />;
      }
      return (
        <BlameLines
          repo={repo}
          path={path}
          commits={content.commits}
          lines={content.lines}
          initialLine={line}
          active={active}
        />
      );
  }
}

function BlameLines({
  repo,
  path,
  commits,
  lines,
  initialLine,
  active,
}: {
  repo: string;
  path: string;
  commits: BlameCommit[];
  lines: BlameLine[];
  initialLine: number | null;
  active: boolean;
}) {
  const reveal = useRepoUi((s) => s.reveal);
  const openFile = useRepoUi((s) => s.openFile);
  const setView = useRepoUi((s) => s.setView);
  const scrollRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const lineHeight = lineRowHeight(useFontSize(probeRef));
  const id = useId();

  const starts = useMemo(() => groupStarts(lines), [lines]);
  const ranks = useMemo(() => ageRanks(commits), [commits]);
  const texts = useMemo(() => lines.map((l) => l.text), [lines]);
  const widest = useMemo(() => texts.reduce((a, b) => (b.length > a.length ? b : a), ""), [texts]);
  const lang = useMemo(() => detectLanguage(path), [path]);
  const digits = String(lines.length).length;

  const clamp = (i: number) => Math.max(0, Math.min(lines.length - 1, i));
  const [cursor, setCursor] = useState(() => clamp((initialLine ?? 1) - 1));
  // The file can shrink under the cursor (a refreshed working copy).
  const current = clamp(cursor);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => lineHeight,
    overscan: 20,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, lineHeight]);
  // Open at the requested line, with focus in the lines for the keyboard.
  useEffect(() => {
    if (initialLine) virtualizer.scrollToIndex(initialLine - 1, { align: "center" });
    scrollRef.current?.focus({ preventScroll: true });
  }, [initialLine, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const tokensFor = useLineHighlights(texts, lang, items[0]?.index ?? 0, items.at(-1)?.index ?? 0);

  const commitOf = (i: number) => commits[lines[i]!.commit]!;
  const move = (to: number) => {
    const i = clamp(to);
    setCursor(i);
    virtualizer.scrollToIndex(i);
  };
  /** Uncommitted lines lead to the Changes view, others to their commit in History. */
  const showCommit = (c: BlameCommit) => (c.uncommitted ? setView("changes") : reveal(c.oid));
  const blameParent = (i: number) => {
    const { previous } = commitOf(i);
    if (previous) {
      openFile({
        path: previous.path,
        mode: "blame",
        rev: previous.oid,
        line: lines[i]!.originalLine,
      });
    }
  };

  const currentCommit = commitOf(current);
  const actions: Action[] = [
    {
      id: "file.revealLine",
      title: t("fileView.actionReveal"),
      group: "file",
      icon: GitCommitHorizontal,
      run: () => showCommit(commitOf(current)),
    },
    {
      id: "file.blameParent",
      title: t("fileView.actionBlameParent"),
      group: "file",
      icon: History,
      disabled: !currentCommit.previous,
      run: () => blameParent(current),
    },
  ];
  useRegisterActions(`blame:${repo}`, actions, active);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / lineHeight) - 1);
    const next: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      PageDown: current + page,
      PageUp: current - page,
      Home: 0,
      End: lines.length - 1,
    };
    if (e.key in next) move(next[e.key]!);
    else if (e.key === "Enter") showCommit(currentCommit);
    else return;
    e.preventDefault();
  };

  const tint = (c: number): string =>
    commits[c]!.uncommitted
      ? "var(--warning)"
      : `color-mix(in srgb, var(--accent) ${ageTint(ranks[c]!)}%, transparent)`;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col font-code text-(length:--text-diff)"
      style={{ tabSize: TAB_WIDTH, lineHeight: `${lineHeight}px` }}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            ref={scrollRef}
            role="listbox"
            aria-label={t("fileView.blameLabel", { path })}
            aria-activedescendant={`${id}-${current}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => {
              const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
              if (row) setCursor(Number(row.dataset.index));
            }}
            className={cn("group/blame relative min-h-0 flex-1 overflow-auto", INSET_FOCUS)}
          >
            <span ref={probeRef} aria-hidden className="invisible absolute h-[1em] w-px" />
            <div
              className="relative w-max min-w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {/* Invisible copy of the widest line: gives the scroll area its width. */}
              <div aria-hidden className="invisible flex h-0 overflow-hidden">
                <span
                  className="shrink-0"
                  style={{ width: `calc(${GUTTER}px + ${digits}ch + 1rem)` }}
                />
                <span className="pr-4 pl-3 whitespace-pre">{widest}</span>
              </div>
              {items.map((item) => {
                const i = item.index;
                const l = lines[i]!;
                const c = commits[l.commit]!;
                const isCurrent = i === current;
                const same = !isCurrent && l.commit === lines[current]!.commit;
                // A hairline above each run of lines from another commit.
                const divider = starts[i] && i > 0 && "shadow-[inset_0_1px_0_var(--border-subtle)]";
                return (
                  <div
                    key={item.key}
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={isCurrent}
                    data-index={i}
                    onMouseDown={(e) => e.button === 0 && setCursor(i)}
                    onDoubleClick={() => showCommit(c)}
                    className={cn(
                      "group/row absolute top-0 left-0 flex w-full",
                      !isCurrent && "hover:bg-hover",
                      divider,
                    )}
                    style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  >
                    <span className="sr-only">
                      {c.uncommitted
                        ? t("fileView.lineLabelUncommitted", { line: l.line })
                        : t("fileView.lineLabel", {
                            line: l.line,
                            hash: shortHash(c.oid),
                            author: c.authorName,
                            date: relativeTime(c.authorTime),
                          })}
                    </span>
                    <div
                      className={cn(
                        "sticky left-0 z-1 flex shrink-0 border-r border-line-subtle select-none",
                        isCurrent ? GUTTER_CURRENT : same ? GUTTER_SAME : GUTTER_BASE,
                        divider,
                      )}
                    >
                      <span
                        aria-hidden
                        className="w-0.75 shrink-0"
                        style={{ background: tint(l.commit) }}
                      />
                      <span
                        aria-hidden
                        className="flex min-w-0 items-center gap-2 px-2 font-ui text-small"
                        style={{ width: GUTTER - 3 }}
                      >
                        {starts[i] && (
                          <GroupLabel commit={c} path={path} onShow={() => showCommit(c)} />
                        )}
                      </span>
                      <span
                        aria-hidden
                        className="box-content px-2 text-right text-fg-muted tabular-nums"
                        style={{ width: `${digits}ch` }}
                      >
                        {l.line}
                      </span>
                    </div>
                    {/* The current line is marked by its commit column and an accent edge:
                        a tint behind syntax colours would cost them contrast. */}
                    <div
                      className={cn(
                        "pr-4 pl-3 whitespace-pre",
                        isCurrent && "shadow-[inset_2px_0_0_var(--accent)]",
                      )}
                      data-selectable
                    >
                      {mergeSegments(l.text, tokensFor(i), []).map((s, k) => (
                        <span
                          key={k}
                          className={cn(s.italic && "italic")}
                          style={s.color ? { color: s.color } : undefined}
                        >
                          {s.text}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          <ContextMenu.Item
            icon={GitCommitHorizontal}
            shortcut="Enter"
            onSelect={() => showCommit(currentCommit)}
          >
            {t("fileView.showInHistory")}
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={History}
            disabled={!currentCommit.previous}
            onSelect={() => blameParent(current)}
          >
            {t("fileView.blameParent")}
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={Copy}
            disabled={currentCommit.uncommitted}
            onSelect={() => void navigator.clipboard.writeText(currentCommit.oid)}
          >
            {t("details.copyHash")}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    </div>
  );
}

/** Hash, author and date at the top of a run of lines from one commit. */
function GroupLabel({
  commit,
  path,
  onShow,
}: {
  commit: BlameCommit;
  path: string;
  onShow: () => void;
}) {
  if (commit.uncommitted) {
    return (
      <Tooltip side="right" content={t("fileView.uncommittedHint")}>
        <span className="min-w-0 truncate pr-0.5 text-warning italic">
          {t("fileView.uncommitted")}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      side="right"
      content={
        <span className="flex max-w-80 flex-col gap-0.5 py-0.5">
          <span className="font-medium break-words">{commit.summary}</span>
          <span className="text-fg-secondary">
            {commit.authorName} · {absoluteTime(commit.authorTime)}
          </span>
          <span className="text-fg-muted">
            <span className="font-code">{shortHash(commit.oid)}</span>
            {commit.path !== path && ` · ${commit.path}`}
            {!commit.previous && ` · ${t("fileView.addedHere")}`}
          </span>
        </span>
      }
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {/* Not a button: lines are options, which can't contain controls. Enter on the
            line does the same. */}
        <span
          onClick={onShow}
          className="shrink-0 cursor-pointer font-code text-fg-muted hover:text-accent hover:underline"
        >
          {shortHash(commit.oid)}
        </span>
        <span className="min-w-0 truncate text-fg-secondary">{commit.authorName}</span>
        <span className="ml-auto shrink-0 text-fg-muted tabular-nums">
          {relativeTime(commit.authorTime)}
        </span>
      </span>
    </Tooltip>
  );
}

const SKELETON_WIDTHS = ["w-2/5", "w-3/5", "w-1/3", "w-1/2", "w-3/4", "w-1/4", "w-2/3"];

/** Placeholder shaped like blame lines: commit column, number, code. */
function BlameSkeleton() {
  const height = lineRowHeight(DEFAULT_DIFF_FONT_PX);
  return (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col overflow-hidden pt-1">
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="flex shrink-0 items-center gap-3 px-3" style={{ height }}>
          <span className="flex shrink-0 items-center gap-2" style={{ width: GUTTER - 12 }}>
            {i % 4 === 0 && (
              <>
                <Skeleton className="h-2 w-12" />
                <Skeleton className="h-2 w-20" />
              </>
            )}
          </span>
          <Skeleton className="h-2 w-5" />
          <Skeleton className={cn("h-2", SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])} />
        </div>
      ))}
    </div>
  );
}
