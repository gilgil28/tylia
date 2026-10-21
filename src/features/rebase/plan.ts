// The interactive rebase editor's model: rows in the new order with their actions, what the
// result will look like, and the plan sent to the backend (which validates it again and does
// the work — see `crates/tylia-git/src/rebase.rs`).

import type { TodoCommit, TodoItem } from "@/ipc";

export type ActionKind = TodoItem["action"]["kind"];

export const ACTIONS: ActionKind[] = ["pick", "reword", "edit", "squash", "fixup", "drop"];

/** Row shortcuts, as in Git's todo list. */
export const ACTION_KEYS: Record<string, ActionKind> = {
  p: "pick",
  r: "reword",
  e: "edit",
  s: "squash",
  f: "fixup",
  d: "drop",
};

export interface Row {
  oid: string;
  action: ActionKind;
  /** Reword: the new message as edited (`null` until edited: the original). */
  message: string | null;
}

export interface PlanState {
  rows: Row[];
  /** The combined message of a squash group, by the group's first (target) commit. */
  groupMessages: Record<string, string>;
}

export type RowError = "noTarget" | "emptyMessage";

export interface ResultCommit {
  /** The commit the result is made from (the group's target). */
  oid: string;
  subject: string;
  /** Commits squashed / fixed up into it. */
  folded: number;
  edit: boolean;
  /** Its message changes (reword or squash). */
  newMessage: boolean;
  /** Gets a new id (it comes after the first change). */
  rewritten: boolean;
}

export interface Analysis {
  /** For squash / fixup rows: the row index they fold into (`null`: none, an error). */
  targetOf: (number | null)[];
  /** Target row index → the row that holds the group's combined-message editor. */
  messageRow: Map<number, number>;
  errors: Map<number, RowError>;
  allDropped: boolean;
  /** The first row that differs from Git's own todo (rows.length: nothing changed). */
  firstChange: number;
  result: ResultCommit[];
  dropped: number;
  /** Commits after the first change that are already on a remote. */
  pushedRewritten: number;
}

export function initialState(commits: TodoCommit[]): PlanState {
  return {
    rows: commits.map((c) => ({ oid: c.oid, action: "pick", message: null })),
    groupMessages: {},
  };
}

/** Moves the row at `from` to `to`. */
export function moveRow(rows: Row[], from: number, to: number): Row[] {
  if (from === to || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

const folds = (a: ActionKind) => a === "squash" || a === "fixup";
const isTarget = (a: ActionKind) => a === "pick" || a === "reword" || a === "edit";

/** The message the target row's commit ends up with before any squashes. */
function ownMessage(row: Row, commit: TodoCommit): string {
  return row.action === "reword" ? (row.message ?? commit.message) : commit.message;
}

/** Git's default for a squash: the messages joined with a blank line between them. */
export function defaultGroupMessage(
  rows: Row[],
  target: number,
  byOid: Map<string, TodoCommit>,
): string {
  const parts = [ownMessage(rows[target]!, byOid.get(rows[target]!.oid)!)];
  for (const row of rows.slice(target + 1)) {
    if (row.action === "squash") parts.push(byOid.get(row.oid)!.message);
    else if (row.action !== "fixup" && row.action !== "drop") break;
  }
  return parts.map((p) => p.trim()).join("\n\n");
}

/** The combined message of the group starting at `target`: as edited, else Git's default. */
export function groupMessage(state: PlanState, target: number, byOid: Map<string, TodoCommit>) {
  const oid = state.rows[target]!.oid;
  return state.groupMessages[oid] ?? defaultGroupMessage(state.rows, target, byOid);
}

export function analyze(
  state: PlanState,
  commits: TodoCommit[],
  byOid: Map<string, TodoCommit>,
): Analysis {
  const { rows } = state;
  const targetOf: (number | null)[] = rows.map(() => null);
  const messageRow = new Map<number, number>();
  const errors = new Map<number, RowError>();
  const hasSquash = new Set<number>();
  const isGroupTarget = new Set<number>();
  let target: number | null = null;
  rows.forEach((row, i) => {
    if (isTarget(row.action)) target = i;
    if (!folds(row.action)) return;
    targetOf[i] = target;
    if (target === null) {
      errors.set(i, "noTarget");
      return;
    }
    isGroupTarget.add(target);
    if (row.action === "squash") {
      hasSquash.add(target);
      messageRow.set(target, i);
    }
  });
  rows.forEach((row, i) => {
    if (row.action === "reword" && (row.message ?? byOid.get(row.oid)!.message).trim() === "") {
      errors.set(i, "emptyMessage");
    }
  });
  for (const [t, at] of messageRow) {
    if (groupMessage(state, t, byOid).trim() === "") errors.set(at, "emptyMessage");
  }

  let firstChange = rows.length;
  rows.forEach((row, i) => {
    const changed = row.oid !== commits[i]?.oid || row.action !== "pick" || isGroupTarget.has(i);
    if (changed && i < firstChange) firstChange = i;
  });

  const result: ResultCommit[] = [];
  rows.forEach((row, i) => {
    if (!isTarget(row.action)) return;
    const commit = byOid.get(row.oid)!;
    const message = hasSquash.has(i) ? groupMessage(state, i, byOid) : ownMessage(row, commit);
    result.push({
      oid: row.oid,
      subject: message.trim().split("\n")[0] ?? "",
      folded: targetOf.filter((t) => t === i).length,
      edit: row.action === "edit",
      newMessage: message.trim() !== commit.message.trim(),
      rewritten: i >= firstChange,
    });
  });

  return {
    targetOf,
    messageRow,
    errors,
    allDropped: rows.length > 0 && rows.every((r) => r.action === "drop"),
    firstChange,
    result,
    dropped: rows.filter((r) => r.action === "drop").length,
    pushedRewritten: rows.filter((r, i) => i >= firstChange && byOid.get(r.oid)!.pushed).length,
  };
}

/** The plan for `rebaseInteractive`. */
export function toPlan(
  state: PlanState,
  analysis: Analysis,
  byOid: Map<string, TodoCommit>,
): TodoItem[] {
  const editorRows = new Map([...analysis.messageRow].map(([t, at]) => [at, t]));
  return state.rows.map((row, i): TodoItem => {
    const commit = byOid.get(row.oid)!;
    switch (row.action) {
      case "reword":
        return { oid: row.oid, action: { kind: "reword", message: row.message ?? commit.message } };
      case "squash": {
        const t = editorRows.get(i);
        const edited = t === undefined ? undefined : state.groupMessages[state.rows[t]!.oid];
        return { oid: row.oid, action: { kind: "squash", message: edited ?? null } };
      }
      default:
        return { oid: row.oid, action: { kind: row.action } };
    }
  });
}
