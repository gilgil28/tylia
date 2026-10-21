import { useQuery } from "@tanstack/react-query";

import { ipc } from "@/ipc";

/**
 * Whether an interactive rebase can start from `oid` (an ancestor of HEAD other than HEAD).
 * `head` keys the answer to the current HEAD; `oid` null skips the question.
 */
export function useRebaseBase(repo: string, head: string | null, oid: string | null) {
  return useQuery({
    queryKey: ["rebase-base", repo, head, oid],
    queryFn: () => ipc.isRebaseBase(repo, oid!),
    enabled: !!head && !!oid,
    staleTime: Infinity,
    retry: false,
  });
}
