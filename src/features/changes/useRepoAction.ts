import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { isIpcError, type DiffRequest, type IpcError, type WorkingStatus } from "@/ipc";
import { toast } from "@/ui/Toast";

/** When Tylia itself last wrote to each repository (see `recentlyWritten`). */
const lastWrite = new Map<string, number>();

/** The file watcher echoes Tylia's own writes ~0.5 s later; skip refreshing for those. */
const ECHO_MS = 1200;

export function recentlyWritten(repo: string): boolean {
  return Date.now() - (lastWrite.get(repo) ?? 0) < ECHO_MS;
}

/**
 * Runs a write against `repo`, then refreshes what it may have changed (status, working-copy
 * diffs and — with `refs` — branches and history). `optimistic` updates the cached status at
 * once so the lists respond instantly; Git's real answer replaces it. Failures become an
 * error toast with Git's command and output under "Details", unless `onError` handles them
 * (returns true), e.g. by asking the user how to proceed. Resolves to the result, or
 * `undefined` on failure.
 */
export function useRepoAction(repo: string) {
  const client = useQueryClient();
  return useCallback(
    async <T>(
      run: () => Promise<T>,
      failTitle: string,
      {
        refs = false,
        optimistic,
        onError,
      }: {
        refs?: boolean;
        optimistic?: (status: WorkingStatus) => WorkingStatus;
        onError?: (error: IpcError) => boolean;
      } = {},
    ): Promise<T | undefined> => {
      if (optimistic) {
        await client.cancelQueries({ queryKey: ["status", repo] });
        client.setQueryData<WorkingStatus>(["status", repo], (s) => s && optimistic(s));
      }
      try {
        return await run();
      } catch (err) {
        if (isIpcError(err) && onError?.(err)) return undefined;
        toast({
          kind: "error",
          title: failTitle,
          // Tylia's own refusals are a full sentence saying why: show it, not just "Details".
          description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
          error: isIpcError(err) ? err : { message: String(err) },
        });
        return undefined;
      } finally {
        lastWrite.set(repo, Date.now());
        void client.invalidateQueries({ queryKey: ["status", repo] });
        void client.invalidateQueries({ queryKey: ["conflict-file", repo] });
        void client.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] === "diff" &&
            q.queryKey[1] === repo &&
            (q.queryKey[2] as DiffRequest | null)?.target.kind !== "commit",
        });
        if (refs) {
          void client.invalidateQueries({ queryKey: ["refs", repo] });
          void client.invalidateQueries({ queryKey: ["lost", repo] });
          void client.invalidateQueries({ queryKey: ["dangling", repo] });
        }
        void client.invalidateQueries({ queryKey: ["undo", repo] });
      }
    },
    [client, repo],
  );
}
