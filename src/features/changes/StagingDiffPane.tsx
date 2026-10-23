import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileSearch } from "lucide-react";
import { useState } from "react";

import { useWorkspace } from "@/app/workspace";
import { DiffView } from "@/features/diff/DiffView";
import { FileViewButtons } from "@/features/file-view/FileViewButtons";
import { useRepoUi, type SelectedFile } from "@/features/repo/repo-store";
import { useRestore } from "@/features/undo/backups";
import { plural, t } from "@/i18n";
import {
  ipc,
  isIpcError,
  type DiffRequest,
  type FileDiff,
  type Hunk,
  type LineAction,
  type WorkingStatus,
} from "@/ipc";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState } from "@/ui/EmptyState";

import { changedLines, keysToLines, linesRequest } from "./changes-model";
import { ConflictDiff } from "./Conflicts";
import { useRepoAction } from "./useRepoAction";

/** `u32::MAX` in Rust: the whole file as context. */
export const FULL_CONTEXT = 4294967295;
export const DEFAULT_CONTEXT = 3;

/** The request for a working-copy file's diff (also used to prefetch neighbours). */
export function workingDiffRequest(
  file: Pick<SelectedFile, "path" | "oldPath"> & {
    target: "staged" | "unstaged" | "untracked" | "conflicted";
  },
  context = DEFAULT_CONTEXT,
  force = false,
): DiffRequest {
  return {
    target: { kind: file.target },
    path: file.path,
    oldPath: file.oldPath,
    context,
    ignoreWhitespace: false,
    force,
  };
}

/** Writes and the file watcher invalidate working-copy diffs explicitly; this only avoids
 * refetching a just-prefetched diff when it's shown. */
export const WORKING_DIFF_STALE_MS = 5000;

/** The selected working-copy file's diff, with hunk and line staging. */
export function StagingDiffPane({
  repo,
  status,
}: {
  repo: string;
  status: WorkingStatus | undefined;
}) {
  const file = useRepoUi((s) => s.selectedFile);
  if (!file || file.target === "commit") {
    return (
      <EmptyState icon={FileSearch} title={t("details.selectFile")} className="h-full bg-app" />
    );
  }
  if (file.target === "conflicted") {
    return <ConflictDiff key={file.path} repo={repo} path={file.path} status={status} />;
  }
  // Keyed per file: context, "load anyway" and the line selection reset with it.
  return <FileStagingDiff key={`${file.target}:${file.path}`} repo={repo} file={file} />;
}

function FileStagingDiff({ repo, file }: { repo: string; file: SelectedFile }) {
  const mode = useWorkspace((s) => s.diffMode);
  const setMode = useWorkspace((s) => s.setDiffMode);
  // Changes only by default (faster, and what you usually want); reset per file.
  const [fullFile, setFullFile] = useState(false);
  const context = fullFile ? FULL_CONTEXT : DEFAULT_CONTEXT;
  const [force, setForce] = useState(false);
  const [selection, setSelection] = useState<{ fingerprint: string | null; keys: Set<string> }>({
    fingerprint: null,
    keys: new Set(),
  });
  const [confirmDiscard, setConfirmDiscard] = useState<[number, number][] | null>(null);
  const run = useRepoAction(repo);
  const { discarded } = useRestore(repo);

  const target = file.target as Exclude<SelectedFile["target"], "commit" | "conflicted">;
  const request = workingDiffRequest({ ...file, target }, context, force);
  const diff = useQuery({
    queryKey: ["diff", repo, request],
    queryFn: () => ipc.getDiff(repo, request),
    staleTime: WORKING_DIFF_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = diff.data?.path === file.path ? diff.data : undefined;

  // A selection belongs to one version of the diff: drop it when the diff changes.
  const keys =
    data && selection.fingerprint === data.fingerprint ? selection.keys : new Set<string>();
  const setKeys = (next: Set<string>) =>
    setSelection({ fingerprint: data?.fingerprint ?? null, keys: next });

  const apply = (diffData: FileDiff, action: LineAction, lines: [number, number][]) =>
    run(
      () =>
        ipc.applyLines(repo, linesRequest({ ...file, target }, diffData, action, lines, context)),
      action === "unstage"
        ? t("changes.unstageFailed")
        : action === "discard"
          ? t("changes.discardFailed")
          : t("changes.stageFailed"),
    ).then((backup) => {
      setKeys(new Set());
      if (action === "discard") discarded(backup, [file.path]);
    });

  const hunkActions = (hunk: Hunk, index: number) => {
    if (!data) return null;
    const inHunk = [...keys].filter((k) => k.startsWith(`${index}:`));
    const lines = inHunk.length > 0 ? keysToLines(inHunk) : changedLines(hunk, index);
    const count = plural("count.lines", inHunk.length);
    const some = inHunk.length > 0;
    if (target === "staged") {
      return (
        <Button size="sm" onClick={() => void apply(data, "unstage", lines)}>
          {some ? t("lines.unstage", { lines: count }) : t("lines.unstageHunk")}
        </Button>
      );
    }
    return (
      <span className="flex items-center gap-1">
        {target === "unstaged" && (
          <Button size="sm" variant="ghostDanger" onClick={() => setConfirmDiscard(lines)}>
            {some ? t("lines.discard", { lines: count }) : t("lines.discardHunk")}
          </Button>
        )}
        <Button size="sm" onClick={() => void apply(data, "stage", lines)}>
          {some ? t("lines.stage", { lines: count }) : t("lines.stageHunk")}
        </Button>
      </span>
    );
  };

  const err = diff.error;
  const name = file.path.split("/").pop() ?? file.path;
  return (
    <>
      <DiffView
        diff={data}
        loading={diff.isPending || (!data && !err)}
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
        onLoadAnyway={() => setForce(true)}
        headerActions={target !== "untracked" && <FileViewButtons path={file.path} rev={null} />}
        renderHunkActions={hunkActions}
        selection={keys}
        onSelectionChange={setKeys}
        className="h-full"
      />
      <ConfirmDialog
        open={confirmDiscard !== null}
        onOpenChange={(open) => !open && setConfirmDiscard(null)}
        destructive
        title={t("discard.linesTitle")}
        consequence={t("discard.lines", {
          lines: plural("count.lines", confirmDiscard?.length ?? 0),
          name,
        })}
        confirmLabel={t("discard.linesConfirm", {
          lines: plural("count.lines", confirmDiscard?.length ?? 0),
        })}
        onConfirm={() => data && confirmDiscard && void apply(data, "discard", confirmDiscard)}
      />
    </>
  );
}
