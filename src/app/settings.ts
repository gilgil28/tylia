import { create } from "zustand";

import { t } from "@/i18n";
import { ipc, isIpcError, type Settings, type ThemePreference } from "@/ipc";
import { toast } from "@/ui/Toast";

import { boot } from "./boot";
import { resolveTheme } from "./theme";

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(preference, systemDark.matches);
}

/** UI font sizes offered in Settings (DESIGN §4.4: 12/13/14/15). */
export const UI_FONT_SIZES = [12, 13, 14, 15] as const;

/** Density and font size are CSS variables on <html> (public/boot.js sets them first). */
function applyLayout(settings: Settings) {
  const root = document.documentElement;
  root.dataset.density = settings.density;
  const size = UI_FONT_SIZES.includes(settings.uiFontSize as 13) ? settings.uiFontSize : 13;
  root.style.setProperty("--ui-font-size", `${size}px`);
}

interface SettingsState {
  settings: Settings;
  /** `nativeTitleBar` as the window was created; changing it applies on restart. */
  nativeTitleBarAtStart: boolean;
  update(patch: Partial<Settings>): void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: boot.settings,
  nativeTitleBarAtStart: boot.settings.nativeTitleBar,
  update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    applyTheme(settings.theme);
    applyLayout(settings);
    ipc.setSettings(settings).catch((err: unknown) =>
      toast({
        kind: "error",
        title: t("settings.saveFailed"),
        error: isIpcError(err) ? err : { message: String(err) },
      }),
    );
  },
}));

systemDark.addEventListener("change", () => applyTheme(useSettings.getState().settings.theme));
