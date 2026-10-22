// Branches, tags, stashes and merge / rebase / pick / revert / reset in browser mode. They
// change the mock's refs and status (not its history, which is a fixed fixture). Outcomes are
// scripted through `window.__tyliaBranching` (Playwright sets it), e.g.
// `{ checkout: "localChanges", merge: "conflicts" }`; by default everything succeeds.

import type { Backend } from "../backend";
import type { ConflictSegment } from "../bindings/ConflictSegment";
import type { IpcError } from "../bindings/IpcError";
import type { IpcErrorKind } from "../bindings/IpcErrorKind";
import type { OperationKind } from "../bindings/OperationKind";
import type { Progress } from "../bindings/Progress";
import type { RefsSnapshot } from "../bindings/RefsSnapshot";
import type { WorkingStatus } from "../bindings/WorkingStatus";

export interface MockBranchingScript {
  checkout?: "ok" | "localChanges" | "stashConflicts";
  deleteBranch?: "ok" | "notFullyMerged";
  merge?: "ok" | "upToDate" | "fastForward" | "conflicts";
  rebase?: "ok" | "conflicts";
  cherryPick?: "ok" | "conflicts";
  revert?: "ok" | "conflicts";
  /** Creating a patch file's commits (`git am`). */
  applyPatch?: "ok" | "conflicts";
  stashApply?: "ok" | "conflicts";
  /** `continueOperation` stops on the next conflict instead of finishing. */
  continue?: "ok" | "conflicts";
  mergeTool?: "ok" | "notConfigured";
}

declare global {
  interface Window {
    __tyliaBranching?: MockBranchingScript;
  }
}

const script = (): MockBranchingScript => window.__tyliaBranching ?? {};

const fail = (
  kind: IpcErrorKind,
  message: string,
  command: string,
  extra: Partial<IpcError> = {},
): IpcError => ({ kind, message, command, stderr: null, ...extra });

const CONFLICT_FILE = "src/conflict.rs";

/** The conflicted file: context runs around two conflict blocks. */
const CONTEXT = [
  ["use crate::lexer::{lex, Token};", "", "pub fn parse(input: &str) -> Vec<Token> {"],
  [
    "    tokens",
    "}",
    "",
    "/// Trailers are the last paragraph's `Key: value` lines.",
    "pub fn trailers(msg: &str) -> Vec<&str> {",
  ],
  ["        .collect()", "}"],
];
const BLOCKS = [
  {
    ours: ["    let tokens = lex(input);"],
    theirs: ["    let tokens = lex(input.trim());"],
  },
  {
    ours: ["    msg.lines()", "        .filter(|l| l.contains(':'))"],
    theirs: [
      "    msg.lines()",
      "        .rev()",
      "        .take_while(|l| !l.is_empty())",
      '        .filter(|l| l.contains(": "))',
    ],
  },
];

type Methods = Pick<
  Backend,
  | "createBranch"
  | "checkout"
  | "renameBranch"
  | "deleteBranch"
  | "deleteRemoteBranch"
  | "setUpstream"
  | "createTag"
  | "deleteTag"
  | "pushTag"
  | "stashSave"
  | "stashApply"
  | "stashDrop"
  | "merge"
  | "rebase"
  | "cherryPick"
  | "applyPatchFile"
  | "cherryPickMany"
  | "revertMany"
  | "revert"
  | "reset"
  | "continueOperation"
  | "skipOperation"
  | "abortOperation"
  | "resolveWith"
  | "markResolved"
  | "mergeTool"
  | "diffTool"
  | "conflictFile"
  | "resolveBlock"
>;

interface Store<T> {
  get(): T;
  set(value: T): void;
}

export function branchingMock(
  refs: Store<RefsSnapshot>,
  status: Store<WorkingStatus>,
  transfer: (id: number, onProgress: (p: Progress) => void) => Promise<void>,
): Methods {
  /** Resolves a branch, tag or oid to an oid. */
  const resolve = (rev: string): string => {
    const r = refs.get();
    return (
      r.branches.find((b) => b.name === rev)?.oid ??
      r.tags.find((t) => t.name === rev)?.oid ??
      r.remotes.flatMap((x) => x.branches).find((b) => b.fullName === rev)?.oid ??
      rev
    );
  };

  const setHead = (branch: string | null, oid: string) => {
    const r = refs.get();
    refs.set({
      ...r,
      head: { branch, oid },
      branches: r.branches.map((b) => ({ ...b, isHead: b.name === branch })),
    });
    status.set({ ...status.get(), branch, headOid: oid });
  };

  /** Stops with a conflict in one file, as Git leaves it. */
  // How each conflict block of CONFLICT_FILE was resolved (null: still conflicted).
  let picked: (string[] | null)[] = BLOCKS.map(() => null);
  let version = 0;

  const conflictSegments = (): ConflictSegment[] => {
    const out: ConflictSegment[] = [];
    let line = 1;
    let index = 0;
    const addLines = (lines: string[]) => {
      const last = out[out.length - 1];
      if (last?.kind === "lines") last.lines.push(...lines);
      else out.push({ kind: "lines", first: line, lines: [...lines] });
      line += lines.length;
    };
    CONTEXT.forEach((context, i) => {
      addLines(context);
      const block = BLOCKS[i];
      if (!block) return;
      const resolved = picked[i];
      if (resolved) {
        addLines(resolved);
        return;
      }
      out.push({
        kind: "conflict",
        index: index++,
        first: line,
        oursLabel: "HEAD",
        theirsLabel: "feature/parser",
        ours: block.ours,
        base: null,
        theirs: block.theirs,
      });
      line += block.ours.length + block.theirs.length + 3;
    });
    return out;
  };

  const stopOnConflict = (kind: OperationKind, incoming: string) => {
    picked = BLOCKS.map(() => null);
    version++;
    const s = status.get();
    const r = refs.get();
    status.set({
      ...s,
      operation: {
        kind,
        incoming,
        branch: kind === "rebase" ? r.head.branch : null,
        onto: kind === "rebase" ? incoming.slice(0, 7) : null,
        step: kind === "rebase" || kind === "am" ? 1 : null,
        total: kind === "rebase" ? 3 : kind === "am" ? 2 : null,
        editing: false,
      },
      entries: [
        ...s.entries.filter((e) => e.path !== CONFLICT_FILE),
        {
          path: CONFLICT_FILE,
          oldPath: null,
          staged: null,
          unstaged: "unmerged",
          conflicted: true,
        },
      ],
    });
    return "conflicts" as const;
  };

  const finishOperation = () => {
    const s = status.get();
    status.set({
      ...s,
      operation: null,
      entries: s.entries.filter((e) => !e.conflicted && e.path !== CONFLICT_FILE),
    });
  };

  const resolveFiles = (paths: string[]) => {
    const s = status.get();
    status.set({
      ...s,
      entries: s.entries.map((e) =>
        paths.includes(e.path)
          ? { ...e, conflicted: false, unstaged: null, staged: "modified" }
          : e,
      ),
    });
  };

  return {
    createBranch: async (_repo, name, start, checkout) => {
      const r = refs.get();
      if (r.branches.some((b) => b.name === name)) {
        throw fail("gitFailed", `a branch named '${name}' already exists`, `git branch ${name}`);
      }
      const oid = resolve(start);
      refs.set({
        ...r,
        branches: [
          ...r.branches,
          {
            name,
            oid,
            upstream: null,
            upstreamRemote: null,
            upstreamBranch: null,
            ahead: 0,
            behind: 0,
            upstreamGone: false,
            isHead: false,
          },
        ].sort((a, b) => a.name.localeCompare(b.name)),
      });
      if (checkout) setHead(name, oid);
    },

    checkout: async (_repo, request) => {
      const outcome = script().checkout ?? "ok";
      if (outcome === "localChanges" && !request.stash) {
        throw fail("localChanges", "local changes would be overwritten", "git switch", {
          files: ["src/parser.rs", "README.md"],
          stderr:
            "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/parser.rs\n\tREADME.md\nPlease commit your changes or stash them before you switch branches.\nAborting",
        });
      }
      const t = request.target;
      if (t.kind === "branch") setHead(t.name, resolve(t.name));
      else if (t.kind === "detached") setHead(null, t.oid);
      else {
        const [remote, ...rest] = t.remoteBranch.split("/");
        const branch = rest.join("/");
        const r = refs.get();
        const oid = resolve(t.remoteBranch);
        refs.set({
          ...r,
          branches: [
            ...r.branches,
            {
              name: t.localName,
              oid,
              upstream: t.remoteBranch,
              upstreamRemote: remote ?? null,
              upstreamBranch: branch,
              ahead: 0,
              behind: 0,
              upstreamGone: false,
              isHead: false,
            },
          ].sort((a, b) => a.name.localeCompare(b.name)),
        });
        setHead(t.localName, oid);
      }
      if (request.stash && outcome === "stashConflicts") {
        const s = status.get();
        status.set({
          ...s,
          entries: s.entries.map((e, i) => (i === 0 ? { ...e, conflicted: true } : e)),
        });
        return "stashConflicts";
      }
      return "done";
    },

    renameBranch: async (_repo, name, newName) => {
      const r = refs.get();
      refs.set({
        ...r,
        head: r.head.branch === name ? { ...r.head, branch: newName } : r.head,
        branches: r.branches.map((b) => (b.name === name ? { ...b, name: newName } : b)),
      });
    },

    deleteBranch: async (_repo, name, force) => {
      if (!force && script().deleteBranch === "notFullyMerged") {
        throw fail(
          "notFullyMerged",
          "the branch has commits that aren't merged",
          `git branch -d ${name}`,
          {
            stderr: `error: The branch '${name}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${name}'.`,
          },
        );
      }
      const r = refs.get();
      refs.set({ ...r, branches: r.branches.filter((b) => b.name !== name) });
    },

    deleteRemoteBranch: async (_repo, remote, branch, id, onProgress) => {
      await transfer(id, onProgress);
      const r = refs.get();
      refs.set({
        ...r,
        remotes: r.remotes.map((x) =>
          x.name === remote ? { ...x, branches: x.branches.filter((b) => b.name !== branch) } : x,
        ),
      });
    },

    setUpstream: async (_repo, branch, upstream) => {
      const r = refs.get();
      const [remote, ...rest] = upstream?.split("/") ?? [];
      refs.set({
        ...r,
        branches: r.branches.map((b) =>
          b.name !== branch
            ? b
            : {
                ...b,
                upstream,
                upstreamRemote: upstream ? (remote ?? null) : null,
                upstreamBranch: upstream ? rest.join("/") : null,
                ahead: 0,
                behind: 0,
              },
        ),
      });
    },

    createTag: async (_repo, name, target, message) => {
      const r = refs.get();
      if (r.tags.some((t) => t.name === name)) {
        throw fail("gitFailed", `tag '${name}' already exists`, `git tag ${name}`);
      }
      refs.set({
        ...r,
        tags: [...r.tags, { name, oid: resolve(target), annotated: message !== null }].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      });
    },

    deleteTag: async (_repo, name) => {
      const r = refs.get();
      refs.set({ ...r, tags: r.tags.filter((t) => t.name !== name) });
    },

    pushTag: async (_repo, _remote, _name, id, onProgress) => transfer(id, onProgress),

    stashSave: async (_repo, request) => {
      const s = status.get();
      const entries = request.includeUntracked
        ? s.entries
        : s.entries.filter((e) => e.unstaged !== "untracked");
      if (entries.length === 0) return false;
      const r = refs.get();
      const branch = r.head.branch ?? "HEAD";
      const message = request.message || `WIP on ${branch}`;
      refs.set({
        ...r,
        stashes: [
          {
            name: "stash@{0}",
            oid: "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a",
            time: Math.floor(Date.now() / 1000),
            message: request.message ? `On ${branch}: ${message}` : message,
          },
          ...r.stashes.map((x, i) => ({ ...x, name: `stash@{${i + 1}}` })),
        ],
      });
      status.set({
        ...s,
        entries: s.entries.filter(
          (e) =>
            (request.keepIndex && e.staged) ||
            (!request.includeUntracked && e.unstaged === "untracked"),
        ),
      });
      return true;
    },

    stashApply: async (_repo, index, pop) => {
      if (script().stashApply === "conflicts") {
        stopOnConflict("merge", `stash@{${index}}`);
        status.set({ ...status.get(), operation: null });
        return "conflicts";
      }
      if (pop) {
        const r = refs.get();
        refs.set({
          ...r,
          stashes: r.stashes
            .filter((_, i) => i !== index)
            .map((x, i) => ({ ...x, name: `stash@{${i}}` })),
        });
      }
      return "applied";
    },

    stashDrop: async (_repo, index) => {
      const r = refs.get();
      refs.set({
        ...r,
        stashes: r.stashes
          .filter((_, i) => i !== index)
          .map((x, i) => ({ ...x, name: `stash@{${i}}` })),
      });
    },

    merge: async (_repo, rev) => {
      const outcome = script().merge ?? "ok";
      if (outcome === "conflicts") return stopOnConflict("merge", rev);
      if (outcome === "upToDate") return "upToDate";
      if (outcome === "fastForward") return "fastForward";
      return "done";
    },
    rebase: async (_repo, onto) =>
      script().rebase === "conflicts" ? stopOnConflict("rebase", resolve(onto)) : "done",
    cherryPick: async (_repo, oid) =>
      script().cherryPick === "conflicts" ? stopOnConflict("cherryPick", oid.slice(0, 7)) : "done",
    cherryPickMany: async (_repo, oids) =>
      script().cherryPick === "conflicts"
        ? stopOnConflict("cherryPick", oids[0]!.slice(0, 7))
        : "done",
    revertMany: async (_repo, oids) =>
      script().revert === "conflicts" ? stopOnConflict("revert", oids[0]!.slice(0, 7)) : "done",
    applyPatchFile: async (_repo, _file, mode) =>
      mode === "commits" && script().applyPatch === "conflicts"
        ? stopOnConflict("am", "parser: handle empty input")
        : "done",
    revert: async (_repo, oid) =>
      script().revert === "conflicts" ? stopOnConflict("revert", oid.slice(0, 7)) : "done",
    reset: async (_repo, oid, mode) => {
      const r = refs.get();
      if (r.head.branch) {
        refs.set({
          ...r,
          head: { ...r.head, oid },
          branches: r.branches.map((b) => (b.name === r.head.branch ? { ...b, oid } : b)),
        });
      }
      if (mode === "hard") {
        const s = status.get();
        status.set({ ...s, entries: s.entries.filter((e) => e.unstaged === "untracked") });
      }
    },

    continueOperation: async () => {
      const s = status.get();
      if (s.entries.some((e) => e.conflicted)) {
        throw fail(
          "gitFailed",
          "`git merge --continue` exited with code 128",
          "git merge --continue",
          {
            stderr: "error: Committing is not possible because you have unmerged files.",
          },
        );
      }
      if (script().continue === "conflicts" && s.operation?.kind === "rebase") {
        stopOnConflict("rebase", s.operation.onto ?? "");
        status.set({
          ...status.get(),
          operation: { ...s.operation, step: (s.operation.step ?? 1) + 1 },
        });
        return "conflicts";
      }
      finishOperation();
      return "done";
    },
    skipOperation: async () => {
      finishOperation();
      return "done";
    },
    abortOperation: async () => finishOperation(),
    resolveWith: async (_repo, paths) => resolveFiles(paths),
    markResolved: async (_repo, paths) => resolveFiles(paths),
    conflictFile: async (_repo, path) => ({
      path,
      fingerprint: String(version),
      segments: path === CONFLICT_FILE && picked.some((p) => p === null) ? conflictSegments() : [],
    }),
    resolveBlock: async (_repo, path, index, resolution, fingerprint) => {
      if (fingerprint !== String(version)) {
        throw fail("invalidInput", `${path} changed since it was shown.`, "");
      }
      // `index` counts the blocks still conflicted.
      const open = picked.flatMap((p, i) => (p === null ? [i] : []));
      const i = open[index];
      const block = i === undefined ? undefined : BLOCKS[i];
      if (i === undefined || !block)
        throw fail("invalidInput", `No conflict block ${index + 1}.`, "");
      picked[i] =
        resolution === "ours"
          ? block.ours
          : resolution === "theirs"
            ? block.theirs
            : [...block.ours, ...block.theirs];
      version++;
      const remaining = open.length - 1;
      if (remaining === 0) resolveFiles([path]);
      return { remaining, resolved: remaining === 0 };
    },
    diffTool: async (_repo, request) => {
      throw fail(
        "invalidInput",
        "No diff tool is configured. Set diff.tool (or diff.guitool) in your Git config to a graphical diff tool, such as meld, kdiff3, bc or vscode.",
        `git difftool --no-prompt -- ${request.path}`,
      );
    },
    mergeTool: async (_repo, path) => {
      if ((script().mergeTool ?? "notConfigured") === "notConfigured") {
        throw fail(
          "invalidInput",
          "No merge tool is configured. Set one with `git config --global merge.tool <tool>`.",
          `git mergetool -- ${path}`,
        );
      }
    },
  };
}
