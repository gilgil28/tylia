// The palette's "Interactively rebase from the selected commit…" for the visible repository.

import { ListOrdered } from "lucide-react";

import { useRegisterActions, type Action } from "@/app/actions";
import { shortHash } from "@/app/format";
import { useBranchDialog } from "@/features/branching/dialog-store";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import type { RefsSnapshot, WorkingStatus } from "@/ipc";

import { useRebaseBase } from "./useRebaseBase";

export function useRebaseActions(
  repo: string,
  refs: RefsSnapshot | undefined,
  status: WorkingStatus | undefined,
  active: boolean,
) {
  const selection = useRepoUi((s) => s.selection);
  const open = useBranchDialog((s) => s.open);
  const oid = active && selection?.kind === "commit" ? selection.oid : null;
  const base = useRebaseBase(repo, refs?.head.oid ?? null, oid);

  const actions: Action[] = [
    {
      id: "branch.interactiveRebase",
      title: t("rebase.actionTitle"),
      group: "branch",
      icon: ListOrdered,
      keywords: ["rebase", "reorder", "squash", "reword", "fixup", "drop", "edit", "history"],
      disabled: !oid || !!status?.operation || !base.data,
      run: () => {
        if (oid) open(repo, { mode: "interactiveRebase", base: oid, label: shortHash(oid) });
      },
    },
  ];
  useRegisterActions(`rebase:${repo}`, actions, active);
}
