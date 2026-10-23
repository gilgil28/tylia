// The action registry: everything the user can do by name. The command palette lists the
// registered actions, the keyboard dispatcher runs them by shortcut (with the user's
// rebindings from Settings → Keyboard), and Settings lists them for rebinding.
//
// Components register what they offer while they're on screen:
//   useRegisterActions("repo-toolbar", [{ id: "remote.fetch", … }], active)

import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";

export type ActionGroup =
  "app" | "tabs" | "view" | "repository" | "remote" | "branch" | "history" | "changes" | "file";

export interface Action {
  /** Stable id, also the key for shortcut rebinding, e.g. `remote.fetch`. */
  id: string;
  title: string;
  group: ActionGroup;
  icon?: LucideIcon;
  /** Default shortcut (`Mod+Shift+F`; `Mod` is Cmd on macOS, Ctrl elsewhere). */
  shortcut?: string;
  /** Extra words the palette matches. */
  keywords?: string[];
  /** Shown but not runnable (the palette greys it out; its shortcut does nothing). */
  disabled?: boolean;
  /** Not listed in the palette (shortcut-only, e.g. Mod+1…9). */
  hidden?: boolean;
  /** Listed only once the palette has a query (e.g. one item per branch or recent repo). */
  searchOnly?: boolean;
  /** Its shortcut does nothing in text fields, which keep it (Mod+Z undoes typing there). */
  notWhileTyping?: boolean;
  run: () => void;
}

/** What Settings → Keyboard lists for an action, even while it isn't registered. */
export type KnownAction = Pick<Action, "id" | "title" | "group" | "shortcut" | "icon">;

interface Registry {
  /** Actions by source (a registering component), in registration order. */
  sources: Map<string, Action[]>;
  /** Every bindable action registered this session (not the per-item search entries). */
  known: Map<string, KnownAction>;
  set(source: string, actions: Action[] | null): void;
}

export const useActionRegistry = create<Registry>((set) => ({
  sources: new Map(),
  known: new Map(),
  set(source, actions) {
    set((s) => {
      const sources = new Map(s.sources);
      if (actions && actions.length > 0) sources.set(source, actions);
      else sources.delete(source);
      let known = s.known;
      for (const a of actions ?? []) {
        if (a.searchOnly || known.get(a.id)?.title === a.title) continue;
        if (known === s.known) known = new Map(known);
        known.set(a.id, {
          id: a.id,
          title: a.title,
          group: a.group,
          shortcut: a.shortcut,
          icon: a.icon,
        });
      }
      return { sources, known };
    });
  },
}));

/** Every registered action (later sources win on duplicate ids). */
export function allActions(sources: Map<string, Action[]> = useActionRegistry.getState().sources) {
  const byId = new Map<string, Action>();
  for (const list of sources.values()) for (const a of list) byId.set(a.id, a);
  return [...byId.values()];
}

/**
 * Registers `actions` under `source` while `active` (e.g. only for the visible repository).
 * Re-registers on every render, so the actions' closures stay current.
 */
export function useRegisterActions(source: string, actions: Action[], active = true) {
  useEffect(() => {
    useActionRegistry.getState().set(source, active ? actions : null);
  });
  useEffect(() => () => useActionRegistry.getState().set(source, null), [source]);
}
