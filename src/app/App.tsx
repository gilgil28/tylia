import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

import { AskpassHost } from "@/features/askpass/AskpassHost";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { RepoView } from "@/features/repo/RepoView";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { UpdateDialog } from "@/features/update/UpdateDialog";
import { useStartupUpdateCheck } from "@/features/update/useStartupUpdateCheck";
import { WelcomeScreen } from "@/features/welcome/WelcomeScreen";
import { Toaster } from "@/ui/Toast";
import { TooltipProvider } from "@/ui/Tooltip";

import { FolderDrop } from "./FolderDrop";
import { queryClient } from "./query-client";
import { useRoute } from "./route";
import { TitleBar } from "./TitleBar";
import { useAppActions } from "./appActions";
import { useShortcutDispatcher } from "./keyboard";
import { useRepoEvents } from "./useRepoEvents";
import { useWorkspace } from "./workspace";

// Dev-only page. `import.meta.env` is inlined at build time (unlike an imported constant),
// so release builds drop the import and the chunk. Keep in sync with `galleryEnabled`.
const Gallery =
  import.meta.env.DEV || import.meta.env.MODE === "web"
    ? lazy(() => import("@/ui/gallery/Gallery"))
    : null;

/** Every tab stays mounted (hidden when inactive) so switching is instant. */
function Tabs() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  return (
    <>
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            hidden={!active}
            className="min-h-0 flex-1 flex-col [&:not([hidden])]:flex"
          >
            {tab.kind === "welcome" ? (
              active && <WelcomeScreen />
            ) : (
              <RepoView tabId={tab.id} path={tab.path} active={active} />
            )}
          </div>
        );
      })}
    </>
  );
}

function Shell() {
  const route = useRoute();
  useShortcutDispatcher();
  useAppActions();
  useRepoEvents();
  useStartupUpdateCheck();
  return (
    <div className="flex h-full flex-col bg-app text-fg">
      <TitleBar />
      {route === "gallery" && Gallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : (
        <Tabs />
      )}
      <FolderDrop />
      <CommandPalette />
      <SettingsDialog />
      <UpdateDialog />
      <AskpassHost />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Shell />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
