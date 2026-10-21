// The row above the history: search (message, author, hash, path) and which branches it
// shows. Both only concern the history, so they live with it rather than in the toolbar.

import type { RepoLayout } from "@/app/workspace";
import { useWorkspace } from "@/app/workspace";
import { t } from "@/i18n";
import { SegmentedControl } from "@/ui/SegmentedControl";

import { HistorySearch } from "./HistorySearch";

export function HistoryFilterBar({ repo, layout }: { repo: string; layout: RepoLayout }) {
  const updateLayout = useWorkspace((s) => s.updateLayout);
  return (
    <div className="@container flex h-10 shrink-0 items-center gap-3 border-b border-line-subtle bg-app px-3">
      <HistorySearch repo={repo} recentPaths={layout.recentPaths} />
      <span className="flex-1" />
      <SegmentedControl
        aria-label={t("toolbar.scope")}
        value={layout.scope}
        onValueChange={(scope) => updateLayout(repo, { scope })}
        segments={[
          { value: "all", label: t("toolbar.allBranches") },
          { value: "head", label: t("toolbar.currentBranch") },
        ]}
      />
    </div>
  );
}
