import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, GitMerge, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { shortHash, timeLabel } from "@/app/format";
import { useSettings } from "@/app/settings";
import { useWorkspace, type RepoLayout } from "@/app/workspace";
import { useRepoUi } from "@/features/repo/repo-store";
import { plural, t } from "@/i18n";
import { ipc, isIpcError, type CommitDetails } from "@/ipc";
import { Avatar } from "@/ui/Avatar";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { IconButton } from "@/ui/IconButton";
import { Skeleton } from "@/ui/Skeleton";
import { SplitPane } from "@/ui/SplitPane";

import { commitDiffRequest, DiffPane } from "./DiffPane";
import { FileList, FileViewToggle, type ListedFile } from "./FileList";
import { SeveralCommits } from "./SeveralCommits";

function CopyHash({ oid }: { oid: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <span className="flex items-center gap-1">
      <code className="text-small text-fg-secondary" data-selectable title={oid}>
        {shortHash(oid)}
      </code>
      <IconButton
        icon={copied ? Check : Copy}
        label={copied ? t("details.hashCopied", { hash: shortHash(oid) }) : t("details.copyHash")}
        compact
        onClick={() => void navigator.clipboard.writeText(oid).then(() => setCopied(true))}
      />
    </span>
  );
}

function CommitHeader({ details }: { details: CommitDetails }) {
  const dateFormat = useSettings((s) => s.settings.dateFormat);
  const reveal = useRepoUi((s) => s.reveal);
  const { author, committer } = details;
  const sameCommitter = committer.email === author.email && committer.name === author.name;
  return (
    <div className="flex flex-col gap-2 border-b border-line-subtle px-3 py-3">
      <h3 className="text-title font-semibold break-words text-fg" data-selectable>
        {details.subject}
      </h3>
      {details.body && (
        <p
          className="max-h-32 overflow-auto text-small whitespace-pre-wrap text-fg-secondary"
          data-selectable
        >
          {details.body}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-secondary">
        <span
          className="flex min-w-0 items-center gap-1.5"
          title={`${author.name} <${author.email}>`}
        >
          <Avatar name={author.name} email={author.email} />
          <span className="truncate font-medium text-fg">{author.name}</span>
        </span>
        <span title={timeLabel(author.time, dateFormat).title}>
          {timeLabel(author.time, dateFormat).text}
        </span>
        <CopyHash oid={details.oid} />
      </div>
      {(!sameCommitter || details.parents.length > 0) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
          {!sameCommitter && (
            <>
              <dt className="text-fg-muted">{t("details.committer")}</dt>
              <dd className="truncate text-fg-secondary" title={committer.email}>
                {committer.name} · {timeLabel(committer.time, dateFormat).text}
              </dd>
            </>
          )}
          {details.parents.length > 0 && (
            <>
              <dt className="text-fg-muted">{t("details.parents")}</dt>
              <dd className="flex flex-wrap gap-2">
                {details.parents.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => reveal(p)}
                    className="rounded-badge font-code text-small text-accent focus-ring hover:underline"
                  >
                    {shortHash(p)}
                  </button>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}
      {details.parents.length > 1 && (
        <p className="flex items-center gap-1.5 text-small text-fg-muted">
          <GitMerge size={12} strokeWidth={1.75} aria-hidden />
          {t("details.merge")}
        </p>
      )}
    </div>
  );
}

function ListHeader({
  title,
  view,
  onView,
}: {
  title: string;
  view: "flat" | "tree";
  onView: (v: "flat" | "tree") => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-3">
      <span className="truncate text-caption font-medium text-fg-muted">{title}</span>
      <FileViewToggle value={view} onChange={onView} />
    </div>
  );
}

function CommitSide({
  repo,
  oid,
  layout,
  listRef,
}: {
  repo: string;
  oid: string;
  layout: RepoLayout;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const selectedFile = useRepoUi((s) => s.selectedFile);
  const selectFile = useRepoUi((s) => s.selectFile);
  const commit = useQuery({
    queryKey: ["commit", repo, oid],
    queryFn: () => ipc.getCommit(repo, oid),
    staleTime: Infinity,
  });
  const files: ListedFile[] = useMemo(
    () =>
      (commit.data?.files ?? []).map((f) => ({
        path: f.path,
        oldPath: f.oldPath,
        status: f.status,
        target: "commit" as const,
        additions: f.additions,
        deletions: f.deletions,
      })),
    [commit.data],
  );

  // Show the first file's diff by default.
  useEffect(() => {
    const first = files[0];
    if (!selectedFile && first)
      selectFile({ path: first.path, oldPath: first.oldPath, target: "commit" });
  }, [files, selectedFile, selectFile]);

  // Prefetch the diffs next to the shown file (commit diffs never change, so they stay cached).
  const client = useQueryClient();
  useEffect(() => {
    const details = commit.data;
    const i = files.findIndex((f) => f.path === selectedFile?.path);
    if (!details || i < 0) return;
    for (const f of [files[i + 1], files[i - 1]]) {
      if (!f) continue;
      const request = commitDiffRequest(details, f);
      void client.prefetchQuery({
        queryKey: ["diff", repo, request],
        queryFn: () => ipc.getDiff(repo, request),
        staleTime: Infinity,
      });
    }
  }, [client, repo, commit.data, files, selectedFile]);

  if (commit.isPending) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-2.5 w-1/2" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
    );
  }
  if (commit.isError) {
    const err = commit.error;
    return (
      <div className="p-3">
        <ErrorPanel
          message={t("details.loadFailed")}
          command={isIpcError(err) ? err.command : null}
          stderr={isIpcError(err) ? (err.stderr ?? err.message) : String(err)}
        />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CommitHeader details={commit.data} />
      <ListHeader
        title={`${t("details.files")} · ${plural("count.files", files.length)}`}
        view={layout.fileView}
        onView={(fileView) => updateLayout(repo, { fileView })}
      />
      {files.length === 0 ? (
        <p className="p-3 text-small text-fg-muted">{t("details.noFiles")}</p>
      ) : (
        <FileList
          ref={listRef}
          files={files}
          view={layout.fileView}
          label={t("details.files")}
          className="flex-1"
        />
      )}
    </div>
  );
}

/** The area under the history: commit info and files on the left, the diff on the right. */
export function DetailsPane({
  repo,
  layout,
  focusToken,
}: {
  repo: string;
  layout: RepoLayout;
  /** Changes when the details should take keyboard focus (Enter in the history). */
  focusToken: number;
}) {
  const selection = useRepoUi((s) => s.selection);
  const selectedOids = useRepoUi((s) => s.selectedOids);
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the file list; after a fast ↓ + Enter it may still be loading, so keep trying
  // for a moment.
  useEffect(() => {
    if (focusToken === 0) return;
    let frame = 0;
    let tries = 60;
    const attempt = () => {
      const target = listRef.current?.querySelector<HTMLElement>("[tabindex='0']");
      if (target) target.focus();
      else if (tries-- > 0) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [focusToken]);

  const several = selectedOids.length >= 2;
  if (several) return <SeveralCommits repo={repo} oids={selectedOids} />;
  if (!selection) {
    return <EmptyState icon={Info} title={t("details.selectCommit")} className="h-full bg-app" />;
  }
  return (
    <SplitPane
      size={layout.filesWidth}
      onSizeChange={(filesWidth) => updateLayout(repo, { filesWidth })}
      min={220}
      max={640}
      first={
        <div className="h-full bg-app">
          <CommitSide
            key={selection.oid}
            repo={repo}
            oid={selection.oid}
            layout={layout}
            listRef={listRef}
          />
        </div>
      }
      second={<DiffPane repo={repo} />}
    />
  );
}
