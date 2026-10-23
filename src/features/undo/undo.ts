// Undo and redo of Tylia's own operations (ROADMAP Phase 11 A). The journal lives in Rust
// (crates/tylia-git/src/undo.rs); this asks what it can do and runs it like any write.

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useRepoAction } from "@/features/changes/useRepoAction";
import { t, type MessageKey } from "@/i18n";
import { ipc, type UndoKind, type UndoState } from "@/ipc";
import { toast, type ToastAction } from "@/ui/Toast";

const NAMES: Record<UndoKind, MessageKey> = {
  commit: "undo.kind.commit",
  amend: "undo.kind.amend",
  merge: "undo.kind.merge",
  rebase: "undo.kind.rebase",
  interactiveRebase: "undo.kind.interactiveRebase",
  cherryPick: "undo.kind.cherryPick",
  revert: "undo.kind.revert",
  reset: "undo.kind.reset",
  checkout: "undo.kind.checkout",
  createBranch: "undo.kind.createBranch",
  renameBranch: "undo.kind.renameBranch",
  deleteBranch: "undo.kind.deleteBranch",
  createTag: "undo.kind.createTag",
  deleteTag: "undo.kind.deleteTag",
  stashSave: "undo.kind.stashSave",
  stashApply: "undo.kind.stashApply",
  stashPop: "undo.kind.stashPop",
  stashDrop: "undo.kind.stashDrop",
  flowFinish: "undo.kind.flowFinish",
};

/** "commit", "branch delete"…, for "Undo {operation}". */
export const operationName = (kind: UndoKind) => t(NAMES[kind]);

export interface Undo {
  state: UndoState | undefined;
  undo(): void;
  redo(): void;
  /** "Undo" on a success toast. */
  toastAction: ToastAction;
}

export function useUndo(repo: string): Undo {
  const run = useRepoAction(repo);
  const { data: state } = useQuery({
    queryKey: ["undo", repo],
    queryFn: () => ipc.undoState(repo),
  });
  const go = useCallback(
    async function go(redo: boolean): Promise<void> {
      const result = await run(
        () => (redo ? ipc.redo(repo) : ipc.undo(repo)),
        t(redo ? "undo.redoFailed" : "undo.undoFailed"),
        { refs: true },
      );
      // What was just undone can now be redone, and the other way round.
      const kind = redo ? result?.undo : result?.redo;
      if (!kind) return;
      toast({
        kind: "success",
        title: t(redo ? "undo.redone" : "undo.undone", { operation: operationName(kind) }),
        action: {
          label: t(redo ? "undo.undoPlain" : "undo.redoPlain"),
          run: () => void go(!redo),
        },
      });
    },
    [repo, run],
  );
  return useMemo(
    () => ({
      state,
      undo: () => void go(false),
      redo: () => void go(true),
      toastAction: { label: t("undo.undoPlain"), run: () => void go(false) },
    }),
    [state, go],
  );
}
