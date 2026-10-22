import { useQueryClient } from "@tanstack/react-query";
import { Copy, FileClock, FileUser, FolderTree, List, SquareSplitHorizontal } from "lucide-react";
import { forwardRef, useState, type ReactNode } from "react";

import { openInDiffTool } from "@/features/diff/externalDiff";
import { LfsMark } from "@/features/lfs/lfs";
import { useRepoUi, type FileTarget, type SelectedFile } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import type { CommitDetails, FileStatus } from "@/ipc";
import { cn } from "@/ui/cn";
import { ContextMenu } from "@/ui/Menu";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Tree } from "@/ui/Tree";
import { allFolders } from "@/ui/tree-model";

import { commitDiffRequest } from "./DiffPane";
import { VirtualList } from "@/ui/VirtualList";

import { StatusGlyph } from "./StatusGlyph";

export interface ListedFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  target: FileTarget;
  additions?: number | null;
  deletions?: number | null;
}

const ROW = 26;

function Counts({ file }: { file: ListedFile }) {
  if (file.additions == null && file.deletions == null) return null;
  return (
    <span className="ml-auto flex shrink-0 gap-1.5 pl-2 text-caption tabular-nums">
      {!!file.additions && <span className="text-success">+{file.additions}</span>}
      {!!file.deletions && <span className="text-danger">−{file.deletions}</span>}
    </span>
  );
}

function FileName({ file, showDir }: { file: ListedFile; showDir: boolean }) {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash > 0 ? file.path.slice(0, slash) : "";
  return (
    <span
      className="flex min-w-0 items-baseline gap-2"
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
    >
      <span className="truncate text-fg">{name}</span>
      {showDir && dir && <span className="min-w-0 truncate text-small text-fg-muted">{dir}</span>}
    </span>
  );
}

const isSelected = (sel: SelectedFile | null, f: ListedFile) =>
  sel?.path === f.path && sel.target === f.target;

/** Changed files of a commit or of one working-copy area, as a flat list or a folder tree. */
export const FileList = forwardRef<
  HTMLDivElement,
  {
    files: ListedFile[];
    view: "flat" | "tree";
    label: string;
    className?: string;
    /** Paths Git LFS stores (marked on their rows). */
    lfs?: ReadonlySet<string>;
  }
>(function FileList({ files, view, label, className, lfs }, ref) {
  const selected = useRepoUi((s) => s.selectedFile);
  const selectFile = useRepoUi((s) => s.selectFile);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const pick = (f: ListedFile) =>
    selectFile({ path: f.path, oldPath: f.oldPath, target: f.target });

  if (view === "tree") {
    return (
      <FileMenu files={files} onPick={pick}>
        <div ref={ref} className={cn("overflow-auto px-1", className)}>
          <Tree<ListedFile>
            aria-label={label}
            items={files}
            getPath={(f) => f.path}
            expanded={expanded ?? allFolders(files.map((f) => f.path))}
            onExpandedChange={setExpanded}
            selectedId={
              selected && files.some((f) => isSelected(selected, f)) ? selected.path : null
            }
            onSelect={(leaf) => pick(leaf.data)}
            renderLeaf={(leaf) => (
              <span data-file-path={leaf.data.path} className="contents">
                <StatusGlyph status={leaf.data.status} />
                <FileName file={leaf.data} showDir={false} />
                {lfs?.has(leaf.data.path) && <LfsMark />}
                <Counts file={leaf.data} />
              </span>
            )}
          />
        </div>
      </FileMenu>
    );
  }
  const index = files.findIndex((f) => isSelected(selected, f));
  return (
    <FileMenu files={files} onPick={pick}>
      <div ref={ref} className={cn("min-h-0", className)}>
        <VirtualList
          aria-label={label}
          items={files}
          rowHeight={ROW}
          getKey={(f) => `${f.target}:${f.path}`}
          selectedIndex={index < 0 ? null : index}
          onSelect={(i) => pick(files[i]!)}
          renderRow={(f) => (
            <span
              data-file-path={f.path}
              className="flex min-w-0 flex-1 items-center gap-2 self-stretch"
            >
              <StatusGlyph status={f.status} />
              <FileName file={f} showDir />
              {lfs?.has(f.path) && <LfsMark />}
              <Counts file={f} />
            </span>
          )}
        />
      </div>
    </FileMenu>
  );
});

/** Context menu for a file row: its history and blame, copy path. Rows carry
 * `data-file-path`; elsewhere in the list there is no menu. */
function FileMenu({
  files,
  onPick,
  children,
}: {
  files: ListedFile[];
  onPick: (file: ListedFile) => void;
  children: ReactNode;
}) {
  const selection = useRepoUi((s) => s.selection);
  const openFile = useRepoUi((s) => s.openFile);
  const [file, setFile] = useState<ListedFile | null>(null);
  const rev = file?.target === "commit" && selection?.kind === "commit" ? selection.oid : null;
  const repo = useRepoUi((s) => s.repo);
  const client = useQueryClient();
  const commit = rev ? client.getQueryData<CommitDetails>(["commit", repo, rev]) : undefined;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        asChild
        onContextMenu={(e) => {
          const path = (e.target as HTMLElement)
            .closest<HTMLElement>("[data-file-path]")
            ?.getAttribute("data-file-path");
          const hit = files.find((f) => f.path === path);
          if (!hit) return e.preventDefault();
          onPick(hit);
          setFile(hit);
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        {file && (
          <>
            <ContextMenu.Item
              icon={FileClock}
              disabled={file.target === "untracked"}
              onSelect={() => openFile({ path: file.path, mode: "history" })}
            >
              {t("fileView.menuHistory")}
            </ContextMenu.Item>
            <ContextMenu.Item
              icon={FileUser}
              disabled={file.target === "untracked" || file.status === "deleted"}
              onSelect={() => openFile({ path: file.path, mode: "blame", rev })}
            >
              {t("fileView.menuBlame")}
            </ContextMenu.Item>
            <ContextMenu.Item
              icon={SquareSplitHorizontal}
              disabled={!commit || file.target !== "commit"}
              onSelect={() => commit && openInDiffTool(repo, commitDiffRequest(commit, file))}
            >
              {t("actions.diffTool")}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              icon={Copy}
              onSelect={() => void navigator.clipboard.writeText(file.path)}
            >
              {t("changes.copyPath")}
            </ContextMenu.Item>
          </>
        )}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

export function FileViewToggle({
  value,
  onChange,
}: {
  value: "flat" | "tree";
  onChange: (v: "flat" | "tree") => void;
}) {
  return (
    <SegmentedControl
      aria-label={t("details.fileView")}
      value={value}
      onValueChange={onChange}
      segments={[
        { value: "flat", label: t("details.flat"), icon: List },
        { value: "tree", label: t("details.tree"), icon: FolderTree },
      ]}
    />
  );
}
