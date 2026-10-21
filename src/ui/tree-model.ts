// Builds a folder tree from slash-separated names (e.g. branches `feature/graph/lanes`).

export interface TreeLeaf<T> {
  kind: "leaf";
  id: string;
  /** Last path segment. */
  label: string;
  depth: number;
  data: T;
}

export interface TreeFolder<T> {
  kind: "folder";
  /** The folder path, e.g. `feature/graph`. */
  id: string;
  label: string;
  depth: number;
  children: TreeNode<T>[];
}

export type TreeNode<T> = TreeLeaf<T> | TreeFolder<T>;

/** Folders first, then leaves, each sorted by label; `getPath` gives the slash path. */
export function buildTree<T>(items: T[], getPath: (item: T) => string): TreeNode<T>[] {
  const root: TreeFolder<T> = { kind: "folder", id: "", label: "", depth: -1, children: [] };
  for (const item of items) {
    const path = getPath(item);
    const parts = path.split("/").filter(Boolean);
    let folder = root;
    for (const [i, part] of parts.slice(0, -1).entries()) {
      const id = parts.slice(0, i + 1).join("/");
      let next = folder.children.find(
        (c): c is TreeFolder<T> => c.kind === "folder" && c.id === id,
      );
      if (!next) {
        next = { kind: "folder", id, label: part, depth: i, children: [] };
        folder.children.push(next);
      }
      folder = next;
    }
    folder.children.push({
      kind: "leaf",
      id: path,
      label: parts[parts.length - 1] ?? path,
      depth: parts.length - 1,
      data: item,
    });
  }
  sortTree(root.children);
  return root.children;
}

function sortTree<T>(nodes: TreeNode<T>[]) {
  nodes.sort((a, b) =>
    a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "folder" ? -1 : 1,
  );
  for (const n of nodes) if (n.kind === "folder") sortTree(n.children);
}

/** Ids of every folder above `paths` (to show a tree fully expanded). */
export function allFolders(paths: string[]): Set<string> {
  const set = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"));
  }
  return set;
}

/** The nodes currently visible: children of collapsed folders are skipped. */
export function flattenVisible<T>(nodes: TreeNode<T>[], expanded: Set<string>): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  const walk = (list: TreeNode<T>[]) => {
    for (const n of list) {
      out.push(n);
      if (n.kind === "folder" && expanded.has(n.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
