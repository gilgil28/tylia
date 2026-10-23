// Mock backend for browser mode (`pnpm dev:web`) and Playwright screenshots. Serves the
// demo repository in fixtures/demo.json (regenerate with `pnpm fixture`); settings and UI
// state persist in localStorage (the settings key is also read by public/boot.js).

import type { Backend } from "../backend";
import type { CommitDetails } from "../bindings/CommitDetails";
import type { DiscardBackup } from "../bindings/DiscardBackup";
import type { FileDiff } from "../bindings/FileDiff";
import type { HistoryRow } from "../bindings/HistoryRow";
import type { IpcError } from "../bindings/IpcError";
import type { RefsSnapshot } from "../bindings/RefsSnapshot";
import type { RepoConfig } from "../bindings/RepoConfig";
import type { RepoInfo } from "../bindings/RepoInfo";
import type { WorkingStatus } from "../bindings/WorkingStatus";
import demo from "./fixtures/demo.json";
import { askpass } from "./askpass";
import { branchingMock } from "./branching";
import { flowMock } from "./flow";
import { openRequestsMock } from "./open-requests";
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
/** Backups of discarded changes, newest first: one from earlier, and the mock's discards. */
let backups: DiscardBackup[] = [
  {
    id: "1700000000000",
    time: Math.floor(Date.now() / 1000) - 7200,
    kind: "lines",
    files: ["src/graph.rs"],
  },
];
/** Working-copy state; the mock's writes change it. */
let status: WorkingStatus = structuredClone(fixture.status);
/** Whether the demo repository has a commit-graph (writing one sets it). */
let commitGraph = false;
/** Branches and remotes; push, pull and remote management change them. */
let refs: RefsSnapshot = {
  ...structuredClone(fixture.refs),
  // Fetched 25 minutes before the page loaded.
  lastFetch: Math.floor(Date.now() / 1000) - 25 * 60,
};

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

const GLOBAL_NAME = { value: "Ada Moreno", scope: "global" as const };
const GLOBAL_EMAIL = { value: "ada@example.com", scope: "global" as const };
/** Repository settings; the remotes come from `refs`. */
let repoConfig: RepoConfig = {
  userName: GLOBAL_NAME,
  userEmail: GLOBAL_EMAIL,
  sshCommand: null,
  sshKey: null,
  credentialHelpers: [{ value: "manager", scope: "global" }],
  remotes: [],
};

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
  // `?hostgit=denied`: the Flatpak may not run the system's Git (no `flatpak override` yet).
  gitVersion: async () => {
    const settings = storage<{ hostGit?: boolean } | null>(SETTINGS_KEY, null);
    if (!settings?.hostGit) return gitInfo;
    if (new URLSearchParams(location.search).get("hostgit") === "denied") {
      throw {
        kind: "gitFailed",
        message: "git --version failed",
        command: "git --version",
        stderr: "Portal call failed: org.freedesktop.DBus.Error.ServiceUnknown",
      } satisfies IpcError;
    }
    return { ...gitInfo, raw: "git version 2.53.0", path: "git" };
  },
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
  writePerfReport: async (report) => console.info("perf report", report),
  // The browser preview has no journal: nothing to undo.
  undoState: async () => ({ undo: null, redo: null }),
  undo: async () => ({ undo: null, redo: null }),
  redo: async () => ({ undo: null, redo: null }),
  // Two of the demo's commits stand in for lost ones, so the details pane can show them.
  lostCommits: async () => {
    const [a, b] = fixture.history.slice(2, 4);
    const hour = Math.floor(Date.now() / 1000) - 3600;
    return [
      {
        oid: a!.oid,
        subject: a!.subject,
        author: a!.authorName,
        time: hour,
        reflog: "refs/heads/main",
        reason: "reset: moving to HEAD~2",
        commits: 2,
      },
      {
        oid: b!.oid,
        subject: b!.subject,
        author: b!.authorName,
        time: hour - 86_400,
        reflog: "HEAD",
        reason: "commit (amend): " + b!.subject,
        commits: 1,
      },
    ];
  },
  danglingCommits: async () => {
    const c = fixture.history[6]!;
    return [
      {
        oid: c.oid,
        subject: "On main: work in progress",
        author: c.authorName,
        time: c.time,
        reflog: null,
        reason: null,
        commits: 1,
      },
    ];
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
      canInstall: window.__TYLIA_BOOT__.distribution === "other",
    };
  },
  openDownloadPage: async () => {},
  openTokenPage: async () => {},
  // `?cli=installed|cancelled` simulates an existing link or a dismissed password prompt.
  installCli: async () => {
    const mode = new URLSearchParams(location.search).get("cli");
    return mode === "installed"
      ? "alreadyInstalled"
      : mode === "cancelled"
        ? "cancelled"
        : "installed";
  },
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
  // `?lfs=1`: the demo uses Git LFS for *.md and *.ts files; `?lfs=missing` without Git LFS.
  lfsStatus: async () => {
    const mode = new URLSearchParams(location.search).get("lfs");
    return { used: mode !== null, installed: mode === "1" };
  },
  lfsFiles: async (_repo, paths) =>
    new URLSearchParams(location.search).has("lfs")
      ? paths.filter((p) => /\.(md|ts)$/.test(p))
      : [],
  lfsTrack: async () => {},
  lfsPull: async (_repo, _id, onProgress) => {
    for (const percent of [0, 50, 100]) {
      onProgress({ phase: "Downloading LFS objects", percent, current: null, total: null });
      await delay(60);
    }
  },
  lfsLocks: async () => {
    await delay(100);
    return {
      ours: [{ id: "1", path: "notes.md", owner: "Ada Moreno", lockedAt: "2026-10-22T09:00:00Z" }],
      theirs: [
        { id: "2", path: "assets/logo.psd", owner: "Sam Okafor", lockedAt: "2026-10-21T15:30:00Z" },
      ],
    };
  },
  lfsSetLock: async () => {},
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
  // The demo's HEAD is signed; everything else isn't.
  verifyCommit: async (_repo, oid) =>
    oid === fixture.refs.head.oid
      ? {
          status: "good",
          signer: "ada@example.com",
          key: "SHA256:3mX9fQ2pLk7c0bV1yRzT8uWnE4hJ6gA5sD0oK2iU9qY",
        }
      : { status: "unsigned", signer: null, key: null },
  // The demo's first release tag is signed; other tags aren't.
  verifyTag: async (_repo, name) =>
    name === "v0.1.0"
      ? {
          status: "good",
          signer: "Ada Moreno <ada@example.com>",
          key: "E1F036B1FEE7221FC778ECEFB0B5E88696AFE6CB",
        }
      : { status: "unsigned", signer: null, key: null },
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
    if (tracked.length === 0) return null;
    backups.unshift({
      id: String(Date.now()),
      time: Math.floor(Date.now() / 1000),
      kind: "files",
      files: tracked,
    });
    return backups[0]!.id;
  },
  applyLines: async () => null,
  discardBackups: async () => backups,
  restoreBackup: async (_repo, id) => {
    const backup = backups.find((b) => b.id === id);
    backups = backups.filter((b) => b !== backup);
    return { restored: backup?.files ?? [], conflicts: [], skipped: [] };
  },
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
  // A rough stand-in for Rust's splitting (no quotes) and the common variables.
  customActionCommand: async (action, context) => [
    action.program,
    ...action.arguments
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((arg) => (arg === "{files}" ? context.files : [arg]))
      .map((arg) =>
        arg
          .replace("{repo}", context.repo)
          .replace("{sha}", context.sha ?? "")
          .replace("{shortSha}", (context.sha ?? "").slice(0, 7))
          .replace("{branch}", context.branch ?? "")
          .replace("{file}", context.files[0] ?? ""),
      ),
  ],
  // `?action=fail|missing|slow` simulates a failing, missing or long-running program.
  runCustomAction: async (action, context, operationId) => {
    const mode = new URLSearchParams(location.search).get("action");
    const [program, ...args] = await backend.customActionCommand(action, context);
    if (mode === "missing") {
      throw {
        kind: "invalidInput",
        message: `${program} wasn't found. Check the program in Settings → Actions.`,
        command: null,
        stderr: null,
      } satisfies IpcError;
    }
    if (mode === "slow") {
      for (let i = 0; i < 100 && !cancelled.has(operationId); i++) await delay(50);
      if (cancelled.has(operationId)) {
        throw {
          kind: "cancelled",
          message: `${action.name} was stopped.`,
          command: null,
          stderr: null,
        } satisfies IpcError;
      }
    }
    const failed = mode === "fail";
    return {
      program: program!,
      args,
      code: action.showOutput ? (failed ? 1 : 0) : null,
      stdout: action.showOutput && !failed ? "Checked 42 files: no problems.\n" : "",
      stderr: failed ? "error: tests/parser.rs:14: expected `;`\n" : "",
      truncated: false,
      waited: action.showOutput,
    };
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
  ...openRequestsMock,
  ...fileViewMock(fixture),

  pickFolder: async () => fixture.repo.path,
  pickFile: async (_title, _defaultPath, filters) =>
    filters?.some((f) => f.extensions.includes("patch"))
      ? "C:/Users/ada/Downloads/0001-parser-handle-empty-input.patch"
      : "C:/Users/ada/.ssh/id_ed25519",
  // `?token=bad` simulates a refused token, `?token=unsaved` no credential helper;
  // `?repos=fail` a provider that can't be reached.
  addHostingAccount: async (provider, host, login, token) => {
    await delay(150);
    const mode = new URLSearchParams(location.search).get("token");
    if (mode === "bad" || !token.trim()) {
      throw {
        kind: "invalidInput",
        message: `${host || "github.com"} refused the token (401 Unauthorized). Check that it hasn't expired and can read repositories.`,
        command: null,
        stderr: null,
      } satisfies IpcError;
    }
    const defaultHost = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" };
    return {
      account: {
        provider,
        host: provider === "bitbucket" ? "bitbucket.org" : host || defaultHost[provider],
        login: provider === "bitbucket" ? login : "ada",
        name: "Ada Moreno",
      },
      saved: mode !== "unsaved",
    };
  },
  removeHostingAccount: async () => {},
  listHostedRepos: async (account) => {
    const w = window as Window & { __tyliaHostingCalls?: number };
    w.__tyliaHostingCalls = (w.__tyliaHostingCalls ?? 0) + 1;
    await delay(150);
    if (new URLSearchParams(location.search).get("repos") === "fail") {
      throw {
        kind: "invalidInput",
        message: `Couldn't reach ${account.host}: connection refused`,
        command: null,
        stderr: null,
      } satisfies IpcError;
    }
    const base = account.provider === "gitlab" ? `https://${account.host}` : "https://github.com";
    return ["tylia", "engine", "dotfiles", "graph-lab", "website"].map((name, i) => ({
      fullName: `${i === 1 ? "acme" : "ada"}/${name}`,
      description: i === 0 ? "A calm, fast desktop Git client" : null,
      private: i === 2,
      httpsUrl: `${base}/${i === 1 ? "acme" : "ada"}/${name}.git`,
      sshUrl: `git@${account.host}:${i === 1 ? "acme" : "ada"}/${name}.git`,
      updated: `2026-10-${20 - i}T10:00:00Z`,
    }));
  },
  // `?save=cancel` simulates closing the save dialog.
  pickSaveFile: async (_title, defaultPath) =>
    new URLSearchParams(location.search).get("save") === "cancel" ? null : defaultPath,
  saveCommitPatch: async () => {},
  saveCommitPatches: async (_repo, oids, dir) =>
    oids.map((_, i) => `${dir}/${String(i + 1).padStart(4, "0")}-patch.patch`),
  saveChangesPatch: async () => {},
  exportArchive: async () => {},
  // `?patch=threeWay|fails|diff` simulates other patch files and repository states.
  previewPatch: async () => {
    const mode = new URLSearchParams(location.search).get("patch");
    const diff = mode === "diff";
    return {
      format: diff ? "diff" : "mailbox",
      commits: diff ? [] : ["parser: handle empty input", "parser: test empty input"],
      files: [
        { path: "src/parser.rs", oldPath: null, added: 12, removed: 3 },
        { path: "tests/parser.rs", oldPath: "tests/parse.rs", added: 20, removed: 0 },
        { path: "assets/logo.png", oldPath: null, added: null, removed: null },
      ],
      check: mode === "threeWay" ? "threeWay" : mode === "fails" ? "fails" : "clean",
      checkMessage:
        mode === "threeWay" || mode === "fails"
          ? "error: patch failed: src/parser.rs:14\nerror: src/parser.rs: patch does not apply"
          : null,
    };
  },
  repoConfig: async () => {
    const remotes = refs.remotes.map((r) => {
      const url = r.url ?? "";
      const https = url.startsWith("https://");
      const m = https
        ? /^https:\/\/([^/]+)\/(.+?)(\.git)?$/.exec(url)
        : /^git@([^:]+):(.+?)(\.git)?$/.exec(url);
      return {
        name: r.name,
        url,
        pushUrl: r.pushUrl,
        protocol: https
          ? ("https" as const)
          : url.startsWith("git@")
            ? ("ssh" as const)
            : ("local" as const),
        alternateUrl: m
          ? https
            ? `git@${m[1]}:${m[2]}.git`
            : `https://${m[1]}/${m[2]}.git`
          : null,
      };
    });
    return { ...repoConfig, remotes };
  },
  setIdentity: async (_repo, name, email) => {
    const local = (value: string | null) =>
      value?.trim() ? { value: value.trim(), scope: "local" as const } : null;
    repoConfig = {
      ...repoConfig,
      userName: local(name) ?? GLOBAL_NAME,
      userEmail: local(email) ?? GLOBAL_EMAIL,
    };
  },
  setSshKey: async (_repo, key) => {
    const value = key ? `ssh -i '${key.replace(/\\/g, "/")}' -o IdentitiesOnly=yes` : null;
    repoConfig = {
      ...repoConfig,
      sshCommand: value ? { value, scope: "local" } : null,
      sshKey: key ? key.replace(/\\/g, "/") : null,
    };
  },
  forgetCredentials: async () => {},
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
  onSystemThemeChanged: async () => () => {},
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
