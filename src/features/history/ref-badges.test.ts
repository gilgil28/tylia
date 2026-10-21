import { describe, expect, it } from "vitest";

import type { RefsSnapshot } from "@/ipc";

import { refsByCommit } from "./ref-badges";

const base: RefsSnapshot = {
  head: { branch: "main", oid: "a" },
  branches: [
    {
      name: "feature/x",
      oid: "b",
      upstream: "origin/feature/x",
      upstreamRemote: "origin",
      upstreamBranch: "feature/x",
      ahead: 1,
      behind: 0,
      upstreamGone: false,
      isHead: false,
    },
    {
      name: "main",
      oid: "a",
      upstream: "origin/main",
      upstreamRemote: "origin",
      upstreamBranch: "main",
      ahead: 0,
      behind: 0,
      upstreamGone: false,
      isHead: true,
    },
  ],
  remotes: [
    {
      name: "origin",
      url: null,
      pushUrl: null,
      branches: [
        { name: "main", fullName: "origin/main", oid: "a" },
        { name: "feature/x", fullName: "origin/feature/x", oid: "c" },
      ],
    },
  ],
  tags: [{ name: "v1", oid: "a", annotated: true }],
  stashes: [],
  lastFetch: null,
};

describe("refsByCommit", () => {
  it("merges a local branch with its in-sync upstream and orders badges", () => {
    const map = refsByCommit(base);
    expect(map.get("a")).toEqual([
      { kind: "local", name: "main", current: true, syncedRemote: "origin" },
      { kind: "tag", name: "v1" },
    ]);
    expect(map.get("b")).toEqual([
      { kind: "local", name: "feature/x", current: false, syncedRemote: undefined },
    ]);
    expect(map.get("c")).toEqual([{ kind: "remote", name: "origin/feature/x" }]);
  });

  it("shows a HEAD badge when detached", () => {
    const map = refsByCommit({ ...base, head: { branch: null, oid: "z" } });
    expect(map.get("z")).toEqual([{ kind: "head", name: "HEAD" }]);
  });
});
