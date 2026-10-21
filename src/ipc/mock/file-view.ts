// Blame and file history for the mock backend, derived from the demo fixture: a file's
// history is the fixture commits that changed it; its blame is rebuilt from those commits'
// added lines (the way make-fixture.ts grew the files). For src/parser.rs the whole file is
// reconstructed, its oldest listed change is presented as a rename (to show rename markers),
// and the working copy's uncommitted edit appears as "not committed yet".

import type { Backend } from "../backend";
import type { BlameCommit } from "../bindings/BlameCommit";
import type { BlameLine } from "../bindings/BlameLine";
import type { CommitDetails } from "../bindings/CommitDetails";
import type { FileDiff } from "../bindings/FileDiff";
import type { FileHistoryEntry } from "../bindings/FileHistoryEntry";
import type { HistoryRow } from "../bindings/HistoryRow";

interface FixtureData {
  history: HistoryRow[];
  commits: Record<string, CommitDetails>;
  diffs: Record<string, FileDiff>;
}

const PARSER = "src/parser.rs";
const PARSER_RENAMED_FROM = "src/parse.rs";
const UNCOMMITTED = "0".repeat(40);

const fn = (name: string) => [
  "",
  `pub fn ${name}(input: &str) -> usize {`,
  "    input.lines().filter(|l| !l.is_empty()).count()",
  "}",
];

/** src/parser.rs before the commits the fixture has diffs for (see make-fixture.ts). */
const PARSER_START: [subject: string, lines: string[]][] = [
  ["Initial commit", ["//! Parses log records.", "", "pub fn parse(line: &str) -> Vec<&str> {"]],
  [
    "Strip CR before splitting records",
    ["    line.trim_end_matches('\\r').split('\\0').collect()"],
  ],
  ["Initial commit", ["}"]],
  ["Add parser module", fn("count_0")],
  ["Read config from the environment", fn("count_1")],
  ["Document the record format", fn("count_2")],
  ["Handle empty input in parse", fn("count_3")],
  ["Add CLI flags for verbose output", fn("count_4")],
  ["Split records on NUL", fn("records_412")],
  ["Parse parent hashes", fn("records_87")],
  ["Add tests for multi-parent commits", fn("records_655")],
  ["Refactor record parsing", fn("helper_0")],
  ["Rename internal helper", fn("helper_3")],
  ["Show hook output when commit fails", fn("helper_6")],
];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fileViewMock(fixture: FixtureData): Pick<Backend, "getBlame" | "getFileHistory"> {
  /** Commits with a diff of `path`, newest first. */
  const touching = (path: string) =>
    fixture.history.filter((row) => fixture.commits[row.oid]?.files.some((f) => f.path === path));

  const history = (path: string): FileHistoryEntry[] => {
    const entries = touching(path).map((row): FileHistoryEntry => {
      const file = fixture.commits[row.oid]!.files.find((f) => f.path === path)!;
      return {
        oid: row.oid,
        parents: row.parents,
        authorName: row.authorName,
        authorEmail: row.authorEmail,
        time: row.time,
        subject: row.subject,
        path,
        oldPath: file.oldPath,
        status: file.status,
      };
    });
    const oldest = entries.at(-1);
    if (path === PARSER && oldest) {
      oldest.status = "renamed";
      oldest.oldPath = PARSER_RENAMED_FROM;
    }
    return entries;
  };

  return {
    getFileHistory: async (_repo, path, rev, skip, limit) => {
      await delay(40);
      let entries = history(path);
      if (rev) {
        const at = entries.findIndex((e) => e.oid === rev);
        if (at >= 0) entries = entries.slice(at);
      }
      return { entries: entries.slice(skip, skip + limit), more: skip + limit < entries.length };
    },

    getBlame: async (_repo, path, rev) => {
      await delay(60);
      const result = { path, rev };
      const byOid = new Map(fixture.history.map((r) => [r.oid, r]));
      const bySubject = (subject: string) => fixture.history.find((r) => r.subject === subject);
      const cutoff = rev ? byOid.get(rev)?.time : undefined;
      const upToRev = (row: HistoryRow | undefined): row is HistoryRow =>
        !!row && (cutoff === undefined || row.time <= cutoff);

      // Oldest first: (commit row, its lines).
      const parts: [HistoryRow, string[]][] = [];
      if (path === PARSER) {
        for (const [subject, lines] of PARSER_START) {
          const row = bySubject(subject);
          if (upToRev(row)) parts.push([row, lines]);
        }
      }
      for (const row of [...touching(path)].reverse()) {
        if (!upToRev(row)) continue;
        const content = fixture.diffs[`${row.oid}:${path}`]?.content;
        if (content?.kind !== "text") continue;
        parts.push([
          row,
          content.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "add").map((l) => l.text)),
        ]);
      }
      if (parts.length === 0) return { ...result, content: { kind: "missing" } };

      const commits: BlameCommit[] = [];
      const index = new Map<string, number>();
      let previous: BlameCommit["previous"] = null;
      // In order of first appearance, as Git reports them; `previous` is the commit before.
      const commitFor = (row: HistoryRow) => {
        let i = index.get(row.oid);
        if (i === undefined) {
          i = commits.length;
          index.set(row.oid, i);
          commits.push({
            oid: row.oid,
            authorName: row.authorName,
            authorEmail: row.authorEmail,
            authorTime: row.time,
            summary: row.subject,
            path,
            previous,
            uncommitted: false,
          });
          previous = { oid: row.oid, path };
        }
        return i;
      };
      const lines: BlameLine[] = [];
      for (const [row, texts] of parts) {
        const commit = commitFor(row);
        for (const text of texts) {
          lines.push({ commit, originalLine: lines.length + 1, line: lines.length + 1, text });
        }
      }

      // The working copy: replaced lines from the unstaged diff become uncommitted.
      const unstaged = rev ? undefined : fixture.diffs[`unstaged:${path}`]?.content;
      if (unstaged?.kind === "text") {
        const wip = commits.length;
        commits.push({
          oid: UNCOMMITTED,
          authorName: "Not Committed Yet",
          authorEmail: "not.committed.yet",
          authorTime: Math.floor(Date.now() / 1000) - 600,
          summary: `Version of ${path} from ${path}`,
          path,
          previous,
          uncommitted: true,
        });
        for (const line of unstaged.hunks.flatMap((h) => h.lines)) {
          const at = (line.newLine ?? 0) - 1;
          if (line.kind === "add" && lines[at]) {
            lines[at] = { ...lines[at], commit: wip, text: line.text };
          }
        }
      }
      return { ...result, content: { kind: "lines", commits, lines } };
    },
  };
}
