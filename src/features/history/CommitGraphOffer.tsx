// Offer to write Git's commit-graph index for a large repository without one: history then
// streams in ~0.2 s instead of seconds. Never done without asking (it adds a file to .git).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { useState } from "react";

import { useRegisterActions } from "@/app/actions";
import { useWorkspace } from "@/app/workspace";
import { plural, t } from "@/i18n";
import { ipc, isIpcError } from "@/ipc";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/Toast";

/** Below this many commits history is fast enough without a commit-graph. */
export const COMMIT_GRAPH_MIN_COMMITS = 5000;

export function CommitGraphOffer({
  repo,
  commits,
  done,
  dismissed,
  active,
}: {
  repo: string;
  /** Commits loaded so far. */
  commits: number;
  /** The history stream has finished. */
  done: boolean;
  dismissed: boolean;
  active: boolean;
}) {
  const client = useQueryClient();
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const [writing, setWriting] = useState(false);
  const has = useQuery({
    queryKey: ["commit-graph", repo],
    queryFn: () => ipc.hasCommitGraph(repo),
    staleTime: Infinity,
    enabled: done,
  });
  const missing = has.data === false;

  const write = async () => {
    setWriting(true);
    try {
      await ipc.writeCommitGraph(repo);
      toast({ kind: "success", title: t("commitGraph.written") });
    } catch (err) {
      toast({
        kind: "error",
        title: t("commitGraph.failed"),
        error: isIpcError(err) ? err : { message: String(err) },
      });
    } finally {
      setWriting(false);
      void client.invalidateQueries({ queryKey: ["commit-graph", repo] });
    }
  };

  useRegisterActions(
    `commit-graph:${repo}`,
    missing
      ? [
          {
            id: "repo.commitGraph",
            title: t("commitGraph.action"),
            group: "repository",
            icon: Zap,
            keywords: ["faster", "performance", "commit-graph"],
            disabled: writing,
            run: () => void write(),
          },
        ]
      : [],
    active,
  );

  if (!missing || dismissed || commits < COMMIT_GRAPH_MIN_COMMITS) return null;
  return (
    <div
      role="note"
      className="flex shrink-0 items-center gap-3 border-t border-line-subtle bg-panel px-3 py-2"
    >
      <Zap size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-small font-medium text-fg">
          {t("commitGraph.offer", { commits: plural("count.commits", commits) })}
        </span>
        <span className="text-small text-fg-muted">{t("commitGraph.explain")}</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => updateLayout(repo, { commitGraphDismissed: true })}
      >
        {t("commitGraph.notNow")}
      </Button>
      <Button size="sm" variant="primary" loading={writing} onClick={() => void write()}>
        {t("commitGraph.write")}
      </Button>
    </div>
  );
}
