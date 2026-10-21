import { ArrowLeft, FileClock, FileUser, X } from "lucide-react";
import type { KeyboardEvent } from "react";

import { shortHash } from "@/app/format";
import type { RepoLayout } from "@/app/workspace";
import { useRepoUi, type FileViewTarget } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Tooltip } from "@/ui/Tooltip";

import { BlameView } from "./BlameView";
import { BACK_SHORTCUT } from "./fileActions";
import { FileHistory } from "./FileHistory";

/** One file's history ("Log selected…") or blame, in place of History / Changes. */
export function FileView({
  repo,
  layout,
  active,
}: {
  repo: string;
  layout: RepoLayout;
  active: boolean;
}) {
  const file = useRepoUi((s) => s.file);
  const openFile = useRepoUi((s) => s.openFile);
  const closeFile = useRepoUi((s) => s.closeFile);
  if (!file) return null;

  // Escape in the view goes back; not from its menus, which are portalled elsewhere in the
  // page and close on their own Escape.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented && e.currentTarget.contains(e.target as Node)) {
      e.preventDefault();
      closeFile();
    }
  };

  return (
    <section
      aria-label={file.path}
      className="flex h-full min-h-0 flex-col bg-app"
      onKeyDown={onKeyDown}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle bg-panel pr-1.5 pl-1.5">
        <IconButton
          icon={ArrowLeft}
          label={t("fileView.back")}
          shortcut={BACK_SHORTCUT}
          compact
          onClick={closeFile}
        />
        <Tooltip content={file.path}>
          <span className="flex min-w-0">
            <PathLabel path={file.path} />
          </span>
        </Tooltip>
        {file.rev && (
          <RevChip
            file={file}
            onClear={() => openFile({ path: file.path, mode: file.mode, rev: null })}
          />
        )}
        <span className="flex-1" />
        <SegmentedControl
          aria-label={t("fileView.mode")}
          value={file.mode}
          onValueChange={(mode) => openFile({ ...file, mode, line: null })}
          segments={[
            { value: "history", label: t("fileView.history"), icon: FileClock },
            { value: "blame", label: t("fileView.blame"), icon: FileUser },
          ]}
        />
      </header>
      {file.mode === "history" ? (
        <FileHistory
          key={`${file.path}:${file.rev}`}
          repo={repo}
          path={file.path}
          rev={file.rev}
          layout={layout}
        />
      ) : (
        <BlameView
          key={`${file.path}:${file.rev}:${file.line}`}
          repo={repo}
          path={file.path}
          rev={file.rev}
          line={file.line}
          active={active}
        />
      )}
    </section>
  );
}

/** "at a1b2c3d" (blame) / "up to a1b2c3d" (history), with a way back to the latest. */
function RevChip({ file, onClear }: { file: FileViewTarget; onClear: () => void }) {
  const hash = shortHash(file.rev!);
  return (
    <span className="flex h-6 shrink-0 items-center gap-0.5 rounded-control bg-hover pl-2 text-small text-fg-secondary">
      <Tooltip content={t("fileView.atCommitHint", { hash })}>
        <span className="font-code">
          {file.mode === "blame"
            ? t("fileView.atCommit", { hash })
            : t("fileView.upToCommit", { hash })}
        </span>
      </Tooltip>
      <IconButton icon={X} label={t("fileView.showLatest")} compact onClick={onClear} />
    </span>
  );
}

/** Path with the directory truncated first: `src/features/d…/DiffView.tsx`. */
function PathLabel({ path, className }: { path: string; className?: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <span className={cn("flex min-w-0 items-baseline", className)} data-selectable>
      {slash >= 0 && (
        <span className="min-w-0 truncate text-fg-secondary">{path.slice(0, slash + 1)}</span>
      )}
      <span className="max-w-full shrink-0 truncate font-medium text-fg">
        {path.slice(slash + 1)}
      </span>
    </span>
  );
}
