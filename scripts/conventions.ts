// Commit message and branch name conventions (CONTRIBUTING.md → "Commits and branches").
//
//   node scripts/conventions.ts commit-msg <file>     the commit-msg hook: message + branch
//   node scripts/conventions.ts range <base>..<head>  every commit in a range (CI)
//   node scripts/conventions.ts branch <name>         one branch name (CI)
//   node scripts/conventions.ts install-hooks         git config core.hooksPath .githooks
//
// Exits non-zero, with what to change, when something doesn't follow them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** What a commit can be about: the first word of its subject. Add an area here when a new
 * part of the codebase appears. */
export const AREAS = [
  // Features (src/features, src-tauri commands)
  "a11y",
  "branch",
  "changes",
  "commit",
  "conflict",
  "diff",
  "file-view",
  "flow",
  "graph",
  "history",
  "i18n",
  "palette",
  "rebase",
  "remote",
  "repo",
  "settings",
  "sidebar",
  "terminal",
  "toolbar",
  "update",
  "welcome",
  // Layers
  "app", // src/app and src-tauri shell (window, state, boot)
  "git", // crates/tylia-git
  "ipc", // commands, bindings, mock backend
  "ui", // src/ui design-system components, tokens
  // Project
  "build",
  "ci",
  "deps",
  "docs",
  "release",
  "site", // website/
  "test",
] as const;

/** Branch prefixes: the kind of work. */
export const BRANCH_KINDS = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "deps",
  "chore",
  "release",
] as const;

export const SUBJECT_MAX = 72;
const BRANCH_MAX = 60;

/** Subjects Git (or a bot) writes itself. */
const GENERATED =
  /^(Merge (branch|pull request|remote-tracking branch|tag|commit) |Revert "|(fixup|squash|amend)! )/;
/** Long-lived branches, and bot branches named by their tools. */
const EXEMPT_BRANCHES = /^(main|HEAD|(dependabot|renovate)\/.+)$/;
/** Non-imperative first words people commonly write. */
const NOT_IMPERATIVE =
  /^(added|adds|adding|fixed|fixes|fixing|updated|updates|updating|changed|changes|removed|removes|renamed|renames|moved|moves|improved|improves|made|makes)$/;

/** Problems with a commit message; empty when it follows the conventions. */
export function checkCommitMessage(raw: string): string[] {
  const lines = raw
    .replace(/\r\n/g, "\n")
    // `git commit -v` appends the diff below a scissors line.
    .split(/^# -+ >8 -+\n/m)[0]!
    .split("\n")
    .filter((line) => !line.startsWith("#"));
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  const subject = lines[0]?.trimEnd() ?? "";
  if (!subject) return ["The commit message is empty."];
  if (GENERATED.test(subject)) return [];

  const problems: string[] = [];
  const m = /^([a-z0-9-]+)(!)?: (.+)$/.exec(subject);
  if (!m) {
    problems.push(
      `The subject must be "<area>: <summary>", e.g. "graph: draw merge curves as beziers". Got: "${subject}"`,
    );
  } else {
    const [, area, , summary] = m as unknown as [string, string, string | undefined, string];
    if (!(AREAS as readonly string[]).includes(area)) {
      problems.push(
        `Unknown area "${area}". Use one of: ${AREAS.join(", ")} (or add it to scripts/conventions.ts).`,
      );
    }
    const first = summary.split(/\s/)[0]!;
    if (/^[A-Z][a-z]/.test(first)) {
      problems.push(`Start the summary in lowercase ("${first}" → "${first.toLowerCase()}").`);
    }
    if (NOT_IMPERATIVE.test(first.toLowerCase())) {
      problems.push(`Write the summary in the imperative: "add …", "fix …", not "${first} …".`);
    }
    if (/[.!]$/.test(summary)) problems.push("Leave out the full stop at the end of the subject.");
  }
  if (subject.length > SUBJECT_MAX) {
    problems.push(`Keep the subject to ${SUBJECT_MAX} characters (it has ${subject.length}).`);
  }
  if (lines.length > 1 && lines[1]!.trim()) {
    problems.push("Leave a blank line between the subject and the body.");
  }
  return problems;
}

/** A problem with a branch name, or null. */
export function checkBranchName(name: string): string | null {
  if (EXEMPT_BRANCHES.test(name)) return null;
  const kinds = BRANCH_KINDS.join("|");
  const release = /^release\/v\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;
  const topic = new RegExp(`^(${kinds})/(\\d+-)?[a-z0-9]+(-[a-z0-9]+)*$`);
  if (name.startsWith("release/") ? release.test(name) : topic.test(name)) {
    return name.length > BRANCH_MAX ? `Keep branch names to ${BRANCH_MAX} characters.` : null;
  }
  return (
    `Branch "${name}" should be "<kind>/<topic>" in lowercase kebab-case, e.g. ` +
    `"feat/open-in-terminal" or "fix/123-crlf-staging" (kinds: ${BRANCH_KINDS.join(", ")}; ` +
    `releases: "release/v1.2.0"). Rename it with: git branch -m <new-name>`
  );
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function report(problems: string[], hint: string): never {
  if (problems.length === 0) process.exit(0);
  console.error(problems.map((p) => `  ✗ ${p}`).join("\n"));
  console.error(`\n${hint}`);
  process.exit(1);
}

function main(args: string[]) {
  const [command, arg] = args;
  const guide = 'See CONTRIBUTING.md → "Commits and branches".';
  switch (command) {
    case "commit-msg": {
      const problems = checkCommitMessage(readFileSync(arg!, "utf8"));
      let branch = "";
      try {
        branch = git("symbolic-ref", "--quiet", "--short", "HEAD");
      } catch {
        // Detached HEAD (rebase, bisect): no branch to check.
      }
      const branchProblem = branch && checkBranchName(branch);
      if (branchProblem) problems.push(branchProblem);
      report(problems, `Commit refused. ${guide} Your message is kept in .git/COMMIT_EDITMSG.`);
      break;
    }
    case "range": {
      const problems: string[] = [];
      for (const oid of git("rev-list", "--no-merges", arg!).split("\n").filter(Boolean)) {
        for (const p of checkCommitMessage(git("log", "-1", "--format=%B", oid))) {
          problems.push(`${oid.slice(0, 7)}: ${p}`);
        }
      }
      report(problems, guide);
      break;
    }
    case "branch": {
      const problem = checkBranchName(arg ?? "");
      report(problem ? [problem] : [], guide);
      break;
    }
    case "install-hooks": {
      // Part of `pnpm install`; outside a Git checkout (a source tarball) there's nothing to do.
      try {
        git("config", "core.hooksPath", ".githooks");
      } catch {
        // Not a repository.
      }
      break;
    }
    default:
      console.error(
        "usage: conventions.ts commit-msg <file> | range <a>..<b> | branch <name> | install-hooks",
      );
      process.exit(2);
  }
}

if (import.meta.main) main(process.argv.slice(2));
