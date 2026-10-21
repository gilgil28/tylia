// Finds user-facing text that bypasses src/i18n/en.ts: literal JSX text and literal
// aria-label / title / placeholder / label props in components. `pnpm i18n:audit`;
// exits non-zero when it finds any. The dev-only gallery is skipped.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src");
const SKIP = [/[\\/]gallery[\\/]/, /GallerySection\.tsx$/, /\.test\.tsx?$/, /[\\/]ipc[\\/]/];
/** Literal text allowed in components: symbols, units, product names. */
const ALLOWED = /^(LFS|Git|Tylia|Ctrl|Shift|Alt|Esc|⌘|⇧|⌥|↵|·|…|—|\+|-|\/|\d+|[A-Z])$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !SKIP.some((re) => re.test(path)) ? [path] : [];
  });
}

const findings: string[] = [];
for (const file of files(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const where = `${relative(join(ROOT, ".."), file)}:${i + 1}`;
    // Text between tags on one line: >Some words< (not the `=>` of an arrow function type).
    for (const m of line.matchAll(/(?<!=)>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
      const text = m[1]!.trim();
      if (text && !ALLOWED.test(text) && !/^[=&|?:(),;]/.test(text)) {
        findings.push(`${where}  text  "${text}"`);
      }
    }
    // Literal props that users see or hear.
    for (const m of line.matchAll(
      /\b(aria-label|title|placeholder|label)="([^"]*[A-Za-z][^"]*)"/g,
    )) {
      if (!ALLOWED.test(m[2]!)) findings.push(`${where}  ${m[1]}  "${m[2]}"`);
    }
  });
}

if (findings.length > 0) {
  console.log(findings.join("\n"));
  console.log(`\n${findings.length} hardcoded string(s); move them to src/i18n/en.ts.`);
  process.exit(1);
}
console.log("No hardcoded user-facing strings found.");
