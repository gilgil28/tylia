import { describe, expect, it } from "vitest";

import { buildTree, flattenVisible, type TreeNode } from "./tree-model";

const render = (nodes: TreeNode<string>[]) =>
  nodes.map((n) => `${"  ".repeat(n.depth)}${n.kind === "folder" ? `${n.label}/` : n.label}`);

describe("buildTree", () => {
  const branches = ["main", "feature/graph/lanes", "feature/graph/dots", "feature/ui", "dev"];
  const tree = buildTree(branches, (b) => b);

  it("folds on slashes, folders first, sorted", () => {
    const all = flattenVisible(tree, new Set(["feature", "feature/graph"]));
    expect(render(all)).toEqual([
      "feature/",
      "  graph/",
      "    dots",
      "    lanes",
      "  ui",
      "dev",
      "main",
    ]);
  });

  it("hides children of collapsed folders", () => {
    expect(render(flattenVisible(tree, new Set()))).toEqual(["feature/", "dev", "main"]);
    expect(render(flattenVisible(tree, new Set(["feature"])))).toEqual([
      "feature/",
      "  graph/",
      "  ui",
      "dev",
      "main",
    ]);
  });

  it("keeps the full path as the leaf id", () => {
    const leaves = flattenVisible(tree, new Set(["feature", "feature/graph"])).filter(
      (n) => n.kind === "leaf",
    );
    expect(leaves.map((l) => l.id)).toContain("feature/graph/lanes");
  });
});
