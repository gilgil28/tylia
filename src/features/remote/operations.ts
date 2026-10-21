// Fetch, pull and push: one network operation per repository at a time, with progress for
// the toolbar, cancel, and errors turned into toasts that say what to do next.

import { create } from "zustand";

import { queryClient } from "@/app/query-client";
import { useSettings } from "@/app/settings";
import { plural, t } from "@/i18n";
import {
  ipc,
  isIpcError,
  type Branch,
  type IpcError,
  type Progress,
  type PullMode,
  type PushRequest,
  type RefsSnapshot,
} from "@/ipc";
import { toast, type ToastInput } from "@/ui/Toast";

export type OperationKind = "fetch" | "pull" | "push" | "submodules";

export interface RunningOperation {
  id: number;
  kind: OperationKind;
  /** What is happening, e.g. "Pushing main to origin". */
  title: string;
  progress: Progress | null;
  cancelling: boolean;
  /** A background fetch: no toasts, and it gives way to anything the user starts. */
  background: boolean;
}

/** The last operation that succeeded in a repository, for its button's check and tooltip. */
export interface OperationSuccess {
  kind: OperationKind;
  /** The success message, e.g. "Pushed main to origin/main". */
  message: string;
  /** `Date.now()` when it finished. */
  at: number;
  /** For a few seconds after: the button shows a check mark. */
  fresh: boolean;
}

/** How long a button shows its check mark after its operation succeeded. */
const FRESH_MS = 5000;

interface OperationsState {
  byRepo: Record<string, RunningOperation>;
  lastSuccess: Record<string, OperationSuccess>;
  /** The repository whose Push dialog is open. */
  pushDialog: string | null;
  openPushDialog(repo: string | null): void;
}

export const useOperations = create<OperationsState>((set) => ({
  byRepo: {},
  lastSuccess: {},
  pushDialog: null,
  openPushDialog: (pushDialog) => set({ pushDialog }),
}));

let nextId = 1;
/** Ids for `cancelOperation`; unique across clone, fetch, pull and push. */
export const nextOperationId = () => nextId++;

/** Per operation id: settles when its backend call has returned. */
const finished = new Map<number, Promise<unknown>>();

function setRunning(repo: string, op: RunningOperation | null) {
  useOperations.setState((s) => {
    const byRepo = { ...s.byRepo };
    if (op) byRepo[repo] = op;
    else delete byRepo[repo];
    return { byRepo };
  });
}

function patchRunning(repo: string, id: number, patch: Partial<RunningOperation>) {
  useOperations.setState((s) => {
    const op = s.byRepo[repo];
    return op?.id === id ? { byRepo: { ...s.byRepo, [repo]: { ...op, ...patch } } } : s;
  });
}

export function cancelRunning(repo: string) {
  const op = useOperations.getState().byRepo[repo];
  if (!op || op.cancelling) return;
  patchRunning(repo, op.id, { cancelling: true });
  void ipc.cancelOperation(op.id);
}

/** Refreshes what a network operation may have changed. */
function refresh(repo: string, worktree: boolean) {
  void queryClient.invalidateQueries({ queryKey: ["refs", repo] });
  void queryClient.invalidateQueries({ queryKey: ["repo-branch", repo] });
  if (worktree) {
    void queryClient.invalidateQueries({ queryKey: ["status", repo] });
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "diff" && q.queryKey[1] === repo,
    });
  }
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: IpcError };

/**
 * Runs one network operation, unless one is already running in `repo` (then resolves to
 * `null`). A background fetch in progress is cancelled to make way for the user's.
 */
async function run<T>(
  repo: string,
  kind: OperationKind,
  title: string,
  background: boolean,
  call: (id: number, onProgress: (p: Progress) => void) => Promise<T>,
): Promise<Outcome<T> | null> {
  const current = useOperations.getState().byRepo[repo];
  if (current && !(current.background && !background)) {
    // Never silently: the user asked for this.
    if (!background)
      toast({ kind: "error", title: t("ops.busyWith", { operation: current.title }) });
    return null;
  }
  if (!background) clearErrors(repo);
  const id = nextOperationId();
  setRunning(repo, { id, kind, title, progress: null, cancelling: false, background });
  if (current) {
    // Let the background fetch stop (and release Git's locks) before starting.
    void ipc.cancelOperation(current.id);
    await finished.get(current.id);
  }
  const done = call(id, (progress) => patchRunning(repo, id, { progress }));
  finished.set(
    id,
    done.catch(() => {}),
  );
  try {
    return { ok: true, value: await done };
  } catch (err) {
    const error: IpcError = isIpcError(err)
      ? err
      : { kind: "io", message: String(err), command: null, stderr: null };
    return { ok: false, error };
  } finally {
    finished.delete(id);
    if (useOperations.getState().byRepo[repo]?.id === id) setRunning(repo, null);
    refresh(repo, kind === "pull");
  }
}

/** Toasts a success and keeps it for the operation's button (check mark, tooltip). */
function succeeded(repo: string, kind: OperationKind, message: string) {
  toast({ kind: "success", title: message });
  const at = Date.now();
  useOperations.setState((s) => ({
    lastSuccess: { ...s.lastSuccess, [repo]: { kind, message, at, fresh: true } },
  }));
  setTimeout(() => {
    useOperations.setState((s) => {
      const last = s.lastSuccess[repo];
      return last?.at === at
        ? { lastSuccess: { ...s.lastSuccess, [repo]: { ...last, fresh: false } } }
        : s;
    });
  }, FRESH_MS);
}

function cachedRefs(repo: string): RefsSnapshot | undefined {
  return queryClient.getQueryData<RefsSnapshot>(["refs", repo]);
}

/** The checked-out branch, if any. */
export function headBranch(refs: RefsSnapshot | undefined): Branch | undefined {
  const name = refs?.head.branch;
  return name ? refs.branches.find((b) => b.name === name) : undefined;
}

/** Where a plain Push sends `branch`: its upstream on a remote, if it has one. */
export function pushTarget(branch: Branch | undefined) {
  if (!branch?.upstreamRemote || branch.upstreamRemote === "." || !branch.upstreamBranch) {
    return null;
  }
  return { remote: branch.upstreamRemote, remoteBranch: branch.upstreamBranch };
}

/**
 * Error toasts of each repository's operations. Starting another operation there clears
 * them: the user has acted on them, and an old "push rejected" next to a later "Pushed"
 * only confuses.
 */
const errorToasts = new Map<string, number[]>();

function errorToast(repo: string, input: ToastInput) {
  errorToasts.set(repo, [...(errorToasts.get(repo) ?? []), toast(input)]);
}

function clearErrors(repo: string) {
  errorToasts.get(repo)?.forEach((id) => toast.dismiss(id));
  errorToasts.delete(repo);
}

function failed(
  repo: string,
  title: string,
  error: IpcError,
  action?: { label: string; run: () => void },
) {
  if (error.kind === "cancelled") return;
  // Our own refusals (no upstream, invalid input) are already a full sentence.
  if (error.kind === "invalidInput") {
    errorToast(repo, { kind: "error", title: error.message, action });
    return;
  }
  // Access problems say what to check; Git's own words stay under "Details".
  if (error.kind === "authFailed" || error.kind === "hostKeyFailed") {
    const auth = error.kind === "authFailed";
    errorToast(repo, {
      kind: "error",
      title: auth ? t("ops.authFailed") : t("ops.hostKeyFailed"),
      description: auth ? t("ops.authFailedHint") : t("ops.hostKeyFailedHint"),
      error,
    });
    return;
  }
  errorToast(repo, { kind: "error", title, error, action });
}

// Background fetch failures are shown once per repository, until a fetch succeeds again.
const quietFailures = new Set<string>();

export async function fetchRepo(repo: string, { background = false } = {}) {
  const prune = useSettings.getState().settings.fetchPrune;
  const outcome = await run(repo, "fetch", t("ops.fetching"), background, (id, onProgress) =>
    ipc.fetch(repo, { remote: null, prune }, background, id, onProgress),
  );
  if (!outcome) return;
  if (outcome.ok) {
    quietFailures.delete(repo);
    if (!background) succeeded(repo, "fetch", t("ops.fetched"));
    return;
  }
  if (background) {
    if (outcome.error.kind === "cancelled" || quietFailures.has(repo)) return;
    quietFailures.add(repo);
    if (outcome.error.kind === "authFailed") {
      // It may not ask for credentials; one fetch by the user can (and a credential helper
      // then remembers them).
      errorToast(repo, {
        kind: "error",
        title: t("ops.backgroundAuth"),
        description: t("ops.backgroundAuthHint"),
        error: outcome.error,
        action: { label: t("ops.fetch"), run: () => void fetchRepo(repo) },
      });
      return;
    }
    failed(repo, t("ops.backgroundFetchFailed"), outcome.error);
    return;
  }
  failed(repo, t("ops.fetchFailed"), outcome.error);
}

export async function pullRepo(
  repo: string,
  mode: PullMode = useSettings.getState().settings.pullMode,
  { onConflicts }: { onConflicts?: () => void } = {},
) {
  const branch = headBranch(cachedRefs(repo));
  const incoming = branch?.behind ?? 0;
  const title = branch?.upstream
    ? t("ops.pulling", { upstream: branch.upstream, branch: branch.name })
    : t("ops.pullingPlain");
  const outcome = await run(repo, "pull", title, false, (id, onProgress) =>
    ipc.pull(repo, mode, id, onProgress),
  );
  if (!outcome) return;
  if (!outcome.ok) {
    failed(repo, t("ops.pullFailed"), outcome.error);
    return;
  }
  const name = branch?.name ?? "HEAD";
  switch (outcome.value) {
    case "upToDate":
      succeeded(repo, "pull", t("ops.pullUpToDate", { branch: name }));
      break;
    case "updated":
      succeeded(
        repo,
        "pull",
        incoming > 0
          ? t("ops.pulledCount", { commits: plural("count.commits", incoming), branch: name })
          : t("ops.pulled", { branch: name }),
      );
      break;
    case "conflicts":
      errorToast(repo, {
        kind: "error",
        title: t("ops.pullConflicts"),
        description: t("ops.pullConflictsHint"),
        action: onConflicts && { label: t("ops.showChanges"), run: onConflicts },
      });
      break;
  }
}

/**
 * Pushes. Without `request`, pushes the current branch to its upstream, or opens the Push
 * dialog when it has none (first push).
 */
export async function pushRepo(repo: string, request?: PushRequest) {
  const refs = cachedRefs(repo);
  const branch = headBranch(refs);
  if (!request) {
    if (!refs?.head.branch) {
      toast({ kind: "error", title: t("ops.pushDetached") });
      return;
    }
    const target = pushTarget(branch);
    if (!target) {
      useOperations.getState().openPushDialog(repo);
      return;
    }
    request = {
      remote: target.remote,
      branch: refs.head.branch,
      remoteBranch: target.remoteBranch,
      setUpstream: false,
      tags: false,
      forceLease: null,
    };
  }
  const req = request;
  const destination = `${req.remote}/${req.remoteBranch}`;
  const outcome = await run(
    repo,
    "push",
    t("ops.pushing", { branch: req.branch, remote: req.remote }),
    false,
    (id, onProgress) => ipc.push(repo, req, id, onProgress),
  );
  if (!outcome) return;
  if (outcome.ok) {
    succeeded(
      repo,
      "push",
      outcome.value === "upToDate"
        ? t("ops.pushUpToDate", { destination })
        : t("ops.pushed", { branch: req.branch, destination }),
    );
    return;
  }
  const { error } = outcome;
  switch (error.kind) {
    case "pushBehind":
      errorToast(repo, {
        kind: "error",
        title: t("ops.pushBehind", { destination, branch: req.branch }),
        description: t("ops.pushBehindHint"),
        error,
        action: { label: t("ops.pull"), run: () => void pullRepo(repo) },
      });
      break;
    case "pushStale":
      errorToast(repo, {
        kind: "error",
        title: t("ops.pushStale", { destination }),
        description: t("ops.pushStaleHint"),
        error,
        action: { label: t("ops.fetch"), run: () => void fetchRepo(repo) },
      });
      break;
    case "pushRejected":
      failed(repo, t("ops.pushRejected", { remote: req.remote }), error);
      break;
    default:
      failed(repo, t("ops.pushFailed"), error);
  }
}

export async function deleteRemoteBranch(repo: string, remote: string, branch: string) {
  const name = `${remote}/${branch}`;
  const outcome = await run(
    repo,
    "push",
    t("ops.deletingRemote", { name }),
    false,
    (id, onProgress) => ipc.deleteRemoteBranch(repo, remote, branch, id, onProgress),
  );
  if (!outcome) return;
  if (outcome.ok) toast({ kind: "success", title: t("ops.deletedRemote", { name }) });
  else failed(repo, t("ops.deleteRemoteFailed", { name }), outcome.error);
}

export async function pushTag(repo: string, remote: string, tag: string) {
  const outcome = await run(
    repo,
    "push",
    t("ops.pushingTag", { tag, remote }),
    false,
    (id, onProgress) => ipc.pushTag(repo, remote, tag, id, onProgress),
  );
  if (!outcome) return;
  if (outcome.ok) toast({ kind: "success", title: t("ops.pushedTag", { tag, remote }) });
  else failed(repo, t("ops.pushTagFailed", { tag }), outcome.error);
}

/** `git submodule update --init` for `paths` (all when empty), with a progress toast. */
export async function updateSubmodules(repo: string, paths: string[]) {
  const title = t("ops.updatingSubmodules");
  const progressToast = toast({ kind: "progress", title });
  const outcome = await run(repo, "submodules", title, false, (id, onProgress) =>
    ipc.submoduleUpdate(repo, paths, id, (p) => {
      onProgress(p);
      toast.update(progressToast, {
        kind: "progress",
        title,
        description: p.phase,
        progress: p.percent / 100,
      });
    }),
  );
  toast.dismiss(progressToast);
  void queryClient.invalidateQueries({ queryKey: ["submodules", repo] });
  if (!outcome) {
    toast({ kind: "error", title: t("ops.busy") });
    return;
  }
  if (outcome.ok) toast({ kind: "success", title: t("ops.submodulesUpdated") });
  else failed(repo, t("ops.submodulesFailed"), outcome.error);
}
