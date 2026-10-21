// Mock backend for browser mode (`pnpm dev:web`) and Playwright screenshots. Serves the
// demo repository in fixtures/demo.json (regenerate with `pnpm fixture`); settings and UI
// state persist in localStorage (the settings key is also read by public/boot.js).

import type { Backend } from "../backend";
import type { CommitDetails } from "../bindings/CommitDetails";
import type { FileDiff } from "../bindings/FileDiff";
import type { HistoryRow } from "../bindings/HistoryRow";
import type { IpcError } from "../bindings/IpcError";
import type { RefsSnapshot } from "../bindings/RefsSnapshot";
import type { RepoInfo } from "../bindings/RepoInfo";
import type { WorkingStatus } from "../bindings/WorkingStatus";
import demo from "./fixtures/demo.json";
import { askpass } from "./askpass";
import { branchingMock } from "./branching";
import { flowMock } from "./flow";
import { rebaseMock } from "./rebase";
import { fileViewMock } from "./file-view";
import { remoteMock, transfer } from "./remote";
import { gitInfo } from "./fixtures";

interface Fixture {
  repo: RepoInfo;
  refs: RefsSnapshot;
  status: WorkingStatus;
  history: HistoryRow[];
  /** Straight graph segments for the whole history (`[lane, color, start, end]`). */
  segments: [number, number, number, number][];
  commits: Record<string, CommitDetails>;
  diffs: Record<string, FileDiff>;
}

const fixture = demo as unknown as Fixture;
/** Working-copy state; the mock's writes change it. */
let status: WorkingStatus = structuredClone(fixture.status);
/** Whether the demo repository has a commit-graph (writing one sets it). */
let commitGraph = false;
/** Branches and remotes; push, pull and remote management change them. */
let refs: RefsSnapshot = structuredClone(fixture.refs);

function stage(path: string) {
  status = {
    ...status,
    entries: status.entries.map((e) =>
      e.path === path && e.unstaged
        ? { ...e, staged: e.unstaged === "untracked" ? "added" : e.unstaged, unstaged: null }
        : e,
    ),
  };
}

function unstage(path: string) {
  status = {
    ...status,
    entries: status.entries.map((e) =>
      e.path === path && e.staged
        ? { ...e, unstaged: e.staged === "added" ? "untracked" : e.staged, staged: null }
        : e,
    ),
  };
}
const SETTINGS_KEY = "tylia.web.settings";
const UI_KEY = "tylia.web.ui";
const HOME = "/home/ada";

/** Other recent repositories shown on the welcome screen. */
const OTHER_REPOS: Record<string, string | null> = {
  "/home/ada/code/website": "main",
  "/home/ada/code/infra/terraform-modules": "develop",
  "/home/ada/old/prototype": null,
};

const DEFAULT_UI = {
  version: 1,
  tabs: [{ id: "tab-welcome", kind: "welcome" }],
  activeTabId: "tab-welcome",
  recent: [
    { path: fixture.repo.path, name: fixture.repo.name, lastOpened: Date.now() - 3_600_000 },
    { path: "/home/ada/code/website", name: "website", lastOpened: Date.now() - 86_400_000 },
    {
      path: "/home/ada/code/infra/terraform-modules",
      name: "terraform-modules",
      lastOpened: Date.now() - 6 * 86_400_000,
    },
    {
      path: "/home/ada/old/prototype",
      name: "prototype",
      lastOpened: Date.now() - 40 * 86_400_000,
    },
  ],
  layouts: {},
  diffMode: "unified",
  lastParentFolder: null,
};

const notARepo = (path: string): IpcError => ({
  kind: "notARepository",
  message: `${path} is not a Git repository`,
  command: null,
  stderr: null,
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function storage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private window): state lasts for this page only.
  }
}

function repoFor(path: string): RepoInfo {
  if (path === fixture.repo.path || path.endsWith(fixture.repo.name)) return fixture.repo;
  if (path in OTHER_REPOS && OTHER_REPOS[path] !== null) {
    const name = path.split("/").pop()!;
    return { path, name, gitDir: `${path}/.git` };
  }
  throw notARepo(path);
}

const cancelled = new Set<number>();

const branching = branchingMock(
  {
    get: () => refs,
    set: (next) => {
      refs = next;
    },
  },
  {
    get: () => status,
    set: (next) => {
      status = next;
    },
  },
  (id, onProgress) => transfer(id, onProgress, cancelled, ["Writing objects"]),
);

export const backend: Backend = {
  gitVersion: async () => gitInfo,
  setSettings: async (settings) => store(SETTINGS_KEY, settings),
  loadUiState: async () => {
    const params = new URLSearchParams(location.search);
    // `?repo=demo` opens the demo repository directly (screenshots).
    if (params.get("repo") === "demo") {
      return {
        ...DEFAULT_UI,
        tabs: [{ id: "tab-demo", kind: "repo", path: fixture.repo.path, name: fixture.repo.name }],
        activeTabId: "tab-demo",
      };
    }
    return storage(UI_KEY, DEFAULT_UI);
  },
  saveUiState: async (state) => {
    if (!new URLSearchParams(location.search).has("repo")) store(UI_KEY, state);
  },
  // `?update=available|failed` simulates the release server (screenshots, e2e).
  checkUpdate: async () => {
    await new Promise((r) => setTimeout(r, 150));
    const mode = new URLSearchParams(location.search).get("update");
    if (mode === "failed") {
      throw {
        kind: "updateFailed",
        message: "error sending request for url (https://github.com/…/latest.json)",
        command: null,
        stderr: null,
      } satisfies IpcError;
    }
    if (mode !== "available") return null;
    return {
      version: "0.2.0",
      currentVersion: import.meta.env.VITE_APP_VERSION,
      date: "2026-11-02T10:00:00Z",
      notes: "### Added\n- git-flow helpers\n\n### Fixed\n- Faster status on large repositories",
      canInstall: true,
    };
  },
  openDownloadPage: async () => {},
  installUpdate: async (onProgress) => {
    const total = 12_000_000;
    for (let downloaded = 0; downloaded <= total; downloaded += 3_000_000) {
      onProgress({ downloaded, total });
      await new Promise((r) => setTimeout(r, 100));
    }
  },

  openRepo: async (path) => repoFor(path),
  initRepo: async (path) => ({ path, name: path.split(/[/\\]/).pop()!, gitDir: `${path}/.git` }),
  repoBranch: async (path) => {
    if (path === fixture.repo.path) return fixture.refs.head.branch;
    if (path in OTHER_REPOS && OTHER_REPOS[path] !== null) return OTHER_REPOS[path]!;
    throw notARepo(path);
  },
  getRefs: async () => refs,
  getStatus: async () => status,
  getSubmodules: async () => [],
  hasCommitGraph: async () => commitGraph,
  getWorktrees: async (repo) => [
    {
      path: repo,
      head: fixture.refs.head.oid,
      branch: fixture.refs.head.branch,
      main: true,
      current: true,
      locked: false,
      prunable: false,
    },
    {
      path: `${repo}-hotfix`,
      head: fixture.history[3]?.oid ?? null,
      branch: "release/0.1",
      main: false,
      current: false,
      locked: false,
      prunable: false,
    },
  ],
  lfsStatus: async () => ({ used: false, installed: false }),
  submoduleUpdate: async (_repo, _paths, id, onProgress) =>
    transfer(id, onProgress, cancelled, ["Cloning into", "Receiving objects"]),
  writeCommitGraph: async () => {
    await delay(400);
    commitGraph = true;
  },
  streamHistory: async (_repo, options, _head, onEvent) => {
    const rows =
      options.scope === "head"
        ? fixture.history.filter((r) => reachableFromHead().has(r.oid))
        : fixture.history;
    await delay(30);
    onEvent({ kind: "rows", rows: rows.slice(0, 40), segments: fixture.segments, open: [] });
    await delay(30);
    onEvent({ kind: "rows", rows: rows.slice(40), segments: [], open: [] });
    onEvent({ kind: "done", total: rows.length });
  },
  getCommit: async (_repo, oid) => {
    const details = fixture.commits[oid];
    if (details) return details;
    const row = fixture.history.find((r) => r.oid === oid);
    // Not in the history: a stash (or another commit the mock doesn't know).
    const stash = refs.stashes.find((s) => s.oid === oid);
    const sig = row
      ? { name: row.authorName, email: row.authorEmail, time: row.time }
      : { name: "Ada Moreno", email: "ada@example.com", time: stash?.time ?? 0 };
    return {
      oid,
      parents: row?.parents ?? (fixture.refs.head.oid ? [fixture.refs.head.oid] : []),
      author: sig,
      committer: sig,
      subject: row?.subject ?? stash?.message ?? oid.slice(0, 7),
      body: "",
      files: [],
    };
  },
  getDiff: async (_repo, request) => {
    const t = request.target;
    const key = t.kind === "commit" ? `${t.oid}:${request.path}` : `${t.kind}:${request.path}`;
    const diff = fixture.diffs[key];
    // A rename's source comes from the request (file history shows the demo's rename).
    if (diff) return request.oldPath ? { ...diff, oldPath: request.oldPath } : diff;
    return {
      path: request.path,
      oldPath: request.oldPath,
      oldMode: null,
      newMode: null,
      content: { kind: "empty" },
      image: null,
      fingerprint: "",
    };
  },
  searchHistory: async (_repo, _options, field, query) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return fixture.history
      .filter((r) =>
        field === "message"
          ? r.subject.toLowerCase().includes(q)
          : field === "author"
            ? `${r.authorName} ${r.authorEmail}`.toLowerCase().includes(q)
            : field === "hash"
              ? r.oid.startsWith(q)
              : fixture.commits[r.oid]?.files.some((f) => {
                  const path = f.path.toLowerCase();
                  // Like the backend: a name matches anywhere, a path or folder by prefix.
                  return q.includes("/")
                    ? path === q.replace(/\/$/, "") || path.startsWith(q.replace(/\/?$/, "/"))
                    : path.split("/").includes(q) || path.split("/").pop()!.includes(q);
                }),
      )
      .map((r) => r.oid);
  },
  pathSuggestions: async (_repo, query, limit) => {
    const q = query.trim().toLowerCase();
    const files = new Set<string>(["src/legacy_parser.rs"]);
    for (const c of Object.values(fixture.commits)) for (const f of c.files) files.add(f.path);
    const dirs = new Set<string>();
    for (const f of files) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    const name = (p: string) => p.split("/").pop()!.toLowerCase();
    const rank = (p: string) =>
      name(p) === q
        ? 0
        : name(p).startsWith(q)
          ? 1
          : name(p).includes(q)
            ? 2
            : p.toLowerCase().includes(q)
              ? 3
              : 9;
    const items = [
      ...[...files].map((path) => ({
        path,
        kind: "file" as const,
        deleted: path === "src/legacy_parser.rs",
      })),
      ...[...dirs].map((d) => ({ path: `${d}/`, kind: "dir" as const, deleted: false })),
    ]
      .filter((s) => rank(s.path.replace(/\/$/, "")) < 9)
      .sort(
        (a, b) =>
          rank(a.path.replace(/\/$/, "")) - rank(b.path.replace(/\/$/, "")) ||
          a.path.length - b.path.length,
      )
      .slice(0, limit);
    return { items, indexing: false };
  },
  watchRepo: async () => {},
  unwatchRepo: async () => {},
  onRepoChanged: async () => () => {},

  stageFiles: async (_repo, paths) => paths.forEach(stage),
  unstageFiles: async (_repo, paths) => paths.forEach(unstage),
  stageAll: async () => status.entries.forEach((e) => stage(e.path)),
  unstageAll: async () => status.entries.forEach((e) => unstage(e.path)),
  discardFiles: async (_repo, tracked, untracked) => {
    const gone = new Set([...tracked, ...untracked]);
    status = {
      ...status,
      entries: status.entries
        .map((e) => (gone.has(e.path) ? { ...e, unstaged: null } : e))
        .filter((e) => e.staged || e.unstaged),
    };
  },
  applyLines: async () => {},
  commit: async () => {
    status = { ...status, entries: status.entries.filter((e) => e.unstaged) };
    status = { ...status, entries: status.entries.map((e) => ({ ...e, staged: null })) };
    return "0123456789abcdef0123456789abcdef01234567";
  },
  headMessage: async () => fixture.history[0]?.subject ?? null,
  ignorePattern: async () => {},
  openFile: async () => {},

  cloneRepo: async (request, operationId, onProgress) => {
    const phases = ["Counting objects", "Receiving objects", "Resolving deltas"];
    for (const phase of phases) {
      for (let percent = 0; percent <= 100; percent += 20) {
        if (cancelled.delete(operationId)) {
          throw { kind: "cancelled", message: "cancelled", command: null, stderr: null };
        }
        onProgress({ phase, percent, current: percent, total: 100 });
        await delay(60);
      }
    }
    const name = request.destination.split(/[/\\]/).pop()!;
    return { path: request.destination, name, gitDir: `${request.destination}/.git` };
  },
  cancelOperation: async (operationId) => {
    cancelled.add(operationId);
  },
  ...remoteMock(
    () => refs,
    (next) => {
      refs = next;
    },
    cancelled,
  ),
  ...branching,
  ...flowMock(branching),
  ...rebaseMock(
    fixture.history,
    fixture.commits,
    { get: () => refs, set: (next) => (refs = next) },
    { get: () => status, set: (next) => (status = next) },
  ),
  ...askpass,
  ...fileViewMock(fixture),

  pickFolder: async () => fixture.repo.path,
  revealInFileManager: async () => {},
  // `?terminal=missing` simulates a machine where no terminal is found.
  openTerminal: async () => {
    if (new URLSearchParams(location.search).get("terminal") === "missing") {
      throw {
        kind: "invalidInput",
        message: "No terminal was found. Choose one in Settings → General → Terminal.",
        command: null,
        stderr: null,
      } satisfies IpcError;
    }
    return "wt.exe";
  },
  homeDir: async () => HOME,
  onFolderDrop: async () => () => {},

  window: {
    show: async () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    isMaximized: async () => false,
    onResized: async () => () => {},
  },
};

let headSet: Set<string> | undefined;
/** Commits reachable from HEAD in the fixture (for the "current branch" filter). */
function reachableFromHead(): Set<string> {
  if (headSet) return headSet;
  const byOid = new Map(fixture.history.map((r) => [r.oid, r]));
  headSet = new Set();
  const stack = fixture.refs.head.oid ? [fixture.refs.head.oid] : [];
  while (stack.length) {
    const oid = stack.pop()!;
    if (headSet.has(oid)) continue;
    headSet.add(oid);
    stack.push(...(byOid.get(oid)?.parents ?? []));
  }
  return headSet;
}
