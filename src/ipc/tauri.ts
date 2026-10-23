import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

import type { Backend } from "./backend";
import type { AskpassPrompt } from "./bindings/AskpassPrompt";
import type { DownloadProgress } from "./bindings/DownloadProgress";
import type { HistoryEvent } from "./bindings/HistoryEvent";
import type { Progress } from "./bindings/Progress";
import type { RepoChanged } from "./bindings/RepoChanged";

const appWindow = getCurrentWindow();

/** The only URL the app opens (capabilities/default.json allows just this one). */
const RELEASES_URL = "https://github.com/gilgil28/tylia/releases/latest";

function channel<T>(handler: (message: T) => void): Channel<T> {
  const ch = new Channel<T>();
  ch.onmessage = handler;
  return ch;
}

export const backend: Backend = {
  gitVersion: () => invoke("git_version"),
  setSettings: (settings) => invoke("set_settings", { settings }),
  loadUiState: () => invoke("load_ui_state"),
  saveUiState: (value) => invoke("save_ui_state", { value }),
  checkUpdate: () => invoke("check_update"),
  installUpdate: (onProgress) =>
    invoke("install_update", { onProgress: channel<DownloadProgress>(onProgress) }),
  openDownloadPage: () => openUrl(RELEASES_URL),
  openTokenPage: (url) => openUrl(url),
  installCli: () => invoke("install_cli"),

  openRepo: (path) => invoke("open_repo", { path }),
  initRepo: (path) => invoke("init_repo", { path }),
  repoBranch: (path) => invoke("repo_branch", { path }),
  getRefs: (repo) => invoke("get_refs", { repo }),
  getStatus: (repo) => invoke("get_status", { repo }),
  getSubmodules: (repo) => invoke("get_submodules", { repo }),
  hasCommitGraph: (repo) => invoke("has_commit_graph", { repo }),
  getWorktrees: (repo) => invoke("get_worktrees", { repo }),
  lfsStatus: (repo) => invoke("lfs_status", { repo }),
  lfsFiles: (repo, paths) => invoke("lfs_files", { repo, paths }),
  lfsTrack: (repo, pattern) => invoke("lfs_track", { repo, pattern }),
  lfsPull: (repo, operationId, onProgress) =>
    invoke("lfs_pull", { repo, operationId, onProgress: channel<Progress>(onProgress) }),
  lfsLocks: (repo, operationId, onProgress) =>
    invoke("lfs_locks", { repo, operationId, onProgress: channel<Progress>(onProgress) }),
  lfsSetLock: (repo, path, lock, operationId, onProgress) =>
    invoke("lfs_set_lock", {
      repo,
      path,
      lock,
      operationId,
      onProgress: channel<Progress>(onProgress),
    }),
  submoduleUpdate: (repo, paths, operationId, onProgress) =>
    invoke("submodule_update", {
      repo,
      paths,
      operationId,
      onProgress: channel<Progress>(onProgress),
    }),
  writeCommitGraph: (repo) => invoke("write_commit_graph", { repo }),
  streamHistory: (repo, options, head, onEvent) =>
    invoke("stream_history", { repo, options, head, onEvent: channel<HistoryEvent>(onEvent) }),
  getCommit: (repo, oid) => invoke("get_commit", { repo, oid }),
  getDiff: (repo, request) => invoke("get_diff", { repo, request }),
  searchHistory: (repo, options, field, query) =>
    invoke("search_history", { repo, options, field, query }),
  pathSuggestions: (repo, query, limit) => invoke("path_suggestions", { repo, query, limit }),
  getBlame: (repo, path, rev, force) => invoke("get_blame", { repo, path, rev, force }),
  getFileHistory: (repo, path, rev, skip, limit) =>
    invoke("get_file_history", { repo, path, rev, skip, limit }),
  watchRepo: (repo) => invoke("watch_repo", { repo }),
  unwatchRepo: (repo) => invoke("unwatch_repo", { repo }),
  onRepoChanged: (handler) => listen<RepoChanged>("repo-changed", (e) => handler(e.payload)),

  stageFiles: (repo, paths) => invoke("stage_files", { repo, paths }),
  unstageFiles: (repo, paths) => invoke("unstage_files", { repo, paths }),
  stageAll: (repo) => invoke("stage_all", { repo }),
  unstageAll: (repo) => invoke("unstage_all", { repo }),
  discardFiles: (repo, tracked, untracked) => invoke("discard_files", { repo, tracked, untracked }),
  applyLines: (repo, request) => invoke("apply_lines", { repo, request }),
  commit: (repo, message, amend) => invoke("commit", { repo, message, amend }),
  headMessage: (repo) => invoke("head_message", { repo }),
  ignorePattern: (repo, pattern) => invoke("ignore_pattern", { repo, pattern }),
  openFile: (repo, path) => invoke("open_file", { repo, path }),
  openTerminal: (repo) => invoke("open_terminal", { repo }),

  cloneRepo: (request, operationId, onProgress) =>
    invoke("clone_repo", { request, operationId, onProgress: channel<Progress>(onProgress) }),
  cancelOperation: (operationId) => invoke("cancel_operation", { operationId }),
  customActionCommand: (action, context) => invoke("custom_action_command", { action, context }),
  runCustomAction: (action, context, operationId) =>
    invoke("run_custom_action", { action, context, operationId }),

  fetch: (repo, request, quiet, operationId, onProgress) =>
    invoke("fetch", {
      repo,
      request,
      quiet,
      operationId,
      onProgress: channel<Progress>(onProgress),
    }),
  pull: (repo, mode, operationId, onProgress) =>
    invoke("pull", { repo, mode, operationId, onProgress: channel<Progress>(onProgress) }),
  push: (repo, request, operationId, onProgress) =>
    invoke("push", { repo, request, operationId, onProgress: channel<Progress>(onProgress) }),
  addRemote: (repo, name, url) => invoke("add_remote", { repo, name, url }),
  setRemoteUrl: (repo, name, url, push) => invoke("set_remote_url", { repo, name, url, push }),
  renameRemote: (repo, name, newName) => invoke("rename_remote", { repo, name, newName }),
  removeRemote: (repo, name) => invoke("remove_remote", { repo, name }),

  createBranch: (repo, name, start, checkout) =>
    invoke("create_branch", { repo, name, start, checkout }),
  checkout: (repo, request) => invoke("checkout", { repo, request }),
  renameBranch: (repo, name, newName) => invoke("rename_branch", { repo, name, newName }),
  deleteBranch: (repo, name, force) => invoke("delete_branch", { repo, name, force }),
  deleteRemoteBranch: (repo, remote, branch, operationId, onProgress) =>
    invoke("delete_remote_branch", {
      repo,
      remote,
      branch,
      operationId,
      onProgress: channel<Progress>(onProgress),
    }),
  setUpstream: (repo, branch, upstream) => invoke("set_upstream", { repo, branch, upstream }),
  createTag: (repo, name, target, message) => invoke("create_tag", { repo, name, target, message }),
  deleteTag: (repo, name) => invoke("delete_tag", { repo, name }),
  pushTag: (repo, remote, name, operationId, onProgress) =>
    invoke("push_tag", {
      repo,
      remote,
      name,
      operationId,
      onProgress: channel<Progress>(onProgress),
    }),
  stashSave: (repo, request) => invoke("stash_save", { repo, request }),
  stashApply: (repo, index, pop) => invoke("stash_apply", { repo, index, pop }),
  stashDrop: (repo, index) => invoke("stash_drop", { repo, index }),
  merge: (repo, rev, ff) => invoke("merge", { repo, rev, ff }),
  rebase: (repo, onto) => invoke("rebase", { repo, onto }),
  cherryPick: (repo, oid) => invoke("cherry_pick", { repo, oid }),
  saveCommitPatch: (repo, oid, file) => invoke("save_commit_patch", { repo, oid, file }),
  saveCommitPatches: (repo, oids, dir) => invoke("save_commit_patches", { repo, oids, dir }),
  cherryPickMany: (repo, oids) => invoke("cherry_pick_many", { repo, oids }),
  revertMany: (repo, oids) => invoke("revert_many", { repo, oids }),
  saveChangesPatch: (repo, staged, file) => invoke("save_changes_patch", { repo, staged, file }),
  previewPatch: (repo, file) => invoke("preview_patch", { repo, file }),
  applyPatchFile: (repo, file, mode) => invoke("apply_patch_file", { repo, file, mode }),
  exportArchive: (repo, rev, label, format, file) =>
    invoke("export_archive", { repo, rev, label, format, file }),
  revert: (repo, oid) => invoke("revert", { repo, oid }),
  reset: (repo, oid, mode) => invoke("reset", { repo, oid, mode }),
  continueOperation: (repo) => invoke("continue_operation", { repo }),
  skipOperation: (repo) => invoke("skip_operation", { repo }),
  abortOperation: (repo) => invoke("abort_operation", { repo }),
  rebaseTodo: (repo, base) => invoke("rebase_todo", { repo, base }),
  isRebaseBase: (repo, oid) => invoke("is_rebase_base", { repo, oid }),
  rebaseInteractive: (repo, base, plan) => invoke("rebase_interactive", { repo, base, plan }),
  resolveWith: (repo, paths, side) => invoke("resolve_with", { repo, paths, side }),
  markResolved: (repo, paths) => invoke("mark_resolved", { repo, paths }),
  mergeTool: (repo, path) => invoke("merge_tool", { repo, path }),
  diffTool: (repo, request) => invoke("diff_tool", { repo, request }),
  conflictFile: (repo, path) => invoke("conflict_file", { repo, path }),
  resolveBlock: (repo, path, index, resolution, fingerprint) =>
    invoke("resolve_block", { repo, path, index, resolution, fingerprint }),

  flowState: (repo) => invoke("flow_state", { repo }),
  flowInit: (repo, config) => invoke("flow_init", { repo, config }),
  flowStart: (repo, kind, name) => invoke("flow_start", { repo, kind, name }),
  flowFinish: (repo, request) => invoke("flow_finish", { repo, request }),

  onAskpassPrompt: (handler) => listen<AskpassPrompt>("askpass-prompt", (e) => handler(e.payload)),
  onAskpassClosed: (handler) => listen<number>("askpass-closed", (e) => handler(e.payload)),
  askpassRespond: (id, answer) => invoke("askpass_respond", { id, answer }),

  repoConfig: (repo) => invoke("repo_config", { repo }),
  setIdentity: (repo, name, email) => invoke("set_identity", { repo, name, email }),
  setSshKey: (repo, key) => invoke("set_ssh_key", { repo, key }),
  forgetCredentials: (repo, url) => invoke("forget_credentials", { repo, url }),

  addHostingAccount: (provider, host, login, token) =>
    invoke("add_hosting_account", { provider, host, login, token }),
  removeHostingAccount: (account) => invoke("remove_hosting_account", { account }),
  listHostedRepos: (account) => invoke("list_hosted_repos", { account }),
  pickFile: async (title, defaultPath, filters) => {
    const picked = await open({ directory: false, multiple: false, title, defaultPath, filters });
    return typeof picked === "string" ? picked : null;
  },
  pickSaveFile: async (title, defaultPath, filters) =>
    (await save({ title, defaultPath, filters })) ?? null,
  pickFolder: async (title, defaultPath) => {
    const picked = await open({ directory: true, multiple: false, title, defaultPath });
    return typeof picked === "string" ? picked : null;
  },
  revealInFileManager: (path) => revealItemInDir(path),
  homeDir: () => homeDir(),
  takeOpenRequests: () => invoke("take_open_requests"),
  onOpenRequested: (handler) => listen("open-requested", () => handler()),
  onSystemThemeChanged: (handler) =>
    listen<boolean | null>("system-theme-changed", (e) => handler(e.payload)),
  onFolderDrop: ({ over, drop }) =>
    getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") over(true);
      else if (p.type === "leave") over(false);
      else if (p.type === "drop") {
        over(false);
        drop(p.paths);
      }
    }),

  window: {
    show: () => appWindow.show(),
    minimize: () => appWindow.minimize(),
    toggleMaximize: () => appWindow.toggleMaximize(),
    close: () => appWindow.close(),
    isMaximized: () => appWindow.isMaximized(),
    onResized: (handler) => appWindow.onResized(() => handler()),
  },
};
