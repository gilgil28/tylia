import {
  CircleCheckBig,
  Copy,
  EyeOff,
  FileClock,
  FileDown,
  FileUp,
  FileUser,
  FolderOpen,
  SquareArrowOutUpRight,
  SquareSplitHorizontal,
  SquareCheck,
  SquareMinus,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { revealLabel, trashLabel } from "@/app/labels";
import { isMod } from "@/app/keyboard";
import { useWorkspace, type RepoLayout } from "@/app/workspace";
import { CustomActionItems } from "@/features/custom-actions/CustomActionItems";
import { saveChangesPatch } from "@/features/patch/patch";
import { useRepoUi } from "@/features/repo/repo-store";
import { joinPath } from "@/features/welcome/paths";
import { plural, t } from "@/i18n";
import { ipc, type WorkingStatus } from "@/ipc";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState } from "@/ui/EmptyState";
import { IconButton } from "@/ui/IconButton";
import { ContextMenu } from "@/ui/Menu";
import { SplitPane } from "@/ui/SplitPane";
import { toast } from "@/ui/Toast";

import { ChangeList } from "./ChangeList";
import {
  entryKey,
  conflictedPaths,
  groupChanges,
  ignoreOptions,
  discardOptimistic,
  stageOptimistic,
  unstageOptimistic,
  unstagePaths,
  type Area,
  type ChangedEntry,
} from "./changes-model";
import { openInDiffTool } from "@/features/diff/externalDiff";

import { CommitComposer } from "./CommitComposer";
import { ConflictList } from "./Conflicts";
import { StagingDiffPane, WORKING_DIFF_STALE_MS, workingDiffRequest } from "./StagingDiffPane";
import { useRepoAction } from "./useRepoAction";

/** Pointer travel before a press on a row becomes a drag. */
const DRAG_THRESHOLD = 4;

/** The lists top to bottom: changes flow upwards, from Unstaged to Staged to the commit. */
const AREAS: Area[] = ["staged", "unstaged"];

const NO_MODIFIERS = { ctrlKey: false, metaKey: false, shiftKey: false };

interface Drag {
  from: Area;
  entries: ChangedEntry[];
  x: number;
  y: number;
  over: Area | null;
}

/** Staging area (Sourcetree's "File status"): unstaged and staged files, the diff with
 * hunk/line staging, and the commit composer. */
export function ChangesView({
  repo,
  status,
  layout,
}: {
  repo: string;
  status: WorkingStatus | undefined;
  layout: RepoLayout;
}) {
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const selectedFile = useRepoUi((s) => s.selectedFile);
  const selectFile = useRepoUi((s) => s.selectFile);
  const openFile = useRepoUi((s) => s.openFile);
  const run = useRepoAction(repo);
  const groups = useMemo(() => groupChanges(status), [status]);
  const conflicts = useMemo(() => conflictedPaths(status), [status]);

  const [explicitSelection, setSelection] = useState<{
    area: Area;
    keys: Set<string>;
    anchor: string | null;
  }>({ area: "unstaged", keys: new Set(), anchor: null });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [discarding, setDiscarding] = useState<ChangedEntry[] | null>(null);
  const pending = useRef<{ entry: ChangedEntry; x: number; y: number } | null>(null);

  const focusKey =
    selectedFile && selectedFile.target !== "commit" && selectedFile.target !== "conflicted"
      ? `${selectedFile.target === "staged" ? "staged" : "unstaged"}:${selectedFile.path}`
      : null;

  const focus = (entry: ChangedEntry) =>
    selectFile({ path: entry.path, oldPath: entry.oldPath, target: entry.target });

  // Keep a file selected: the first conflict, else the first unstaged (else staged) one, and
  // re-pick when the shown file disappears from the lists (staged, discarded, committed,
  // resolved).
  const all = [...groups.unstaged, ...groups.staged];
  const focusExists =
    (selectedFile?.target === "conflicted" && conflicts.includes(selectedFile.path)) ||
    (focusKey !== null && all.some((e) => entryKey(e) === focusKey));
  useEffect(() => {
    if (focusExists) return;
    const conflict = conflicts[0];
    const first = groups.unstaged[0] ?? groups.staged[0];
    if (conflict) {
      selectFile({ path: conflict, oldPath: null, target: "conflicted" });
    } else if (first) {
      selectFile({ path: first.path, oldPath: first.oldPath, target: first.target });
    } else if (selectedFile) {
      selectFile(null);
    }
  }, [focusExists, conflicts, groups, selectFile, selectedFile]);

  const focusArea: Area = selectedFile?.target === "staged" ? "staged" : "unstaged";
  const selection =
    explicitSelection.keys.size > 0 || !focusKey
      ? explicitSelection
      : { area: focusArea, keys: new Set([focusKey]), anchor: focusKey };

  const selectedEntries = (area: Area) =>
    selection.area === area ? groups[area].filter((e) => selection.keys.has(entryKey(e))) : [];

  // Prefetch the diffs next to the shown file, so moving through the list is instant.
  const client = useQueryClient();
  useEffect(() => {
    const list = [...groups.unstaged, ...groups.staged];
    const i = list.findIndex((e) => entryKey(e) === focusKey);
    if (i < 0) return;
    for (const neighbour of [list[i + 1], list[i - 1]]) {
      if (!neighbour) continue;
      const request = workingDiffRequest(neighbour);
      void client.prefetchQuery({
        queryKey: ["diff", repo, request],
        queryFn: () => ipc.getDiff(repo, request),
        staleTime: WORKING_DIFF_STALE_MS,
      });
    }
  }, [client, repo, groups, focusKey]);

  // --- Actions -------------------------------------------------------------------------
  // Each updates the lists at once (optimistic) and lets Git confirm in the background.
  const stage = (entries: ChangedEntry[]) => {
    const paths = entries.map((e) => e.path);
    return run(() => ipc.stageFiles(repo, paths), t("changes.stageFailed"), {
      optimistic: (s) => stageOptimistic(s, paths),
    });
  };
  const unstage = (entries: ChangedEntry[]) =>
    run(() => ipc.unstageFiles(repo, unstagePaths(entries)), t("changes.unstageFailed"), {
      optimistic: (s) =>
        unstageOptimistic(
          s,
          entries.map((e) => e.path),
        ),
    });
  const toggle = (entries: ChangedEntry[]) =>
    entries[0]?.area === "staged" ? unstage(entries) : stage(entries);
  const discard = (entries: ChangedEntry[]) =>
    run(
      () =>
        ipc.discardFiles(
          repo,
          entries.filter((e) => e.target !== "untracked").map((e) => e.path),
          entries.filter((e) => e.target === "untracked").map((e) => e.path),
        ),
      t("changes.discardFailed"),
      {
        optimistic: (s) =>
          discardOptimistic(
            s,
            entries.map((e) => e.path),
          ),
      },
    );
  const stageAll = () =>
    run(() => ipc.stageAll(repo), t("changes.stageFailed"), {
      optimistic: (s) =>
        stageOptimistic(
          s,
          s.entries.map((e) => e.path),
        ),
    });
  const unstageAll = () =>
    run(() => ipc.unstageAll(repo), t("changes.unstageFailed"), {
      optimistic: (s) =>
        unstageOptimistic(
          s,
          s.entries.map((e) => e.path),
        ),
    });
  const ignore = (pattern: string) =>
    run(() => ipc.ignorePattern(repo, pattern), t("changes.ignoreFailed")).then(
      (ok) =>
        ok !== undefined && toast({ kind: "success", title: t("changes.ignored", { pattern }) }),
    );

  // --- Selection -----------------------------------------------------------------------
  const selectRow = (
    entry: ChangedEntry,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    const key = entryKey(entry);
    const list = groups[entry.area];
    const sameArea = selection.area === entry.area;
    if (e.shiftKey && sameArea && selection.anchor) {
      const a = list.findIndex((x) => entryKey(x) === selection.anchor);
      const b = list.findIndex((x) => entryKey(x) === key);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelection({
        area: entry.area,
        keys: new Set(list.slice(lo, hi + 1).map(entryKey)),
        anchor: selection.anchor,
      });
    } else if ((e.ctrlKey || e.metaKey) && sameArea) {
      const keys = new Set(selection.keys);
      if (keys.has(key)) keys.delete(key);
      else keys.add(key);
      setSelection({ area: entry.area, keys, anchor: key });
    } else {
      setSelection({ area: entry.area, keys: new Set([key]), anchor: key });
    }
    focus(entry);
  };

  const onRowPointerDown = (entry: ChangedEntry, e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      // Right-click: act on the selection if the row is in it, else on the row alone.
      if (!(selection.area === entry.area && selection.keys.has(entryKey(entry)))) {
        selectRow(entry, { ctrlKey: false, metaKey: false, shiftKey: false });
      }
      return;
    }
    if (e.button !== 0) return;
    selectRow(entry, e);
    pending.current = { entry, x: e.clientX, y: e.clientY };
  };

  // Dragging rows from one list onto the other stages or unstages them.
  useEffect(() => {
    const areaAt = (x: number, y: number) =>
      (document
        .elementFromPoint(x, y)
        ?.closest("[data-drop-area]")
        ?.getAttribute("data-drop-area") ?? null) as Area | null;
    const move = (e: globalThis.PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      const entries =
        selection.area === p.entry.area && selection.keys.has(entryKey(p.entry))
          ? groups[p.entry.area].filter((x) => selection.keys.has(entryKey(x)))
          : [p.entry];
      const over = areaAt(e.clientX, e.clientY);
      setDrag({
        from: p.entry.area,
        entries,
        x: e.clientX,
        y: e.clientY,
        over: over === p.entry.area ? null : over,
      });
    };
    const up = () => {
      if (drag?.over) void toggle(drag.entries);
      pending.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const onListKeyDown = (area: Area) => (e: KeyboardEvent<HTMLDivElement>) => {
    const list = groups[area];
    if (list.length === 0) return;
    const current = list.findIndex((x) => entryKey(x) === focusKey);
    const move = (to: number) => {
      // ↑ / ↓ past the end of a list continue in the next one (Staged above Unstaged), unless
      // extending a selection, which stays in one list.
      const next = to < 0 ? AREAS[AREAS.indexOf(area) - 1] : AREAS[AREAS.indexOf(area) + 1];
      const other = next && groups[next];
      if ((to < 0 || to >= list.length) && !e.shiftKey && other && other.length > 0) {
        selectRow(other[to < 0 ? other.length - 1 : 0]!, NO_MODIFIERS);
        document.querySelector<HTMLElement>(`[data-drop-area="${next}"] [role="listbox"]`)?.focus();
        return;
      }
      const entry = list[Math.max(0, Math.min(list.length - 1, to))]!;
      selectRow(entry, { ...NO_MODIFIERS, shiftKey: e.shiftKey });
    };
    if (e.key === "ArrowDown") move(current + 1);
    else if (e.key === "ArrowUp") move(current - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === " ") void toggle(selectedEntries(area));
    else if ((e.key === "Delete" || e.key === "Backspace") && area === "unstaged") {
      setDiscarding(selectedEntries(area));
    } else if (isMod(e) && e.key.toLowerCase() === "a") {
      setSelection({ area, keys: new Set(list.map(entryKey)), anchor: selection.anchor });
    } else return;
    e.preventDefault();
  };

  // --- Context menu --------------------------------------------------------------------
  const menu = (entry: ChangedEntry) => {
    const targets =
      selection.area === entry.area && selection.keys.has(entryKey(entry))
        ? selectedEntries(entry.area)
        : [entry];
    const single = targets.length === 1;
    const fullPath = joinPath(repo, entry.path.replaceAll("/", repo.includes("\\") ? "\\" : "/"));
    return (
      <>
        {entry.area === "unstaged" ? (
          <ContextMenu.Item icon={SquareCheck} onSelect={() => void stage(targets)}>
            {single
              ? t("changes.stage")
              : `${t("changes.stage")} · ${plural("count.files", targets.length)}`}
          </ContextMenu.Item>
        ) : (
          <ContextMenu.Item icon={SquareMinus} onSelect={() => void unstage(targets)}>
            {single
              ? t("changes.unstage")
              : `${t("changes.unstage")} · ${plural("count.files", targets.length)}`}
          </ContextMenu.Item>
        )}
        {entry.area === "unstaged" && (
          <ContextMenu.Item icon={Trash2} danger onSelect={() => setDiscarding(targets)}>
            {t("changes.discard")}
          </ContextMenu.Item>
        )}
        <ContextMenu.Separator />
        <ContextMenu.Item
          icon={FileClock}
          disabled={!single || entry.target === "untracked"}
          onSelect={() => openFile({ path: entry.path, mode: "history" })}
        >
          {t("fileView.menuHistory")}
        </ContextMenu.Item>
        <ContextMenu.Item
          icon={FileUser}
          disabled={
            !single ||
            entry.target === "untracked" ||
            entry.status === "added" ||
            entry.status === "deleted"
          }
          onSelect={() => openFile({ path: entry.path, mode: "blame" })}
        >
          {t("fileView.menuBlame")}
        </ContextMenu.Item>
        <ContextMenu.Item
          icon={SquareSplitHorizontal}
          disabled={!single || entry.target === "untracked"}
          onSelect={() =>
            openInDiffTool(
              repo,
              workingDiffRequest({
                path: entry.path,
                oldPath: entry.oldPath,
                target: entry.target,
              }),
            )
          }
        >
          {t("actions.diffTool")}
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item
          icon={SquareArrowOutUpRight}
          disabled={!single || entry.status === "deleted"}
          onSelect={() => void run(() => ipc.openFile(repo, entry.path), t("changes.openFailed"))}
        >
          {t("changes.open")}
        </ContextMenu.Item>
        <ContextMenu.Item
          icon={FolderOpen}
          disabled={!single || entry.status === "deleted"}
          onSelect={() => void ipc.revealInFileManager(fullPath)}
        >
          {revealLabel}
        </ContextMenu.Item>
        <ContextMenu.Item
          icon={Copy}
          onSelect={() => void navigator.clipboard.writeText(targets.map((e) => e.path).join("\n"))}
        >
          {t("changes.copyPath")}
        </ContextMenu.Item>
        <ContextMenu.Item
          icon={FileUp}
          disabled={!single}
          onSelect={() => void navigator.clipboard.writeText(fullPath)}
        >
          {t("changes.copyFullPath")}
        </ContextMenu.Item>
        {single && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger icon={EyeOff}>{t("changes.ignore")}</ContextMenu.SubTrigger>
              <ContextMenu.SubContent>
                {ignoreOptions(entry.path).map((o) => (
                  <ContextMenu.Item key={o.kind} onSelect={() => void ignore(o.pattern)}>
                    {o.kind === "file"
                      ? t("changes.ignoreFile", { name: o.label })
                      : o.kind === "extension"
                        ? t("changes.ignoreExtension", { ext: o.label })
                        : t("changes.ignoreFolder", { folder: o.label })}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Sub>
          </>
        )}
        <CustomActionItems
          M={ContextMenu}
          scope="file"
          context={{ repo, sha: null, branch: null, files: targets.map((e) => e.path) }}
        />
      </>
    );
  };

  const discardTracked = (discarding ?? []).filter((e) => e.target !== "untracked").length;
  const discardUntracked = (discarding ?? []).length - discardTracked;

  if (all.length === 0 && conflicts.length === 0 && status) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState
          icon={CircleCheckBig}
          title={t("changes.clean")}
          description={t("changes.cleanBody")}
          className="flex-1 bg-app"
        />
        <CommitComposer repo={repo} stagedCount={0} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <SplitPane
        className="flex-1"
        size={layout.filesWidth}
        onSizeChange={(filesWidth) => updateLayout(repo, { filesWidth })}
        min={220}
        max={640}
        first={
          <div className="flex h-full flex-col">
            {conflicts.length > 0 && <ConflictList repo={repo} paths={conflicts} status={status} />}
            <ChangeList
              area="staged"
              entries={groups.staged}
              selected={selection.area === "staged" ? selection.keys : new Set()}
              focusKey={focusKey}
              onRowPointerDown={onRowPointerDown}
              onToggle={(e) => void toggle(e)}
              onKeyDown={onListKeyDown("staged")}
              dropActive={drag?.over === "staged"}
              menu={menu}
              action={{
                label: t("changes.unstageAll"),
                onClick: () => void unstageAll(),
              }}
              extra={
                <IconButton
                  icon={FileDown}
                  label={t("patch.saveStaged")}
                  compact
                  disabled={groups.staged.length === 0}
                  onClick={() => void saveChangesPatch(repo, true)}
                />
              }
              empty={
                <span className="flex flex-col gap-1">
                  <span className="text-fg-secondary">{t("changes.nothingStaged")}</span>
                  {t("changes.nothingStagedHint")}
                </span>
              }
            />
            <div className="h-px shrink-0 bg-line-subtle" />
            <ChangeList
              area="unstaged"
              entries={groups.unstaged}
              selected={selection.area === "unstaged" ? selection.keys : new Set()}
              focusKey={focusKey}
              onRowPointerDown={onRowPointerDown}
              onToggle={(e) => void toggle(e)}
              onKeyDown={onListKeyDown("unstaged")}
              dropActive={drag?.over === "unstaged"}
              menu={menu}
              action={{
                label: t("changes.stageAll"),
                onClick: () => void stageAll(),
              }}
              extra={
                <>
                  <IconButton
                    icon={FileDown}
                    label={t("patch.saveUnstaged")}
                    compact
                    disabled={groups.unstaged.length === 0}
                    onClick={() => void saveChangesPatch(repo, false)}
                  />
                  <IconButton
                    icon={Trash2}
                    label={t("changes.discardAll")}
                    compact
                    onClick={() => setDiscarding(groups.unstaged)}
                  />
                </>
              }
              empty={t("changes.nothingUnstaged")}
            />
          </div>
        }
        second={<StagingDiffPane repo={repo} status={status} />}
      />
      <CommitComposer repo={repo} stagedCount={groups.staged.length} />

      {drag && (
        <div
          className="pointer-events-none fixed z-50 rounded-badge bg-elevated px-2 py-1 text-small text-fg shadow-float"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {drag.entries.length === 1
            ? drag.entries[0]!.path.split("/").pop()
            : plural("count.files", drag.entries.length)}
        </div>
      )}

      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => !open && setDiscarding(null)}
        destructive
        title={t("discard.title")}
        consequence={[
          discardTracked > 0 &&
            t("discard.tracked", { files: plural("count.files", discardTracked) }),
          discardUntracked > 0 &&
            t("discard.untracked", {
              files: plural("count.files", discardUntracked),
              trash: trashLabel,
            }),
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("discard.confirm", {
          files: plural("count.files", discarding?.length ?? 0),
        })}
        onConfirm={() => discarding && void discard(discarding)}
      />
    </div>
  );
}
