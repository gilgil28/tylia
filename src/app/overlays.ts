// App-wide overlays opened from anywhere (actions, menus): the command palette, Settings,
// and the welcome screen's Clone / Create dialogs.

import { create } from "zustand";

export type SettingsSection = "general" | "git" | "keyboard";

interface Overlays {
  palette: boolean;
  settings: SettingsSection | null;
  welcomeDialog: "clone" | "create" | null;
  setPalette(open: boolean): void;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
  setWelcomeDialog(dialog: "clone" | "create" | null): void;
}

export const useOverlays = create<Overlays>((set) => ({
  palette: false,
  settings: null,
  welcomeDialog: null,
  setPalette: (palette) => set({ palette }),
  openSettings: (section = "general") => set({ settings: section, palette: false }),
  closeSettings: () => set({ settings: null }),
  setWelcomeDialog: (welcomeDialog) => set({ welcomeDialog }),
}));
