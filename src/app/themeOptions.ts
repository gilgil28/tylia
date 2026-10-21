import { Monitor, Moon, Sun } from "lucide-react";

import { t } from "@/i18n";
import type { ThemePreference } from "@/ipc";

/** The theme choices, as shown in Settings → General. */
export const themeOptions = [
  { value: "system", label: t("theme.system"), icon: Monitor },
  { value: "light", label: t("theme.light"), icon: Sun },
  { value: "dark", label: t("theme.dark"), icon: Moon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: unknown }[];
