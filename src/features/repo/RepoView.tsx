import { useQuery } from "@tanstack/react-query";
import { FolderX, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useWorkspace } from "@/app/workspace";
import { BranchDialogs } from "@/features/branching/BranchDialogs";
import { OperationBanner } from "@/features/branching/OperationBanner";
import { ChangesView } from "@/features/changes/ChangesView";
import { DetailsPane } from "@/features/commit-details/DetailsPane";
import { useFileActions } from "@/features/file-view/fileActions";
import { FileView } from "@/features/file-view/FileView";
import { useHistoryStream } from "@/features/history/history-stream";
import { useRebaseActions } from "@/features/rebase/rebaseActions";
import { HistoryFilterBar } from "@/features/history/HistoryFilterBar";
import { RepoSettingsDialog } from "@/features/repo-settings/RepoSettingsDialog";
import { HistoryView } from "@/features/history/HistoryView";
import { ApplyPatchDialog } from "@/features/patch/ApplyPatchDialog";
import { Sidebar } from "@/features/sidebar/Sidebar";
import { RepoToolbar } from "@/features/toolbar/RepoToolbar";
import { t } from "@/i18n";
import { ipc, isIpcError } from "@/ipc";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { SplitPane } from "@/ui/SplitPane";

import { createRepoStore, RepoStoreContext, useRepoUi } from "./repo-store";
import { useRepoActions } from "./repoActions";

interface RepoViewProps {
  tabId: string;
  path: string;
  /** The view is on screen (inactive tabs stay mounted, hidden). */
  active: boolean;
}

export function RepoView({ tabId, path, active }: RepoViewProps) {
  const [store] = useState(() => createRepoStore(path));
  const opened = useQuery({
    queryKey: ["open", path],
    queryFn: () => ipc.openRepo(path),
    retry: false,
    staleTime: Infinity,
  });

  if (opened.isError) {
    const err = opened.error;
    const missing =
      isIpcError(err) && (err.kind === "notARepository" || err.kind === "bareRepository");
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-app p-6">
        <EmptyState
          icon={FolderX}
          title={missing ? t("repo.missingTitle") : t("repo.loadFailed")}
          description={missing ? t("repo.missingBody", { path }) : undefined}
          actions={
            <>
              <Button icon={RotateCw} onClick={() => void opened.refetch()}>
                {t("repo.retry")}
              </Button>
              <Button icon={X} onClick={() => useWorkspace.getState().closeTab(tabId)}>
                {t("repo.closeTab")}
              </Button>
            </>
          }
        />
        {!missing && (
          <ErrorPanel
            className="w-112 max-w-full"
            message={isIpcError(err) ? err.message : String(err)}
            command={isIpcError(err) ? err.command : null}
            stderr={isIpcError(err) ? err.stderr : null}
          />
        )}
      </div>
    );
  }
  if (!opened.data) return <div className="flex-1 bg-app" />;
  return (
    <RepoStoreContext.Provider value={store}>
      <RepoLoaded path={path} active={active} />
    </RepoStoreContext.Provider>
  );
}

function RepoLoaded({ path, active }: { path: string; active: boolean }) {
  const layout = useWorkspace(useShallow((s) => s.layout(path)));
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const [focusToken, setFocusToken] = useState(0);
  const view = useRepoUi((s) => s.view);

  const refs = useQuery({ queryKey: ["refs", path], queryFn: () => ipc.getRefs(path) });
  const status = useQuery({ queryKey: ["status", path], queryFn: () => ipc.getStatus(path) });
  const stream = useHistoryStream(path, { scope: layout.scope, order: "date" }, refs.data);

  useEffect(() => {
    void ipc.watchRepo(path);
    return () => void ipc.unwatchRepo(path);
  }, [path]);

  useRepoActions(path, refs.data, status.data, active);
  useRebaseActions(path, refs.data, status.data, active);
  useFileActions(path, active);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RepoToolbar
        repo={path}
        refs={refs.data}
        status={status.data}
        layout={layout}
        active={active}
      />
      <OperationBanner repo={path} refs={refs.data} status={status.data} />
      <BranchDialogs repo={path} refs={refs.data} status={status.data} />
      <ApplyPatchDialog repo={path} />
      <RepoSettingsDialog repo={path} name={path.split(/[\\/]/).pop() ?? path} />
      <SplitPane
        className="flex-1"
        size={layout.sidebarWidth}
        onSizeChange={(sidebarWidth) => updateLayout(path, { sidebarWidth })}
        min={180}
        max={400}
        collapsed={layout.sidebarCollapsed}
        first={<Sidebar repo={path} refs={refs.data} status={status.data} />}
        second={
          view === "changes" ? (
            <ChangesView repo={path} status={status.data} layout={layout} />
          ) : view === "file" ? (
            <FileView repo={path} layout={layout} active={active} />
          ) : (
            <div className="flex h-full flex-col">
              <HistoryFilterBar repo={path} layout={layout} />
              <div className="min-h-0 flex-1">
                <BottomSplit
                  history={
                    <HistoryView
                      repo={path}
                      stream={stream}
                      refs={refs.data}
                      status={status.data}
                      layout={layout}
                      onActivate={() => setFocusToken((n) => n + 1)}
                      active={active}
                    />
                  }
                  details={<DetailsPane repo={path} layout={layout} focusToken={focusToken} />}
                  height={layout.detailsHeight}
                  onHeight={(detailsHeight) => updateLayout(path, { detailsHeight })}
                />
              </div>
            </div>
          )
        }
      />
    </div>
  );
}

const DETAILS_SHARE = 0.42;

/** History on top, details below; the split is sized by the details' height. */
function BottomSplit({
  history,
  details,
  height,
  onHeight,
}: {
  history: React.ReactNode;
  details: React.ReactNode;
  height: number;
  onHeight: (h: number) => void;
}) {
  const [total, setTotal] = useState(0);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setTotal(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const min = 160;
  const max = Math.max(min, total - 120);
  // Until the user drags the divider, details take a share of the height.
  const wanted = height > 0 ? height : Math.round(total * DETAILS_SHARE);
  const top = Math.max(120, total - Math.min(Math.max(wanted, min), max));
  return (
    <div ref={setEl} className="h-full">
      {total > 0 && (
        <SplitPane
          direction="vertical"
          size={top}
          onSizeChange={(h) => onHeight(total - h)}
          min={120}
          max={Math.max(120, total - min)}
          first={history}
          second={details}
        />
      )}
    </div>
  );
}
