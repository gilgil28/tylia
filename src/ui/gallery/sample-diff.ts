// Sample file diffs for the dev-only gallery (not shipped in release builds, so not
// localized). Real diffs come from Rust; these are written in a compact notation.

import type { DiffLine } from "@/ipc/bindings/DiffLine";
import type { FileDiff } from "@/ipc/bindings/FileDiff";
import type { Hunk } from "@/ipc/bindings/Hunk";

/**
 * Builds a hunk from `" ctx"`, `"-del"`, `"+add"` lines. `«…»` marks changed words and a
 * trailing `⌀` means "no newline at end of file".
 */
function hunk(oldStart: number, newStart: number, heading: string, lines: string[]): Hunk {
  let o = oldStart;
  let n = newStart;
  const parsed = lines.map((raw): DiffLine => {
    const kind = raw[0] === "+" ? "add" : raw[0] === "-" ? "del" : "context";
    const noNewline = raw.endsWith("⌀");
    const marked = raw.slice(1, noNewline ? -1 : undefined);
    const emphasis: [number, number][] = [];
    let text = "";
    for (const ch of marked) {
      if (ch === "«") emphasis.push([text.length, text.length]);
      else if (ch === "»") emphasis.at(-1)![1] = text.length;
      else text += ch;
    }
    return {
      kind,
      oldLine: kind === "add" ? null : o++,
      newLine: kind === "del" ? null : n++,
      text,
      noNewline,
      emphasis,
    };
  });
  const oldLines = o - oldStart;
  const newLines = n - newStart;
  return {
    heading,
    // Git writes an empty side as `-0,0`.
    oldStart: oldLines === 0 && oldStart === 1 ? 0 : oldStart,
    oldLines,
    newStart: newLines === 0 && newStart === 1 ? 0 : newStart,
    newLines,
    lines: parsed,
  };
}

function textDiff(
  path: string,
  hunks: Hunk[],
  extra: Partial<Omit<FileDiff, "path" | "content">> = {},
): FileDiff {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.kind === "add") additions++;
      if (line.kind === "del") deletions++;
    }
  }
  return {
    path,
    oldPath: path,
    oldMode: "100644",
    newMode: "100644",
    image: null,
    // Samples are never staged, so any stable value will do.
    fingerprint: `sample:${path}`,
    ...extra,
    content: { kind: "text", hunks, additions, deletions },
  };
}

const typescript = textDiff("src/features/history/format.ts", [
  hunk(1, 1, "", [
    ` import type { Commit } from "@/ipc";`,
    `+import { t } from "@/i18n";`,
    ` `,
    `-const MINUTE = «60»;`,
    `+const MINUTE = «60_000»;`,
    ` const HOUR = 60 * MINUTE;`,
    ` const DAY = 24 * HOUR;`,
    ` `,
  ]),
  hunk(24, 25, "export function relativeTime(date: Date, now = Date.now()): string {", [
    `   const elapsed = now - date.getTime();`,
    `-  if (elapsed < MINUTE) return «"just now"»;`,
    "-  if (elapsed < HOUR) return «`${Math.floor(elapsed / MINUTE)} min ago`»;",
    `+  if (elapsed < MINUTE) return «t("time.justNow")»;`,
    `+  if (elapsed < HOUR) return «t("time.minutesAgo", { count: Math.floor(elapsed / MINUTE) })»;`,
    `   if (elapsed < DAY) {`,
    `     const hours = Math.floor(elapsed / HOUR);`,
    '-    return «hours === 1 ? "1 hour ago" : `${hours} hours ago`»;',
    `+    return «t(hours === 1 ? "time.hourAgo" : "time.hoursAgo", { count: hours })»;`,
    `   }`,
    `   // Older than a day: the calendar date in the user's locale ("12 Mar 2026" or "Mar 12, 2026", depending on their settings).`,
    `   return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });`,
    ` }`,
    ` `,
    `+/** Abbreviated hash for lists; full hashes stay in the details panel. */`,
    `+export const shortHash = (commit: Commit) => commit.hash.slice(0, 7);`,
    `+`,
  ]),
  hunk(58, 62, "export function formatAuthor(commit: Commit): string {", [
    `   const { name, email } = commit.author;`,
    `   return name || email;`,
    ` }`,
    `-export { relativeTime };⌀`,
    `+export { relativeTime«, shortHash» };⌀`,
  ]),
]);

const rust = textDiff(
  "crates/tylia-git/src/diff.rs",
  [
    hunk(12, 12, "pub struct Hunk {", [
      ` `,
      ` impl Hunk {`,
      `     /// Number of lines on the new side.`,
      `-    pub fn new_len(&self) -> «usize» {`,
      `-        self.lines.iter().filter(|l| l.kind != LineKind::Del).count()`,
      `+    pub fn new_len(&self) -> «u32» {`,
      `+        «let len = »self.lines.iter().filter(|l| l.kind != LineKind::Del).count()«;»`,
      `+        u32::try_from(len).expect("hunk longer than u32::MAX lines")`,
      `     }`,
      ` `,
      `     /// Number of lines on the old side.`,
    ]),
    hunk(40, 41, "fn parse_range(s: &str) -> Option<(u32, u32)> {", [
      `     let (start, len) = match s.split_once(',') {`,
      `         Some((a, b)) => (a.parse().ok()?, b.parse().ok()?),`,
      `+        // A missing length means one line: \`@@ -3 +3 @@\`.`,
      `         None => (s.parse().ok()?, 1),`,
      `     };`,
      `+    debug_assert!(len > 0 || start > 0, "empty range at line 0");`,
      `     Some((start, len))`,
      ` }`,
    ]),
  ],
  { oldPath: "crates/tylia-git/src/patch.rs" },
);

const added = textDiff(
  "e2e/smoke.spec.ts",
  [
    hunk(1, 1, "", [
      `+import { expect, test } from "@playwright/test";`,
      `+`,
      `+// Opens the app against the mock backend and checks the start screen renders.`,
      `+test("start screen", async ({ page }) => {`,
      `+  await page.goto("/?theme=dark");`,
      `+  await expect(page.getByText("No repository open")).toBeVisible();`,
      `+  await expect(page.getByRole("button", { name: "Open repository…" })).toBeEnabled();`,
      `+});`,
    ]),
  ],
  { oldPath: null, oldMode: null },
);

/** A tiny inline SVG as a `data:` URI. */
const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;

const logo = textDiff(
  "public/logo.svg",
  [
    hunk(1, 1, "", [
      ` <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
      `-  <circle cx="32" cy="32" r="«24»" fill="«hsl(222 100% 68%)»" />`,
      `+  <circle cx="32" cy="32" r="«26»" fill="«hsl(152 49% 49%)»" />`,
      `+  <path d="M22 33l7 7 14-15" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`,
      ` </svg>`,
    ]),
  ],
  {
    image: {
      old: svg(`<circle cx="32" cy="32" r="24" fill="hsl(222 100% 68%)" />`),
      new: svg(
        `<circle cx="32" cy="32" r="26" fill="hsl(152 49% 49%)" /><path d="M22 33l7 7 14-15" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`,
      ),
    },
  },
);

const png = (base64: string) => `data:image/png;base64,${base64}`;

const raster: FileDiff = {
  path: "docs/assets/lanes.png",
  oldPath: "docs/assets/lanes.png",
  oldMode: "100644",
  newMode: "100644",
  content: { kind: "binary" },
  image: {
    old: png(
      "iVBORw0KGgoAAAANSUhEUgAAAKAAAABwCAYAAACZ8XsCAAABHUlEQVR42u3SAQ0AIAwDwSnFEKJBBIGM9C6ZgfWrAAAAAAAAAAAAAAAA4DNjruULXA3s9HyR59GJkTbRiZFW4QmRFuEJUXwiRHhCFJ8IEZ8IxSdCxCdC8YkQ8YlQfCJEfCIUoAARnwjFJ0IEKEDxiRABClB8IhSgE6AABSg+pwoBClCAAkR8IhSgABGgAAUoQAQoQAEKEAEKUIACRHwiFKH4EKAABShABChAAQoQAQpQgAJEgAIUofgQoAAFKEBEKD4BChABClCE4kOAAhSh+BCgAEUoPgIjtLYABUhmhFYWofjIi9CqIhQfeRFaUYTiIy9Cq4lQfGSFaB0Rio+sEK1ACY+IGH2X5zH6IlcD9QUAAAAAAAAAAAAAAOAzG3mb9dcpa2a0AAAAAElFTkSuQmCC",
    ),
    new: png(
      "iVBORw0KGgoAAAANSUhEUgAAAKAAAABwCAYAAACZ8XsCAAABUUlEQVR42u3cUQ2AMAxAwTlDAKKwxC+OcDEsbCEspb2X1EC58AVtTZIkSZIkSZIkSZIkSZIkSZIkSdJU23V0W9CnwN6OLWo5OhgVBh2MCgUPRIWAByJ8EAo8EOGDUPBBCB+Egg9C+CAUfBDCB6HggxBAAFd2n3uPOvAVQPg3gBXxpUYIIIAADgKsjC8tQgABBHAAIHxJEQIIIIAAAhgZIHSJEQIIIIAAAhgVIGzJEQIIIIAAAggggAACCCCAAAIIIIAAAlgeIGQFEHoDwgcggAACCCCAAAIIIIAAAggggAACCCCAvoiGD0DgAAQQwLIAIfRfMIAAAmgAdB0LPgABBNCFVPgABBBAV/Lhqxl8AhBACOEThPBBCJ8ghA9C+AQhfBDCJwjhE3iCED5FgegpqIGnEhhtV8sx2qI+BWoLkiRJkiRJkiRJkiRJkiRJkiRpsgeYkRo5hxgX4gAAAABJRU5ErkJggg==",
    ),
  },
  fingerprint: "sample",
};

const binary: FileDiff = {
  path: "src-tauri/icons/icon.ico",
  oldPath: "src-tauri/icons/icon.ico",
  oldMode: "100644",
  newMode: "100644",
  content: { kind: "binary" },
  image: null,
  fingerprint: "sample",
};

const tooLarge: FileDiff = {
  path: "pnpm-lock.yaml",
  oldPath: "pnpm-lock.yaml",
  oldMode: "100644",
  newMode: "100644",
  content: { kind: "tooLarge", bytes: 1_845_302, lines: 24_381 },
  image: null,
  fingerprint: "sample",
};

const modeOnly: FileDiff = {
  path: "scripts/release.sh",
  oldPath: "scripts/release.sh",
  oldMode: "100644",
  newMode: "100755",
  content: { kind: "empty" },
  image: null,
  fingerprint: "sample",
};

/** A generated 20,000-line new file, for checking scrolling and highlighting at scale. */
function large(): FileDiff {
  const lines = Array.from({ length: 20_000 }, (_, i) =>
    i % 5 === 0
      ? `+// Section ${i / 5 + 1}: generated from icons/svg/${i}.svg`
      : `+export const icon${i} = { id: ${i}, path: "M${i % 24} 0h24v24H${i % 24}z", tags: ["glyph", "${i % 7 === 0 ? "brand" : "ui"}"] };`,
  );
  return textDiff("src/generated/icons.ts", [hunk(1, 1, "", lines)], {
    oldPath: null,
    oldMode: null,
  });
}

export const sampleDiffs = {
  TypeScript: () => typescript,
  "Rust (renamed)": () => rust,
  Added: () => added,
  SVG: () => logo,
  PNG: () => raster,
  Binary: () => binary,
  "Too large": () => tooLarge,
  "Mode only": () => modeOnly,
  "20k lines": large,
} satisfies Record<string, () => FileDiff>;

export type SampleDiffName = keyof typeof sampleDiffs;
