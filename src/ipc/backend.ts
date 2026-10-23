import type { ActionContext } from "./bindings/ActionContext";
import type { ActionRun } from "./bindings/ActionRun";
import type { AddedAccount } from "./bindings/AddedAccount";
import type { ArchiveFormat } from "./bindings/ArchiveFormat";
import type { AskpassPrompt } from "./bindings/AskpassPrompt";
import type { Blame } from "./bindings/Blame";
import type { BlockOutcome } from "./bindings/BlockOutcome";
import type { BlockResolution } from "./bindings/BlockResolution";
import type { CheckoutOutcome } from "./bindings/CheckoutOutcome";
import type { CliLinkOutcome } from "./bindings/CliLinkOutcome";
import type { CheckoutRequest } from "./bindings/CheckoutRequest";
import type { CloneRequest } from "./bindings/CloneRequest";
import type { ConflictFile } from "./bindings/ConflictFile";
import type { ConflictSide } from "./bindings/ConflictSide";
import type { CommitDetails } from "./bindings/CommitDetails";
import type { CustomAction } from "./bindings/CustomAction";
import type { DiffRequest } from "./bindings/DiffRequest";
import type { DownloadProgress } from "./bindings/DownloadProgress";
import type { FastForward } from "./bindings/FastForward";
import type { FetchRequest } from "./bindings/FetchRequest";
import type { FileDiff } from "./bindings/FileDiff";
import type { FileHistoryPage } from "./bindings/FileHistoryPage";
import type { FlowConfig } from "./bindings/FlowConfig";
import type { FlowFinished } from "./bindings/FlowFinished";
import type { FlowFinishRequest } from "./bindings/FlowFinishRequest";
import type { FlowKind } from "./bindings/FlowKind";
import type { FlowState } from "./bindings/FlowState";
import type { GitInfo } from "./bindings/GitInfo";
import type { HistoryEvent } from "./bindings/HistoryEvent";
import type { HostedRepo } from "./bindings/HostedRepo";
import type { HostingAccount } from "./bindings/HostingAccount";
import type { HostingProvider } from "./bindings/HostingProvider";
import type { IntegrateOutcome } from "./bindings/IntegrateOutcome";
import type { IpcError } from "./bindings/IpcError";
import type { LfsLocks } from "./bindings/LfsLocks";
import type { LfsStatus } from "./bindings/LfsStatus";
import type { LinesRequest } from "./bindings/LinesRequest";
import type { LogOptions } from "./bindings/LogOptions";
import type { Progress } from "./bindings/Progress";
import type { PullMode } from "./bindings/PullMode";
import type { PullOutcome } from "./bindings/PullOutcome";
import type { PushOutcome } from "./bindings/PushOutcome";
import type { PushRequest } from "./bindings/PushRequest";
import type { PatchApplyMode } from "./bindings/PatchApplyMode";
import type { PatchPreview } from "./bindings/PatchPreview";
import type { PathSuggestions } from "./bindings/PathSuggestions";
import type { RebaseTodo } from "./bindings/RebaseTodo";
import type { RefsSnapshot } from "./bindings/RefsSnapshot";
import type { RepoConfig } from "./bindings/RepoConfig";
import type { RepoChanged } from "./bindings/RepoChanged";
import type { RepoInfo } from "./bindings/RepoInfo";
import type { ResetMode } from "./bindings/ResetMode";
import type { SearchField } from "./bindings/SearchField";
import type { Settings } from "./bindings/Settings";
import type { StashOutcome } from "./bindings/StashOutcome";
import type { StashRequest } from "./bindings/StashRequest";
import type { Submodule } from "./bindings/Submodule";
import type { TodoItem } from "./bindings/TodoItem";
import type { UndoState } from "./bindings/UndoState";
import type { UpdateInfo } from "./bindings/UpdateInfo";
import type { WorkingStatus } from "./bindings/WorkingStatus";
import type { Worktree } from "./bindings/Worktree";

/** The window operations the custom title bar needs. No-ops in browser mode. */
export interface WindowControls {
  show(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Calls `handler` after every resize; returns an unsubscribe function. */
  onResized(handler: () => void): Promise<() => void>;
}

export type Unlisten = () => void;

/** A file-type choice in the native open / save dialogs. */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Everything the frontend can ask of the backend. Implemented by `tauri.ts` and `mock/`. */
export interface Backend {
  gitVersion(): Promise<GitInfo>;
  setSettings(settings: Settings): Promise<void>;
  /** The frontend's own persisted state (tabs, recents, layout); `null` on first run. */
  loadUiState(): Promise<unknown>;
  saveUiState(state: unknown): Promise<void>;
  /** Ends a performance run (`TYLIA_PERF`): Rust writes the report and quits. */
  writePerfReport(report: unknown): Promise<void>;
  /** Asks the release server for a newer Tylia; `null` when this is the latest. Only on the
   * user's request or with "Check for updates" on (no other network request is made). */
  checkUpdate(): Promise<UpdateInfo | null>;
  /** Downloads, verifies and installs the update the last check found, then restarts. */
  installUpdate(onProgress: (progress: DownloadProgress) => void): Promise<void>;
  /** Opens a hosting provider's "new token" page (only those in the opener allow-list). */
  openTokenPage(url: string): Promise<void>;
  /** Opens Tylia's releases page in the browser. */
  openDownloadPage(): Promise<void>;
  /** macOS: links /usr/local/bin/tylia to the app (asks for a password if needed). */
  installCli(): Promise<CliLinkOutcome>;

  openRepo(path: string): Promise<RepoInfo>;
  initRepo(path: string): Promise<RepoInfo>;
  /** Branch of a repository on disk, for the recent list; rejects if it is gone. */
  repoBranch(path: string): Promise<string | null>;
  getRefs(repo: string): Promise<RefsSnapshot>;
  getStatus(repo: string): Promise<WorkingStatus>;
  /** Slow on repositories with many submodules: load only when shown. */
  getSubmodules(repo: string): Promise<Submodule[]>;
  /** Whether Git's commit-graph index exists (history streams much faster with it). */
  hasCommitGraph(repo: string): Promise<boolean>;
  getWorktrees(repo: string): Promise<Worktree[]>;
  lfsStatus(repo: string): Promise<LfsStatus>;
  /** The paths among `paths` that Git LFS stores (from the attributes). */
  lfsFiles(repo: string, paths: string[]): Promise<string[]>;
  /** `git lfs track <pattern>` (writes .gitattributes). */
  lfsTrack(repo: string, pattern: string): Promise<void>;
  /** `git lfs pull`; network operation. */
  lfsPull(repo: string, operationId: number, onProgress: (p: Progress) => void): Promise<void>;
  /** The server's locks; network operation. */
  lfsLocks(repo: string, operationId: number, onProgress: (p: Progress) => void): Promise<LfsLocks>;
  /** Locks or unlocks `path` on the server; network operation. */
  lfsSetLock(
    repo: string,
    path: string,
    lock: boolean,
    operationId: number,
    onProgress: (p: Progress) => void,
  ): Promise<void>;
  /** Initializes and updates submodules (`paths` empty: all); network operation. */
  submoduleUpdate(
    repo: string,
    paths: string[],
    operationId: number,
    onProgress: (progress: Progress) => void,
  ): Promise<void>;
  /** Writes one; only on the user's request. */
  writeCommitGraph(repo: string): Promise<void>;
  /** Streams history; a newer stream for the same repo stops older ones. `head: null`
   * lets the backend resolve HEAD (so history need not wait for refs). */
  streamHistory(
    repo: string,
    options: LogOptions,
    head: string | null,
    onEvent: (event: HistoryEvent) => void,
  ): Promise<void>;
  getCommit(repo: string, oid: string): Promise<CommitDetails>;
  getDiff(repo: string, request: DiffRequest): Promise<FileDiff>;
  searchHistory(
    repo: string,
    options: LogOptions,
    field: SearchField,
    query: string,
  ): Promise<string[]>;
  /** Files and folders from the whole history whose name or path matches `query` (for the
   * path search); `indexing` while the history is still being read. */
  pathSuggestions(repo: string, query: string, limit: number): Promise<PathSuggestions>;
  /** Blame at `rev`, or of the working copy with `null`. `force` skips the size limit. */
  getBlame(repo: string, path: string, rev: string | null, force: boolean): Promise<Blame>;
  /** Commits that changed `path` (following renames), newest first, from `rev` (`null`:
   * HEAD); `limit` entries after `skip`. */
  getFileHistory(
    repo: string,
    path: string,
    rev: string | null,
    skip: number,
    limit: number,
  ): Promise<FileHistoryPage>;
  watchRepo(repo: string): Promise<void>;
  unwatchRepo(repo: string): Promise<void>;
  onRepoChanged(handler: (change: RepoChanged) => void): Promise<Unlisten>;

  // Working-copy writes (serialized per repository by the backend).
  stageFiles(repo: string, paths: string[]): Promise<void>;
  /** For a staged rename, pass both the old and the new path. */
  unstageFiles(repo: string, paths: string[]): Promise<void>;
  stageAll(repo: string): Promise<void>;
  unstageAll(repo: string): Promise<void>;
  /** Tracked files are restored from the index; untracked ones go to the OS trash. */
  discardFiles(repo: string, tracked: string[], untracked: string[]): Promise<void>;
  applyLines(repo: string, request: LinesRequest): Promise<void>;
  /** Returns the new commit id. */
  commit(repo: string, message: string, amend: boolean): Promise<string>;
  headMessage(repo: string): Promise<string | null>;
  ignorePattern(repo: string, pattern: string): Promise<void>;
  openFile(repo: string, path: string): Promise<void>;
  /** Opens the terminal from Settings (else the platform's usual one) in the repository;
   * resolves to the program started. */
  openTerminal(repo: string): Promise<string>;

  cloneRepo(
    request: CloneRequest,
    operationId: number,
    onProgress: (progress: Progress) => void,
  ): Promise<RepoInfo>;
  cancelOperation(operationId: number): Promise<void>;
  /** A custom action's program and arguments here (errors when a variable has no value). */
  customActionCommand(action: CustomAction, context: ActionContext): Promise<string[]>;
  /** Runs a custom action (no shell); with `showOutput` waits for it (cancel by id). */
  runCustomAction(
    action: CustomAction,
    context: ActionContext,
    operationId: number,
  ): Promise<ActionRun>;

  // Network operations: progress on `onProgress`, cancel with `cancelOperation`.
  /** `quiet` (background fetch) never shows a credential prompt. */
  fetch(
    repo: string,
    request: FetchRequest,
    quiet: boolean,
    operationId: number,
    onProgress: (progress: Progress) => void,
  ): Promise<void>;
  /** Pulls the current branch from its upstream. */
  pull(
    repo: string,
    mode: PullMode,
    operationId: number,
    onProgress: (progress: Progress) => void,
  ): Promise<PullOutcome>;
  push(
    repo: string,
    request: PushRequest,
    operationId: number,
    onProgress: (progress: Progress) => void,
  ): Promise<PushOutcome>;

  addRemote(repo: string, name: string, url: string): Promise<void>;
  /** With `push`, sets the push URL; an empty push URL removes it. */
  setRemoteUrl(repo: string, name: string, url: string, push: boolean): Promise<void>;
  renameRemote(repo: string, name: string, newName: string): Promise<void>;
  removeRemote(repo: string, name: string): Promise<void>;

  // Branches, tags, stashes, merge / rebase / pick / revert / reset (serialized per repo).
  /** `start`: any commit-ish (oid, branch, tag). */
  createBranch(repo: string, name: string, start: string, checkout: boolean): Promise<void>;
  /** Rejects with `localChanges` (and `files`) when changes would be overwritten. */
  checkout(repo: string, request: CheckoutRequest): Promise<CheckoutOutcome>;
  renameBranch(repo: string, name: string, newName: string): Promise<void>;
  /** Rejects with `notFullyMerged` unless `force`. */
  deleteBranch(repo: string, name: string, force: boolean): Promise<void>;
  deleteRemoteBranch(
    repo: string,
    remote: string,
    branch: string,
    operationId: number,
    onProgress: (progress: Progress) => void,
  ): Promise<void>;
  /** `null` removes the upstream. */
  setUpstream(repo: string, branch: string, upstream: string | null): Promise<void>;
  /** Annotated with `message`, lightweight with `null`. */
  createTag(repo: string, name: string, target: string, message: string | null): Promise<void>;
  deleteTag(repo: string, name: string): Promise<void>;
  pushTag(
    repo: string,
    remote: string,
    name: string,
    operationId: number,
    onProgress: (progress: Progress) => void,
  ): Promise<void>;
  /** Resolves false when there was nothing to stash. */
  stashSave(repo: string, request: StashRequest): Promise<boolean>;
  stashApply(repo: string, index: number, pop: boolean): Promise<StashOutcome>;
  stashDrop(repo: string, index: number): Promise<void>;
  /** What Tylia's operation journal can undo and redo (Phase 11). */
  undoState(repo: string): Promise<UndoState>;
  /** Undoes the last operation; refuses when the repository changed since. */
  undo(repo: string): Promise<UndoState>;
  redo(repo: string): Promise<UndoState>;
  merge(repo: string, rev: string, ff: FastForward): Promise<IntegrateOutcome>;
  rebase(repo: string, onto: string): Promise<IntegrateOutcome>;
  cherryPick(repo: string, oid: string): Promise<IntegrateOutcome>;
  /** Writes commit `oid` as a mailbox patch (`git format-patch`) to `file`. */
  saveCommitPatch(repo: string, oid: string, file: string): Promise<void>;
  /** Writes `oids` (oldest first) as `0001-….patch`, `0002-…` into `dir`; never overwrites. */
  saveCommitPatches(repo: string, oids: string[], dir: string): Promise<string[]>;
  /** Cherry-picks `oids`, oldest first, as one operation. */
  cherryPickMany(repo: string, oids: string[]): Promise<IntegrateOutcome>;
  /** Reverts `oids`, newest first, as one operation. */
  revertMany(repo: string, oids: string[]): Promise<IntegrateOutcome>;
  /** Writes the staged or unstaged changes (`git diff --binary`) to `file`. */
  saveChangesPatch(repo: string, staged: boolean, file: string): Promise<void>;
  /** What applying the patch `file` would do, and whether it applies. */
  previewPatch(repo: string, file: string): Promise<PatchPreview>;
  /** Applies `file` to the working tree, or as commits (`git am`, may stop on conflicts). */
  applyPatchFile(repo: string, file: string, mode: PatchApplyMode): Promise<IntegrateOutcome>;
  /** Writes the files of `rev` into `file` (zip or tar.gz), in a `<repo>-<label>/` folder. */
  exportArchive(
    repo: string,
    rev: string,
    label: string,
    format: ArchiveFormat,
    file: string,
  ): Promise<void>;
  revert(repo: string, oid: string): Promise<IntegrateOutcome>;
  reset(repo: string, oid: string, mode: ResetMode): Promise<void>;
  continueOperation(repo: string): Promise<IntegrateOutcome>;
  skipOperation(repo: string): Promise<IntegrateOutcome>;
  abortOperation(repo: string): Promise<void>;
  /** Interactive rebase: the commits after `base` (an ancestor of HEAD), oldest first. */
  rebaseTodo(repo: string, base: string): Promise<RebaseTodo>;
  /** Whether `oid` is an ancestor of HEAD other than HEAD (an interactive rebase can start). */
  isRebaseBase(repo: string, oid: string): Promise<boolean>;
  /** Replays the commits after `base` by `plan`; `stopped` at an `edit` step. */
  rebaseInteractive(repo: string, base: string, plan: TodoItem[]): Promise<IntegrateOutcome>;
  resolveWith(repo: string, paths: string[], side: ConflictSide): Promise<void>;
  markResolved(repo: string, paths: string[]): Promise<void>;
  /** Resolves when the tool closes. */
  mergeTool(repo: string, path: string): Promise<void>;
  /** Opens the configured external diff tool for one file; resolves when it closes. */
  diffTool(repo: string, request: DiffRequest): Promise<void>;
  /** A conflicted file's conflict blocks (no blocks: e.g. a delete/modify conflict). */
  conflictFile(repo: string, path: string): Promise<ConflictFile>;
  /** Resolves one block; rejects (`invalidInput`) if the file changed since `fingerprint`. */
  resolveBlock(
    repo: string,
    path: string,
    index: number,
    resolution: BlockResolution,
    fingerprint: string,
  ): Promise<BlockOutcome>;

  // git-flow helpers (plain Git; `gitflow.*` config compatible with the git-flow CLI).
  /** The setup, or `config: null` with a suggested one. */
  flowState(repo: string): Promise<FlowState>;
  /** Writes the setup; creates the development branch if it's missing. */
  flowInit(repo: string, config: FlowConfig): Promise<void>;
  /** Creates and checks out the branch; resolves to its full name. */
  flowStart(repo: string, kind: FlowKind, name: string): Promise<string>;
  /** Merges (refusing beforehand if any merge would conflict), tags, deletes. */
  flowFinish(repo: string, request: FlowFinishRequest): Promise<FlowFinished>;

  /** Credential and ssh prompts from Git (the askpass bridge). */
  onAskpassPrompt(handler: (prompt: AskpassPrompt) => void): Promise<Unlisten>;
  /** A prompt no longer wants an answer: its operation ended or the asker went away. */
  onAskpassClosed(handler: (id: number) => void): Promise<Unlisten>;
  /** Answers a prompt; `null` cancels it. */
  askpassRespond(id: number, answer: string | null): Promise<void>;

  // Repository settings (writes go to the repository's own config only).
  repoConfig(repo: string): Promise<RepoConfig>;
  /** `null` or blank removes the repository's own value (the global one applies). */
  setIdentity(repo: string, name: string | null, email: string | null): Promise<void>;
  /** The private key for this repository's SSH remotes; `null` for the defaults. */
  setSshKey(repo: string, key: string | null): Promise<void>;
  /** Asks the credential helper to forget the sign-in saved for an HTTPS remote URL. */
  forgetCredentials(repo: string, url: string): Promise<void>;

  /** Checks a personal access token with the provider and stores it with Git's credential
   * helpers; `host` is empty for the provider's main site, `login` the Bitbucket email. */
  addHostingAccount(
    provider: HostingProvider,
    host: string,
    login: string,
    token: string,
  ): Promise<AddedAccount>;
  /** Forgets the account's token (remove it from settings separately). */
  removeHostingAccount(account: HostingAccount): Promise<void>;
  /** The account's repositories, most recently active first. */
  listHostedRepos(account: HostingAccount): Promise<HostedRepo[]>;

  /** Native file picker; `null` if cancelled. */
  pickFile(title: string, defaultPath?: string, filters?: FileFilter[]): Promise<string | null>;
  /** Native "save as" dialog; `null` if cancelled. */
  pickSaveFile(title: string, defaultPath: string, filters?: FileFilter[]): Promise<string | null>;
  /** Native folder picker; `null` if cancelled. */
  pickFolder(title: string, defaultPath?: string): Promise<string | null>;
  revealInFileManager(path: string): Promise<void>;
  homeDir(): Promise<string>;
  /**
   * Folders to open that came from outside the window: `tylia <path>`, a second launch, or
   * a file manager's "Open in Tylia". Returns them and clears the queue.
   */
  takeOpenRequests(): Promise<string[]>;
  /** More folders are waiting for `takeOpenRequests`. */
  onOpenRequested(handler: () => void): Promise<Unlisten>;
  /** Folders dropped on the window. */
  /**
   * The desktop's light / dark preference changed, where Rust reads it (`boot.systemDark`
   * is not `null`); `null` when it has none.
   */
  onSystemThemeChanged(handler: (dark: boolean | null) => void): Promise<Unlisten>;
  onFolderDrop(handlers: {
    over: (active: boolean) => void;
    drop: (paths: string[]) => void;
  }): Promise<Unlisten>;

  window: WindowControls;
}

export function isIpcError(value: unknown): value is IpcError {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}
