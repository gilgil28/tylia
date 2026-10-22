// Checks WCAG contrast of the design tokens in src/styles/tokens.css (docs/DESIGN.md §4.2).
// Run with `pnpm contrast`; exits non-zero if a required check fails.

import { readFileSync } from "node:fs";

type Rgba = [number, number, number, number];
type Tokens = Map<string, string>;

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function block(selector: string): Tokens {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens: Tokens = new Map();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1]!, m[2]!.trim());
  return tokens;
}

function resolve(tokens: Tokens, name: string): string {
  let value = tokens.get(name);
  for (let i = 0; value?.startsWith("var(") && i < 5; i++) {
    value = tokens.get(value.slice(4, -1).trim());
  }
  if (!value) throw new Error(`token not found: ${name}`);
  return value;
}

function parse(color: string): Rgba {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1]!.split(",").map(Number);
    return [r!, g!, b!, a];
  }
  throw new Error(`unsupported colour: ${color}`);
}

function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

interface Check {
  fg: string;
  bg: string;
  min: number;
  note: string;
}

const checks: Check[] = [
  { fg: "--text", bg: "--bg-app", min: 7, note: "body text" },
  { fg: "--text", bg: "--bg-panel", min: 7, note: "body text on panels" },
  { fg: "--text", bg: "--bg-elevated", min: 7, note: "body text on menus" },
  { fg: "--text-secondary", bg: "--bg-app", min: 4.5, note: "secondary text" },
  { fg: "--text-secondary", bg: "--bg-panel", min: 4.5, note: "secondary text on panels" },
  { fg: "--text-secondary", bg: "--bg-elevated", min: 4.5, note: "secondary text on menus" },
  { fg: "--text-secondary", bg: "--bg-titlebar", min: 4.5, note: "inactive tabs" },
  { fg: "--text", bg: "--bg-tab-active", min: 7, note: "active tab" },
  { fg: "--accent-text", bg: "--accent-fill", min: 4.5, note: "primary button label" },
  { fg: "--accent-text", bg: "--accent-hover", min: 4.5, note: "primary button label, hover" },
  { fg: "--accent-text", bg: "--danger-fill", min: 4.5, note: "danger button label" },
  { fg: "--accent-text", bg: "--danger-hover", min: 4.5, note: "danger button label, hover" },
  { fg: "--accent", bg: "--bg-app", min: 3, note: "accent marks, focus ring" },
  // Status colours are also used for text (status letters, +N / −N counts, warnings).
  ...["--success", "--danger", "--warning", "--info"].flatMap((fg) =>
    ["--bg-app", "--bg-panel", "--bg-selected"].map((bg) => ({
      fg,
      bg,
      min: 4.5,
      note: `status colour as text on ${bg.slice(5)}`,
    })),
  ),
  ...Array.from({ length: 8 }, (_, i) => ({
    fg: `--lane-${i + 1}`,
    bg: "--bg-app",
    min: 3,
    note: `graph lane ${i + 1}`,
  })),
  { fg: "--text-muted", bg: "--bg-app", min: 4.5, note: "muted text (hints, placeholders)" },
  { fg: "--text-muted", bg: "--bg-panel", min: 4.5, note: "muted text on panels" },
  { fg: "--text-muted", bg: "--bg-elevated", min: 4.5, note: "muted text on menus and dialogs" },
  { fg: "--text-muted", bg: "--bg-selected", min: 4.5, note: "muted text in selected rows" },
  {
    fg: "--text-muted",
    bg: "--bg-selected-strong",
    min: 4.5,
    note: "muted text in selected rows of a focused list",
  },
  {
    fg: "--text-secondary",
    bg: "--bg-selected-strong",
    min: 4.5,
    note: "secondary text in selected rows of a focused list",
  },
];

const light = block(':root[data-theme="light"]');
const themes: [string, Tokens][] = [
  ["light", light],
  ["dark", new Map([...light, ...block(':root[data-theme="dark"]')])],
];

let failures = 0;
for (const [theme, tokens] of themes) {
  console.log(`\n${theme}`);
  const bgApp = parse(resolve(tokens, "--bg-app"));
  for (const c of checks) {
    const bg = over(parse(resolve(tokens, c.bg)), bgApp);
    const fg = over(parse(resolve(tokens, c.fg)), bg);
    const r = ratio(fg, bg);
    const ok = r >= c.min;
    if (!ok) failures++;
    const status = c.min === 0 ? "info" : ok ? "pass" : "FAIL";
    console.log(
      `  ${status.padEnd(4)}  ${r.toFixed(2).padStart(5)}:1  (min ${c.min})  ${c.fg} on ${c.bg} — ${c.note}`,
    );
  }
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll contrast checks passed.");
process.exit(failures ? 1 : 0);
