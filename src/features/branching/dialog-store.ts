import { create } from "zustand";

import type { CheckoutTarget, FlowKind } from "@/ipc";

/** The branching dialogs, each with what it needs. `repo` scopes it to one repository view. */
export type BranchDialog =
  | { mode: "createBranch"; start: string; startLabel: string }
  | { mode: "renameBranch"; name: string }
  /** `unmerged`: Git refused because of unmerged commits; this asks to force. */
  | { mode: "deleteBranch"; name: string; unmerged: boolean }
  | { mode: "deleteRemoteBranch"; remote: string; branch: string }
  | { mode: "checkoutRemote"; remoteBranch: string }
  | { mode: "checkoutDetached"; oid: string; label: string }
  /** A checkout Git refused because these files' changes would be overwritten. */
  | { mode: "localChanges"; target: CheckoutTarget; label: string; files: string[] }
  | { mode: "setUpstream"; branch: string }
  | { mode: "createTag"; target: string; targetLabel: string }
  | { mode: "deleteTag"; name: string }
  | { mode: "stash" }
  | { mode: "dropStash"; index: number; message: string }
  | { mode: "rebase"; onto: string; label: string }
  /** The interactive rebase editor for the commits after `base`. */
  | { mode: "interactiveRebase"; base: string; label: string }
  | { mode: "reset"; oid: string; subject: string }
  | { mode: "abortOperation" }
  | { mode: "flowInit" }
  | { mode: "flowStart"; kind: FlowKind }
  | { mode: "flowFinish"; branch: string };

export const useBranchDialog = create<{
  repo: string | null;
  dialog: BranchDialog | null;
  open(repo: string, dialog: BranchDialog): void;
  close(): void;
}>((set) => ({
  repo: null,
  dialog: null,
  open: (repo, dialog) => set({ repo, dialog }),
  close: () => set({ repo: null, dialog: null }),
}));
