import { ChevronRight, Cloud, Copy, Ellipsis, GitBranch, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { RemoteBranchItems, type MenuContext } from "@/features/branching/menus";
import { useRemoteDialog } from "@/features/remote/RemoteDialogs";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import type { Remote, RemoteBranch } from "@/ipc";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { ContextMenu, Menu } from "@/ui/Menu";
import { Tree } from "@/ui/Tree";
import { allFolders } from "@/ui/tree-model";

/** Edit / Copy URL / Remove, for both the context menu and the ⋯ menu. */
function RemoteActions({
  repo,
  remote,
  M,
}: {
  repo: string;
  remote: Remote;
  M: typeof Menu | typeof ContextMenu;
}) {
  const open = useRemoteDialog((s) => s.open);
  const url = remote.url;
  return (
    <>
      <M.Item icon={Pencil} onSelect={() => open({ repo, mode: "edit", name: remote.name })}>
        {t("remotes.edit")}
      </M.Item>
      <M.Item
        icon={Copy}
        disabled={!url}
        onSelect={() => url && void navigator.clipboard.writeText(url)}
      >
        {t("remotes.copyUrl")}
      </M.Item>
      <M.Separator />
      <M.Item
        icon={Trash2}
        danger
        onSelect={() => open({ repo, mode: "remove", name: remote.name })}
      >
        {t("remotes.remove")}
      </M.Item>
    </>
  );
}

/** A remote in the sidebar: its name (with actions) above a tree of its branches. */
export function RemoteGroup({
  repo,
  remote,
  branches,
  filtering,
  ctx,
}: {
  repo: string;
  remote: Remote;
  /** The remote's branches that pass the sidebar filter. */
  branches: RemoteBranch[];
  filtering: boolean;
  ctx: MenuContext | null;
}) {
  const reveal = useRepoUi((s) => s.reveal);
  const [open, setOpen] = useState(true);
  // `null` = every folder expanded (the default until the user collapses one).
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const shown = open || filtering;
  const folders = (!filtering && expanded) || allFolders(branches.map((b) => b.name));

  const header: ReactNode = (
    <div
      className="group/remote flex h-(--row-h) items-center gap-1 rounded-control pr-1 pl-1 hover:bg-hover"
      title={remote.url ?? remote.name}
    >
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen(!open)}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-control text-left focus-ring"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            aria-hidden
            className={cn("transition-transform duration-(--dur-fast)", shown && "rotate-90")}
          />
        </span>
        <Cloud size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-fg-muted" />
        <span className="truncate text-fg-secondary">{remote.name}</span>
      </button>
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            icon={Ellipsis}
            label={t("remotes.actions", { name: remote.name })}
            compact
            className="opacity-0 group-hover/remote:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          />
        </Menu.Trigger>
        <Menu.Content align="start">
          <RemoteActions repo={repo} remote={remote} M={Menu} />
        </Menu.Content>
      </Menu.Root>
    </div>
  );

  return (
    <div className="flex flex-col">
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{header}</ContextMenu.Trigger>
        <ContextMenu.Content>
          <RemoteActions repo={repo} remote={remote} M={ContextMenu} />
        </ContextMenu.Content>
      </ContextMenu.Root>
      {shown && branches.length > 0 && (
        <Tree<RemoteBranch>
          aria-label={remote.name}
          items={branches}
          getPath={(b) => b.name}
          expanded={folders}
          onExpandedChange={setExpanded}
          onSelect={(leaf) => reveal(leaf.data.oid)}
          indent={1}
          renderLeaf={(leaf) => (
            <ContextMenu.Root>
              <ContextMenu.Trigger asChild disabled={!ctx}>
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <GitBranch
                    size={14}
                    strokeWidth={1.75}
                    aria-hidden
                    className="shrink-0 text-fg-muted"
                  />
                  <span className="truncate text-fg-secondary">{leaf.label}</span>
                </span>
              </ContextMenu.Trigger>
              {ctx && (
                <ContextMenu.Content>
                  <RemoteBranchItems
                    ctx={ctx}
                    M={ContextMenu}
                    remote={remote.name}
                    branch={leaf.data}
                  />
                </ContextMenu.Content>
              )}
            </ContextMenu.Root>
          )}
        />
      )}
    </div>
  );
}
