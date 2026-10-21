// Turning key events into shortcut strings and running the matching action.

import { useEffect } from "react";

import { allActions, type Action } from "./actions";
import { platform } from "./boot";
import { useSettings } from "./settings";

/** True for Cmd on macOS, Ctrl elsewhere (and not both). */
export function isMod(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return platform === "macos" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
};

/**
 * A key event as a shortcut string in the canonical order `Mod+Ctrl+Alt+Shift+Key`
 * (`Ctrl` only on macOS, where it differs from Mod); `null` for a bare modifier press.
 */
export function eventShortcut(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return null;
  const parts: string[] = [];
  const mod = platform === "macos" ? e.metaKey : e.ctrlKey;
  if (mod) parts.push("Mod");
  if (platform === "macos" && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  // `code` keeps letters and digits stable under Shift / Alt and other layouts' symbols.
  let key = KEY_NAMES[e.key] ?? e.key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

/** Normalizes a written shortcut (`shift+mod+k`) to the canonical form. */
export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.split("+").map((p) => p.trim());
  const key = parts.pop() ?? "";
  const has = (m: string) => parts.some((p) => p.toLowerCase() === m.toLowerCase());
  const out = ["Mod", "Ctrl", "Alt", "Shift"].filter(has);
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join("+");
}

/** The shortcut an action has: the user's binding (`""` = none) or its default. */
export function effectiveShortcut(
  action: Pick<Action, "id" | "shortcut">,
  bindings: Record<string, string>,
): string | null {
  const bound = bindings[action.id];
  if (bound !== undefined) return bound === "" ? null : normalizeShortcut(bound);
  return action.shortcut ? normalizeShortcut(action.shortcut) : null;
}

const isTyping = (el: Element | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    (el instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(el.type)) ||
    el instanceof HTMLTextAreaElement);

/**
 * One keydown listener runs registered actions by shortcut. While typing, only shortcuts
 * with Mod work; while a dialog is open, only those marked to work over dialogs (the palette
 * itself is a dialog). Unmodified keys never trigger actions in text fields.
 */
export function useShortcutDispatcher() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const pressed = eventShortcut(e);
      if (!pressed) return;
      if (isTyping(document.activeElement) && !pressed.startsWith("Mod")) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      const bindings = useSettings.getState().settings.shortcuts;
      const action = allActions().find((a) => effectiveShortcut(a, bindings) === pressed);
      if (!action || action.disabled) return;
      e.preventDefault();
      action.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
