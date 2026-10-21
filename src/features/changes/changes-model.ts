// Pure helpers for the Changes view: grouping status entries, line requests, ignore patterns.

import type {
  DiffTarget,
  FileDiff,
  FileStatus,
  Hunk,
  LineAction,
  LinesRequest,
  WorkingStatus,
} from "@/ipc";

export type Area = "unstaged" | "staged";

export interface ChangedEntry {
  area: Area;
  path: string;
  /** Rename source (staged renames). */
  oldPath: string | null;
  status: FileStatus;
  /** Which diff shows this entry. */
  target: Extract<DiffTarget["kind"], "staged" | "unstaged" | "untracked">;
}

export const entryKey = (e: { area: Area; path: string }) => `${e.area}:${e.path}`;

/** Splits status entries into the unstaged and staged lists (a file can be in both). */
export function groupChanges(status: WorkingStatus | undefined): Record<Area, ChangedEntry[]> {
  const unstaged: ChangedEntry[] = [];
  const staged: ChangedEntry[] = [];
  for (const e of status?.entries ?? []) {
    // Conflicted files have their own list until they're resolved.
    if (e.conflicted) continue;
    if (e.unstaged) {
      unstaged.push({
        area: "unstaged",
        path: e.path,
        oldPath: null,
        status: e.unstaged,
        target: e.unstaged === "untracked" ? "untracked" : "unstaged",
      });
    }
    if (e.staged) {
      staged.push({
        area: "staged",
        path: e.path,
        oldPath: e.oldPath,
        status: e.staged,
        target: "staged",
      });
    }
  }
  const byPath = (a: ChangedEntry, b: ChangedEntry) => a.path.localeCompare(b.path);
  return { unstaged: unstaged.sort(byPath), staged: staged.sort(byPath) };
}

/** Conflicted paths, sorted. */
export function conflictedPaths(status: WorkingStatus | undefined): string[] {
  return (status?.entries ?? [])
    .filter((e) => e.conflicted)
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b));
}

/** Whether a conflicted file's diff still contains conflict markers it added. */
export function hasConflictMarkers(diff: FileDiff): boolean {
  return (
    diff.content.kind === "text" &&
    diff.content.hunks.some((h) =>
      h.lines.some((l) => l.kind === "add" && /^(<{7}|>{7})( |$)/.test(l.text)),
    )
  );
}

/** Paths to pass to unstage: a staged rename needs its source path too. */
export function unstagePaths(entries: ChangedEntry[]): string[] {
  return entries.flatMap((e) => (e.oldPath ? [e.oldPath, e.path] : [e.path]));
}

/** Changed (added or removed) line indices of a hunk. */
export function changedLines(hunk: Hunk, hunkIndex: number): [number, number][] {
  return hunk.lines.flatMap((line, i) =>
    line.kind === "context" ? [] : [[hunkIndex, i] as [number, number]],
  );
}

/** `"h:l"` selection keys → `[h, l]` pairs, in order. */
export function keysToLines(keys: Iterable<string>): [number, number][] {
  return [...keys]
    .map((k) => k.split(":").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function linesRequest(
  entry: Pick<ChangedEntry, "path" | "oldPath" | "target">,
  diff: FileDiff,
  action: LineAction,
  lines: [number, number][],
  context: number,
): LinesRequest {
  return {
    path: entry.path,
    oldPath: entry.oldPath,
    action,
    source: { kind: entry.target },
    context,
    fingerprint: diff.fingerprint,
    lines,
  };
}

/** Patterns offered by "Ignore": the file, its extension, its folder. */
export function ignoreOptions(
  path: string,
): { kind: "file" | "extension" | "folder"; pattern: string; label: string }[] {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const options: ReturnType<typeof ignoreOptions> = [
    { kind: "file", pattern: `/${path}`, label: name },
  ];
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1);
    options.push({ kind: "extension", pattern: `*.${ext}`, label: ext });
  }
  if (slash > 0) {
    const folder = path.slice(0, slash);
    options.push({ kind: "folder", pattern: `/${folder}/`, label: folder });
  }
  return options;
}

// Optimistic updates: the lists change at once and Git's answer (refetched right after)
// replaces them; on failure the refetch puts the real state back.

type Entry = WorkingStatus["entries"][number];

function mapEntries(
  status: WorkingStatus,
  paths: Iterable<string>,
  update: (e: Entry) => Entry | null,
): WorkingStatus {
  const set = new Set(paths);
  const entries: Entry[] = [];
  for (const e of status.entries) {
    const next = set.has(e.path) ? update(e) : e;
    if (next && (next.staged || next.unstaged)) entries.push(next);
  }
  return { ...status, entries };
}

/** After `stageFiles`: the working-tree change joins the staged one. */
export function stageOptimistic(status: WorkingStatus, paths: string[]): WorkingStatus {
  return mapEntries(status, paths, (e) =>
    e.unstaged
      ? {
          ...e,
          staged: e.unstaged === "untracked" ? "added" : (e.staged ?? e.unstaged),
          unstaged: null,
        }
      : e,
  );
}

/** After `unstageFiles`: staged changes move back to the working tree. */
export function unstageOptimistic(status: WorkingStatus, paths: string[]): WorkingStatus {
  return mapEntries(status, paths, (e) =>
    e.staged
      ? {
          ...e,
          unstaged: e.staged === "added" ? "untracked" : (e.unstaged ?? e.staged),
          staged: null,
          oldPath: null,
        }
      : e,
  );
}

/** After `discardFiles`: working-tree changes are gone (staged ones stay). */
export function discardOptimistic(status: WorkingStatus, paths: string[]): WorkingStatus {
  return mapEntries(status, paths, (e) => ({ ...e, unstaged: null }));
}
