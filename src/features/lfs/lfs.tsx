// Git LFS in the UI: whether the repository uses it, which files are LFS files (a badge on
// their rows), tracking a file or an extension, and the locks dialog's store.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { create } from "zustand";

import { queryClient } from "@/app/query-client";
import { t } from "@/i18n";
import { ipc, isIpcError } from "@/ipc";
import { Badge } from "@/ui/Badge";
import { toast } from "@/ui/Toast";

export function useLfsStatus(repo: string) {
  return useQuery({
    queryKey: ["lfs", repo],
    queryFn: () => ipc.lfsStatus(repo),
    staleTime: Infinity,
  });
}

/** The LFS files among `paths` (empty while the repository doesn't use LFS). */
export function useLfsFiles(repo: string, paths: string[]): ReadonlySet<string> {
  const status = useLfsStatus(repo);
  const key = paths.join("\0");
  const files = useQuery({
    queryKey: ["lfs-files", repo, key],
    queryFn: () => ipc.lfsFiles(repo, paths),
    enabled: !!status.data?.used && paths.length > 0,
    staleTime: 60_000,
  });
  return useMemo(() => new Set(files.data ?? []), [files.data]);
}

/** The "LFS" mark on a file row. */
export function LfsMark() {
  return (
    <Badge className="h-4 px-1">
      <span title={t("lfs.fileHint")}>{t("lfs.badge")}</span>
    </Badge>
  );
}

/** `git lfs track <pattern>`; .gitattributes then shows up in Changes, to commit. */
export async function trackWithLfs(repo: string, pattern: string) {
  try {
    await ipc.lfsTrack(repo, pattern);
    toast({
      kind: "success",
      title: t("lfs.tracked", { pattern }),
      description: t("lfs.trackedHint"),
    });
  } catch (err) {
    toast({
      kind: "error",
      title: t("lfs.trackFailed"),
      description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
      error: isIpcError(err) ? err : { message: String(err) },
    });
  } finally {
    void queryClient.invalidateQueries({ queryKey: ["lfs", repo] });
    void queryClient.invalidateQueries({ queryKey: ["lfs-files", repo] });
    void queryClient.invalidateQueries({ queryKey: ["status", repo] });
  }
}

/** The pattern for "every file like this one": `*.psd`, or the name itself without one. */
export function extensionPattern(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `*${name.slice(dot)}` : null;
}

interface LocksState {
  repo: string | null;
  open(repo: string): void;
  close(): void;
}

export const useLfsLocksDialog = create<LocksState>((set) => ({
  repo: null,
  open: (repo) => set({ repo }),
  close: () => set({ repo: null }),
}));
