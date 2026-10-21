import { describe, expect, it } from "vitest";

import type { Hunk, WorkingStatus } from "@/ipc";

import {
  changedLines,
  discardOptimistic,
  stageOptimistic,
  unstageOptimistic,
  groupChanges,
  ignoreOptions,
  keysToLines,
  unstagePaths,
} from "./changes-model";

const status: WorkingStatus = {
  entries: [
    {
      path: "src/b.ts",
      oldPath: null,
      staged: "modified",
      unstaged: "modified",
      conflicted: false,
    },
    { path: "a.md", oldPath: null, staged: null, unstaged: "untracked", conflicted: false },
    {
      path: "lib/new.rs",
      oldPath: "lib/old.rs",
      staged: "renamed",
      unstaged: null,
      conflicted: false,
    },
  ],
  headOid: "abc",
  branch: "main",
  upstream: null,
  ahead: 0,
  behind: 0,
  operation: null,
};

describe("groupChanges", () => {
  it("puts a file in both lists when it has staged and unstaged changes", () => {
    const { unstaged, staged } = groupChanges(status);
    expect(unstaged.map((e) => [e.path, e.target])).toEqual([
      ["a.md", "untracked"],
      ["src/b.ts", "unstaged"],
    ]);
    expect(staged.map((e) => e.path)).toEqual(["lib/new.rs", "src/b.ts"]);
    expect(unstagePaths(staged)).toEqual(["lib/old.rs", "lib/new.rs", "src/b.ts"]);
  });
});

describe("line helpers", () => {
  const hunk = {
    heading: "",
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
    lines: [
      { kind: "context", oldLine: 1, newLine: 1, text: "a", noNewline: false, emphasis: [] },
      { kind: "del", oldLine: 2, newLine: null, text: "b", noNewline: false, emphasis: [] },
      { kind: "add", oldLine: null, newLine: 2, text: "c", noNewline: false, emphasis: [] },
    ],
  } satisfies Hunk;

  it("lists changed lines of a hunk", () => {
    expect(changedLines(hunk, 3)).toEqual([
      [3, 1],
      [3, 2],
    ]);
  });

  it("orders selection keys", () => {
    expect(keysToLines(["1:4", "0:9", "1:2"])).toEqual([
      [0, 9],
      [1, 2],
      [1, 4],
    ]);
  });
});

describe("ignoreOptions", () => {
  it("offers file, extension and folder", () => {
    expect(ignoreOptions("logs/app.log").map((o) => o.pattern)).toEqual([
      "/logs/app.log",
      "*.log",
      "/logs/",
    ]);
    expect(ignoreOptions("Makefile").map((o) => o.pattern)).toEqual(["/Makefile"]);
    expect(ignoreOptions(".env").map((o) => o.pattern)).toEqual(["/.env"]);
  });
});

describe("optimistic updates", () => {
  const find = (s: WorkingStatus, path: string) => s.entries.find((e) => e.path === path);

  it("stages untracked and modified files", () => {
    const s = stageOptimistic(status, ["a.md", "src/b.ts"]);
    expect(find(s, "a.md")).toMatchObject({ staged: "added", unstaged: null });
    expect(find(s, "src/b.ts")).toMatchObject({ staged: "modified", unstaged: null });
  });

  it("unstages back to the working tree", () => {
    const s = unstageOptimistic(status, ["lib/new.rs", "src/b.ts"]);
    expect(find(s, "lib/new.rs")).toMatchObject({ staged: null, unstaged: "renamed" });
    expect(find(s, "src/b.ts")).toMatchObject({ staged: null, unstaged: "modified" });
    const added = unstageOptimistic(stageOptimistic(status, ["a.md"]), ["a.md"]);
    expect(find(added, "a.md")).toMatchObject({ unstaged: "untracked", staged: null });
  });

  it("discards working-tree changes and drops clean entries", () => {
    const s = discardOptimistic(status, ["a.md", "src/b.ts"]);
    expect(find(s, "a.md")).toBeUndefined();
    expect(find(s, "src/b.ts")).toMatchObject({ staged: "modified", unstaged: null });
  });
});
