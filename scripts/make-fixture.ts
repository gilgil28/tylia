// Builds a synthetic demo repository (branches, merges, tags, a remote, a stash and
// uncommitted changes), dumps it with `cargo run -p tylia-git --example dump-fixture`, and
// writes src/ipc/mock/fixtures/demo.json for browser mode and screenshots.
//
// Usage: pnpm fixture   (content is generated, so it is ours to commit)

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const OUT = new URL("../src/ipc/mock/fixtures/demo.json", import.meta.url);
const FAKE_PATH = "/home/ada/code/tylia-demo";
const FAKE_REMOTE = "https://github.com/tylia-dev/tylia-demo.git";

const AUTHORS = [
  ["Ada Moreno", "ada@example.com"],
  ["Kenji Sato", "kenji@example.com"],
  ["Priya Nair", "priya@example.org"],
  ["Sam Okafor", "sam@example.net"],
  ["Lena Fischer", "lena@example.org"],
] as const;

const root = mkdtempSync(join(tmpdir(), "tylia-fixture-"));
const repo = join(root, "tylia-demo");
const remote = join(root, "remote.git");
mkdirSync(repo);

let clock = Date.UTC(2026, 5, 1, 9, 0, 0) / 1000;
let seed = 7;
const rand = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
let author: readonly [string, string] = AUTHORS[0];

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author[0],
      GIT_AUTHOR_EMAIL: author[1],
      GIT_COMMITTER_NAME: author[0],
      GIT_COMMITTER_EMAIL: author[1],
      GIT_AUTHOR_DATE: `${clock} +0000`,
      GIT_COMMITTER_DATE: `${clock} +0000`,
    },
  }).trim();
}

function write(path: string, content: string) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function read(path: string): string {
  try {
    return readFileSync(join(repo, path), "utf8");
  } catch {
    return "";
  }
}

/** Tick the clock, rotate authors, stage everything and commit. */
function commit(message: string, who = rand(AUTHORS.length)) {
  clock += 1800 + rand(6) * 1800;
  author = AUTHORS[who]!;
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", message);
}

/** Appends a small Rust function to `path`, so each commit has a readable diff. */
function addFn(path: string, name: string) {
  write(
    path,
    `${read(path)}\npub fn ${name}(input: &str) -> usize {\n    input.lines().filter(|l| !l.is_empty()).count()\n}\n`,
  );
}

/** Rewrites one line of `path` (a word-level change). */
function tweak(path: string, from: string, to: string) {
  write(path, read(path).replace(from, to));
}

git("init", "-q", "-b", "main");
git("config", "commit.gpgsign", "false");
git("config", "core.autocrlf", "false");

write("README.md", "# tylia-demo\n\nA small project used to render Tylia's screenshots.\n");
write("Cargo.toml", '[package]\nname = "tylia-demo"\nversion = "0.1.0"\nedition = "2024"\n');
write("src/main.rs", 'fn main() {\n    println!("hello");\n}\n');
write(
  "src/parser.rs",
  "//! Parses log records.\n\npub fn parse(line: &str) -> Vec<&str> {\n    line.split('\\0').collect()\n}\n",
);
commit("Initial commit", 0);

const mainWork = [
  "Add parser module",
  "Read config from the environment",
  "Document the record format",
  "Handle empty input in parse",
  "Add CLI flags for verbose output",
];
mainWork.forEach((m, i) => {
  addFn("src/parser.rs", `count_${i}`);
  commit(m);
});

// A feature branch merged back while main moves on.
git("checkout", "-q", "-b", "feature/parser");
for (const m of [
  "Split records on NUL",
  "Parse parent hashes",
  "Add tests for multi-parent commits",
]) {
  addFn("src/parser.rs", `records_${rand(1000)}`);
  commit(m, 1);
}
git("checkout", "-q", "main");
write("docs/guide.md", "# Guide\n\nRun `tylia-demo` in a repository.\n");
commit("Write a short guide", 2);
tweak("README.md", "renders", "renders");
write("README.md", `${read("README.md")}\n## Building\n\n\`cargo build --release\`\n`);
commit("Explain how to build", 4);
clock += 3600;
git("merge", "-q", "--no-ff", "-m", "Merge branch 'feature/parser'", "feature/parser");

// Short fix branch.
git("checkout", "-q", "-b", "fix/crlf-parser");
tweak("src/parser.rs", "line.split('\\0')", "line.trim_end_matches('\\r').split('\\0')");
commit("Strip CR before splitting records", 3);
git("checkout", "-q", "main");
clock += 3600;
git("merge", "-q", "--no-ff", "-m", "Merge branch 'fix/crlf-parser'", "fix/crlf-parser");
git("branch", "-q", "-d", "fix/crlf-parser");

// Release branch with tags, merged back.
git("checkout", "-q", "-b", "release/0.1");
tweak("Cargo.toml", 'version = "0.1.0"', 'version = "0.1.0"');
commit("Prepare 0.1.0", 0);
git("tag", "-a", "v0.1.0", "-m", "Release 0.1.0");
tweak("src/main.rs", '"hello"', '"hello, world"');
commit("Fix greeting in release build", 0);
git("tag", "v0.1.1");
git("checkout", "-q", "main");

// Long-lived graph feature, with main merged into it midway.
write(
  "src/graph/render.ts",
  `export interface Point {\n  x: number;\n  y: number;\n}\n\nexport function drawEdge(ctx: CanvasRenderingContext2D, from: Point, to: Point) {\n  ctx.beginPath();\n  ctx.moveTo(from.x, from.y);\n  ctx.lineTo(to.x, to.y);\n  ctx.stroke();\n}\n`,
);
commit("Add graph renderer skeleton", 4);
git("checkout", "-q", "-b", "feature/graph");
for (const m of ["Assign lane colours", "Keep lanes stable while scrolling", "Draw commit dots"]) {
  write(
    "src/graph/lanes.rs",
    `${read("src/graph/lanes.rs")}// ${m}\npub const LANE_${rand(100)}: u16 = ${rand(12)};\n`,
  );
  commit(m, 4);
}
git("checkout", "-q", "main");
for (const m of ["Bump dependencies", "Speed up startup"]) {
  addFn("src/main.rs", `startup_${rand(100)}`);
  commit(m);
}
git("checkout", "-q", "feature/graph");
clock += 1800;
git("merge", "-q", "--no-ff", "-m", "Merge branch 'main' into feature/graph", "main");
tweak(
  "src/graph/render.ts",
  "  ctx.lineTo(to.x, to.y);",
  "  const midY = (from.y + to.y) / 2;\n  ctx.bezierCurveTo(from.x, midY, to.x, midY, to.x, to.y);",
);
commit("Draw merge curves as cubic beziers", 4);
git("checkout", "-q", "main");
git("merge", "-q", "--no-ff", "-m", "Merge branch 'release/0.1'", "release/0.1");
clock += 3600;
git("merge", "-q", "--no-ff", "-m", "Merge branch 'feature/graph'", "feature/graph");

// Many small commits on main for a long, scrollable history.
for (let i = 0; i < 40; i++) {
  const file = ["src/parser.rs", "src/main.rs", "docs/guide.md"][i % 3]!;
  if (file.endsWith(".md")) write(file, `${read(file)}\n- Note ${i}: keep commits small.\n`);
  else addFn(file, `helper_${i}`);
  commit(
    [
      "Refactor record parsing",
      "Tidy up error messages",
      "Add a test for detached HEAD",
      "Rename internal helper",
      "Cache parsed refs",
      "Handle unborn branches",
      "Show hook output when commit fails",
      "Keep lane colours stable",
    ][i % 8]! + (i >= 8 ? ` (${i})` : ""),
  );
}

// An image change for the image diff.
write(
  "assets/logo.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="#5e8bff"/></svg>\n',
);
commit("Add logo", 2);
write(
  "assets/logo.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="6" fill="#3fb97f"/></svg>\n',
);
commit("Use the new square logo", 2);

// Push to a remote, then keep working locally (ahead by 2).
execFileSync("git", ["init", "-q", "--bare", remote]);
git("remote", "add", "origin", remote);
git("push", "-q", "-u", "origin", "main", "feature/graph");
git("checkout", "-q", "-b", "feature/remote-only");
addFn("src/main.rs", "remote_only");
commit("Experiment with async status", 1);
git("push", "-q", "origin", "feature/remote-only");
git("checkout", "-q", "main");
git("branch", "-q", "-D", "feature/remote-only");

// An open feature branch, not merged.
git("checkout", "-q", "-b", "feature/line-staging");
for (const m of ["Build partial patches", "Stage selected lines", "Handle no-newline markers"]) {
  addFn("src/patch.rs", `patch_${rand(100)}`);
  commit(m, 3);
}
git("checkout", "-q", "main");
tweak(
  "src/graph/render.ts",
  "export function drawEdge(ctx: CanvasRenderingContext2D, from: Point, to: Point) {",
  "export function drawEdge(\n  ctx: CanvasRenderingContext2D,\n  from: Point,\n  to: Point,\n  width = 2,\n) {\n  ctx.lineWidth = width;",
);
commit("Make edge width configurable", 4);
addFn("src/parser.rs", "parse_trailers");
commit("Parse commit trailers", 0);

// A stash and uncommitted changes.
tweak("src/main.rs", '"hello, world"', '"hello from a stash"');
clock += 600;
git("stash", "push", "-q", "-m", "WIP: tweak greeting");
tweak("src/parser.rs", "//! Parses log records.", "//! Parses `git log -z` records.");
write(
  "src/graph/curves.rs",
  "/// Control points for a lane change.\npub fn control_points(y0: f32, y1: f32) -> (f32, f32) {\n    let mid = (y0 + y1) / 2.0;\n    (mid, mid)\n}\n",
);
git("add", "src/graph/curves.rs");
write("notes.md", "# Notes\n\n- Try the split diff view.\n");

const raw = join(root, "fixture.json");
execFileSync(
  "cargo",
  ["run", "-q", "-p", "tylia-git", "--example", "dump-fixture", "--", repo, raw, "400"],
  {
    stdio: "inherit",
    cwd: new URL("..", import.meta.url),
  },
);

// Replace machine-specific paths (in every escaping/separator style) with stable fakes.
let json = readFileSync(raw, "utf8");
for (const p of [repo, repo.replaceAll("\\", "/")]) {
  json = json.replaceAll(JSON.stringify(p).slice(1, -1), FAKE_PATH);
}
for (const p of [remote, remote.replaceAll("\\", "/")]) {
  json = json.replaceAll(JSON.stringify(p).slice(1, -1), FAKE_REMOTE);
}
mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, json);
rmSync(root, { recursive: true, force: true });
console.log(`wrote ${OUT.pathname}`);
