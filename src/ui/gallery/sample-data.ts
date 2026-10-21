// Sample content for the dev-only component gallery (not shipped in release builds, so
// not localized).

import type { RefInfo } from "../RefBadge";

export interface SampleCommit {
  hash: string;
  subject: string;
  author: string;
  email: string;
  age: string;
  refs: RefInfo[];
}

const SUBJECTS = [
  "Fix parser on CRLF input",
  "Add lane colour assignment",
  "Merge branch 'feature/graph' into main",
  "Stream history pages from Rust",
  "Draw merge curves as cubic beziers",
  "Bump tauri to 2.12",
  "Handle detached HEAD in status",
  "Refactor patch builder for line staging",
  "Show hook output when commit fails",
  "Keep lane colours stable while scrolling",
];

const AUTHORS: [string, string][] = [
  ["Ada Lovelace", "ada@example.com"],
  ["Grace Hopper", "grace@example.com"],
  ["Linus Torvalds", "linus@example.org"],
  ["Margaret Hamilton", "margaret@example.net"],
  ["Ken Thompson", "ken@example.org"],
];

const AGES = ["2 min ago", "1 hour ago", "3 hours ago", "yesterday", "2 days ago", "last week"];

/** Deterministic pseudo-random 40-hex-digit hash. */
function hash(i: number): string {
  let x = Math.imul(i + 1, 0x9e3779b1);
  let out = "";
  for (let k = 0; k < 5; k++) {
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
    out += ((x ^ (x >>> 15)) >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

export const commits: SampleCommit[] = Array.from({ length: 10_000 }, (_, i) => {
  const [author, email] = AUTHORS[(i * 7) % AUTHORS.length]!;
  const refs: RefInfo[] =
    i === 0
      ? [
          { kind: "local", name: "main", current: true, syncedRemote: "origin" },
          { kind: "tag", name: "v0.1.0" },
        ]
      : i === 3
        ? [
            { kind: "local", name: "feature/graph", lane: 2 },
            { kind: "remote", name: "origin/feature/graph", lane: 2 },
          ]
        : i === 9
          ? [{ kind: "tag", name: "v0.0.9" }]
          : [];
  return {
    hash: hash(i),
    subject: SUBJECTS[i % SUBJECTS.length]!,
    author,
    email,
    age: AGES[Math.min(AGES.length - 1, Math.floor(i / 3))]!,
    refs,
  };
});

export interface SampleBranch {
  name: string;
  ahead?: number;
  behind?: number;
}

export const branches: SampleBranch[] = [
  { name: "main", ahead: 2 },
  { name: "dev" },
  { name: "feature/graph/lanes", ahead: 4, behind: 1 },
  { name: "feature/graph/curves" },
  { name: "feature/line-staging", behind: 3 },
  { name: "fix/crlf-parser" },
  { name: "release/0.1" },
];

export const manyRefs: RefInfo[] = [
  { kind: "local", name: "main", current: true, syncedRemote: "origin" },
  { kind: "local", name: "feature/graph", lane: 2 },
  { kind: "remote", name: "upstream/main", lane: 1 },
  { kind: "tag", name: "v0.1.0" },
  { kind: "tag", name: "v0.1.0-rc.2" },
];

export const sampleError = {
  message: "Push was rejected because the remote contains work you don’t have locally.",
  command: "git push origin main",
  stderr: `To github.com:tylia-dev/tylia.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'github.com:tylia-dev/tylia.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. Integrate the remote changes (e.g. 'git pull ...') before pushing again.`,
};
