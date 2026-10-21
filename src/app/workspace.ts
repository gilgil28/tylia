// Open tabs, recent repositories and per-repository layout, persisted through the backend
// (`ui-state.json`) and restored on start.

import { create } from "zustand";

import { ipc, type LogScope, type RepoInfo } from "@/ipc";

export type Tab =
  { id: string; kind: "welcome" } | { id: string; kind: "repo"; path: string; name: string };

export interface RecentRepo {
  path: string;
  name: string;
  /** ms since epoch */
  lastOpened: number;
}

export type ColumnId = "graph" | "description" | "author" | "date" | "hash";

export interface RepoLayout {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** Height of the commit-details area under the history; 0 = a share of the window. */
  detailsHeight: number;
  /** Width of the file list inside the details area. */
  filesWidth: number;
  columnWidths: Partial<Record<ColumnId, number>>;
  hiddenColumns: ColumnId[];
  collapsedSections: string[];
  scope: LogScope;
  fileView: "flat" | "tree";
  /** "Not now" on the commit-graph offer. */
  commitGraphDismissed: boolean;
  /** Recent path searches, newest first (suggested in the history search). */
  recentPaths: string[];
}

export const DEFAULT_LAYOUT: RepoLayout = {
  sidebarWidth: 240,
  sidebarCollapsed: false,
  detailsHeight: 0,
  filesWidth: 320,
  columnWidths: {},
  hiddenColumns: [],
  collapsedSections: ["tags", "stashes", "submodules"],
  scope: "all",
  fileView: "flat",
  commitGraphDismissed: false,
  recentPaths: [],
};

export type DiffMode = "unified" | "split";

interface Persisted {
  version: 1;
  tabs: Tab[];
  activeTabId: string;
  recent: RecentRepo[];
  layouts: Record<string, Partial<RepoLayout>>;
  diffMode: DiffMode;
  /** Folder last used as the parent of a clone or new repository. */
  lastParentFolder: string | null;
  /** Recent commit messages per repository, newest first. */
  recentMessages: Record<string, string[]>;
}

interface WorkspaceState extends Persisted {
  loaded: boolean;
  newTab(): void;
  activate(id: string): void;
  activateIndex(index: number): void;
  closeTab(id: string): void;
  moveTab(from: number, to: number): void;
  /** Shows `repo` in the active welcome tab, an existing tab, or a new tab. */
  openRepo(repo: RepoInfo): void;
  removeRecent(path: string): void;
  layout(path: string): RepoLayout;
  updateLayout(path: string, patch: Partial<RepoLayout>): void;
  setDiffMode(mode: DiffMode): void;
  setLastParentFolder(folder: string): void;
  addRecentMessage(repo: string, message: string): void;
}

const MAX_RECENT = 30;
const MAX_RECENT_MESSAGES = 10;
let nextId = 1;
const newId = () => `tab-${Date.now().toString(36)}-${nextId++}`;

function welcomeTab(): Tab {
  return { id: newId(), kind: "welcome" };
}

function initial(): Persisted {
  const tab = welcomeTab();
  return {
    version: 1,
    tabs: [tab],
    activeTabId: tab.id,
    recent: [],
    layouts: {},
    diffMode: "unified",
    lastParentFolder: null,
    recentMessages: {},
  };
}

/** Accepts a stored document only if it has the expected shape; otherwise starts fresh. */
function restore(raw: unknown): Persisted {
  const fresh = initial();
  if (typeof raw !== "object" || raw === null || (raw as Persisted).version !== 1) return fresh;
  const p = raw as Partial<Persisted>;
  const tabs = Array.isArray(p.tabs)
    ? p.tabs.filter(
        (t): t is Tab =>
          typeof t === "object" &&
          t !== null &&
          typeof t.id === "string" &&
          (t.kind === "welcome" || (t.kind === "repo" && typeof t.path === "string")),
      )
    : [];
  if (tabs.length === 0) tabs.push(welcomeTab());
  return {
    version: 1,
    tabs,
    activeTabId: tabs.some((t) => t.id === p.activeTabId) ? p.activeTabId! : tabs[0]!.id,
    recent: Array.isArray(p.recent) ? p.recent.filter((r) => typeof r?.path === "string") : [],
    layouts: typeof p.layouts === "object" && p.layouts !== null ? p.layouts : {},
    diffMode: p.diffMode === "split" ? "split" : "unified",
    lastParentFolder: typeof p.lastParentFolder === "string" ? p.lastParentFolder : null,
    recentMessages:
      typeof p.recentMessages === "object" && p.recentMessages !== null ? p.recentMessages : {},
  };
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  ...initial(),
  loaded: false,

  newTab() {
    const tab = welcomeTab();
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  activate(id) {
    if (get().tabs.some((t) => t.id === id)) set({ activeTabId: id });
  },

  activateIndex(index) {
    const tabs = get().tabs;
    // Mod+9 always means the last tab, as in browsers.
    const tab = index === 8 ? tabs[tabs.length - 1] : tabs[index];
    if (tab) set({ activeTabId: tab.id });
  },

  closeTab(id) {
    const { tabs, activeTabId } = get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const rest = tabs.filter((t) => t.id !== id);
    if (rest.length === 0) rest.push(welcomeTab());
    const nextActive =
      activeTabId === id ? rest[Math.min(index, rest.length - 1)]!.id : activeTabId;
    set({ tabs: rest, activeTabId: nextActive });
  },

  moveTab(from, to) {
    const tabs = [...get().tabs];
    const [moved] = tabs.splice(from, 1);
    if (!moved) return;
    tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, moved);
    set({ tabs });
  },

  openRepo(repo) {
    const { tabs, activeTabId, recent } = get();
    const entry: RecentRepo = { path: repo.path, name: repo.name, lastOpened: Date.now() };
    const nextRecent = [entry, ...recent.filter((r) => r.path !== repo.path)].slice(0, MAX_RECENT);
    const existing = tabs.find((t) => t.kind === "repo" && t.path === repo.path);
    if (existing) {
      set({ activeTabId: existing.id, recent: nextRecent });
      return;
    }
    const tab: Tab = { id: newId(), kind: "repo", path: repo.path, name: repo.name };
    const active = tabs.find((t) => t.id === activeTabId);
    const nextTabs =
      active?.kind === "welcome"
        ? tabs.map((t) => (t.id === activeTabId ? tab : t))
        : [...tabs, tab];
    set({ tabs: nextTabs, activeTabId: tab.id, recent: nextRecent });
  },

  removeRecent(path) {
    set((s) => ({ recent: s.recent.filter((r) => r.path !== path) }));
  },

  layout(path) {
    return { ...DEFAULT_LAYOUT, ...get().layouts[path] };
  },

  updateLayout(path, patch) {
    set((s) => ({ layouts: { ...s.layouts, [path]: { ...s.layouts[path], ...patch } } }));
  },

  setDiffMode(diffMode) {
    set({ diffMode });
  },

  setLastParentFolder(lastParentFolder) {
    set({ lastParentFolder });
  },

  addRecentMessage(repo, message) {
    set((s) => {
      const list = [message, ...(s.recentMessages[repo] ?? []).filter((m) => m !== message)];
      return {
        recentMessages: { ...s.recentMessages, [repo]: list.slice(0, MAX_RECENT_MESSAGES) },
      };
    });
  },
}));

/** Loads the persisted workspace, then saves every change (debounced). */
export async function initWorkspace() {
  let raw: unknown = null;
  try {
    raw = await ipc.loadUiState();
  } catch {
    // Unreadable state: start fresh (the backend keeps the old file).
  }
  useWorkspace.setState({ ...restore(raw), loaded: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  useWorkspace.subscribe((s) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const snapshot: Persisted = {
        version: 1,
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        recent: s.recent,
        layouts: s.layouts,
        diffMode: s.diffMode,
        lastParentFolder: s.lastParentFolder,
        recentMessages: s.recentMessages,
      };
      void ipc.saveUiState(snapshot).catch(() => {});
    }, 300);
  });
}

export const testing = { restore, initial };
