import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileSearch } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useWorkspace } from "@/app/workspace";
import { DiffView } from "@/features/diff/DiffView";
import { FileViewButtons } from "@/features/file-view/FileViewButtons";
import { useRepoUi, type SelectedFile } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import { ipc, isIpcError, type CommitDetails, type DiffRequest } from "@/ipc";
import { EmptyState } from "@/ui/EmptyState";

/** `u32::MAX` in Rust: the whole file as context. */
const FULL_CONTEXT = 4294967295;
const DEFAULT_CONTEXT = 3;

/** The request for one file of a commit, against its first parent (also used to prefetch). */
export function commitDiffRequest(
  commit: Pick<CommitDetails, "oid" | "parents">,
  file: Pick<SelectedFile, "path" | "oldPath">,
  context = DEFAULT_CONTEXT,
  force = false,
): DiffRequest {
  return {
    target: { kind: "commit", oid: commit.oid, parent: commit.parents[0] ?? null },
    path: file.path,
    oldPath: file.oldPath,
    context,
    ignoreWhitespace: false,
    force,
  };
}

/** Diff of the selected file of a commit. */
export function DiffPane({ repo }: { repo: string }) {
  const selection = useRepoUi((s) => s.selection);
  const file = useRepoUi((s) => s.selectedFile);
  if (!file) {
    return (
      <EmptyState icon={FileSearch} title={t("details.selectFile")} className="h-full bg-app" />
    );
  }
  const commitOid = selection?.kind === "commit" ? selection.oid : null;
  // Keyed per file, so expanded context and "load anyway" reset when the file changes.
  return (
    <FileDiffPane
      key={`${commitOid}:${file.target}:${file.path}`}
      repo={repo}
      file={file}
      commitOid={commitOid}
    />
  );
}

function FileDiffPane({
  repo,
  file,
  commitOid,
}: {
  repo: string;
  file: SelectedFile;
  commitOid: string | null;
}) {
  // The first parent comes from the commit details, already cached by the file list.
  const commit = useQuery({
    queryKey: ["commit", repo, commitOid],
    queryFn: () => ipc.getCommit(repo, commitOid!),
    enabled: file.target === "commit" && commitOid !== null,
    staleTime: Infinity,
  });
  return (
    <CommitFileDiff
      repo={repo}
      commit={commit.data}
      file={file}
      headerActions={<FileViewButtons path={file.path} rev={commitOid} />}
    />
  );
}

/**
 * One file's changes in a commit, against its first parent; loading until `commit` is
 * known. Key it per file so "show full file" and "load anyway" reset.
 */
export function CommitFileDiff({
  repo,
  commit,
  file,
  headerActions,
}: {
  repo: string;
  commit: Pick<CommitDetails, "oid" | "parents"> | undefined;
  file: Pick<SelectedFile, "path" | "oldPath">;
  headerActions?: ReactNode;
}) {
  const mode = useWorkspace((s) => s.diffMode);
  const setMode = useWorkspace((s) => s.setDiffMode);
  // Changes only by default (faster, and what you usually want); reset per file.
  const [fullFile, setFullFile] = useState(false);
  const context = fullFile ? FULL_CONTEXT : DEFAULT_CONTEXT;
  const [force, setForce] = useState(false);

  const request = commit ? commitDiffRequest(commit, file, context, force) : null;

  const diff = useQuery({
    queryKey: ["diff", repo, request],
    queryFn: () => ipc.getDiff(repo, request!),
    enabled: request !== null,
    // Commit diffs never change.
    staleTime: Infinity,
    // Keep showing the diff while more context loads.
    placeholderData: keepPreviousData,
    retry: false,
  });

  const err = diff.error;
  return (
    <DiffView
      diff={diff.data}
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
      onLoadAnyway={() => setForce(true)}
      headerActions={headerActions}
      className="h-full"
    />
  );
}
