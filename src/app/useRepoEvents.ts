import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { recentlyWritten } from "@/features/changes/useRepoAction";
import { ipc, type DiffRequest } from "@/ipc";

/**
 * Invalidates cached data when the file watcher reports changes: refs (and with them the
 * history stream, keyed on the refs data) and working-copy status and diffs.
 */
export function useRepoEvents() {
  const client = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void ipc
      .onRepoChanged(({ repo, refs, worktree }) => {
        // Tylia's own writes already refreshed everything; this is their echo.
        if (recentlyWritten(repo)) return;
        if (refs) {
          void client.invalidateQueries({ queryKey: ["refs", repo] });
          void client.invalidateQueries({ queryKey: ["repo-branch", repo] });
        }
        if (worktree || refs) {
          void client.invalidateQueries({ queryKey: ["status", repo] });
          void client.invalidateQueries({ queryKey: ["conflict-file", repo] });
          void client.invalidateQueries({
            predicate: (q) =>
              q.queryKey[0] === "diff" &&
              q.queryKey[1] === repo &&
              (q.queryKey[2] as DiffRequest | null)?.target.kind !== "commit",
          });
        }
      })
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [client]);
}
