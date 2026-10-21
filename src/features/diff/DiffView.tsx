import {
  ArrowRight,
  Binary,
  Columns2,
  FileCheck,
  FileExclamationPoint,
  FoldVertical,
  UnfoldVertical,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { t } from "@/i18n";
import type { FileDiff } from "@/ipc/bindings/FileDiff";
import type { Hunk } from "@/ipc/bindings/Hunk";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorPanel, type ErrorDetails } from "@/ui/ErrorPanel";
import { IconButton } from "@/ui/IconButton";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Skeleton } from "@/ui/Skeleton";
import { Tooltip } from "@/ui/Tooltip";

import { DiffRows } from "./DiffRows";
import { formatSize } from "./format";
import { ImageCompare } from "./ImageCompare";
import { detectLanguage } from "./language";
import { DEFAULT_DIFF_FONT_PX, lineRowHeight, type DiffMode } from "./rows";

export type { DiffMode };

export interface DiffViewProps {
  diff: FileDiff | undefined;
  loading?: boolean;
  error?: ErrorDetails | null;
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  /** Re-request with the whole file as context (expands collapsed regions). */
  onExpandContext?: () => void;
  /** The whole file is shown (not just the changes); with `onFullFileChange`, a header
   * toggle switches between the two. Callers default to changes only. */
  fullFile?: boolean;
  onFullFileChange?: (full: boolean) => void;
  /** Re-request ignoring the large-file guard. */
  onLoadAnyway?: () => void;
  /** Extra controls at the end of the header (e.g. the file's history and blame). */
  headerActions?: ReactNode;
  /** Slot for per-hunk actions (Phase 2: "Stage hunk"); render in the hunk header row. */
  renderHunkActions?: (hunk: Hunk, index: number) => ReactNode;
  /**
   * Line selection for staging. Keys are `${hunkIndex}:${lineIndex}` (indices into
   * diff.content.hunks / hunk.lines; see `selection.ts`). Only "add"/"del" lines are
   * selectable. Keys refer to the rendered diff: reset the selection when `diff` changes.
   */
  selection?: ReadonlySet<string>;
  /** Makes changed lines selectable from their gutters. */
  onSelectionChange?: (next: Set<string>) => void;
  className?: string;
}

/** One file's changes: header, then the text diff, image comparison, or a state. */
export function DiffView({
  diff,
  loading = false,
  error,
  mode,
  onModeChange,
  onExpandContext,
  fullFile = false,
  onFullFileChange,
  onLoadAnyway,
  headerActions,
  renderHunkActions,
  selection,
  onSelectionChange,
  className,
}: DiffViewProps) {
  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden bg-app", className)}>
      {diff ? (
        <DiffHeader
          diff={diff}
          mode={mode}
          onModeChange={onModeChange}
          fullFile={fullFile}
          onFullFileChange={onFullFileChange}
          actions={headerActions}
        />
      ) : (
        loading && (
          <div className="flex h-9 shrink-0 items-center border-b border-line-subtle bg-panel px-3">
            <Skeleton className="h-2.5 w-48" />
          </div>
        )
      )}
      {error ? (
        <div className="min-h-0 overflow-auto p-4">
          <ErrorPanel {...error} />
        </div>
      ) : loading ? (
        <DiffSkeleton />
      ) : (
        diff && (
          <DiffBody
            diff={diff}
            mode={mode}
            onExpandContext={onExpandContext}
            onLoadAnyway={onLoadAnyway}
            renderHunkActions={renderHunkActions}
            selection={selection}
            onSelectionChange={onSelectionChange}
          />
        )
      )}
    </div>
  );
}

function DiffBody({
  diff,
  mode,
  onExpandContext,
  onLoadAnyway,
  renderHunkActions,
  selection,
  onSelectionChange,
}: Pick<
  DiffViewProps,
  | "mode"
  | "onExpandContext"
  | "onLoadAnyway"
  | "renderHunkActions"
  | "selection"
  | "onSelectionChange"
> & {
  diff: FileDiff;
}) {
  const lang = useMemo(() => detectLanguage(diff.path), [diff.path]);
  const { content } = diff;
  const image = diff.image?.old || diff.image?.new ? diff.image : null;

  if (content.kind === "text") {
    return (
      <>
        {/* SVG: the picture above its source */}
        {image && (
          <ImageCompare image={image} className="h-44 shrink-0 border-b border-line-subtle" />
        )}
        <DiffRows
          hunks={content.hunks}
          mode={mode}
          lang={lang}
          label={t("diff.changesIn", { path: diff.path })}
          onExpandContext={onExpandContext}
          renderHunkActions={renderHunkActions}
          selection={selection}
          onSelectionChange={onSelectionChange}
        />
      </>
    );
  }
  if (image) return <ImageCompare image={image} className="flex-1" />;

  switch (content.kind) {
    case "binary":
      return (
        <EmptyState
          className="flex-1"
          icon={Binary}
          title={t("diff.binaryTitle")}
          description={t("diff.binaryBody")}
        />
      );
    case "tooLarge":
      return (
        <EmptyState
          className="flex-1"
          icon={FileExclamationPoint}
          title={t("diff.tooLargeTitle")}
          description={t("diff.tooLargeBody", {
            lines: content.lines.toLocaleString(),
            size: formatSize(content.bytes),
          })}
          actions={
            onLoadAnyway && (
              <Button size="sm" onClick={onLoadAnyway}>
                {t("diff.loadAnyway")}
              </Button>
            )
          }
        />
      );
    case "empty": {
      const modes = modeChange(diff);
      return (
        <EmptyState
          className="flex-1"
          icon={FileCheck}
          title={t("diff.emptyTitle")}
          description={modes && t("diff.emptyModeBody", modes)}
        />
      );
    }
  }
}

function modeChange({ oldMode, newMode }: FileDiff): { old: string; new: string } | null {
  return oldMode && newMode && oldMode !== newMode ? { old: oldMode, new: newMode } : null;
}

function DiffHeader({
  diff,
  mode,
  onModeChange,
  fullFile,
  onFullFileChange,
  actions,
}: {
  diff: FileDiff;
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  fullFile: boolean;
  onFullFileChange?: (full: boolean) => void;
  actions?: ReactNode;
}) {
  const { content, oldPath, path } = diff;
  const renamed = oldPath !== null && oldPath !== path;
  const modes = modeChange(diff);
  return (
    // A container: in a narrow pane the stats hide and the layout switch becomes one toggle,
    // so the path keeps its room.
    <div className="@container flex h-9 shrink-0 items-center gap-3 border-b border-line-subtle bg-panel pr-1.5 pl-3">
      <Tooltip content={renamed ? t("diff.renamed", { old: oldPath, new: path }) : path}>
        <span className="flex min-w-0 items-center gap-1.5">
          {renamed && (
            <>
              <PathLabel path={oldPath} className="text-fg-secondary" />
              <ArrowRight
                size={14}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-fg-muted"
              />
            </>
          )}
          <PathLabel path={path} />
        </span>
      </Tooltip>
      {modes && (
        <Tooltip content={t("diff.modeChanged", modes)}>
          <span className="flex shrink-0">
            <Badge>
              {modes.old} → {modes.new}
            </Badge>
          </span>
        </Tooltip>
      )}
      <span className="flex-1" />
      {content.kind === "text" && (
        <>
          <Tooltip
            content={t("diff.stats", {
              additions: content.additions,
              deletions: content.deletions,
            })}
          >
            <span className="shrink-0 text-small font-medium tabular-nums @max-[32rem]:hidden">
              <span aria-hidden>
                <span className="text-success">+{content.additions}</span>{" "}
                <span className="text-danger">−{content.deletions}</span>
              </span>
              <span className="sr-only">
                {t("diff.stats", { additions: content.additions, deletions: content.deletions })}
              </span>
            </span>
          </Tooltip>
          {onFullFileChange && (
            <IconButton
              icon={fullFile ? FoldVertical : UnfoldVertical}
              label={fullFile ? t("diff.changesOnly") : t("diff.fullFile")}
              active={fullFile}
              aria-pressed={fullFile}
              onClick={() => onFullFileChange(!fullFile)}
            />
          )}
          <span className="flex @max-[32rem]:hidden">
            <SegmentedControl
              aria-label={t("diff.layout")}
              value={mode}
              onValueChange={onModeChange}
              segments={[
                { value: "unified", label: t("diff.unified") },
                { value: "split", label: t("diff.split") },
              ]}
            />
          </span>
          <span className="hidden @max-[32rem]:flex">
            <IconButton
              icon={Columns2}
              label={t("diff.split")}
              active={mode === "split"}
              aria-pressed={mode === "split"}
              onClick={() => onModeChange(mode === "split" ? "unified" : "split")}
            />
          </span>
        </>
      )}
      {actions && <span className="flex shrink-0 items-center gap-0.5">{actions}</span>}
    </div>
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
      <span className="max-w-full shrink-0 truncate font-medium">{path.slice(slash + 1)}</span>
    </span>
  );
}

const SKELETON_WIDTHS = ["w-2/5", "w-3/5", "w-1/3", "w-1/2", "w-3/4", "w-1/4", "w-2/3"];

/** Placeholder shaped like a hunk: header band, then numbered lines. */
function DiffSkeleton() {
  const height = lineRowHeight(DEFAULT_DIFF_FONT_PX);
  return (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center bg-(--diff-hunk-bg) px-3">
        <Skeleton className="h-2 w-40" />
      </div>
      {Array.from({ length: 16 }, (_, i) => (
        <div key={i} className="flex shrink-0 items-center gap-3 px-3" style={{ height }}>
          <Skeleton className="h-2 w-5" />
          <Skeleton className="h-2 w-5" />
          <Skeleton className={cn("h-2", SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])} />
        </div>
      ))}
    </div>
  );
}
