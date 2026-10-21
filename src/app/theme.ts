import type { ThemePreference } from "@/ipc";

export type ResolvedTheme = "light" | "dark";

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}
