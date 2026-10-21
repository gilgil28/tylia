// The toolbar's git-flow menu, and the same actions in the palette: set up, start a
// feature / release / hotfix, finish the current (or another open) flow branch.

import { Flag, GitBranchPlus, GitMerge, Rocket, Settings2, Wrench, Workflow } from "lucide-react";

import { useRegisterActions, type Action } from "@/app/actions";
import { useBranchDialog } from "@/features/branching/dialog-store";
import { t } from "@/i18n";
import type { FlowKind, RefsSnapshot, WorkingStatus } from "@/ipc";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { Tooltip } from "@/ui/Tooltip";

import { classifyFlowBranch, FLOW_KINDS, useFlowState } from "./useFlow";

const KIND_ICONS = { feature: GitBranchPlus, release: Rocket, hotfix: Wrench } as const;

export function FlowMenu({
  repo,
  refs,
  status,
  active,
}: {
  repo: string;
  refs: RefsSnapshot | undefined;
  status: WorkingStatus | undefined;
  active: boolean;
}) {
  const open = useBranchDialog((s) => s.open);
  const state = useFlowState(repo);
  const config = state.data?.config;
  const busy = !!status?.operation;
  const unborn = !refs?.head.oid;
  const current = classifyFlowBranch(config, refs?.head.branch) ? refs?.head.branch : null;
  const openBranches = (refs?.branches ?? [])
    .map((b) => b.name)
    .filter((name) => name !== current && classifyFlowBranch(config, name));

  const start = (kind: FlowKind) => open(repo, { mode: "flowStart", kind });
  const finish = (branch: string) => open(repo, { mode: "flowFinish", branch });

  const actions: Action[] = config
    ? [
        ...FLOW_KINDS.map((kind): Action => ({
          id: `flow.start.${kind}`,
          title: t(`flow.startAction.${kind}`),
          group: "branch",
          icon: KIND_ICONS[kind],
          keywords: ["git-flow", "gitflow", kind],
          disabled: busy,
          run: () => start(kind),
        })),
        ...[current, ...openBranches].filter(Boolean).map((branch): Action => ({
          // The current branch's finish has a stable id (bindable in Settings → Keyboard).
          id: branch === current ? "flow.finishCurrent" : `flow.finish.${branch}`,
          title: t("flow.finishAction", { branch: branch! }),
          group: "branch",
          icon: Flag,
          keywords: ["git-flow", "gitflow", "finish"],
          disabled: busy,
          searchOnly: branch !== current,
          run: () => finish(branch!),
        })),
        {
          id: "flow.settings",
          title: t("flow.settingsAction"),
          group: "branch",
          icon: Settings2,
          keywords: ["git-flow", "gitflow", "prefix"],
          run: () => open(repo, { mode: "flowInit" }),
        },
      ]
    : [
        {
          id: "flow.init",
          title: t("flow.initAction"),
          group: "branch",
          icon: Workflow,
          keywords: ["git-flow", "gitflow", "init"],
          disabled: unborn || busy,
          run: () => open(repo, { mode: "flowInit" }),
        },
      ];
  useRegisterActions(`flow:${repo}`, state.data ? actions : [], active);

  return (
    <Menu.Root>
      <Tooltip content={t("flow.tooltip")}>
        <Menu.Trigger asChild>
          <Button icon={Workflow} variant="ghost" disabled={!state.data || unborn}>
            <span className="@max-[90rem]:sr-only">{t("flow.button")}</span>
          </Button>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content align="start">
        {config ? (
          <>
            {FLOW_KINDS.map((kind) => (
              <Menu.Item
                key={kind}
                icon={KIND_ICONS[kind]}
                disabled={busy}
                onSelect={() => start(kind)}
              >
                {t(`flow.startAction.${kind}`)}
              </Menu.Item>
            ))}
            {(current || openBranches.length > 0) && <Menu.Separator />}
            {current && (
              <Menu.Item icon={Flag} disabled={busy} onSelect={() => finish(current)}>
                {t("flow.finishAction", { branch: current })}
              </Menu.Item>
            )}
            {openBranches.map((branch) => (
              <Menu.Item
                key={branch}
                icon={GitMerge}
                disabled={busy}
                onSelect={() => finish(branch)}
              >
                {t("flow.finishAction", { branch })}
              </Menu.Item>
            ))}
            <Menu.Separator />
            <Menu.Item icon={Settings2} onSelect={() => open(repo, { mode: "flowInit" })}>
              {t("flow.settingsAction")}
            </Menu.Item>
          </>
        ) : (
          <>
            <Menu.Label>{t("flow.notSetUp")}</Menu.Label>
            <Menu.Item
              icon={Workflow}
              disabled={busy}
              onSelect={() => open(repo, { mode: "flowInit" })}
            >
              {t("flow.initAction")}
            </Menu.Item>
          </>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
