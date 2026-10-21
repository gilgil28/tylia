// Fetch, pull, push and remote management in browser mode. Outcomes are scripted through
// `window.__tyliaRemote` (Playwright sets it), e.g. `{ push: "behind" }`; by default
// everything succeeds after a short simulated transfer.

import type { Backend } from "../backend";
import type { IpcError } from "../bindings/IpcError";
import type { IpcErrorKind } from "../bindings/IpcErrorKind";
import type { Progress } from "../bindings/Progress";
import type { RefsSnapshot } from "../bindings/RefsSnapshot";

export interface MockRemoteScript {
  push?: "ok" | "behind" | "stale" | "rejected" | "auth";
  pull?: "ok" | "upToDate" | "conflicts";
  fetch?: "ok" | "fail";
  /** Milliseconds per progress step (default 60). */
  stepMs?: number;
}

declare global {
  interface Window {
    __tyliaRemote?: MockRemoteScript;
  }
}

const script = (): MockRemoteScript => window.__tyliaRemote ?? {};

const fail = (kind: IpcErrorKind, message: string, command: string, stderr = ""): IpcError => ({
  kind,
  message,
  command,
  stderr: stderr || null,
});

/** Reports Git-like progress; throws `cancelled` when the operation is cancelled. */
export async function transfer(
  id: number,
  onProgress: (p: Progress) => void,
  cancelled: Set<number>,
  phases: string[],
) {
  const step = script().stepMs ?? 60;
  for (const phase of phases) {
    for (let percent = 0; percent <= 100; percent += 25) {
      if (cancelled.delete(id)) throw fail("cancelled", "cancelled", "git");
      onProgress({ phase, percent, current: percent, total: 100 });
      await new Promise((r) => setTimeout(r, step));
    }
  }
}

type RemoteMethods = Pick<
  Backend,
  "fetch" | "pull" | "push" | "addRemote" | "setRemoteUrl" | "renameRemote" | "removeRemote"
>;

/**
 * The remote half of the mock. `refs` is the mock's current snapshot: read through `get`,
 * replaced (never mutated) through `set`, so cached queries see new objects.
 */
export function remoteMock(
  get: () => RefsSnapshot,
  set: (refs: RefsSnapshot) => void,
  cancelled: Set<number>,
): RemoteMethods {
  const updateBranch = (name: string, patch: Partial<RefsSnapshot["branches"][number]>) => {
    const refs = get();
    set({
      ...refs,
      branches: refs.branches.map((b) => (b.name === name ? { ...b, ...patch } : b)),
    });
  };

  return {
    fetch: async (_repo, _request, _quiet, id, onProgress) => {
      await transfer(id, onProgress, cancelled, ["Counting objects", "Receiving objects"]);
      if (script().fetch === "fail") {
        throw fail(
          "gitFailed",
          "`git fetch --progress --all` exited with code 128",
          "git fetch --progress --all",
          "fatal: unable to access 'https://github.com/tylia-dev/tylia-demo.git/': Could not resolve host: github.com",
        );
      }
    },

    pull: async (_repo, _mode, id, onProgress) => {
      const refs = get();
      const branch = refs.branches.find((b) => b.name === refs.head.branch);
      if (!branch?.upstream) {
        throw fail(
          "invalidInput",
          `${branch?.name ?? "HEAD"} has no upstream branch to pull from. Push it first.`,
          "git pull",
        );
      }
      await transfer(id, onProgress, cancelled, ["Receiving objects", "Resolving deltas"]);
      const outcome = script().pull ?? (branch.behind > 0 ? "ok" : "upToDate");
      if (outcome === "conflicts") return "conflicts";
      if (outcome === "upToDate") return "upToDate";
      updateBranch(branch.name, { behind: 0 });
      return "updated";
    },

    push: async (_repo, request, id, onProgress) => {
      const command = `git push --progress --porcelain -- ${request.remote} refs/heads/${request.branch}:refs/heads/${request.remoteBranch}`;
      const outcome = script().push ?? "ok";
      if (outcome === "auth") {
        const answer = await window.__tyliaAskpass?.raise({
          kind: "password",
          prompt: `Password for 'https://ada@github.com': `,
          host: "github.com",
          detail: "ada",
          operationId: id,
        });
        if (answer == null) {
          if (cancelled.delete(id)) throw fail("cancelled", "cancelled", command);
          throw fail(
            "gitFailed",
            "`git push` exited with code 128",
            command,
            "fatal: Authentication failed for 'https://github.com/tylia-dev/tylia-demo.git/'",
          );
        }
      }
      await transfer(id, onProgress, cancelled, [
        "Enumerating objects",
        "Compressing objects",
        "Writing objects",
      ]);
      const reasons = {
        behind: ["pushBehind", "[rejected] (fetch first)"],
        stale: ["pushStale", "[rejected] (stale info)"],
        rejected: ["pushRejected", "[remote rejected] (protected branch hook declined)"],
      } as const;
      if (outcome in reasons) {
        const [kind, summary] = reasons[outcome as keyof typeof reasons];
        throw fail(
          kind,
          "the remote refused the push",
          command,
          `To https://github.com/tylia-dev/tylia-demo.git\n!\trefs/heads/${request.branch}:refs/heads/${request.remoteBranch}\t${summary}\nDone`,
        );
      }
      const refs = get();
      const branch = refs.branches.find((b) => b.name === request.branch);
      if (!branch) return "upToDate";
      const fullName = `${request.remote}/${request.remoteBranch}`;
      const pushed =
        branch.ahead > 0 ||
        !refs.remotes.some((r) => r.branches.some((b) => b.fullName === fullName));
      set({
        ...refs,
        branches: refs.branches.map((b) =>
          b.name !== branch.name
            ? b
            : request.setUpstream
              ? {
                  ...b,
                  upstream: fullName,
                  upstreamRemote: request.remote,
                  upstreamBranch: request.remoteBranch,
                  upstreamGone: false,
                  ahead: 0,
                  behind: 0,
                }
              : { ...b, ahead: b.upstream === fullName ? 0 : b.ahead },
        ),
        remotes: refs.remotes.map((r) =>
          r.name !== request.remote
            ? r
            : {
                ...r,
                branches: [
                  ...r.branches.filter((b) => b.name !== request.remoteBranch),
                  { name: request.remoteBranch, fullName, oid: branch.oid },
                ].sort((a, b) => a.name.localeCompare(b.name)),
              },
        ),
      });
      return pushed ? "pushed" : "upToDate";
    },

    addRemote: async (_repo, name, url) => {
      const refs = get();
      if (refs.remotes.some((r) => r.name === name)) {
        throw fail(
          "gitFailed",
          "`git remote add` exited with code 3",
          `git remote add -- ${name} ${url}`,
          `error: remote ${name} already exists.`,
        );
      }
      set({
        ...refs,
        remotes: [...refs.remotes, { name, url, pushUrl: null, branches: [] }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      });
    },

    setRemoteUrl: async (_repo, name, url, push) => {
      const refs = get();
      set({
        ...refs,
        remotes: refs.remotes.map((r) =>
          r.name !== name ? r : push ? { ...r, pushUrl: url || null } : { ...r, url },
        ),
      });
    },

    renameRemote: async (_repo, name, newName) => {
      const refs = get();
      set({
        ...refs,
        remotes: refs.remotes
          .map((r) =>
            r.name !== name
              ? r
              : {
                  ...r,
                  name: newName,
                  branches: r.branches.map((b) => ({ ...b, fullName: `${newName}/${b.name}` })),
                },
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
        branches: refs.branches.map((b) =>
          b.upstreamRemote !== name
            ? b
            : { ...b, upstreamRemote: newName, upstream: `${newName}/${b.upstreamBranch}` },
        ),
      });
    },

    removeRemote: async (_repo, name) => {
      const refs = get();
      set({
        ...refs,
        remotes: refs.remotes.filter((r) => r.name !== name),
        branches: refs.branches.map((b) =>
          b.upstreamRemote !== name
            ? b
            : {
                ...b,
                upstream: null,
                upstreamRemote: null,
                upstreamBranch: null,
                ahead: 0,
                behind: 0,
              },
        ),
      });
    },
  };
}
