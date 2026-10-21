// Turns the refs snapshot into badges per commit (DESIGN §4.10).

import type { RefsSnapshot } from "@/ipc";
import type { RefInfo } from "@/ui/RefBadge";

/**
 * Badges by commit id, without lane colours (the row knows its lane). Order: current
 * branch, other local branches, remote branches, tags. A remote branch pointing at the same
 * commit as the local branch that tracks it is merged into the local badge.
 */
export function refsByCommit(refs: RefsSnapshot): Map<string, RefInfo[]> {
  const map = new Map<string, RefInfo[]>();
  const add = (oid: string, ref: RefInfo) => {
    const list = map.get(oid);
    if (list) list.push(ref);
    else map.set(oid, [ref]);
  };
  const merged = new Set<string>();
  const remoteOid = new Map<string, string>();
  for (const remote of refs.remotes) {
    for (const b of remote.branches) remoteOid.set(b.fullName, b.oid);
  }

  if (!refs.head.branch && refs.head.oid) add(refs.head.oid, { kind: "head", name: "HEAD" });
  const locals = [...refs.branches].sort((a, b) => Number(b.isHead) - Number(a.isHead));
  for (const b of locals) {
    let syncedRemote: string | undefined;
    if (b.upstream && remoteOid.get(b.upstream) === b.oid) {
      syncedRemote = b.upstream.slice(0, b.upstream.length - b.name.length - 1) || undefined;
      // Only merge when the upstream has the same name (origin/main for main).
      if (syncedRemote && b.upstream === `${syncedRemote}/${b.name}`) merged.add(b.upstream);
      else syncedRemote = undefined;
    }
    add(b.oid, { kind: "local", name: b.name, current: b.isHead, syncedRemote });
  }
  for (const remote of refs.remotes) {
    for (const b of remote.branches) {
      if (!merged.has(b.fullName)) add(b.oid, { kind: "remote", name: b.fullName });
    }
  }
  for (const tag of refs.tags) add(tag.oid, { kind: "tag", name: tag.name });
  return map;
}
