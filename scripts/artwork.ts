// Generates every image derived from the app icon (src-tauri/icons/app-icon.svg):
//
// - the app icons, with `tauri icon` (.ico, .icns, Linux PNGs, Windows Store tiles);
// - website/favicon.svg and website/assets/icon-256.png;
// - installer artwork: NSIS header and sidebar, WiX banner and dialog (24-bit BMP), the
//   macOS dmg background (PNG);
// - the website's Open Graph image.
//
// Artwork is laid out as HTML with the app's design tokens and the bundled Inter font, and
// rendered with Playwright's Chromium. The output is deterministic for a given Chromium and
// tauri-cli version, so the committed images can be checked with `pnpm artwork --check`.
//
// Usage: pnpm artwork [--check]

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { chromium, type Page } from "@playwright/test";

const ROOT = new URL("..", import.meta.url);
const path = (p: string) => new URL(p, ROOT);
const ICON_SVG = readFileSync(path("src-tauri/icons/app-icon.svg"), "utf8");
// The dark tokens also apply to any element marked data-theme="dark", so one image can show both.
const TOKENS_CSS = readFileSync(path("src/styles/tokens.css"), "utf8").replace(
  ':root[data-theme="dark"]',
  '[data-theme="dark"]',
);
const INTER = readFileSync(
  path("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
).toString("base64");

const check = process.argv.includes("--check");
const outputs = new Map<string, Buffer>();

/** The icon without its source comment, as an inline element. */
const iconMarkup = (size: number) =>
  ICON_SVG.replace(/\s*<!--[\s\S]*?-->/, "").replace(
    "<svg ",
    `<svg width="${size}" height="${size}" `,
  );

type Theme = "light" | "dark";

interface Art {
  file: string;
  width: number;
  height: number;
  theme: Theme;
  format: "bmp" | "png";
  body: string;
}

const BASE_CSS = `
@font-face { font-family: "Inter Variable"; font-weight: 100 900;
  src: url(data:font/woff2;base64,${INTER}) format("woff2"); }
${TOKENS_CSS}
* { margin: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { font-family: "Inter Variable", sans-serif; background: var(--bg-app); color: var(--text);
  -webkit-font-smoothing: antialiased; }
.wordmark { font-weight: 650; letter-spacing: -0.02em; line-height: 1; }
.muted { color: var(--text-secondary); }
`;

const wordmark = (icon: number, text: number, gap: number) => `
  <div style="display:flex;align-items:center;gap:${gap}px">
    ${iconMarkup(icon)}<span class="wordmark" style="font-size:${text}px">Tylia</span>
  </div>`;

/** Left panel of the welcome / finish pages (NSIS) and dialogs (WiX): dark, calm, centred. */
const sidePanel = (width: number, height: number, icon: number) => `
  <div data-theme="dark" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;
    background:var(--bg-app);color:var(--text);display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:${Math.round(icon / 5)}px">
    ${iconMarkup(icon)}
    <span class="wordmark" style="font-size:${Math.round(icon / 3.2)}px">Tylia</span>
  </div>`;

const ARTS: Art[] = [
  {
    // MUI2 header, top left of the inner pages (the page title follows it), on the
    // header's white background.
    file: "src-tauri/windows/nsis-header.bmp",
    width: 150,
    height: 57,
    theme: "light",
    format: "bmp",
    body: `<div style="height:100%;display:flex;align-items:center;padding-left:16px">
      ${wordmark(28, 19, 8)}</div>`,
  },
  {
    file: "src-tauri/windows/nsis-sidebar.bmp",
    width: 164,
    height: 314,
    theme: "light",
    format: "bmp",
    body: sidePanel(164, 314, 72),
  },
  {
    // WiX draws the dialog title in black over the left of the banner.
    file: "src-tauri/windows/wix-banner.bmp",
    width: 493,
    height: 58,
    theme: "light",
    format: "bmp",
    body: `<div style="height:100%;display:flex;align-items:center;justify-content:flex-end;
      padding-right:14px">${iconMarkup(36)}</div>`,
  },
  {
    // Welcome / finish dialogs: WiX writes its text on the white right-hand part.
    file: "src-tauri/windows/wix-dialog.bmp",
    width: 493,
    height: 312,
    theme: "light",
    format: "bmp",
    body: sidePanel(164, 312, 72),
  },
  {
    // Finder window content: app on the left, Applications on the right (tauri.conf.json
    // positions them at x 180 / 480, y 170). Finder draws the icons and their labels.
    file: "src-tauri/macos/dmg-background.png",
    width: 660,
    height: 400,
    theme: "light",
    format: "png",
    body: `
      <div style="position:absolute;inset:0;background:var(--bg-panel)"></div>
      <svg width="660" height="400" style="position:absolute;inset:0">
        <g fill="none" stroke="var(--text-muted)" stroke-width="3" stroke-linecap="round"
          stroke-linejoin="round" opacity="0.7">
          <path d="M290 170 H368"/><path d="M356 158 L370 170 L356 182"/>
        </g>
      </svg>
      <p class="muted" style="position:absolute;left:0;right:0;bottom:44px;text-align:center;
        font-size:13px">Drag Tylia to Applications</p>`,
  },
  {
    file: "website/assets/og.png",
    width: 1200,
    height: 630,
    theme: "dark",
    format: "png",
    body: `
      <div style="height:100%;display:flex;flex-direction:column;justify-content:center;
        padding:0 112px;gap:36px">
        ${wordmark(132, 96, 32)}
        <p style="font-size:40px;font-weight:500;letter-spacing:-0.01em">
          A fast, clear Git client</p>
        <p class="muted" style="font-size:28px">Free and open source for Linux, Windows and
          macOS · tylia.dev</p>
      </div>`,
  },
];

async function render(page: Page, art: Art): Promise<Buffer> {
  await page.setViewportSize({ width: art.width, height: art.height });
  await page.setContent(
    `<!doctype html><html data-theme="${art.theme}"><head><style>${BASE_CSS}</style>
     </head><body style="position:relative">${art.body}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png" });
  return art.format === "png" ? png : bmp(decodePng(png));
}

interface Pixels {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, top row first. */
  data: Buffer;
}

/** Decodes the 8-bit RGB / RGBA, non-interlaced PNGs Chromium writes. */
function decodePng(png: Buffer): Pixels {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString("latin1", pos + 4, pos + 8);
    const chunk = png.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const [depth, colour, , , interlace] = chunk.subarray(8);
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
      if (depth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour})`);
      }
    } else if (type === "IDAT") {
      idat.push(chunk);
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[y * stride + x - channels]! : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[y * stride + x] = (line[x]! + predictor) & 0xff;
    }
  }
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < 3; k++) data[i * 4 + k] = rows[i * channels + k]!;
    data[i * 4 + 3] = channels === 4 ? rows[i * channels + 3]! : 255;
  }
  return { width, height, data };
}

/** A 24-bit, bottom-up BMP (what NSIS and WiX expect). Alpha is dropped: the art is opaque. */
function bmp({ width, height, data }: Pixels): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + rowSize * height);
  out.write("BM", 0, "latin1");
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowSize * height, 34);
  out.writeInt32LE(2835, 38); // 72 dpi
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[row + x * 3] = data[i + 2]!;
      out[row + x * 3 + 1] = data[i + 1]!;
      out[row + x * 3 + 2] = data[i]!;
    }
  }
  return out;
}

/**
 * `tauri icon` writes the .icns entries in a random order; sorting them by type makes the
 * file reproducible (macOS doesn't depend on the order).
 */
function sortIcns(icns: Buffer): Buffer {
  const entries: Buffer[] = [];
  for (let pos = 8; pos < icns.length;) {
    const length = icns.readUInt32BE(pos + 4);
    entries.push(icns.subarray(pos, pos + length));
    pos += length;
  }
  entries.sort((a, b) => a.toString("latin1", 0, 4).localeCompare(b.toString("latin1", 0, 4)));
  return Buffer.concat([icns.subarray(0, 8), ...entries]);
}

/** Runs `tauri icon` into a temp folder and keeps the desktop icons (not Android / iOS). */
function appIcons() {
  const dir = mkdtempSync(join(tmpdir(), "tylia-icons-"));
  try {
    const cli = fileURLToPath(path("node_modules/@tauri-apps/cli/tauri.js"));
    execFileSync(process.execPath, [cli, "icon", "src-tauri/icons/app-icon.svg", "-o", dir], {
      cwd: ROOT,
      // Its progress goes to stderr; a failure still shows it (in the thrown error).
      stdio: "pipe",
    });
    for (const name of DESKTOP_ICONS) {
      const bytes = readFileSync(join(dir, name));
      outputs.set(`src-tauri/icons/${name}`, name.endsWith(".icns") ? sortIcns(bytes) : bytes);
    }
    outputs.set("website/assets/icon-256.png", readFileSync(join(dir, "128x128@2x.png")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DESKTOP_ICONS = [
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.ico",
  "icon.icns",
  "StoreLogo.png",
  ...[30, 44, 71, 89, 107, 142, 150, 284, 310].map((s) => `Square${s}x${s}Logo.png`),
];

appIcons();
outputs.set("website/favicon.svg", Buffer.from(ICON_SVG.replace(/\s*<!--[\s\S]*?-->/, "")));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const art of ARTS) outputs.set(art.file, await render(page, art));
} finally {
  await browser.close();
}

const stale: string[] = [];
for (const [file, bytes] of outputs) {
  const target = path(file);
  const same = existsSync(target) && readFileSync(target).equals(bytes);
  if (check) {
    if (!same) stale.push(file);
  } else if (!same) {
    writeFileSync(target, bytes);
    console.log(`wrote ${file}`);
  }
}
if (check && stale.length > 0) {
  console.error(`artwork: out of date (run pnpm artwork):\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
console.log(check ? "artwork: up to date" : `artwork: ${outputs.size} files checked`);
