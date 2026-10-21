import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FolderOpen,
  GitBranchPlus,
  PanelLeft,
  Search,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { revealLabel } from "@/app/labels";
import { useRegisterActions } from "@/app/actions";
import { useWorkspace, type RepoLayout } from "@/app/workspace";
import { BranchSwitcher } from "@/features/branching/BranchSwitcher";
import { useBranchDialog } from "@/features/branching/dialog-store";
import { FlowMenu } from "@/features/flow/FlowMenu";
import { RemoteButtons } from "@/features/remote/RemoteButtons";
import { RemoteDialogs } from "@/features/remote/RemoteDialogs";
import { useAutoFetch } from "@/features/remote/useAutoFetch";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import { ipc, type RefsSnapshot, type SearchField, type WorkingStatus } from "@/ipc";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { Kbd } from "@/ui/Kbd";
import { Menu } from "@/ui/Menu";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Tooltip } from "@/ui/Tooltip";

const FIELDS: { value: SearchField; label: string; placeholder: string }[] = [
  { value: "message", label: t("search.message"), placeholder: t("search.placeholder.message") },
  { value: "author", label: t("search.author"), placeholder: t("search.placeholder.author") },
  { value: "hash", label: t("search.hash"), placeholder: t("search.placeholder.hash") },
  { value: "path", label: t("search.path"), placeholder: t("search.placeholder.path") },
];

function BranchIndicator({
  repo,
  refs,
  status,
}: {
  repo: string;
  refs: RefsSnapshot | undefined;
  status: WorkingStatus | undefined;
}) {
  if (!refs) return null;
  const { head } = refs;
  const branch = head.branch ? refs.branches.find((b) => b.name === head.branch) : undefined;
  return (
    <div className="flex max-w-64 min-w-24 shrink-0 items-center gap-2">
      <BranchSwitcher repo={repo} refs={refs} status={status} />
      {branch?.upstream && (branch.ahead > 0 || branch.behind > 0) && (
        <span className="flex shrink-0 items-center gap-1.5 text-small text-fg-secondary tabular-nums">
          {branch.ahead > 0 && (
            <Tooltip
              content={t("toolbar.ahead", { count: branch.ahead, upstream: branch.upstream })}
            >
              <span className="flex items-center gap-0.5">
                <ArrowUp size={12} strokeWidth={2} aria-hidden />
                {branch.ahead}
              </span>
            </Tooltip>
          )}
          {branch.behind > 0 && (
            <Tooltip
              content={t("toolbar.behind", { count: branch.behind, upstream: branch.upstream })}
            >
              <span className="flex items-center gap-0.5">
                <ArrowDown size={12} strokeWidth={2} aria-hidden />
                {branch.behind}
              </span>
            </Tooltip>
          )}
        </span>
      )}
    </div>
  );
}

export function RepoToolbar({
  repo,
  refs,
  status,
  layout,
  active,
}: {
  repo: string;
  refs: RefsSnapshot | undefined;
  status: WorkingStatus | undefined;
  layout: RepoLayout;
  /** This repository's tab is visible (its actions are registered). */
  active: boolean;
}) {
  const openBranchDialog = useBranchDialog((s) => s.open);
  const hasChanges = (status?.entries.length ?? 0) > 0;
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const search = useRepoUi((s) => s.search);
  const setSearch = useRepoUi((s) => s.setSearch);
  const setView = useRepoUi((s) => s.setView);
  const inputRef = useRef<HTMLInputElement>(null);
  const field = FIELDS.find((f) => f.value === search.field) ?? FIELDS[0]!;
  useAutoFetch(repo, (refs?.remotes.length ?? 0) > 0);
  const lfs = useQuery({
    queryKey: ["lfs", repo],
    queryFn: () => ipc.lfsStatus(repo),
    staleTime: Infinity,
  });

  useRegisterActions(
    `toolbar:${repo}`,
    [
      {
        id: "view.sidebar",
        title: t("toolbar.toggleSidebar"),
        group: "view",
        icon: PanelLeft,
        shortcut: "Mod+B",
        run: () => updateLayout(repo, { sidebarCollapsed: !layout.sidebarCollapsed }),
      },
      {
        id: "history.allBranches",
        title: t("actions.allBranches"),
        group: "history",
        disabled: layout.scope === "all",
        run: () => updateLayout(repo, { scope: "all" }),
      },
      {
        id: "history.currentBranch",
        title: t("actions.currentBranch"),
        group: "history",
        disabled: layout.scope === "head",
        run: () => updateLayout(repo, { scope: "head" }),
      },
      {
        id: "history.search",
        title: t("search.label"),
        group: "history",
        icon: Search,
        shortcut: "Mod+F",
        keywords: ["find"],
        run: () => {
          // The search box is in the history view; switch there first.
          setView("history");
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          });
        },
      },
    ],
    active,
  );

  return (
    <div className="@container flex h-(--toolbar-h) shrink-0 items-center gap-2 border-b border-line-subtle bg-panel px-2">
      <IconButton
        icon={PanelLeft}
        label={t("toolbar.toggleSidebar")}
        shortcut="Mod+B"
        active={!layout.sidebarCollapsed}
        onClick={() => updateLayout(repo, { sidebarCollapsed: !layout.sidebarCollapsed })}
      />
      <BranchIndicator repo={repo} refs={refs} status={status} />
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
      <RemoteButtons repo={repo} refs={refs} />
      <RemoteDialogs repo={repo} refs={refs} />
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line @max-[48rem]:hidden" />
      <Tooltip content={t("toolbar.newBranchHint")}>
        <span className="inline-flex @max-[48rem]:hidden">
          <Button
            icon={GitBranchPlus}
            variant="ghost"
            disabled={!refs?.head.oid}
            onClick={() =>
              openBranchDialog(repo, {
                mode: "createBranch",
                start: "HEAD",
                startLabel: refs?.head.branch ?? "HEAD",
              })
            }
          >
            <span className="@max-[90rem]:sr-only">{t("toolbar.branch")}</span>
          </Button>
        </span>
      </Tooltip>
      <Tooltip content={hasChanges ? t("toolbar.stashHint") : t("toolbar.nothingToStash")}>
        <span className="inline-flex @max-[48rem]:hidden">
          <Button
            icon={Archive}
            variant="ghost"
            disabled={!hasChanges || !!status?.operation}
            onClick={() => openBranchDialog(repo, { mode: "stash" })}
          >
            <span className="@max-[90rem]:sr-only">{t("toolbar.stash")}</span>
          </Button>
        </span>
      </Tooltip>
      <span className="inline-flex @max-[48rem]:hidden">
        <FlowMenu repo={repo} refs={refs} status={status} active={active} />
      </span>
      <span className="flex-1" />
      <SegmentedControl
        className="@max-[60rem]:hidden"
        aria-label={t("toolbar.scope")}
        value={layout.scope}
        onValueChange={(scope) => updateLayout(repo, { scope })}
        segments={[
          { value: "all", label: t("toolbar.allBranches") },
          { value: "head", label: t("toolbar.currentBranch") },
        ]}
      />
      <div
        className={cn(
          "flex h-7 w-72 min-w-0 items-center rounded-control @max-[64rem]:w-52 @max-[48rem]:w-40 border border-line bg-input transition-[border-color,box-shadow] duration-(--dur-fast)",
          "focus-within:border-line-strong focus-within:shadow-(--focus-ring) hover:border-line-strong",
        )}
      >
        <Menu.Root>
          <Menu.Trigger
            aria-label={`${t("search.by")}: ${field.label}`}
            className="flex h-full shrink-0 items-center gap-1 rounded-l-control border-r border-line-subtle pr-1.5 pl-2 text-small text-fg-secondary outline-none hover:text-fg focus-visible:text-fg"
          >
            <Search size={14} strokeWidth={1.75} aria-hidden />
            <span className="@max-[48rem]:sr-only">{field.label}</span>
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
          </Menu.Trigger>
          <Menu.Content align="start">
            <Menu.Label>{t("search.by")}</Menu.Label>
            <Menu.RadioGroup
              value={search.field}
              onValueChange={(v) => {
                setSearch({ field: v as SearchField });
                inputRef.current?.focus();
              }}
            >
              {FIELDS.map((f) => (
                <Menu.RadioItem key={f.value} value={f.value}>
                  {f.label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Root>
        <input
          ref={inputRef}
          value={search.query}
          onChange={(e) => setSearch({ query: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && setSearch({ query: "" })}
          placeholder={field.placeholder}
          aria-label={t("search.label")}
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-fg outline-none placeholder:text-fg-muted"
        />
        {search.query ? (
          <IconButton
            icon={X}
            label={t("search.clear")}
            compact
            className="mr-0.5"
            onClick={() => setSearch({ query: "" })}
          />
        ) : (
          <Kbd shortcut="Mod+F" className="mr-1.5 @max-[48rem]:hidden" />
        )}
      </div>
      {lfs.data?.used && (
        <Tooltip content={lfs.data.installed ? t("toolbar.lfs") : t("toolbar.lfsMissing")}>
          <span tabIndex={0} className="rounded-badge focus-ring">
            <Badge tone={lfs.data.installed ? "neutral" : "warning"}>LFS</Badge>
          </span>
        </Tooltip>
      )}
      <IconButton
        icon={FolderOpen}
        label={revealLabel}
        onClick={() => void ipc.revealInFileManager(repo)}
      />
    </div>
  );
}
