import { ChevronRight, Folder } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "./cn";
import { buildTree, flattenVisible, type TreeFolder, type TreeLeaf } from "./tree-model";

interface TreeProps<T> {
  items: T[];
  getPath: (item: T) => string;
  renderLeaf: (leaf: TreeLeaf<T>) => ReactNode;
  /** Folder ids (paths) that are expanded (controlled, so it can be persisted). */
  expanded: Set<string>;
  onExpandedChange: (expanded: Set<string>) => void;
  selectedId?: string | null;
  onSelect?: (leaf: TreeLeaf<T>) => void;
  onActivate?: (leaf: TreeLeaf<T>) => void;
  /** Extra indentation levels, for a tree nested under a row (e.g. a remote). */
  indent?: number;
  "aria-label": string;
  className?: string;
}

/**
 * Tree that folds names on `/` (sidebar branches). ↑/↓ move, ← collapses or goes to the
 * parent, → expands or goes to the first child, Enter activates.
 */
export function Tree<T>({
  items,
  getPath,
  renderLeaf,
  expanded,
  onExpandedChange,
  selectedId = null,
  onSelect,
  onActivate,
  indent = 0,
  className,
  ...aria
}: TreeProps<T>) {
  const tree = useMemo(() => buildTree(items, getPath), [items, getPath]);
  const visible = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = focusedId ?? selectedId ?? visible[0]?.id ?? null;

  const toggle = (folder: TreeFolder<T>, open = !expanded.has(folder.id)) => {
    const next = new Set(expanded);
    if (open) next.add(folder.id);
    else next.delete(folder.id);
    onExpandedChange(next);
  };

  const focusNode = (id: string) => {
    setFocusedId(id);
    const node = visible.find((n) => n.id === id);
    if (node?.kind === "leaf") onSelect?.(node);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = visible.findIndex((n) => n.id === focused);
    const node = visible[index];
    if (!node) return;
    let handled = true;
    if (e.key === "ArrowDown") {
      const next = visible[index + 1];
      if (next) focusNode(next.id);
    } else if (e.key === "ArrowUp") {
      const prev = visible[index - 1];
      if (prev) focusNode(prev.id);
    } else if (e.key === "ArrowRight" && node.kind === "folder") {
      if (!expanded.has(node.id)) toggle(node, true);
      else if (node.children[0]) focusNode(node.children[0].id);
    } else if (e.key === "ArrowLeft") {
      if (node.kind === "folder" && expanded.has(node.id)) toggle(node, false);
      else {
        const parentId = node.id.split("/").slice(0, -1).join("/");
        if (parentId) focusNode(parentId);
      }
    } else if (e.key === "Enter") {
      if (node.kind === "folder") toggle(node);
      else onActivate?.(node);
    } else handled = false;
    if (handled) e.preventDefault();
  };

  return (
    <div
      role="tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn("group/tree flex flex-col outline-none", className)}
      {...aria}
    >
      {visible.map((node) => {
        const isFolder = node.kind === "folder";
        const isOpen = isFolder && expanded.has(node.id);
        const selected = node.id === selectedId;
        return (
          <div
            key={`${node.kind}:${node.id}`}
            role="treeitem"
            aria-level={node.depth + 1}
            aria-expanded={isFolder ? isOpen : undefined}
            aria-selected={isFolder ? undefined : selected}
            onMouseDown={() => setFocusedId(node.id)}
            onClick={() => (isFolder ? toggle(node) : onSelect?.(node))}
            onDoubleClick={() => node.kind === "leaf" && onActivate?.(node)}
            style={{ paddingLeft: `calc(${node.depth + indent} * var(--tree-indent) + 4px)` }}
            className={cn(
              "flex h-(--row-h) items-center gap-1 rounded-control pr-2",
              selected ? "bg-selected group-focus/tree:bg-selected-strong" : "hover:bg-hover",
              node.id === focused && "group-focus-visible/tree:shadow-(--focus-ring)",
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">
              {isFolder && (
                <ChevronRight
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden
                  className={cn(
                    "transition-transform duration-(--dur-fast)",
                    isOpen && "rotate-90",
                  )}
                />
              )}
            </span>
            {isFolder ? (
              <>
                <Folder size={14} strokeWidth={1.75} aria-hidden className="text-fg-muted" />
                <span className="truncate text-fg-secondary">{node.label}</span>
              </>
            ) : (
              renderLeaf(node)
            )}
          </div>
        );
      })}
    </div>
  );
}
