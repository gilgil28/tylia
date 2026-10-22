// App-wide actions: tabs, opening repositories, palette, Settings, theme and density.

import {
  CopyPlus,
  Download,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Keyboard,
  Monitor,
  Moon,
  RefreshCw,
  Rows3,
  Settings as SettingsIcon,
  SquareTerminal,
  Sun,
  X,
} from "lucide-react";

import { useUpdate } from "@/features/update/update";
import { openRepoAt, pickAndOpenRepo } from "@/features/welcome/open";
import { t } from "@/i18n";

import { useRegisterActions, type Action } from "./actions";
import { distribution, platform } from "./boot";
import { installCli } from "./installCli";
import { useOverlays } from "./overlays";
import { useSettings } from "./settings";
import { useWorkspace } from "./workspace";

/** Shows the welcome screen (reusing a welcome tab) and opens one of its dialogs. */
function welcomeDialog(dialog: "clone" | "create") {
  const ws = useWorkspace.getState();
  const welcome = ws.tabs.find((tab) => tab.kind === "welcome");
  if (welcome) ws.activate(welcome.id);
  else ws.newTab();
  useOverlays.getState().setWelcomeDialog(dialog);
}

export function useAppActions() {
  const ws = useWorkspace();
  const { settings, update } = useSettings();
  const overlays = useOverlays();
  // Cmd+Tab is the macOS app switcher; tabs cycle with Ctrl+Tab there, as in browsers.
  const nextTab = platform === "macos" ? "Ctrl+Tab" : "Mod+Tab";

  const cycle = (step: number) => {
    const i = ws.tabs.findIndex((tab) => tab.id === ws.activeTabId);
    const n = ws.tabs.length;
    ws.activate(ws.tabs[(i + step + n) % n]!.id);
  };

  const actions: Action[] = [
    {
      id: "app.palette",
      title: t("actions.palette"),
      group: "app",
      shortcut: "Mod+K",
      hidden: true,
      run: () => overlays.setPalette(true),
    },
    {
      id: "app.settings",
      title: t("actions.settings"),
      group: "app",
      icon: SettingsIcon,
      shortcut: "Mod+,",
      keywords: ["preferences", "options"],
      run: () => overlays.openSettings(),
    },
    {
      id: "app.keyboard",
      title: t("actions.keyboard"),
      group: "app",
      icon: Keyboard,
      keywords: ["shortcuts", "keys", "bindings"],
      run: () => overlays.openSettings("keyboard"),
    },
    {
      id: "app.checkUpdates",
      title: t("actions.checkUpdates"),
      group: "app",
      icon: RefreshCw,
      keywords: ["update", "upgrade", "version", "release"],
      // Flathub updates a Flatpak; Settings → General says so instead.
      hidden: distribution === "flatpak",
      run: () => void useUpdate.getState().check("palette"),
    },
    // Elsewhere the installer or the package puts the command on PATH.
    ...(platform === "macos"
      ? [
          {
            id: "app.installCli",
            title: t("actions.installCli"),
            group: "app",
            icon: SquareTerminal,
            keywords: ["command line", "cli", "shell", "path", "terminal"],
            run: installCli,
          } satisfies Action,
        ]
      : []),
    {
      id: "app.openRepo",
      title: t("actions.openRepo"),
      group: "app",
      icon: FolderOpen,
      shortcut: "Mod+O",
      run: () => void pickAndOpenRepo(),
    },
    {
      id: "app.cloneRepo",
      title: t("actions.cloneRepo"),
      group: "app",
      icon: Download,
      run: () => welcomeDialog("clone"),
    },
    {
      id: "app.createRepo",
      title: t("actions.createRepo"),
      group: "app",
      icon: FolderPlus,
      keywords: ["init", "new"],
      run: () => welcomeDialog("create"),
    },
    {
      id: "tabs.new",
      title: t("actions.newTab"),
      group: "tabs",
      icon: CopyPlus,
      shortcut: "Mod+T",
      run: () => ws.newTab(),
    },
    {
      id: "tabs.close",
      title: t("actions.closeTab"),
      group: "tabs",
      icon: X,
      shortcut: "Mod+W",
      run: () => ws.closeTab(ws.activeTabId),
    },
    {
      id: "tabs.next",
      title: t("actions.nextTab"),
      group: "tabs",
      shortcut: nextTab,
      disabled: ws.tabs.length < 2,
      run: () => cycle(1),
    },
    {
      id: "tabs.previous",
      title: t("actions.previousTab"),
      group: "tabs",
      shortcut: `${nextTab.split("+")[0]}+Shift+Tab`,
      disabled: ws.tabs.length < 2,
      run: () => cycle(-1),
    },
    ...Array.from({ length: 9 }, (_, i): Action => ({
      id: `tabs.goto${i + 1}`,
      title: t("actions.gotoTab", { n: i + 1 }),
      group: "tabs",
      shortcut: `Mod+${i + 1}`,
      hidden: true,
      run: () => ws.activateIndex(i),
    })),
    ...(
      [
        ["system", Monitor],
        ["light", Sun],
        ["dark", Moon],
      ] as const
    ).map(([theme, icon]): Action => ({
      id: `theme.${theme}`,
      title: t(`actions.theme.${theme}`),
      group: "view",
      icon,
      keywords: ["theme", "appearance"],
      disabled: settings.theme === theme,
      run: () => update({ theme }),
    })),
    {
      id: "view.density",
      title:
        settings.density === "compact" ? t("actions.comfortableRows") : t("actions.compactRows"),
      group: "view",
      icon: Rows3,
      keywords: ["density", "compact", "comfortable"],
      run: () => update({ density: settings.density === "compact" ? "comfortable" : "compact" }),
    },
    // Recent repositories: only while searching (they'd crowd the empty palette).
    ...ws.recent.map((r): Action => ({
      id: `recent.${r.path}`,
      title: t("actions.openRecent", { name: r.name }),
      group: "repository",
      icon: FolderGit2,
      keywords: [r.path],
      searchOnly: true,
      run: () => void openRepoAt(r.path),
    })),
  ];
  useRegisterActions("app", actions);
}
