// Interactive rebase in browser mode. The todo list comes from the fixture's history (first
// parents from HEAD back to the base); running a plan doesn't rewrite the fixture, it only
// reports the outcome — `stopped` (with the rebase in progress) when the plan has an `edit`.
// `window.__tyliaRebase = { outcome: "conflicts" }` makes it stop on a conflict instead.

import type { Backend } from "../backend";
import type { CommitDetails } from "../bindings/CommitDetails";
import type { HistoryRow } from "../bindings/HistoryRow";
import type { IpcError } from "../bindings/IpcError";
import type { RefsSnapshot } from "../bindings/RefsSnapshot";
import type { TodoCommit } from "../bindings/TodoCommit";
import type { WorkingStatus } from "../bindings/WorkingStatus";

export interface MockRebaseScript {
  outcome?: "ok" | "conflicts";
}

declare global {
  interface Window {
    __tyliaRebase?: MockRebaseScript;
  }
}

const invalid = (message: string): IpcError => ({
  kind: "invalidInput",
  message,
  command: null,
  stderr: null,
});

interface Store<T> {
  get(): T;
  set(value: T): void;
}

type Methods = Pick<Backend, "rebaseTodo" | "isRebaseBase" | "rebaseInteractive">;

export function rebaseMock(
  history: HistoryRow[],
  commits: Record<string, CommitDetails>,
  refs: Store<RefsSnapshot>,
  status: Store<WorkingStatus>,
): Methods {
  const byOid = new Map(history.map((r) => [r.oid, r]));

  /** Every commit reachable from `tips`. */
  const reachable = (tips: string[]) => {
    const seen = new Set<string>();
    const stack = [...tips];
    while (stack.length) {
      const oid = stack.pop()!;
      if (seen.has(oid)) continue;
      seen.add(oid);
      stack.push(...(byOid.get(oid)?.parents ?? []));
    }
    return seen;
  };

  const range = (base: string): TodoCommit[] => {
    const head = refs.get().head.oid;
    if (!head || base === head) {
      throw invalid("There are no commits after this one on the current branch.");
    }
    const pushed = reachable(refs.get().remotes.flatMap((r) => r.branches.map((b) => b.oid)));
    const out: TodoCommit[] = [];
    let oid: string | undefined = head;
    while (oid && oid !== base) {
      const row = byOid.get(oid);
      if (!row) break;
      if (row.parents.length > 1) {
        throw invalid(
          "The commits after this one include a merge commit. Interactive rebase in Tylia works on a straight line of commits; start from a commit after the merge.",
        );
      }
      const details = commits[oid];
      out.push({
        oid,
        subject: row.subject,
        message: details?.body ? `${row.subject}\n\n${details.body}` : row.subject,
        authorName: row.authorName,
        authorEmail: row.authorEmail,
        time: row.time,
        pushed: pushed.has(oid),
      });
      oid = row.parents[0];
    }
    if (oid !== base) {
      throw invalid(
        "This commit isn’t on the current branch, so there’s nothing to rebase from it.",
      );
    }
    return out.reverse();
  };

  return {
    rebaseTodo: async (_repo, base) => ({
      base,
      branch: refs.get().head.branch,
      commits: range(base),
    }),

    isRebaseBase: async (_repo, oid) => {
      const head = refs.get().head.oid;
      return !!head && oid !== head && reachable([head]).has(oid);
    },

    rebaseInteractive: async (_repo, base, plan) => {
      const todo = range(base);
      const oids = new Set(todo.map((c) => c.oid));
      if (plan.length !== todo.length || plan.some((p) => !oids.has(p.oid))) {
        throw invalid(
          "The plan doesn’t list every commit being rebased. The branch may have changed; reopen the editor.",
        );
      }
      const s = status.get();
      const operation = {
        kind: "rebase" as const,
        branch: refs.get().head.branch,
        onto: base.slice(0, 7),
        total: plan.filter((p) => p.action.kind !== "drop").length,
      };
      if (window.__tyliaRebase?.outcome === "conflicts") {
        status.set({
          ...s,
          operation: { ...operation, incoming: plan[0]!.oid.slice(0, 7), step: 1, editing: false },
          entries: [
            ...s.entries,
            {
              path: "src/conflict.rs",
              oldPath: null,
              staged: null,
              unstaged: "unmerged",
              conflicted: true,
            },
          ],
        });
        return "conflicts";
      }
      const edit = plan.findIndex((p) => p.action.kind === "edit");
      if (edit >= 0) {
        status.set({
          ...s,
          operation: {
            ...operation,
            incoming: plan[edit]!.oid.slice(0, 7),
            step: edit + 1,
            editing: true,
          },
        });
        return "stopped";
      }
      const unchanged = plan.every((p, i) => p.oid === todo[i]!.oid && p.action.kind === "pick");
      return unchanged ? "upToDate" : "done";
    },
  };
}
