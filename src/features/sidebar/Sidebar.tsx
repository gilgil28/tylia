import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  History,
  Package,
  Plus,
  Settings2,
  RefreshCw,
  Search,
  SquarePen,
  Tag as TagIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import { revealLabel } from "@/app/labels";
import { useWorkspace } from "@/app/workspace";
import { useBranchDialog } from "@/features/branching/dialog-store";
import {
  BranchItems,
  CommitItems,
  StashItems,
  TagItems,
  useMenuContext,
} from "@/features/branching/menus";
import { updateSubmodules } from "@/features/remote/operations";
import { useRemoteDialog } from "@/features/remote/RemoteDialogs";
import { useRepoSettings } from "@/features/repo-settings/store";
import { useRepoUi } from "@/features/repo/repo-store";
import { openRepoAt } from "@/features/welcome/open";
import { joinPath } from "@/features/welcome/paths";
import { t } from "@/i18n";
import { relativeTime, shortHash } from "@/app/format";
import { ipc, type Branch, type LostCommit, type RefsSnapshot, type WorkingStatus } from "@/ipc";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { Input } from "@/ui/Input";
import { ContextMenu } from "@/ui/Menu";
import { Tooltip } from "@/ui/Tooltip";
import { Tree } from "@/ui/Tree";
import { allFolders } from "@/ui/tree-model";

import { RemoteGroup } from "./RemoteGroup";

/** Tags beyond this are only reachable through the filter, to keep the sidebar light. */
const MAX_TAGS = 300;

function Section({
  id,
  title,
  count,
  collapsed,
  onToggle,
  action,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  collapsed: boolean;
  onToggle: (id: string) => void;
  /** A compact IconButton shown at the right of the header on hover (e.g. "Add remote"). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="group/section flex flex-col">
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onToggle(id)}
          className="group flex h-7 min-w-0 flex-1 items-center gap-1 rounded-control px-1 text-caption font-medium text-fg-muted focus-ring hover:text-fg-secondary"
        >
          <ChevronRight
            size={12}
            strokeWidth={2}
            aria-hidden
            className={cn("transition-transform duration-(--dur-fast)", !collapsed && "rotate-90")}
          />
          <span className="flex-1 text-left">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="tabular-nums opacity-0 group-hover:opacity-100">{count}</span>
          )}
        </button>
        {action && (
          <div className="opacity-0 group-hover/section:opacity-100 focus-within:opacity-100">
            {action}
          </div>
        )}
      </div>
      {!collapsed && <div className="flex flex-col pb-2">{children}</div>}
    </section>
  );
}

function Item({
  icon: Icon,
  label,
  active,
  onClick,
  trailing,
  title,
  muted,
  onDoubleClick,
}: {
  icon: typeof GitBranch;
  label: ReactNode;
  active?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  trailing?: ReactNode;
  title?: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex h-(--row-h) items-center gap-2 rounded-control pr-2 pl-5 text-left focus-ring",
        active ? "bg-selected text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg",
        muted && "text-fg-muted",
      )}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

function AheadBehind({ ahead, behind }: { ahead: number; behind: number }) {
  if (!ahead && !behind) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-caption text-fg-muted tabular-nums">
      {ahead > 0 && (
        <span className="flex items-center">
          <ArrowUp size={11} strokeWidth={2} aria-hidden />
          {ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="flex items-center">
          <ArrowDown size={11} strokeWidth={2} aria-hidden />
          {behind}
        </span>
      )}
    </span>
  );
}

const matches = (name: string, filter: string) => name.toLowerCase().includes(filter);

/** Stored in `collapsedSections` while "Recently lost" is open (it starts closed). */
const LOST_OPEN = "lost:open";

/** `abc1234 · 3 hours ago`, then where it was lost from and why. */
function lostTitle(c: LostCommit): string {
  const where = c.reflog
    ? t("sidebar.lostFrom", {
        ref: c.reflog.replace(/^refs\/heads\//, ""),
        reason: c.reason ?? "",
      })
    : t("sidebar.lostDangling");
  return `${shortHash(c.oid)} · ${relativeTime(c.time)}\n${where}`;
}

/** Gives `children` a context menu. */
function WithMenu({ menu, children }: { menu: ReactNode; children: ReactElement }) {
  if (!menu) return children;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Content>{menu}</ContextMenu.Content>
    </ContextMenu.Root>
  );
}

/** `stash@{3}` → 3. */
const stashIndex = (name: string) => Number(/\{(\d+)\}/.exec(name)?.[1] ?? 0);

export function Sidebar({
  repo,
  refs,
  status,
}: {
  repo: string;
  refs: RefsSnapshot | undefined;
  status: WorkingStatus | undefined;
}) {
  const [filter, setFilter] = useState("");
  // `null` = every folder expanded (the default until the user collapses one).
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const collapsed = useWorkspace((s) => s.layout(repo).collapsedSections);
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const view = useRepoUi((s) => s.view);
  const setView = useRepoUi((s) => s.setView);
  const reveal = useRepoUi((s) => s.reveal);
  const openRemoteDialog = useRemoteDialog((s) => s.open);
  const openBranchDialog = useBranchDialog((s) => s.open);
  const select = useRepoUi((s) => s.select);
  const ctx = useMenuContext(repo, refs, status);
  const f = filter.trim().toLowerCase();

  const toggle = (id: string) =>
    updateLayout(repo, {
      collapsedSections: collapsed.includes(id)
        ? collapsed.filter((s) => s !== id)
        : [...collapsed, id],
    });
  const isCollapsed = (id: string) => !f && collapsed.includes(id);
  const branches = useMemo(
    () => (refs?.branches ?? []).filter((b) => !f || matches(b.name, f)),
    [refs, f],
  );
  // While filtering, only remotes with a matching branch (or name) are listed.
  const remotes = useMemo(
    () =>
      (refs?.remotes ?? [])
        .map((remote) => ({
          remote,
          branches: remote.branches.filter((b) => !f || matches(b.fullName, f)),
        }))
        .filter((r) => !f || r.branches.length > 0 || matches(r.remote.name, f)),
    [refs, f],
  );
  const tags = useMemo(() => (refs?.tags ?? []).filter((x) => !f || matches(x.name, f)), [refs, f]);
  const stashes = (refs?.stashes ?? []).filter((s) => !f || matches(s.message, f));
  const submoduleQuery = useQuery({
    queryKey: ["submodules", repo],
    queryFn: () => ipc.getSubmodules(repo),
    enabled: !isCollapsed("submodules"),
  });
  const submodules = (submoduleQuery.data ?? []).filter((s) => !f || matches(s.path, f));
  const worktreeQuery = useQuery({
    queryKey: ["worktrees", repo],
    queryFn: () => ipc.getWorktrees(repo),
    staleTime: 60_000,
  });
  const worktrees = (worktreeQuery.data ?? []).filter((w) => !f || matches(w.branch ?? w.path, f));
  const changed = status?.entries.length ?? 0;
  // "Recently lost" starts closed, and listing it reads every reflog: it stores "open".
  const lostOpen = collapsed.includes(LOST_OPEN);
  const [deeper, setDeeper] = useState(false);
  const lostQuery = useQuery({
    queryKey: ["lost", repo],
    queryFn: () => ipc.lostCommits(repo),
    enabled: lostOpen,
  });
  const danglingQuery = useQuery({
    queryKey: ["dangling", repo],
    queryFn: () => ipc.danglingCommits(repo),
    enabled: lostOpen && deeper,
  });
  const lost = (lostQuery.data ?? []).filter((c) => !f || matches(c.subject, f));
  const dangling = (danglingQuery.data ?? []).filter((c) => !f || matches(c.subject, f));

  const branchExpanded = (!f && expanded) || allFolders(branches.map((b) => b.name));

  return (
    <nav className="flex h-full flex-col bg-panel">
      <div className="shrink-0 p-2">
        <Input
          icon={Search}
          compact
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("sidebar.filter")}
          aria-label={t("sidebar.filter")}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4">
        <Section
          id="workspace"
          title={t("sidebar.workspace")}
          collapsed={isCollapsed("workspace")}
          onToggle={toggle}
        >
          <Item
            icon={SquarePen}
            label={t("sidebar.changes")}
            active={view === "changes"}
            onClick={() => setView("changes")}
            trailing={changed > 0 && <Badge>{changed}</Badge>}
            muted={changed === 0}
          />
          <Item
            icon={History}
            label={t("sidebar.history")}
            active={view === "history"}
            onClick={() => setView("history")}
          />
        </Section>

        <Section
          id="branches"
          title={t("sidebar.branches")}
          count={branches.length}
          collapsed={isCollapsed("branches")}
          onToggle={toggle}
          action={
            refs?.head.oid && (
              <IconButton
                icon={Plus}
                label={t("sidebar.newBranch")}
                compact
                onClick={() =>
                  openBranchDialog(repo, {
                    mode: "createBranch",
                    start: "HEAD",
                    startLabel: refs.head.branch ?? "HEAD",
                  })
                }
              />
            )
          }
        >
          {branches.length === 0 ? (
            <Empty />
          ) : (
            <Tree<Branch>
              aria-label={t("sidebar.branches")}
              items={branches}
              getPath={(b) => b.name}
              expanded={branchExpanded}
              onExpandedChange={setExpanded}
              onSelect={(leaf) => reveal(leaf.data.oid)}
              // Enter / double-click checks the branch out.
              onActivate={(leaf) =>
                !leaf.data.isHead &&
                !ctx?.busy &&
                void ctx?.b.checkout({ kind: "branch", name: leaf.data.name })
              }
              renderLeaf={(leaf) => (
                <WithMenu
                  menu={ctx && <BranchItems ctx={ctx} M={ContextMenu} branch={leaf.data} />}
                >
                  <span className="flex min-w-0 flex-1">
                    <BranchLeaf branch={leaf.data} label={leaf.label} />
                  </span>
                </WithMenu>
              )}
            />
          )}
        </Section>

        <Section
          id="remotes"
          title={t("sidebar.remotes")}
          count={refs?.remotes.length}
          collapsed={isCollapsed("remotes")}
          onToggle={toggle}
          action={
            <>
              <IconButton
                icon={Settings2}
                label={t("remotes.manage")}
                compact
                onClick={() => useRepoSettings.getState().open(repo, "remotes")}
              />
              <IconButton
                icon={Plus}
                label={t("remotes.add")}
                compact
                onClick={() => openRemoteDialog({ repo, mode: "add" })}
              />
            </>
          }
        >
          {remotes.length === 0 ? (
            <Empty />
          ) : (
            remotes.map(({ remote, branches }) => (
              <RemoteGroup
                key={remote.name}
                repo={repo}
                remote={remote}
                branches={branches}
                filtering={!!f}
                ctx={ctx}
              />
            ))
          )}
        </Section>

        <Section
          id="tags"
          title={t("sidebar.tags")}
          count={tags.length}
          collapsed={isCollapsed("tags")}
          onToggle={toggle}
        >
          {tags.length === 0 ? (
            <Empty />
          ) : (
            tags.slice(0, MAX_TAGS).map((tag) => (
              <WithMenu
                key={tag.name}
                menu={ctx && <TagItems ctx={ctx} M={ContextMenu} tag={tag} />}
              >
                <div className="flex flex-col">
                  <Item icon={TagIcon} label={tag.name} onClick={() => reveal(tag.oid)} />
                </div>
              </WithMenu>
            ))
          )}
        </Section>

        <Section
          id="stashes"
          title={t("sidebar.stashes")}
          count={stashes.length}
          collapsed={isCollapsed("stashes")}
          onToggle={toggle}
        >
          {stashes.length === 0 ? (
            <Empty />
          ) : (
            stashes.map((s) => (
              <WithMenu
                key={s.name}
                menu={
                  ctx && (
                    <StashItems ctx={ctx} M={ContextMenu} stash={s} index={stashIndex(s.name)} />
                  )
                }
              >
                <div className="flex flex-col">
                  <Item
                    icon={Archive}
                    label={s.message}
                    title={`${s.name}: ${s.message}`}
                    onClick={() => {
                      setView("history");
                      select({ kind: "commit", oid: s.oid });
                    }}
                  />
                </div>
              </WithMenu>
            ))
          )}
        </Section>

        <Section
          id={LOST_OPEN}
          title={t("sidebar.lost")}
          count={lost.length}
          collapsed={!lostOpen}
          onToggle={toggle}
        >
          {lostQuery.isPending ? null : lostQuery.isError ? (
            <span className="pl-5 text-fg-muted">{t("sidebar.lostFailed")}</span>
          ) : (
            <>
              {lost.length === 0 && (
                <span className="flex h-(--row-h) items-center pl-5 text-fg-muted">
                  {t("sidebar.lostNone")}
                </span>
              )}
              {[...lost, ...dangling].map((c) => (
                <WithMenu
                  key={c.oid}
                  menu={
                    ctx && <CommitItems ctx={ctx} M={ContextMenu} oid={c.oid} subject={c.subject} />
                  }
                >
                  <div className="flex flex-col">
                    <Item
                      icon={GitCommitHorizontal}
                      label={c.subject}
                      title={lostTitle(c)}
                      muted={!c.reflog}
                      trailing={
                        c.commits > 1 && (
                          <span
                            className="shrink-0 text-caption text-fg-muted tabular-nums"
                            title={t("sidebar.lostMoreTitle", { count: c.commits })}
                          >
                            {t("sidebar.lostMore", { count: c.commits - 1 })}
                          </span>
                        )
                      }
                      onClick={() => {
                        setView("history");
                        select({ kind: "commit", oid: c.oid });
                      }}
                    />
                  </div>
                </WithMenu>
              ))}
              {!deeper ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Search}
                  className="mt-1 ml-4 self-start"
                  onClick={() => setDeeper(true)}
                >
                  {t("sidebar.searchDeeper")}
                </Button>
              ) : danglingQuery.isPending ? (
                <span className="pl-5 text-caption text-fg-muted">
                  {t("sidebar.searchingDeeper")}
                </span>
              ) : (
                dangling.length === 0 && (
                  <span className="pl-5 text-caption text-fg-muted">{t("sidebar.deeperNone")}</span>
                )
              )}
            </>
          )}
        </Section>

        <Section
          id="submodules"
          title={t("sidebar.submodules")}
          count={submodules.length}
          collapsed={isCollapsed("submodules")}
          onToggle={toggle}
          action={
            submodules.length > 0 && (
              <IconButton
                icon={RefreshCw}
                label={t("sidebar.updateSubmodules")}
                compact
                onClick={() => void updateSubmodules(repo, [])}
              />
            )
          }
        >
          {submoduleQuery.isPending ? null : submodules.length === 0 ? (
            // `git submodule status` can take a while; don't claim "None" before it answers.
            <Empty />
          ) : (
            submodules.map((s) => (
              <WithMenu
                key={s.path}
                menu={
                  <>
                    <ContextMenu.Item
                      icon={FolderGit2}
                      disabled={s.state === "notInitialized"}
                      onSelect={() => void openRepoAt(joinPath(repo, s.path))}
                    >
                      {t("sidebar.openAsTab")}
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      icon={RefreshCw}
                      onSelect={() => void updateSubmodules(repo, [s.path])}
                    >
                      {s.state === "notInitialized"
                        ? t("sidebar.initSubmodule")
                        : t("sidebar.updateSubmodule")}
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      icon={FolderOpen}
                      disabled={s.state === "notInitialized"}
                      onSelect={() => void ipc.revealInFileManager(joinPath(repo, s.path))}
                    >
                      {revealLabel}
                    </ContextMenu.Item>
                  </>
                }
              >
                <div className="flex flex-col">
                  <Item
                    icon={Package}
                    label={s.path}
                    onDoubleClick={
                      s.state === "notInitialized"
                        ? undefined
                        : () => void openRepoAt(joinPath(repo, s.path))
                    }
                    title={
                      s.state === "notInitialized"
                        ? t("sidebar.notInitialized")
                        : s.state === "modified"
                          ? t("sidebar.submoduleModified")
                          : s.path
                    }
                    muted={s.state === "notInitialized"}
                    trailing={
                      s.state === "modified" && (
                        <CircleAlert
                          size={12}
                          strokeWidth={2}
                          aria-hidden
                          className="text-warning"
                        />
                      )
                    }
                  />
                </div>
              </WithMenu>
            ))
          )}
        </Section>

        {worktrees.length > 1 && (
          <Section
            id="worktrees"
            title={t("sidebar.worktrees")}
            count={worktrees.length}
            collapsed={isCollapsed("worktrees")}
            onToggle={toggle}
          >
            {worktrees.map((w) => {
              const label = w.branch ?? (w.head ? w.head.slice(0, 7) : w.path);
              const open = () => !w.current && !w.prunable && void openRepoAt(w.path);
              return (
                <WithMenu
                  key={w.path}
                  menu={
                    <>
                      <ContextMenu.Item
                        icon={FolderGit2}
                        disabled={w.current || w.prunable}
                        onSelect={open}
                      >
                        {t("sidebar.openAsTab")}
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        icon={FolderOpen}
                        disabled={w.prunable}
                        onSelect={() => void ipc.revealInFileManager(w.path)}
                      >
                        {revealLabel}
                      </ContextMenu.Item>
                    </>
                  }
                >
                  <div className="flex flex-col">
                    <Item
                      icon={FolderGit2}
                      label={label}
                      title={w.prunable ? t("sidebar.worktreeGone", { path: w.path }) : w.path}
                      active={w.current}
                      muted={w.prunable}
                      onDoubleClick={open}
                      trailing={
                        w.current && (
                          <span className="text-caption text-fg-secondary">
                            {t("sidebar.thisWorktree")}
                          </span>
                        )
                      }
                    />
                  </div>
                </WithMenu>
              );
            })}
          </Section>
        )}
      </div>
    </nav>
  );
}

function Empty() {
  return (
    <span className="flex h-(--row-h) items-center pl-5 text-fg-muted">{t("sidebar.none")}</span>
  );
}

function BranchLeaf({ branch, label }: { branch: Branch; label: string }) {
  const tip = branch.upstreamGone
    ? t("sidebar.upstreamGone")
    : branch.upstream
      ? [
          branch.ahead > 0 &&
            t("toolbar.ahead", { count: branch.ahead, upstream: branch.upstream }),
          branch.behind > 0 &&
            t("toolbar.behind", { count: branch.behind, upstream: branch.upstream }),
        ]
          .filter(Boolean)
          .join(" · ") || branch.upstream
      : branch.name;
  return (
    <Tooltip content={tip} side="right">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {branch.isHead ? (
          <Check size={14} strokeWidth={2.25} aria-hidden className="shrink-0 text-accent" />
        ) : (
          <GitBranch size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-fg-muted" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            branch.isHead ? "font-medium text-fg" : "text-fg-secondary",
          )}
        >
          {label}
        </span>
        {branch.upstreamGone ? (
          <CircleAlert size={12} strokeWidth={2} aria-hidden className="shrink-0 text-warning" />
        ) : (
          <AheadBehind ahead={branch.ahead} behind={branch.behind} />
        )}
      </span>
    </Tooltip>
  );
}
