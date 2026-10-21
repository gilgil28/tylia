import type { Platform } from "./boot";

const MAC_SYMBOLS: Record<string, string> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Enter: "↵",
};

/**
 * Splits a shortcut like `Mod+Shift+K` into the keys to display, using platform-correct
 * modifiers: `["⌘", "⇧", "K"]` on macOS, `["Ctrl", "Shift", "K"]` elsewhere.
 */
export function shortcutKeys(shortcut: string, platform: Platform): string[] {
  return shortcut.split("+").map((key) => {
    if (platform === "macos") return MAC_SYMBOLS[key] ?? key;
    return key === "Mod" ? "Ctrl" : key;
  });
}
