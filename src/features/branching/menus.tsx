// Menu items for commits and refs, shared by history rows, the sidebar and the branch
// switcher. Each takes `M` (Menu or ContextMenu) so the same items serve both.

import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  Copy,
  FileDown,
  Flag,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  Link,
  ListOrdered,
  Pencil,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
  Undo2,
  Unlink,
} from "lucide-react";

import { shortHash } from "@/app/format";
import { classifyFlowBranch, useFlowState } from "@/features/flow/useFlow";
import { saveCommitPatch } from "@/features/patch/patch";
import { useRebaseBase } from "@/features/rebase/useRebaseBase";
import { pushRepo, pushTag } from "@/features/remote/operations";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import type { Branch, RefsSnapshot, RemoteBranch, Stash, Tag, WorkingStatus } from "@/ipc";
import type { ContextMenu, Menu } from "@/ui/Menu";

import { useBranchDialog } from "./dialog-store";
import { currentName, useBranching, type Branching } from "./useBranching";

type M = typeof Menu | typeof ContextMenu;

const copy = (text: string) => void navigator.clipboard.writeText(text);

/** What every menu needs: the repository, its refs, and whether an operation is underway. */
export interface MenuContext {
  repo: string;
  refs: RefsSnapshot;
  /** A merge / rebase / pick / revert is in progress: history-changing actions wait. */
  busy: boolean;
  current: string;
  b: Branching;
  open: ReturnType<typeof useBranchDialog.getState>["open"];
}

export function useMenuContext(
  repo: string,
  refs: RefsSnapshot | undefined,
  status: WorkingStatus | undefined,
): MenuContext | null {
  const b = useBranching(repo);
  const open = useBranchDialog((s) => s.open);
  if (!refs) return null;
  return { repo, refs, busy: !!status?.operation, current: currentName(refs), b, open };
}

/** The local branch that tracks `fullName` (`origin/x`), if any. */
function trackingBranch(refs: RefsSnapshot, fullName: string): Branch | undefined {
  return refs.branches.find((b) => b.upstream === fullName);
}

/** Merge with an explicit fast-forward choice (the plain item uses Git's default). */
function MergeOptions({
  ctx,
  M,
  rev,
  label,
  disabled,
}: {
  ctx: MenuContext;
  M: M;
  rev: string;
  label: string;
  disabled: boolean;
}) {
  return (
    <M.Sub>
      <M.SubTrigger icon={GitMerge} disabled={disabled}>
        {t("menu.mergeOptions")}
      </M.SubTrigger>
      <M.SubContent>
        <M.Item onSelect={() => void ctx.b.merge(rev, label, "never")}>
          {t("menu.mergeNoFf")}
        </M.Item>
        <M.Item onSelect={() => void ctx.b.merge(rev, label, "only")}>
          {t("menu.mergeFfOnly")}
        </M.Item>
      </M.SubContent>
    </M.Sub>
  );
}

/** "Finish feature/x…" on git-flow branches. */
function FlowFinishItem({ ctx, M, branch }: { ctx: MenuContext; M: M; branch: string }) {
  const { repo, open, busy } = ctx;
  const flow = useFlowState(repo);
  if (!classifyFlowBranch(flow.data?.config, branch)) return null;
  return (
    <>
      <M.Item
        icon={Flag}
        disabled={busy}
        onSelect={() => open(repo, { mode: "flowFinish", branch })}
      >
        {t("flow.finishAction", { branch })}
      </M.Item>
      <M.Separator />
    </>
  );
}

export function BranchItems({ ctx, M, branch }: { ctx: MenuContext; M: M; branch: Branch }) {
  const { repo, b, open, busy, current } = ctx;
  const head = branch.isHead;
  return (
    <>
      {!head && (
        <>
          <M.Item
            icon={GitBranch}
            disabled={busy}
            onSelect={() => void b.checkout({ kind: "branch", name: branch.name })}
          >
            {t("menu.checkout", { name: branch.name })}
          </M.Item>
          <M.Item
            icon={GitMerge}
            disabled={busy}
            onSelect={() => void b.merge(branch.name, branch.name)}
          >
            {t("menu.mergeInto", { name: branch.name, branch: current })}
          </M.Item>
          <MergeOptions ctx={ctx} M={M} rev={branch.name} label={branch.name} disabled={busy} />
          <M.Item
            icon={GitPullRequestArrow}
            disabled={busy}
            onSelect={() => open(repo, { mode: "rebase", onto: branch.name, label: branch.name })}
          >
            {t("menu.rebaseOnto", { branch: current, name: branch.name })}
          </M.Item>
          <M.Separator />
        </>
      )}
      {head && branch.upstream && !branch.upstreamGone && (
        <>
          <M.Item icon={ArrowUpFromLine} onSelect={() => void pushRepo(repo)}>
            {t("menu.push", { name: branch.name })}
          </M.Item>
          <M.Separator />
        </>
      )}
      <FlowFinishItem ctx={ctx} M={M} branch={branch.name} />
      <M.Item
        icon={GitBranchPlus}
        onSelect={() =>
          open(repo, { mode: "createBranch", start: branch.name, startLabel: branch.name })
        }
      >
        {t("menu.newBranchFrom", { name: branch.name })}
      </M.Item>
      <M.Item
        icon={Pencil}
        onSelect={() => open(repo, { mode: "renameBranch", name: branch.name })}
      >
        {t("menu.rename")}
      </M.Item>
      <M.Item icon={Link} onSelect={() => open(repo, { mode: "setUpstream", branch: branch.name })}>
        {branch.upstream ? t("menu.changeUpstream") : t("menu.setUpstream")}
      </M.Item>
      {branch.upstream && (
        <M.Item icon={Unlink} onSelect={() => void b.setUpstream(branch.name, null)}>
          {t("menu.unsetUpstream", { upstream: branch.upstream })}
        </M.Item>
      )}
      <M.Item icon={Copy} onSelect={() => copy(branch.name)}>
        {t("menu.copyName")}
      </M.Item>
      <M.Separator />
      <M.Item
        icon={Trash2}
        danger
        disabled={head}
        onSelect={() => open(repo, { mode: "deleteBranch", name: branch.name, unmerged: false })}
      >
        {t("menu.deleteBranch")}
      </M.Item>
    </>
  );
}

export function RemoteBranchItems({
  ctx,
  M,
  remote,
  branch,
}: {
  ctx: MenuContext;
  M: M;
  remote: string;
  branch: RemoteBranch;
}) {
  const { repo, refs, b, open, busy, current } = ctx;
  const local = trackingBranch(refs, branch.fullName);
  return (
    <>
      {local ? (
        !local.isHead && (
          <M.Item
            icon={GitBranch}
            disabled={busy}
            onSelect={() => void b.checkout({ kind: "branch", name: local.name })}
          >
            {t("menu.checkout", { name: local.name })}
          </M.Item>
        )
      ) : (
        <M.Item
          icon={GitBranch}
          disabled={busy}
          onSelect={() => open(repo, { mode: "checkoutRemote", remoteBranch: branch.fullName })}
        >
          {t("menu.checkoutRemote")}
        </M.Item>
      )}
      <M.Item
        icon={GitMerge}
        disabled={busy}
        onSelect={() => void b.merge(branch.fullName, branch.fullName)}
      >
        {t("menu.mergeInto", { name: branch.fullName, branch: current })}
      </M.Item>
      <MergeOptions ctx={ctx} M={M} rev={branch.fullName} label={branch.fullName} disabled={busy} />
      <M.Item
        icon={GitPullRequestArrow}
        disabled={busy}
        onSelect={() =>
          open(repo, { mode: "rebase", onto: branch.fullName, label: branch.fullName })
        }
      >
        {t("menu.rebaseOnto", { branch: current, name: branch.fullName })}
      </M.Item>
      <M.Separator />
      <M.Item
        icon={GitBranchPlus}
        onSelect={() =>
          open(repo, { mode: "createBranch", start: branch.fullName, startLabel: branch.fullName })
        }
      >
        {t("menu.newBranchFrom", { name: branch.fullName })}
      </M.Item>
      <M.Item icon={Copy} onSelect={() => copy(branch.fullName)}>
        {t("menu.copyName")}
      </M.Item>
      <M.Separator />
      <M.Item
        icon={Trash2}
        danger
        onSelect={() => open(repo, { mode: "deleteRemoteBranch", remote, branch: branch.name })}
      >
        {t("menu.deleteRemoteBranch", { remote })}
      </M.Item>
    </>
  );
}

export function TagItems({ ctx, M, tag }: { ctx: MenuContext; M: M; tag: Tag }) {
  const { repo, refs, open, busy } = ctx;
  return (
    <>
      <M.Item
        icon={GitCommitHorizontal}
        disabled={busy}
        onSelect={() => open(repo, { mode: "checkoutDetached", oid: tag.oid, label: tag.name })}
      >
        {t("menu.checkoutTag")}
      </M.Item>
      <M.Item
        icon={GitBranchPlus}
        onSelect={() => open(repo, { mode: "createBranch", start: tag.name, startLabel: tag.name })}
      >
        {t("menu.newBranchFrom", { name: tag.name })}
      </M.Item>
      {refs.remotes.map((r) => (
        <M.Item key={r.name} icon={Cloud} onSelect={() => void pushTag(repo, r.name, tag.name)}>
          {t("menu.pushTag", { remote: r.name })}
        </M.Item>
      ))}
      <M.Item icon={Copy} onSelect={() => copy(tag.name)}>
        {t("menu.copyName")}
      </M.Item>
      <M.Separator />
      <M.Item
        icon={Trash2}
        danger
        onSelect={() => open(repo, { mode: "deleteTag", name: tag.name })}
      >
        {t("menu.deleteTag")}
      </M.Item>
    </>
  );
}

export function StashItems({
  ctx,
  M,
  stash,
  index,
}: {
  ctx: MenuContext;
  M: M;
  stash: Stash;
  index: number;
}) {
  const { repo, b, open, busy } = ctx;
  const select = useRepoUi((s) => s.select);
  const setView = useRepoUi((s) => s.setView);
  return (
    <>
      <M.Item
        icon={Archive}
        onSelect={() => {
          setView("history");
          select({ kind: "commit", oid: stash.oid });
        }}
      >
        {t("menu.showStash")}
      </M.Item>
      <M.Separator />
      <M.Item
        icon={ArrowDownToLine}
        disabled={busy}
        onSelect={() => void b.stashApply(index, true)}
      >
        {t("menu.popStash")}
      </M.Item>
      <M.Item
        icon={ArrowDownToLine}
        disabled={busy}
        onSelect={() => void b.stashApply(index, false)}
      >
        {t("menu.applyStash")}
      </M.Item>
      <M.Separator />
      <M.Item
        icon={Trash2}
        danger
        onSelect={() => open(repo, { mode: "dropStash", index, message: stash.message })}
      >
        {t("menu.dropStash")}
      </M.Item>
    </>
  );
}

/**
 * A history row: checkout, branch / tag here, merge / rebase / pick / revert / reset, copy,
 * and a submenu per ref on the commit.
 */
export function CommitItems({
  ctx,
  M,
  oid,
  subject,
}: {
  ctx: MenuContext;
  M: M;
  oid: string;
  subject: string;
}) {
  const { repo, refs, b, open, busy, current } = ctx;
  const isHead = refs.head.oid === oid;
  const short = shortHash(oid);
  const locals = refs.branches.filter((x) => x.oid === oid);
  const remotes = refs.remotes.flatMap((r) =>
    r.branches.filter((x) => x.oid === oid).map((branch) => ({ remote: r.name, branch })),
  );
  const tags = refs.tags.filter((x) => x.oid === oid);
  const checkoutable = locals.filter((x) => !x.isHead);
  // Interactive rebase starts from an ancestor of HEAD (asked when the menu opens).
  const rebaseBase = useRebaseBase(repo, refs.head.oid, isHead ? null : oid);
  return (
    <>
      {checkoutable.map((x) => (
        <M.Item
          key={x.name}
          icon={GitBranch}
          disabled={busy}
          onSelect={() => void b.checkout({ kind: "branch", name: x.name })}
        >
          {t("menu.checkout", { name: x.name })}
        </M.Item>
      ))}
      <M.Item
        icon={GitCommitHorizontal}
        disabled={busy || (isHead && !refs.head.branch)}
        onSelect={() => open(repo, { mode: "checkoutDetached", oid, label: short })}
      >
        {t("menu.checkoutCommit")}
      </M.Item>
      <M.Item
        icon={GitBranchPlus}
        onSelect={() => open(repo, { mode: "createBranch", start: oid, startLabel: short })}
      >
        {t("menu.newBranchHere")}
      </M.Item>
      <M.Item
        icon={TagIcon}
        onSelect={() => open(repo, { mode: "createTag", target: oid, targetLabel: short })}
      >
        {t("menu.newTagHere")}
      </M.Item>
      <M.Separator />
      <M.Item icon={GitMerge} disabled={busy || isHead} onSelect={() => void b.merge(oid, short)}>
        {t("menu.mergeCommit", { branch: current })}
      </M.Item>
      <MergeOptions ctx={ctx} M={M} rev={oid} label={short} disabled={busy || isHead} />
      <M.Item
        icon={GitPullRequestArrow}
        disabled={busy || isHead}
        onSelect={() => open(repo, { mode: "rebase", onto: oid, label: short })}
      >
        {t("menu.rebaseOntoCommit", { branch: current })}
      </M.Item>
      <M.Item
        icon={ListOrdered}
        disabled={busy || !rebaseBase.data}
        onSelect={() => open(repo, { mode: "interactiveRebase", base: oid, label: short })}
      >
        {t("rebase.menuItem")}
      </M.Item>
      <M.Item
        icon={GitCommitHorizontal}
        disabled={busy || isHead}
        onSelect={() => void b.cherryPick(oid)}
      >
        {t("menu.cherryPick", { branch: current })}
      </M.Item>
      <M.Item icon={Undo2} disabled={busy} onSelect={() => void b.revert(oid)}>
        {t("menu.revert")}
      </M.Item>
      <M.Item
        icon={RotateCcw}
        disabled={busy || isHead}
        onSelect={() => open(repo, { mode: "reset", oid, subject })}
      >
        {t("menu.reset", { branch: current })}
      </M.Item>
      <M.Separator />
      <M.Item icon={Copy} onSelect={() => copy(oid)}>
        {t("menu.copyHash")}
      </M.Item>
      <M.Item icon={Copy} onSelect={() => copy(subject)}>
        {t("menu.copyMessage")}
      </M.Item>
      <M.Item icon={FileDown} onSelect={() => void saveCommitPatch(repo, oid, subject)}>
        {t("patch.saveCommit")}
      </M.Item>
      {(locals.length > 0 || remotes.length > 0 || tags.length > 0) && <M.Separator />}
      {locals.map((x) => (
        <M.Sub key={`l:${x.name}`}>
          <M.SubTrigger icon={GitBranch}>{x.name}</M.SubTrigger>
          <M.SubContent>
            <BranchItems ctx={ctx} M={M} branch={x} />
          </M.SubContent>
        </M.Sub>
      ))}
      {remotes.map(({ remote, branch }) => (
        <M.Sub key={`r:${branch.fullName}`}>
          <M.SubTrigger icon={Cloud}>{branch.fullName}</M.SubTrigger>
          <M.SubContent>
            <RemoteBranchItems ctx={ctx} M={M} remote={remote} branch={branch} />
          </M.SubContent>
        </M.Sub>
      ))}
      {tags.map((x) => (
        <M.Sub key={`t:${x.name}`}>
          <M.SubTrigger icon={TagIcon}>{x.name}</M.SubTrigger>
          <M.SubContent>
            <TagItems ctx={ctx} M={M} tag={x} />
          </M.SubContent>
        </M.Sub>
      ))}
    </>
  );
}
