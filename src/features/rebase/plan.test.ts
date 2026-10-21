import { describe, expect, it } from "vitest";

import type { TodoCommit } from "@/ipc";

import { analyze, initialState, moveRow, toPlan, type ActionKind, type PlanState } from "./plan";

const commit = (oid: string, pushed = false): TodoCommit => ({
  oid,
  subject: oid.toUpperCase(),
  message: `${oid.toUpperCase()}\n\nBody of ${oid}.`,
  authorName: "Ada",
  authorEmail: "ada@example.com",
  time: 0,
  pushed,
});

const commits = [commit("a", true), commit("b", true), commit("c"), commit("d")];
const byOid = new Map(commits.map((c) => [c.oid, c]));

function withActions(actions: ActionKind[], order = ["a", "b", "c", "d"]): PlanState {
  return {
    rows: order.map((oid, i) => ({ oid, action: actions[i]!, message: null })),
    groupMessages: {},
  };
}

describe("rebase plan", () => {
  it("starts unchanged", () => {
    const a = analyze(initialState(commits), commits, byOid);
    expect(a.firstChange).toBe(4);
    expect(a.result.map((r) => r.subject)).toEqual(["A", "B", "C", "D"]);
    expect(a.result.every((r) => !r.rewritten)).toBe(true);
    expect(a.errors.size).toBe(0);
  });

  it("moves rows", () => {
    const rows = initialState(commits).rows;
    expect(moveRow(rows, 3, 0).map((r) => r.oid)).toEqual(["d", "a", "b", "c"]);
    expect(moveRow(rows, 0, 9)).toBe(rows);
  });

  it("folds squashes and fixups into the commit above", () => {
    const state = withActions(["pick", "squash", "drop", "fixup"]);
    const a = analyze(state, commits, byOid);
    expect(a.targetOf).toEqual([null, 0, null, 0]);
    expect(a.messageRow.get(0)).toBe(1);
    expect(a.result).toHaveLength(1);
    expect(a.result[0]).toMatchObject({ oid: "a", folded: 2, newMessage: true, rewritten: true });
    expect(a.result[0]!.subject).toBe("A");
    expect(a.firstChange).toBe(0);
    expect(a.pushedRewritten).toBe(2);
    expect(a.dropped).toBe(1);
    // Git's default message: both messages.
    const plan = toPlan(state, a, byOid);
    expect(plan[1]!.action).toEqual({ kind: "squash", message: null });
  });

  it("sends an edited combined message on the group's last squash", () => {
    const state = withActions(["pick", "squash", "squash", "pick"]);
    state.groupMessages = { a: "All three" };
    const a = analyze(state, commits, byOid);
    expect(a.messageRow.get(0)).toBe(2);
    expect(a.result[0]!.subject).toBe("All three");
    const plan = toPlan(state, a, byOid);
    expect(plan[1]!.action).toEqual({ kind: "squash", message: null });
    expect(plan[2]!.action).toEqual({ kind: "squash", message: "All three" });
  });

  it("keeps the unchanged prefix", () => {
    const state = withActions(["pick", "pick", "pick", "pick"], ["a", "b", "d", "c"]);
    const a = analyze(state, commits, byOid);
    expect(a.firstChange).toBe(2);
    expect(a.result.map((r) => r.rewritten)).toEqual([false, false, true, true]);
    expect(a.pushedRewritten).toBe(0);
  });

  it("a fixup rewrites its target", () => {
    const state = withActions(["pick", "pick", "pick", "fixup"]);
    expect(analyze(state, commits, byOid).firstChange).toBe(2);
  });

  it("reports errors", () => {
    let a = analyze(withActions(["fixup", "pick", "pick", "pick"]), commits, byOid);
    expect(a.errors.get(0)).toBe("noTarget");
    a = analyze(withActions(["drop", "squash", "pick", "pick"]), commits, byOid);
    expect(a.errors.get(1)).toBe("noTarget");
    const state = withActions(["pick", "reword", "pick", "pick"]);
    state.rows[1]!.message = "  \n";
    a = analyze(state, commits, byOid);
    expect(a.errors.get(1)).toBe("emptyMessage");
    a = analyze(withActions(["drop", "drop", "drop", "drop"]), commits, byOid);
    expect(a.allDropped).toBe(true);
  });

  it("rewords", () => {
    const state = withActions(["pick", "reword", "pick", "pick"]);
    state.rows[1]!.message = "New B";
    const a = analyze(state, commits, byOid);
    expect(a.result[1]).toMatchObject({ subject: "New B", newMessage: true });
    expect(toPlan(state, a, byOid)[1]!.action).toEqual({ kind: "reword", message: "New B" });
  });
});
