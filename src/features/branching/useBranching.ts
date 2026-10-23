// Branch, tag, stash and history operations for one repository: each runs through
// `useRepoAction` (serialized, refreshes what it changed, error toasts with Git's output)
// and reports its outcome. Refusals the user can do something about open a dialog instead.

import { useCallback, useMemo } from "react";

import { queryClient } from "@/app/query-client";
import { shortHash } from "@/app/format";
import { useRepoAction } from "@/features/changes/useRepoAction";
import { useRepoUi } from "@/features/repo/repo-store";
import { useUndo } from "@/features/undo/undo";
import { plural, t } from "@/i18n";
import {
  ipc,
  type CheckoutTarget,
  type ConflictSide,
  type FastForward,
  type IpcError,
  type IntegrateOutcome,
  type PatchApplyMode,
  type RefsSnapshot,
  type ResetMode,
  type StashRequest,
  type TodoItem,
} from "@/ipc";
import { toast } from "@/ui/Toast";

import { useBranchDialog } from "./dialog-store";

/** The checked-out branch's name, or "HEAD" when detached. */
export function currentName(refs: RefsSnapshot | undefined): string {
  return refs?.head.branch ?? "HEAD";
}

export function targetLabel(target: CheckoutTarget): string {
  switch (target.kind) {
    case "branch":
      return target.name;
    case "remote":
      return target.localName;
    case "detached":
      return shortHash(target.oid);
  }
}

export function useBranching(repo: string) {
  const run = useRepoAction(repo);
  const undo = useUndo(repo);
  const setView = useRepoUi((s) => s.setView);
  const openDialog = useBranchDialog((s) => s.open);

  const current = useCallback(
    () => currentName(queryClient.getQueryData<RefsSnapshot>(["refs", repo])),
    [repo],
  );

  /** Toasts an integration outcome; conflicts point to the Changes view. */
  const reportOutcome = useCallback(
    (outcome: IntegrateOutcome | undefined, done: string, stopped: string, undoable = true) => {
      if (!outcome) return;
      if (outcome === "conflicts") {
        toast({
          kind: "error",
          title: stopped,
          description: t("branching.conflictsHint"),
          action: { label: t("ops.showChanges"), run: () => setView("changes") },
        });
      } else if (outcome === "stopped") {
        // An interactive rebase paused at an `edit`: the banner has Continue.
        void ipc
          .getStatus(repo)
          .catch(() => undefined)
          .then((s) =>
            toast({
              kind: "success",
              title: t("rebase.stopped", { hash: s?.operation?.incoming ?? "" }).trim(),
              description: t("rebase.stoppedHint"),
            }),
          );
      } else if (outcome === "upToDate") {
        toast({ kind: "success", title: t("branching.upToDate", { branch: current() }) });
      } else {
        // Continuing after conflicts isn't journaled: Undo there would mean an older entry.
        toast({ kind: "success", title: done, action: undoable ? undo.toastAction : undefined });
      }
    },
    [repo, current, setView, undo.toastAction],
  );

  /** Merge / rebase / pick / revert refused over local changes: say so and offer Stash. */
  const dirtyRefusal = useCallback(
    (err: IpcError) => {
      if (err.kind !== "localChanges") return false;
      toast({
        kind: "error",
        title: t("branching.dirtyTitle"),
        description: t("branching.dirtyHint"),
        error: err,
        action: {
          label: t("branching.stashAction"),
          run: () => openDialog(repo, { mode: "stash" }),
        },
      });
      return true;
    },
    [repo, openDialog],
  );

  return useMemo(() => {
    const checkout = async (target: CheckoutTarget, stash = false) => {
      const label = targetLabel(target);
      const outcome = await run(
        () => ipc.checkout(repo, { target, stash }),
        t("branching.checkoutFailed", { name: label }),
        {
          refs: true,
          onError: (err) => {
            if (err.kind !== "localChanges" || stash) return false;
            openDialog(repo, { mode: "localChanges", target, label, files: err.files ?? [] });
            return true;
          },
        },
      );
      if (outcome === "done") {
        toast({
          kind: "success",
          title:
            target.kind === "detached"
              ? t("branching.checkedOutCommit", { hash: label })
              : t("branching.switched", { name: label }),
          action: undo.toastAction,
        });
      } else if (outcome === "stashConflicts") {
        toast({
          kind: "error",
          title: t("branching.stashConflicts", { name: label }),
          description: t("branching.stashConflictsHint"),
          action: { label: t("ops.showChanges"), run: () => setView("changes") },
        });
      }
    };

    return {
      checkout,

      createBranch: async (name: string, start: string, andCheckout: boolean) => {
        const ok = await run(
          () => ipc.createBranch(repo, name, start, andCheckout).then(() => true),
          t("branching.createFailed", { name }),
          { refs: true },
        );
        if (ok) {
          toast({
            kind: "success",
            title: andCheckout
              ? t("branching.createdAndSwitched", { name })
              : t("branching.created", { name }),
            action: undo.toastAction,
          });
        }
        return ok === true;
      },

      renameBranch: async (name: string, newName: string) =>
        (await run(
          () => ipc.renameBranch(repo, name, newName).then(() => true),
          t("branching.renameFailed", { name }),
          { refs: true },
        )) === true,

      deleteBranch: async (name: string, force: boolean) => {
        const ok = await run(
          () => ipc.deleteBranch(repo, name, force).then(() => true),
          t("branching.deleteFailed", { name }),
          {
            refs: true,
            onError: (err) => {
              if (err.kind !== "notFullyMerged" || force) return false;
              openDialog(repo, { mode: "deleteBranch", name, unmerged: true });
              return true;
            },
          },
        );
        if (ok)
          toast({
            kind: "success",
            title: t("branching.deleted", { name }),
            action: undo.toastAction,
          });
      },

      setUpstream: async (branch: string, upstream: string | null) =>
        (await run(
          () => ipc.setUpstream(repo, branch, upstream).then(() => true),
          t("branching.upstreamFailed", { name: branch }),
          { refs: true },
        )) === true,

      createTag: async (name: string, target: string, message: string | null) => {
        const ok = await run(
          () => ipc.createTag(repo, name, target, message).then(() => true),
          t("branching.tagFailed", { name }),
          { refs: true },
        );
        if (ok)
          toast({
            kind: "success",
            title: t("branching.tagCreated", { name }),
            action: undo.toastAction,
          });
        return ok === true;
      },

      deleteTag: async (name: string) => {
        const ok = await run(
          () => ipc.deleteTag(repo, name).then(() => true),
          t("branching.tagDeleteFailed", { name }),
          { refs: true },
        );
        if (ok)
          toast({
            kind: "success",
            title: t("branching.tagDeleted", { name }),
            action: undo.toastAction,
          });
      },

      stashSave: async (request: StashRequest) => {
        const saved = await run(() => ipc.stashSave(repo, request), t("branching.stashFailed"), {
          refs: true,
        });
        if (saved === false) toast({ kind: "success", title: t("branching.nothingToStash") });
        else if (saved)
          toast({ kind: "success", title: t("branching.stashed"), action: undo.toastAction });
      },

      stashApply: async (index: number, pop: boolean) => {
        const outcome = await run(
          () => ipc.stashApply(repo, index, pop),
          pop ? t("branching.popFailed") : t("branching.applyFailed"),
          { refs: true },
        );
        if (outcome === "applied") {
          toast({
            kind: "success",
            title: pop ? t("branching.popped") : t("branching.applied"),
            action: undo.toastAction,
          });
        } else if (outcome === "conflicts") {
          toast({
            kind: "error",
            title: t("branching.stashApplyConflicts"),
            description: t("branching.stashApplyConflictsHint"),
            action: { label: t("ops.showChanges"), run: () => setView("changes") },
          });
        }
      },

      stashDrop: async (index: number) => {
        const ok = await run(
          () => ipc.stashDrop(repo, index).then(() => true),
          t("branching.dropFailed"),
          { refs: true },
        );
        if (ok) toast({ kind: "success", title: t("branching.dropped"), action: undo.toastAction });
      },

      merge: async (rev: string, label: string, ff: FastForward = "allow") => {
        const into = current();
        const outcome = await run(
          () => ipc.merge(repo, rev, ff),
          t("branching.mergeFailed", { name: label }),
          { refs: true, onError: dirtyRefusal },
        );
        if (outcome === "fastForward") {
          toast({
            kind: "success",
            title: t("branching.fastForwarded", { branch: into, name: label }),
            action: undo.toastAction,
          });
          return;
        }
        reportOutcome(
          outcome,
          t("branching.merged", { name: label, branch: into }),
          t("branching.mergeConflicts"),
        );
      },

      rebase: async (onto: string, label: string) => {
        const branch = current();
        const outcome = await run(() => ipc.rebase(repo, onto), t("branching.rebaseFailed"), {
          refs: true,
          onError: dirtyRefusal,
        });
        reportOutcome(
          outcome,
          t("branching.rebased", { branch, name: label }),
          t("branching.rebaseConflicts"),
        );
      },

      /** Interactive rebase from `base` by `plan`; resolves to whether it ran. */
      rebaseInteractive: async (base: string, plan: TodoItem[]) => {
        const branch = current();
        const outcome = await run(
          () => ipc.rebaseInteractive(repo, base, plan),
          t("rebase.failed"),
          { refs: true, onError: dirtyRefusal },
        );
        reportOutcome(outcome, t("rebase.done", { branch }), t("rebase.conflicts"));
        return outcome !== undefined;
      },

      cherryPick: async (oid: string) => {
        const outcome = await run(() => ipc.cherryPick(repo, oid), t("branching.pickFailed"), {
          refs: true,
          onError: dirtyRefusal,
        });
        reportOutcome(
          outcome,
          t("branching.picked", { hash: shortHash(oid), branch: current() }),
          t("branching.pickConflicts"),
        );
      },

      /** Cherry-picks several commits, `oids` oldest first. */
      cherryPickMany: async (oids: string[]) => {
        const outcome = await run(() => ipc.cherryPickMany(repo, oids), t("branching.pickFailed"), {
          refs: true,
          onError: dirtyRefusal,
        });
        reportOutcome(
          outcome,
          t("branching.pickedMany", {
            commits: plural("count.commits", oids.length),
            branch: current(),
          }),
          t("branching.pickConflicts"),
        );
      },

      /** Reverts several commits, `oids` newest first. */
      revertMany: async (oids: string[]) => {
        const outcome = await run(() => ipc.revertMany(repo, oids), t("branching.revertFailed"), {
          refs: true,
          onError: dirtyRefusal,
        });
        reportOutcome(
          outcome,
          t("branching.revertedMany", { commits: plural("count.commits", oids.length) }),
          t("branching.revertConflicts"),
        );
      },

      /** Applies a patch file; resolves true unless it failed (conflicts count as applied). */
      applyPatch: async (file: string, mode: PatchApplyMode, commits: number) => {
        const outcome = await run(
          () => ipc.applyPatchFile(repo, file, mode),
          t("patch.applyFailed"),
          { refs: mode === "commits", onError: dirtyRefusal },
        );
        reportOutcome(
          outcome,
          mode === "commits"
            ? t("patch.committed", { commits: plural("count.commits", commits), branch: current() })
            : t("patch.applied"),
          mode === "commits" ? t("patch.amConflicts") : t("patch.applyConflicts"),
        );
        return outcome !== undefined;
      },

      revert: async (oid: string) => {
        const outcome = await run(() => ipc.revert(repo, oid), t("branching.revertFailed"), {
          refs: true,
          onError: dirtyRefusal,
        });
        reportOutcome(
          outcome,
          t("branching.reverted", { hash: shortHash(oid) }),
          t("branching.revertConflicts"),
        );
      },

      reset: async (oid: string, mode: ResetMode) => {
        const branch = current();
        const ok = await run(
          () => ipc.reset(repo, oid, mode).then(() => true),
          t("branching.resetFailed"),
          { refs: true },
        );
        if (ok) {
          toast({
            kind: "success",
            title: t("branching.resetDone", { branch, hash: shortHash(oid) }),
            action: undo.toastAction,
          });
        }
      },

      continueOperation: async () => {
        const outcome = await run(
          () => ipc.continueOperation(repo),
          t("branching.continueFailed"),
          {
            refs: true,
          },
        );
        reportOutcome(outcome, t("branching.continued"), t("branching.nextConflicts"), false);
      },

      skipOperation: async () => {
        const outcome = await run(() => ipc.skipOperation(repo), t("branching.skipFailed"), {
          refs: true,
        });
        reportOutcome(outcome, t("branching.skipped"), t("branching.nextConflicts"), false);
      },

      abortOperation: async () => {
        const ok = await run(
          () => ipc.abortOperation(repo).then(() => true),
          t("branching.abortFailed"),
          { refs: true },
        );
        if (ok) toast({ kind: "success", title: t("branching.aborted") });
      },

      resolveWith: (paths: string[], side: ConflictSide) =>
        run(() => ipc.resolveWith(repo, paths, side), t("branching.resolveFailed")),

      markResolved: (paths: string[]) =>
        run(() => ipc.markResolved(repo, paths), t("branching.resolveFailed")),

      mergeTool: (path: string) =>
        run(() => ipc.mergeTool(repo, path), t("branching.mergeToolFailed")),
    };
  }, [repo, run, openDialog, setView, current, reportOutcome, dirtyRefusal, undo]);
}

export type Branching = ReturnType<typeof useBranching>;
