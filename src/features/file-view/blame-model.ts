// Presentation helpers for the blame view: where a run of lines from one commit starts, and
// how recent each commit is (for the age bar).

import type { BlameCommit, BlameLine } from "@/ipc";

/** `true` where a line starts a run of lines from a different commit than the line above. */
export function groupStarts(lines: readonly BlameLine[]): boolean[] {
  return lines.map((line, i) => i === 0 || lines[i - 1]!.commit !== line.commit);
}

/**
 * Each commit's age as 0 (oldest) … 1 (newest), by rank of author time, so one very old
 * commit doesn't wash out the rest. Uncommitted lines count as newest.
 */
export function ageRanks(commits: readonly BlameCommit[]): number[] {
  const times = [...new Set(commits.filter((c) => !c.uncommitted).map((c) => c.authorTime))].sort(
    (a, b) => a - b,
  );
  const rank = new Map(times.map((time, i) => [time, i]));
  const last = Math.max(1, times.length - 1);
  return commits.map((c) =>
    c.uncommitted ? 1 : times.length === 1 ? 1 : rank.get(c.authorTime)! / last,
  );
}

/** Strength of the age bar's accent tint, in percent: faint for old, full for recent. */
export function ageTint(rank: number): number {
  const MIN = 25;
  return Math.round(MIN + (100 - MIN) * rank);
}
