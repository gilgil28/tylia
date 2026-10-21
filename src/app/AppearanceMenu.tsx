import { Monitor, Moon, Settings, Sun, SunMoon } from "lucide-react";

import { t } from "@/i18n";
import type { ThemePreference } from "@/ipc";
import { IconButton } from "@/ui/IconButton";
import { Menu } from "@/ui/Menu";

import { useOverlays } from "./overlays";
import { useSettings } from "./settings";

export const themeOptions = [
  { value: "system", label: t("theme.system"), icon: Monitor },
  { value: "light", label: t("theme.light"), icon: Sun },
  { value: "dark", label: t("theme.dark"), icon: Moon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: unknown }[];

/** Title-bar menu: theme and title-bar style. */
export function AppearanceMenu() {
  const { settings, nativeTitleBarAtStart, update } = useSettings();
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton icon={SunMoon} label={t("titlebar.appearance")} />
      </Menu.Trigger>
      <Menu.Content align="end" className="w-60">
        <Menu.Label>{t("theme.label")}</Menu.Label>
        <Menu.RadioGroup
          value={settings.theme}
          onValueChange={(v) => update({ theme: v as ThemePreference })}
        >
          {themeOptions.map((o) => (
            <Menu.RadioItem key={o.value} value={o.value} icon={o.icon}>
              {o.label}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
        <Menu.Separator />
        <Menu.CheckboxItem
          checked={settings.nativeTitleBar}
          onCheckedChange={(v) => update({ nativeTitleBar: v })}
          onSelect={(e) => e.preventDefault()}
        >
          {t("settings.nativeTitleBar")}
        </Menu.CheckboxItem>
        {settings.nativeTitleBar !== nativeTitleBarAtStart && (
          <p className="px-2 pt-1 pb-1.5 pl-8 text-small text-fg-muted">
            {t("settings.restartRequired")}
          </p>
        )}
        <Menu.Separator />
        <Menu.Item
          icon={Settings}
          shortcut="Mod+,"
          onSelect={() => useOverlays.getState().openSettings()}
        >
          {t("actions.settings")}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
