import { ArrowDownToLine, ArrowUpFromLine, Check, RefreshCw, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { clockTime } from "@/app/format";
import { useSettings } from "@/app/settings";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import type { PullMode, RefsSnapshot } from "@/ipc";
import { Button } from "@/ui/Button";
import { CountBadge } from "@/ui/CountBadge";
import { Menu } from "@/ui/Menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/Popover";
import { ProgressRing } from "@/ui/ProgressRing";
import { SplitButton } from "@/ui/SplitButton";

import {
  cancelRunning,
  fetchRepo,
  headBranch,
  pullRepo,
  pushRepo,
  pushTarget,
  useOperations,
  type OperationKind,
  type RunningOperation,
} from "./operations";
import { PushDialog } from "./PushDialog";

const PULL_MODES: PullMode[] = ["merge", "rebase", "ffOnly"];
const AUTO_FETCH_MINUTES = [0, 5, 10, 30];
/** Labels give way to icons when the toolbar (a container) is narrow. */
const LABEL = "@max-[72rem]:sr-only";

/** What a running operation is doing, with Cancel. */
function OperationPanel({ repo, op }: { repo: string; op: RunningOperation }) {
  const p = op.progress;
  const counts = p?.total
    ? `${p.current?.toLocaleString("en")} / ${p.total.toLocaleString("en")}`
    : "";
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="font-medium text-fg">{op.title}</p>
      <div className="flex items-baseline justify-between gap-2 text-small text-fg-secondary">
        <span className="truncate">
          {op.cancelling ? t("ops.cancelling") : (p?.phase ?? t("ops.starting"))}
        </span>
        {p && <span className="shrink-0 tabular-nums">{counts || `${p.percent}%`}</span>}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-active">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-(--dur-fast)"
          style={{ width: `${p?.percent ?? 0}%` }}
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={op.cancelling} onClick={() => cancelRunning(repo)}>
          {t("ops.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * One of Fetch / Pull / Push. While its operation runs, a progress ring replaces the icon
 * and the button opens the operation panel instead.
 */
function OperationButton({
  repo,
  kind,
  label,
  icon,
  tooltip,
  onRun,
  trailing,
  menuLabel,
  menu,
  unavailable,
}: {
  repo: string;
  kind: OperationKind;
  label: string;
  icon: LucideIcon;
  tooltip: string;
  onRun: () => void;
  trailing?: ReactNode;
  menuLabel: string;
  menu: ReactNode;
  /** The action can't run (no remotes, no upstream); the menu stays usable. */
  unavailable?: boolean;
}) {
  const op = useOperations((s) => s.byRepo[repo]);
  const mine = op?.kind === kind ? op : undefined;
  const last = useOperations((s) => s.lastSuccess[repo]);
  const lastMine = last?.kind === kind ? last : undefined;
  const justDone = !!lastMine?.fresh;
  // A background fetch doesn't block anything: starting an operation cancels it.
  const busy = !!op && !mine && !op.background;
  const [panelOpen, setPanelOpen] = useState(false);
  const percent = mine?.progress?.percent;
  return (
    <Popover open={!!mine && panelOpen} onOpenChange={setPanelOpen}>
      <PopoverAnchor asChild>
        <div className="inline-flex">
          <SplitButton
            label={label}
            icon={icon}
            leading={
              // Decorative here: `aria-busy` tells assistive tech the action is running, and
              // the success toast announces the result.
              mine ? (
                <span aria-hidden className="flex">
                  <ProgressRing value={percent === undefined ? undefined : percent / 100} />
                </span>
              ) : justDone ? (
                <Check size={16} strokeWidth={2} aria-hidden className="text-success" />
              ) : undefined
            }
            trailing={trailing}
            labelClassName={LABEL}
            onClick={() => (mine ? setPanelOpen((o) => !o) : onRun())}
            mainDisabled={busy || (unavailable && !mine)}
            mainProps={{ "aria-busy": !!mine, "aria-haspopup": mine ? "dialog" : undefined }}
            menuLabel={menuLabel}
            menu={menu}
            tooltip={
              busy ? (
                t("ops.busy")
              ) : lastMine ? (
                <span className="flex flex-col gap-0.5">
                  <span>{tooltip}</span>
                  <span className="text-fg-muted">
                    {t("ops.lastSuccess", {
                      message: lastMine.message,
                      time: clockTime(lastMine.at),
                    })}
                  </span>
                </span>
              ) : (
                tooltip
              )
            }
          />
        </div>
      </PopoverAnchor>
      {mine && (
        <PopoverContent align="start" className="w-72">
          <OperationPanel repo={repo} op={mine} />
        </PopoverContent>
      )}
    </Popover>
  );
}

/** Fetch, Pull ▾ and Push ▾ for the toolbar (an `@container`), with the Push dialog. */
export function RemoteButtons({ repo, refs }: { repo: string; refs: RefsSnapshot | undefined }) {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const setView = useRepoUi((s) => s.setView);
  const pushDialogOpen = useOperations((s) => s.pushDialog === repo);
  const openPushDialog = useOperations((s) => s.openPushDialog);

  const branch = headBranch(refs);
  const hasRemotes = (refs?.remotes.length ?? 0) > 0;
  const upstream = branch?.upstream && !branch.upstreamGone ? branch.upstream : null;
  const target = pushTarget(branch);
  const pull = (mode?: PullMode) =>
    void pullRepo(repo, mode, { onConflicts: () => setView("changes") });

  return (
    <div className="flex items-center gap-1.5">
      <OperationButton
        repo={repo}
        kind="fetch"
        label={t("ops.fetch")}
        icon={RefreshCw}
        tooltip={t("ops.fetchHint")}
        onRun={() => void fetchRepo(repo)}
        unavailable={!hasRemotes}
        menuLabel={t("ops.fetchOptions")}
        menu={
          <>
            <Menu.CheckboxItem
              checked={settings.fetchPrune}
              onCheckedChange={(fetchPrune) => update({ fetchPrune })}
            >
              {t("ops.prune")}
            </Menu.CheckboxItem>
            <Menu.Separator />
            <Menu.Label>{t("ops.autoFetch")}</Menu.Label>
            <Menu.RadioGroup
              value={String(settings.autoFetchMinutes)}
              onValueChange={(v) => update({ autoFetchMinutes: Number(v) })}
            >
              {AUTO_FETCH_MINUTES.map((m) => (
                <Menu.RadioItem key={m} value={String(m)}>
                  {m === 0 ? t("ops.autoFetchOff") : t("ops.autoFetchEvery", { count: m })}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </>
        }
      />
      <OperationButton
        repo={repo}
        kind="pull"
        label={t("ops.pull")}
        icon={ArrowDownToLine}
        tooltip={
          upstream && branch
            ? t("ops.pullHint", {
                upstream,
                branch: branch.name,
                mode: t(`ops.mode.${settings.pullMode}`).toLowerCase(),
              })
            : t("ops.pullHintNoUpstream")
        }
        onRun={() => pull()}
        unavailable={!upstream}
        trailing={
          <CountBadge
            count={upstream ? (branch?.behind ?? 0) : 0}
            label={t("ops.incoming", { count: branch?.behind ?? 0 })}
          />
        }
        menuLabel={t("ops.pullOptions")}
        menu={
          <>
            <Menu.Label>{t("ops.pullMode")}</Menu.Label>
            <Menu.RadioGroup
              value={settings.pullMode}
              onValueChange={(v) => update({ pullMode: v as PullMode })}
            >
              {PULL_MODES.map((mode) => (
                <Menu.RadioItem
                  key={mode}
                  value={mode}
                  disabled={!upstream}
                  onSelect={() => pull(mode)}
                  title={t(`ops.modeHint.${mode}`)}
                >
                  {t(`ops.mode.${mode}`)}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </>
        }
      />
      <OperationButton
        repo={repo}
        kind="push"
        label={t("ops.push")}
        icon={ArrowUpFromLine}
        tooltip={
          branch
            ? target
              ? t("ops.pushHint", {
                  branch: branch.name,
                  destination: `${target.remote}/${target.remoteBranch}`,
                })
              : t("ops.pushHintFirst", { branch: branch.name })
            : t("ops.pushDetached")
        }
        onRun={() => void pushRepo(repo)}
        unavailable={!branch || !refs?.head.oid}
        trailing={
          <CountBadge
            count={target ? (branch?.ahead ?? 0) : 0}
            label={t("ops.outgoing", { count: branch?.ahead ?? 0 })}
          />
        }
        menuLabel={t("ops.pushOptions")}
        menu={
          <Menu.Item disabled={!branch || !refs?.head.oid} onSelect={() => openPushDialog(repo)}>
            {t("ops.pushDialogItem")}
          </Menu.Item>
        }
      />
      {pushDialogOpen && refs && branch && (
        <PushDialog repo={repo} refs={refs} branch={branch} onClose={() => openPushDialog(null)} />
      )}
    </div>
  );
}
