// git-flow state and actions for one repository. Git does the work (tylia-git `flow.rs`);
// this runs it through `useRepoAction` and reports what happened.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useRepoAction } from "@/features/changes/useRepoAction";
import { useBranchDialog } from "@/features/branching/dialog-store";
import { t } from "@/i18n";
import { ipc, type FlowConfig, type FlowKind } from "@/ipc";
import { toast } from "@/ui/Toast";

export const FLOW_KINDS: FlowKind[] = ["feature", "release", "hotfix"];

export function useFlowState(repo: string) {
  return useQuery({
    queryKey: ["flow", repo],
    queryFn: () => ipc.flowState(repo),
    staleTime: Infinity,
  });
}

export function flowPrefix(config: FlowConfig, kind: FlowKind): string {
  return {
    feature: config.featurePrefix,
    release: config.releasePrefix,
    hotfix: config.hotfixPrefix,
  }[kind];
}

/** The flow kind of `branch` and its name without the prefix, if it is a flow branch. */
export function classifyFlowBranch(
  config: FlowConfig | null | undefined,
  branch: string | null | undefined,
): { kind: FlowKind; name: string } | null {
  if (!config || !branch) return null;
  for (const kind of FLOW_KINDS) {
    const prefix = flowPrefix(config, kind);
    if (prefix && branch.startsWith(prefix) && branch.length > prefix.length) {
      return { kind, name: branch.slice(prefix.length) };
    }
  }
  return null;
}

export function useFlow(repo: string) {
  const run = useRepoAction(repo);
  const client = useQueryClient();
  const openDialog = useBranchDialog((s) => s.open);

  return useMemo(() => {
    const refresh = () => void client.invalidateQueries({ queryKey: ["flow", repo] });
    return {
      async init(config: FlowConfig) {
        const done = await run(
          () => ipc.flowInit(repo, config).then(() => true),
          t("flow.initFailed"),
          {
            refs: true,
          },
        );
        refresh();
        if (done === undefined) return false;
        toast({ kind: "success", title: t("flow.initDone") });
        return true;
      },
      async start(kind: FlowKind, name: string) {
        const branch = await run(
          () => ipc.flowStart(repo, kind, name),
          t(`flow.startFailed.${kind}`),
          { refs: true },
        );
        if (branch === undefined) return false;
        toast({ kind: "success", title: t(`flow.started.${kind}`, { branch }) });
        return true;
      },
      async finish(branch: string, tagMessage: string | null, keepBranch: boolean) {
        const done = await run(
          () => ipc.flowFinish(repo, { branch, tagMessage, keepBranch }),
          t("flow.finishFailed", { branch }),
          {
            refs: true,
            onError: (err) => {
              if (err.kind !== "localChanges") return false;
              toast({
                kind: "error",
                title: t("flow.finishFailed", { branch }),
                description: t("flow.finishDirty"),
                error: err,
                action: {
                  label: t("branching.stashAction"),
                  run: () => openDialog(repo, { mode: "stash" }),
                },
              });
              return true;
            },
          },
        );
        if (done === undefined) return false;
        toast({
          kind: "success",
          title: t("flow.finished", { branch }),
          description: [
            t("flow.mergedInto", { branches: done.mergedInto.join(", ") }),
            done.tag && t("flow.tagged", { tag: done.tag }),
            done.deleted && t("flow.deleted", { branch }),
          ]
            .filter(Boolean)
            .join(" "),
        });
        return true;
      },
    };
  }, [repo, run, client, openDialog]);
}
