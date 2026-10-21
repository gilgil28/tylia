// Conflicted files in the Changes view: their list (above Unstaged) and the diff pane for a
// selected one, with "use one side", "open merge tool" and "mark resolved".

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Ellipsis, FileCheck2, Wrench } from "lucide-react";
import { useState } from "react";

import { queryClient } from "@/app/query-client";
import { useWorkspace } from "@/app/workspace";
import { useBranching } from "@/features/branching/useBranching";
import { DiffView } from "@/features/diff/DiffView";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import {
  ipc,
  isIpcError,
  type BlockResolution,
  type ConflictSide,
  type FileDiff,
  type WorkingStatus,
} from "@/ipc";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { IconButton } from "@/ui/IconButton";
import { ContextMenu, Menu } from "@/ui/Menu";
import { toast } from "@/ui/Toast";

import { hasConflictMarkers } from "./changes-model";
import { ConflictBlocks, type SideNames } from "./ConflictBlocks";
import {
  DEFAULT_CONTEXT,
  FULL_CONTEXT,
  WORKING_DIFF_STALE_MS,
  workingDiffRequest,
} from "./StagingDiffPane";
import { useRepoAction } from "./useRepoAction";

/** Button labels for each side. During a rebase "ours" is the branch being rebased onto. */
function sideLabels(status: WorkingStatus | undefined) {
  const rebase = status?.operation?.kind === "rebase";
  return {
    ours: rebase ? t("conflict.useBase") : t("conflict.useMine"),
    theirs: rebase ? t("conflict.useCommit") : t("conflict.useTheirs"),
  };
}

const conflictDiff = (repo: string, path: string) => {
  const request = workingDiffRequest(
    { path, oldPath: null, target: "conflicted" },
    DEFAULT_CONTEXT,
  );
  return queryClient.fetchQuery({
    queryKey: ["diff", repo, request],
    queryFn: () => ipc.getDiff(repo, request),
    staleTime: WORKING_DIFF_STALE_MS,
  });
};

/** Conflict actions; "mark resolved" first checks for leftover conflict markers. */
function useConflictActions(repo: string) {
  const b = useBranching(repo);
  const [unfinished, setUnfinished] = useState<string[] | null>(null);
  const markResolved = async (paths: string[]) => {
    const diffs = await Promise.all(paths.map((p) => conflictDiff(repo, p).catch(() => null)));
    const withMarkers = paths.filter((_, i) => {
      const d = diffs[i] as FileDiff | null;
      return d && hasConflictMarkers(d);
    });
    if (withMarkers.length > 0) setUnfinished(paths);
    else await b.markResolved(paths);
  };
  const confirm = (
    <ConfirmDialog
      open={unfinished !== null}
      onOpenChange={(o) => !o && setUnfinished(null)}
      title={t("conflict.markersTitle")}
      consequence={t("conflict.markersBody")}
      confirmLabel={t("conflict.markAnyway")}
      onConfirm={() => unfinished && void b.markResolved(unfinished)}
    />
  );
  return {
    resolve: (paths: string[], side: ConflictSide) => b.resolveWith(paths, side),
    markResolved,
    mergeTool: (path: string) => b.mergeTool(path),
    confirm,
  };
}

function ConflictItems({
  M,
  path,
  status,
  actions,
}: {
  M: typeof Menu | typeof ContextMenu;
  path: string;
  status: WorkingStatus | undefined;
  actions: ReturnType<typeof useConflictActions>;
}) {
  const labels = sideLabels(status);
  return (
    <>
      <M.Item onSelect={() => void actions.resolve([path], "ours")}>{labels.ours}</M.Item>
      <M.Item onSelect={() => void actions.resolve([path], "theirs")}>{labels.theirs}</M.Item>
      <M.Item icon={Wrench} onSelect={() => void actions.mergeTool(path)}>
        {t("conflict.mergeTool")}
      </M.Item>
      <M.Separator />
      <M.Item icon={FileCheck2} onSelect={() => void actions.markResolved([path])}>
        {t("conflict.markResolved")}
      </M.Item>
    </>
  );
}

/** The conflicted files, above the Unstaged list. */
export function ConflictList({
  repo,
  paths,
  status,
}: {
  repo: string;
  paths: string[];
  status: WorkingStatus | undefined;
}) {
  const selected = useRepoUi((s) => s.selectedFile);
  const selectFile = useRepoUi((s) => s.selectFile);
  const actions = useConflictActions(repo);
  return (
    <section
      aria-label={t("conflict.list")}
      className="flex max-h-[40%] shrink-0 flex-col border-b border-line-subtle"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <CircleAlert size={14} strokeWidth={1.75} aria-hidden className="text-warning" />
        <span className="flex-1 truncate text-caption font-medium text-fg-muted">
          {t("conflict.header", { count: paths.length })}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void actions.markResolved(paths)}>
          {t("conflict.markAllResolved")}
        </Button>
      </div>
      <div role="listbox" aria-label={t("conflict.list")} className="min-h-0 overflow-y-auto pb-1">
        {paths.map((path) => {
          const active = selected?.target === "conflicted" && selected.path === path;
          const slash = path.lastIndexOf("/");
          return (
            <ContextMenu.Root key={path}>
              <ContextMenu.Trigger asChild>
                <div
                  role="option"
                  aria-selected={active}
                  tabIndex={0}
                  onClick={() => selectFile({ path, oldPath: null, target: "conflicted" })}
                  onKeyDown={(e) =>
                    e.key === "Enter" && selectFile({ path, oldPath: null, target: "conflicted" })
                  }
                  className={cn(
                    "group/conflict relative flex h-(--row-h) cursor-default items-center gap-2 pr-1 pl-3 focus-ring",
                    active ? "bg-selected" : "hover:bg-hover",
                  )}
                >
                  {active && (
                    <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" />
                  )}
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-badge bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-caption font-semibold text-warning">
                    !
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={path}>
                    <span className="text-fg">{path.slice(slash + 1)}</span>
                    {slash > 0 && (
                      <span className="ml-2 text-small text-fg-muted">{path.slice(0, slash)}</span>
                    )}
                  </span>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      {/* Mouse-only: the row's context menu and the diff pane offer the same. */}
                      <IconButton
                        tabIndex={-1}
                        aria-hidden
                        icon={Ellipsis}
                        label={t("conflict.actions", { name: path.slice(slash + 1) })}
                        compact
                        className="opacity-0 group-hover/conflict:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Menu.Trigger>
                    <Menu.Content align="end">
                      <ConflictItems M={Menu} path={path} status={status} actions={actions} />
                    </Menu.Content>
                  </Menu.Root>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Content>
                <ConflictItems M={ContextMenu} path={path} status={status} actions={actions} />
              </ContextMenu.Content>
            </ContextMenu.Root>
          );
        })}
      </div>
      {actions.confirm}
    </section>
  );
}

/** The selected conflicted file: the working file with markers, against my version. */
export function ConflictDiff({
  repo,
  path,
  status,
}: {
  repo: string;
  path: string;
  status: WorkingStatus | undefined;
}) {
  const mode = useWorkspace((s) => s.diffMode);
  const setMode = useWorkspace((s) => s.setDiffMode);
  const [fullFile, setFullFile] = useState(false);
  const actions = useConflictActions(repo);
  const labels = sideLabels(status);
  const request = workingDiffRequest(
    { path, oldPath: null, target: "conflicted" },
    fullFile ? FULL_CONTEXT : DEFAULT_CONTEXT,
  );
  const diff = useQuery({
    queryKey: ["diff", repo, request],
    queryFn: () => ipc.getDiff(repo, request),
    staleTime: WORKING_DIFF_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const conflicted = status?.entries.some((e) => e.path === path && e.conflicted) ?? false;
  const err = diff.error;
  const blocks = useQuery({
    queryKey: ["conflict-file", repo, path],
    queryFn: () => ipc.conflictFile(repo, path),
    retry: false,
  });
  const hasBlocks = (blocks.data?.segments.length ?? 0) > 0;
  const run = useRepoAction(repo);
  const client = useQueryClient();
  const [writing, setWriting] = useState(false);
  const rebase = status?.operation?.kind === "rebase";
  const names: SideNames = rebase
    ? {
        mine: t("blocks.base"),
        theirs: t("blocks.myCommit"),
        useMine: t("blocks.useBase"),
        useTheirs: t("blocks.useMyCommit"),
      }
    : {
        mine: t("blocks.mine"),
        theirs: t("blocks.theirs"),
        useMine: t("blocks.useMine"),
        useTheirs: t("blocks.useTheirs"),
      };
  const resolveBlock = async (index: number, resolution: BlockResolution) => {
    const file = blocks.data;
    if (!file || writing) return;
    setWriting(true);
    const outcome = await run(
      () => ipc.resolveBlock(repo, path, index, resolution, file.fingerprint),
      t("blocks.failed"),
    );
    await client.invalidateQueries({ queryKey: ["conflict-file", repo, path] });
    setWriting(false);
    if (outcome?.resolved) {
      toast({
        kind: "success",
        title: t("blocks.fileResolved", { name: path.split("/").pop() ?? path }),
      });
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-subtle bg-panel px-3 py-2">
        <p className="text-small text-fg-secondary">
          {!conflicted
            ? t("conflict.paneResolved")
            : hasBlocks
              ? t("conflict.blocksHint")
              : t("conflict.paneHint")}
        </p>
        {conflicted && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void actions.resolve([path], "ours")}>
              {labels.ours}
            </Button>
            <Button size="sm" onClick={() => void actions.resolve([path], "theirs")}>
              {labels.theirs}
            </Button>
            <Button size="sm" icon={Wrench} onClick={() => void actions.mergeTool(path)}>
              {t("conflict.mergeTool")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={FileCheck2}
              onClick={() => void actions.markResolved([path])}
            >
              {t("conflict.markResolved")}
            </Button>
          </div>
        )}
      </div>
      {hasBlocks && blocks.data ? (
        <ConflictBlocks
          path={path}
          file={blocks.data}
          names={names}
          busy={writing}
          onResolve={(index, resolution) => void resolveBlock(index, resolution)}
        />
      ) : (
        <DiffView
          diff={diff.data?.path === path ? diff.data : undefined}
          loading={diff.isPending}
          error={
            err
              ? {
                  message: t("details.diffFailed"),
                  command: isIpcError(err) ? err.command : null,
                  stderr: isIpcError(err) ? (err.stderr ?? err.message) : String(err),
                }
              : null
          }
          mode={mode}
          onModeChange={setMode}
          onExpandContext={fullFile ? undefined : () => setFullFile(true)}
          fullFile={fullFile}
          onFullFileChange={setFullFile}
          className="min-h-0 flex-1"
        />
      )}
      {actions.confirm}
    </div>
  );
}
