#!/usr/bin/env node
// Builds the deployable copy of the website (used by .github/workflows/pages.yml).
//
//   node website/build.mjs <out-dir> [version]
//
// The version comes from the argument or $TYLIA_VERSION; a leading "v" is stripped.
// - With a version: every __VERSION__ becomes that version, and
//   <!-- if:no-release -->…<!-- /if:no-release --> blocks are removed.
// - Without one (no release yet): every link that contains __VERSION__ points at the
//   releases page instead, and <!-- if:release -->…<!-- /if:release --> blocks are removed.
// Fails if any __VERSION__ is left in the output.

/* global process, console */
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASES_URL = "https://github.com/gilgil28/tylia/releases";
const PLACEHOLDER = "__VERSION__";
const SELF = "build.mjs";

const srcDir = dirname(fileURLToPath(import.meta.url));
const [outArg, versionArg] = process.argv.slice(2);
if (!outArg) {
  console.error("usage: node website/build.mjs <out-dir> [version]");
  process.exit(2);
}
const outDir = resolve(outArg);
if (outDir === srcDir) {
  console.error("build.mjs: the output directory must not be the website directory");
  process.exit(2);
}

const rawVersion = (versionArg ?? process.env.TYLIA_VERSION ?? "").trim();
const version = rawVersion.replace(/^v/, "");
// Semver, optionally with a pre-release / build suffix. Anything else is refused so a tag
// can never inject markup into the page.
if (version && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`build.mjs: "${rawVersion}" is not a version`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
cpSync(srcDir, outDir, {
  recursive: true,
  filter: (path) => resolve(path) !== join(srcDir, SELF),
});

const block = (name) =>
  new RegExp(`[ \\t]*<!-- if:${name} -->[\\s\\S]*?<!-- /if:${name} -->[ \\t]*\\n?`, "g");
const marker = (name) => new RegExp(`<!-- /?if:${name} -->`, "g");

function render(html) {
  if (version) {
    return html
      .replace(block("no-release"), "")
      .replace(marker("release"), "")
      .replaceAll(PLACEHOLDER, version);
  }
  return html
    .replace(block("release"), "")
    .replace(marker("no-release"), "")
    .replace(/href="[^"]*__VERSION__[^"]*"/g, `href="${RELEASES_URL}"`);
}

let leftovers = 0;
for (const name of readdirSync(outDir)) {
  if (!name.endsWith(".html")) continue;
  const file = join(outDir, name);
  const html = render(readFileSync(file, "utf8"));
  writeFileSync(file, html);
  const left = html.split(PLACEHOLDER).length - 1;
  if (left) {
    console.error(`build.mjs: ${name} still contains ${left} × ${PLACEHOLDER}`);
    leftovers += left;
  }
}
if (leftovers) process.exit(1);

console.log(
  version
    ? `website built for version ${version} → ${outDir}`
    : `website built without a release → ${outDir}`,
);
