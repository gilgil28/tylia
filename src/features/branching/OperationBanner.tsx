import { CircleAlert, CircleCheck } from "lucide-react";
import { useState } from "react";

import { useRepoUi } from "@/features/repo/repo-store";
import { plural, t } from "@/i18n";
import type { RefsSnapshot, RepoOperation, WorkingStatus } from "@/ipc";
import { Button } from "@/ui/Button";
import { Tooltip } from "@/ui/Tooltip";

import { useBranchDialog } from "./dialog-store";
import { currentName, useBranching } from "./useBranching";

function describe(op: RepoOperation, current: string): string {
  switch (op.kind) {
    case "merge":
      return op.incoming
        ? t("banner.merging", { name: op.incoming, branch: current })
        : t("banner.mergingPlain", { branch: current });
    case "rebase": {
      const base = op.editing
        ? t("rebase.bannerEditing", { branch: op.branch ?? current, hash: op.incoming ?? "" })
        : t("banner.rebasing", { branch: op.branch ?? current, onto: op.onto ?? "" });
      return op.step && op.total
        ? `${base} · ${t("banner.step", { step: op.step, total: op.total })}`
        : base;
    }
    case "cherryPick":
      return t("banner.picking", { hash: op.incoming ?? "" });
    case "revert":
      return t("banner.reverting", { hash: op.incoming ?? "" });
    case "am": {
      const base = op.incoming
        ? t("banner.applying", { subject: op.incoming, branch: current })
        : t("banner.applyingPlain", { branch: current });
      return op.step && op.total && op.total > 1
        ? `${base} · ${t("banner.patchStep", { step: op.step, total: op.total })}`
        : base;
    }
  }
}

/**
 * Shown while a merge, rebase, cherry-pick, revert or `git am` (applying a patch file's
 * commits) is in progress: what is happening, how
 * many conflicts remain, and Continue / Skip / Abort. Continue waits until conflicts are
 * resolved.
 */
export function OperationBanner({
  repo,
  refs,
  status,
}: {
  repo: string;
  refs: RefsSnapshot | undefined;
  status: WorkingStatus | undefined;
}) {
  const b = useBranching(repo);
  const open = useBranchDialog((s) => s.open);
  const view = useRepoUi((s) => s.view);
  const setView = useRepoUi((s) => s.setView);
  const [busy, setBusy] = useState<"continue" | "skip" | null>(null);
  const op = status?.operation;
  if (!op) return null;
  const conflicts = status.entries.filter((e) => e.conflicted).length;
  const canSkip = op.kind !== "merge";

  const act = async (which: "continue" | "skip") => {
    setBusy(which);
    await (which === "continue" ? b.continueOperation() : b.skipOperation());
    setBusy(null);
  };

  return (
    <div
      role="status"
      className="flex h-10 shrink-0 items-center gap-3 border-b border-line-subtle bg-[color-mix(in_srgb,var(--warning)_10%,var(--bg-panel))] px-3"
    >
      {conflicts > 0 ? (
        <CircleAlert size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-warning" />
      ) : (
        <CircleCheck size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-success" />
      )}
      <span className="min-w-0 truncate font-medium text-fg">
        {describe(op, currentName(refs))}
      </span>
      <span className="shrink-0 text-small text-fg-secondary">
        {conflicts > 0
          ? plural("count.conflicts", conflicts)
          : op.editing
            ? t("rebase.bannerEditHint")
            : t("banner.resolved")}
      </span>
      {conflicts > 0 && view !== "changes" && (
        <Button size="sm" variant="ghost" onClick={() => setView("changes")}>
          {t("banner.showConflicts")}
        </Button>
      )}
      <span className="flex-1" />
      <Button size="sm" onClick={() => open(repo, { mode: "abortOperation" })} disabled={!!busy}>
        {t("banner.abort")}
      </Button>
      {canSkip && (
        <Button
          size="sm"
          onClick={() => void act("skip")}
          loading={busy === "skip"}
          disabled={!!busy}
        >
          {op.kind === "am" ? t("banner.skipPatch") : t("banner.skip")}
        </Button>
      )}
      <Tooltip
        content={
          conflicts > 0
            ? t("banner.resolveFirst")
            : op.editing
              ? t("rebase.continueEditHint")
              : t(`banner.continueHint.${op.kind}`)
        }
      >
        <span className="inline-flex">
          <Button
            size="sm"
            variant="primary"
            disabled={conflicts > 0 || !!busy}
            loading={busy === "continue"}
            onClick={() => void act("continue")}
          >
            {op.kind === "merge" ? t("banner.commitMerge") : t("banner.continue")}
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}
