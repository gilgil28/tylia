import { beforeEach, describe, expect, it } from "vitest";

import { testing, useWorkspace } from "./workspace";

const repo = (name: string) => ({ path: `/r/${name}`, name, gitDir: `/r/${name}/.git` });

describe("workspace", () => {
  beforeEach(() => useWorkspace.setState({ ...testing.initial(), loaded: true }));

  it("opens a repo in the active welcome tab, then in new tabs", () => {
    const ws = useWorkspace.getState();
    ws.openRepo(repo("a"));
    let s = useWorkspace.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ kind: "repo", name: "a" });
    s.openRepo(repo("b"));
    s = useWorkspace.getState();
    expect(s.tabs.map((t) => (t.kind === "repo" ? t.name : "welcome"))).toEqual(["a", "b"]);
    expect(s.recent.map((r) => r.name)).toEqual(["b", "a"]);
  });

  it("re-activates an already open repo", () => {
    const ws = useWorkspace.getState();
    ws.openRepo(repo("a"));
    useWorkspace.getState().newTab();
    useWorkspace.getState().openRepo(repo("a"));
    const s = useWorkspace.getState();
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    expect(active).toMatchObject({ kind: "repo", name: "a" });
    expect(s.tabs.filter((t) => t.kind === "repo")).toHaveLength(1);
  });

  it("closing the last tab leaves a welcome tab", () => {
    const s = useWorkspace.getState();
    s.closeTab(s.tabs[0]!.id);
    const after = useWorkspace.getState();
    expect(after.tabs).toHaveLength(1);
    expect(after.tabs[0]!.kind).toBe("welcome");
    expect(after.activeTabId).toBe(after.tabs[0]!.id);
  });

  it("moves tabs and activates by index (9 = last)", () => {
    const ws = useWorkspace.getState();
    ws.openRepo(repo("a"));
    useWorkspace.getState().openRepo(repo("b"));
    useWorkspace.getState().openRepo(repo("c"));
    useWorkspace.getState().moveTab(2, 0);
    const s = useWorkspace.getState();
    expect(s.tabs.map((t) => (t.kind === "repo" ? t.name : ""))).toEqual(["c", "a", "b"]);
    s.activateIndex(8);
    expect(useWorkspace.getState().activeTabId).toBe(s.tabs[2]!.id);
  });

  it("restores only well-formed state", () => {
    expect(testing.restore(null).tabs).toHaveLength(1);
    expect(testing.restore({ version: 2 }).tabs[0]!.kind).toBe("welcome");
    const restored = testing.restore({
      version: 1,
      tabs: [{ id: "x", kind: "repo", path: "/r/a", name: "a" }, { bogus: true }],
      activeTabId: "missing",
      recent: [{ path: "/r/a", name: "a", lastOpened: 1 }, 42],
      diffMode: "split",
    });
    expect(restored.tabs).toHaveLength(1);
    expect(restored.activeTabId).toBe("x");
    expect(restored.recent).toHaveLength(1);
    expect(restored.diffMode).toBe("split");
  });
});
