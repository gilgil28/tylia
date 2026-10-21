# Tylia — Kickoff Plan

> **How to use this file**
> Open a terminal in this folder, start Claude Code, and say:
>
> ```
> Read KICKOFF.md and execute it.
> ```
>
> The session that reads this file starts from an empty folder. Everything it needs —
> product vision, design system, architecture, phases, acceptance criteria and working
> rules — is below. Later sessions continue from `docs/ROADMAP.md` and `CLAUDE.md`,
> which the first session creates from this file.

---

## 0. Instructions for the executing session

You are building **Tylia** (see §0.2), an open-source, cross-platform
desktop Git client whose workflow and layout are inspired by Atlassian Sourcetree, with a
modern, clean, calm visual design and a first-class dark theme. It must not look or feel
like a 1990s Windows app: no grey bevelled panels, no dense walls of labelled buttons, no
default system widgets.

### 0.1 First-run procedure (do these in order)

1. **Check prerequisites** and report what is missing. Do not install system packages
   yourself — print the exact command for the user's OS and wait.
   - Rust stable (`rustup`, `cargo`), Node.js LTS, `pnpm`, `git` ≥ 2.40.
   - Windows: WebView2 (preinstalled on Windows 11), MSVC Build Tools ("Desktop development with C++").
   - macOS: Xcode Command Line Tools.
   - Linux (Arch/CachyOS): `sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool`
   - Linux (Debian/Ubuntu): see the Tauri v2 prerequisites page.
2. **Confirm the license with the user** (AskUserQuestion): default **MIT OR Apache-2.0**
   dual license, the Rust-ecosystem norm. Name, org and domain are already decided (§0.2).
3. **Verify current stable versions** of the stack (§3) with a web search before
   scaffolding — your training data may be stale. Pin exact versions.
4. **Create the persistent project docs** from this file:
   - `CLAUDE.md` ← §8 (working rules) verbatim, plus a pointer to the docs below.
   - `docs/ROADMAP.md` ← §6 (phases) with checkboxes, plus §7 feature inventory.
   - `docs/DESIGN.md` ← §4 (design system) verbatim.
   - `docs/ARCHITECTURE.md` ← §5.
   - Then move this file to `docs/KICKOFF.md` (history; not read again unless needed).
5. `git init`, add `.gitignore`, `.editorconfig`, `.gitattributes` (`* text=auto eol=lf`).
   **Do not commit** unless the user asks.
6. **Execute Phase 0, then stop**: show screenshots (light + dark) and a short summary,
   and wait for the user's review before Phase 1.
7. For every later phase: execute, verify (tests + screenshots + acceptance list), stop, wait.

### 0.2 Naming

The name is decided: **Tylia**, pronounced **TEE-lee-a**. State the pronunciation once
near the top of the README.

- Origin: a respelling of *Tilia*, botanical Latin for the linden tree (the Git tree
  metaphor). The **y** reads as a fork in a branch — use that for the logo/wordmark (the
  y's arms drawn as two graph lanes joining). Lithuanian *tyla* means "silence", which
  fits "calm by default" (have a native speaker confirm before using it in copy).
- Availability checked on 2026-10-19: GitHub org `tylia-dev` free (bare `tylia` taken);
  crates.io `tylia` and `tylia-git` free; npm `tylia` free; domain `tylia.dev` unregistered
  (`tylia.com`, `.net`, `.org`, `.io` are taken by others); no developer tools on GitHub
  use the name. Trademarks were not checked.
- GitHub: org **`tylia-dev`**, repository **`github.com/tylia-dev/tylia`** — use this URL
  in README, `Cargo.toml` (`repository`), `package.json` (`repository`, `bugs`), issue
  templates and SECURITY.md.
- Website: **https://tylia.dev** — use it as `homepage` in `Cargo.toml`/`package.json`,
  in README and the About dialog. `.dev` is HTTPS-only (HSTS preload); the site will be
  served by GitHub Pages from the repo (Phase 6). Security contact placeholder in
  SECURITY.md: `security@tylia.dev` (mark as "to be set up" until the mailbox exists).
- Identifiers: product name `Tylia`; bundle identifier `dev.tylia.app` (reverse-DNS of
  tylia.dev); Cargo packages `tylia` (app) and `tylia-git` (core); binary `tylia`.
- Keep the name in exactly one place per ecosystem (`package.json` `name`/`productName`,
  `tauri.conf.json` `productName`/`identifier`, Cargo package names).

### 0.3 Legal / branding guardrail

Recreate the **workflow and information layout** of Sourcetree, never its assets.
Do not copy Atlassian icons, images, colours-as-branding, text, the Sourcetree name or
logo, or any code. All icons come from an open icon set (Lucide, ISC) or are drawn by us.
Never describe Tylia as "Sourcetree for Linux" in product text; "inspired by" in the
README is fine.

---

## 1. Product vision

**One sentence:** the Git client you would show someone to prove a GUI can be faster
and clearer than the command line — beautiful commit graph, effortless line-level
staging, zero clutter.

**Principles**

1. **Calm by default.** Content first, chrome last. Neutral surfaces, one accent colour,
   colour reserved for meaning (graph lanes, diff add/remove, status).
2. **The graph is the hero.** It must be gorgeous, legible at a glance, and instant on
   huge repositories.
3. **Keyboard-first, mouse-friendly.** Every action reachable from a command palette
   (Ctrl/Cmd+K) and a shortcut; every list navigable with arrows.
4. **Never lose work.** Destructive operations confirm, explain what will be lost, and
   prefer reversible alternatives (`--force-with-lease`, stash before discard where sensible).
5. **Honest about Git.** Show the real command and the real stderr when something fails
   (collapsible "Details"). No invented abstractions that hide Git's model.
6. **Fast.** Perceived latency under 100 ms for navigation; nothing blocks the UI thread.
7. **Private.** No telemetry. No network requests the user didn't trigger
   (avatars are off by default; Gravatar is opt-in).
8. **Cross-platform, native-respectful.** Same app on Linux, Windows and macOS, honouring
   each platform's window controls, shortcuts (Cmd vs Ctrl) and file-manager integration.

**Non-goals (for v1):** built-in hosting-provider PR management, built-in merge editor
(use an external mergetool first), plugin system, Git LFS management UI beyond indicators.

---

## 2. Target platforms

| OS | Webview | Packages (Phase 6) |
|---|---|---|
| Linux (Arch/CachyOS first-class, also Ubuntu/Fedora) | WebKitGTK 4.1 | AppImage, .deb, .rpm, AUR PKGBUILD; Flatpak later |
| Windows 10/11 | WebView2 | NSIS installer (+ MSI) |
| macOS 12+ (arm64 + x64) | WKWebView | .dmg (universal) |

WebKitGTK is the slowest of the three webviews: **all performance work is measured on Linux.**

---

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | Small binaries, native webviews, Rust backend, all three OSes |
| Backend | **Rust** (stable), cargo workspace | Fast, safe process + file handling |
| Git (writes, most reads) | **system `git` binary** via `std::process::Command` / `tokio::process` | Exact parity with the CLI: hooks, credential helpers, config, LFS, signing |
| Git (hot read paths, later) | `gix` (gitoxide) — only where profiling shows `git` is the bottleneck | Pure Rust, fast object access |
| FS watching | `notify` (+ debounce) | Refresh status/refs on change |
| IPC types | `tauri-specta` (or `ts-rs` if specta isn't stable) | Generated TS types from Rust — one source of truth |
| Frontend | **React + TypeScript + Vite** | Mature, Claude-friendly, huge ecosystem |
| Styling | **Tailwind CSS v4** driven by CSS custom-property tokens | Design tokens in one place; themes = token swaps |
| Primitives | **Radix UI** (unstyled) | Accessible menus, context menus, dialogs, tooltips, tabs |
| Icons | **Lucide** | Clean 1.5–2px line icons, ISC license |
| Fonts (bundled, offline) | **Inter** (UI), **JetBrains Mono** (code) | OFL; never fetched from Google at runtime |
| Virtualization | `@tanstack/react-virtual` | History, file lists, diff lines |
| State | **Zustand** (UI state) + `@tanstack/react-query` (backend data cache/invalidation) | Small, explicit |
| Syntax highlighting | **Shiki** in a Web Worker, lazy, per visible hunk | VS Code-quality grammars + themes |
| Commit graph | **Canvas 2D** renderer per visible window | Thousands of rows at 60 fps; DOM for text columns |
| Tests | `cargo test` (temp-repo fixtures), **Vitest**, **Playwright** (browser mode against mock IPC) | See §5.7 |
| Lint/format | `rustfmt`, `clippy -D warnings`, ESLint (flat config), Prettier, `tsc --noEmit` | |
| Package manager | **pnpm** | |
| CI | GitHub Actions matrix: ubuntu, windows, macos | |

Dependency rule: every dependency must be MIT / Apache-2.0 / BSD / ISC / OFL / Zlib / MPL-2.0.
No GPL in the shipped app. Prefer fewer dependencies.

---

## 4. Design system  → becomes `docs/DESIGN.md`

### 4.1 Feel

Reference points for *feel*, not for copying: Linear, Zed, Raycast, Arc, Sublime Merge,
GitHub's dark theme. Flat surfaces separated by subtle 1px borders and small tonal
steps; shadows only on floating layers (menus, popovers, dialogs, toasts).
Generous but desktop-dense: this is a tool for long sessions.

**Never:** gradients on controls, bevels, inset 3D borders, heavy drop shadows on panels,
pure black (#000) or pure white text on dark, ALL-CAPS headers, more than one accent
colour, icon+label toolbars with 15 items, default OS scrollbars on Windows/Linux,
modal dialogs where an inline affordance works.

### 4.2 Tokens (CSS custom properties; Tailwind reads them)

All colours are tokens. Components never use raw hex.

**Dark (default when OS is dark)**

| Token | Value | Use |
|---|---|---|
| `--bg-app` | `#0F1115` | Main content background |
| `--bg-panel` | `#14171C` | Sidebar, titlebar, panel headers |
| `--bg-elevated` | `#1B1F26` | Menus, popovers, dialogs, toasts |
| `--bg-input` | `#0B0D10` | Text inputs, commit message box |
| `--bg-hover` | `rgba(255,255,255,0.04)` | Row/control hover |
| `--bg-active` | `rgba(255,255,255,0.07)` | Pressed |
| `--bg-selected` | `rgba(94,139,255,0.16)` | Selected row |
| `--bg-selected-strong` | `rgba(94,139,255,0.24)` | Selected + focused list |
| `--border-subtle` | `rgba(255,255,255,0.06)` | Panel dividers |
| `--border` | `rgba(255,255,255,0.10)` | Inputs, cards |
| `--border-strong` | `rgba(255,255,255,0.16)` | Focused inputs (with ring) |
| `--text` | `#E6E8EC` | Primary text |
| `--text-secondary` | `#A2A9B5` | Secondary text, metadata |
| `--text-muted` | `#6B7280` | Placeholders, disabled, hints |
| `--accent` | `#5E8BFF` | Primary buttons, focus ring, current-branch marker |
| `--accent-text` | `#FFFFFF` | Text on accent |
| `--focus-ring` | `0 0 0 2px rgba(94,139,255,0.55)` | Keyboard focus |
| `--success` / `--added` | `#3FB97F` | Added, success |
| `--danger` / `--removed` | `#F0616D` | Removed, destructive |
| `--warning` / `--modified` | `#E8B04B` | Modified, conflicts, warnings |
| `--info` / `--renamed` | `#4FB3D9` | Renamed/copied |
| `--diff-add-bg` | `rgba(63,185,127,0.10)` | Added line |
| `--diff-add-word` | `rgba(63,185,127,0.28)` | Word-level emphasis |
| `--diff-del-bg` | `rgba(240,97,109,0.10)` | Removed line |
| `--diff-del-word` | `rgba(240,97,109,0.28)` | Word-level emphasis |
| `--diff-hunk-bg` | `rgba(94,139,255,0.08)` | Hunk header |
| `--shadow-popover` | `0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)` | Floating layers |

**Light**

| Token | Value |
|---|---|
| `--bg-app` | `#FFFFFF` |
| `--bg-panel` | `#F7F8FA` |
| `--bg-elevated` | `#FFFFFF` |
| `--bg-input` | `#FFFFFF` |
| `--bg-hover` | `rgba(0,0,0,0.04)` |
| `--bg-active` | `rgba(0,0,0,0.07)` |
| `--bg-selected` | `rgba(61,107,245,0.10)` |
| `--bg-selected-strong` | `rgba(61,107,245,0.16)` |
| `--border-subtle` | `rgba(0,0,0,0.06)` |
| `--border` | `rgba(0,0,0,0.10)` |
| `--border-strong` | `rgba(0,0,0,0.18)` |
| `--text` | `#1C2024` |
| `--text-secondary` | `#5B6370` |
| `--text-muted` | `#8B93A0` |
| `--accent` | `#3D6BF5` |
| `--success` / `--added` | `#1F9D63` |
| `--danger` / `--removed` | `#D9364A` |
| `--warning` / `--modified` | `#B7791F` |
| `--info` / `--renamed` | `#1E88B5` |
| `--diff-add-bg` | `rgba(31,157,99,0.09)` |
| `--diff-add-word` | `rgba(31,157,99,0.24)` |
| `--diff-del-bg` | `rgba(217,54,74,0.08)` |
| `--diff-del-word` | `rgba(217,54,74,0.22)` |
| `--shadow-popover` | `0 8px 24px rgba(16,24,40,0.12), 0 0 0 1px rgba(0,0,0,0.06)` |

Theme setting: **System** (default) / Light / Dark, applied via `data-theme` on `<html>`,
switching with no flash on startup (resolve theme in Rust before the window shows, or
set the background colour of the window to match).

Verify with a contrast check: body text ≥ 7:1, secondary text ≥ 4.5:1, graph lane
colours ≥ 3:1 against `--bg-app` in **both** themes. Adjust values if a check fails and
record the change in DESIGN.md.

### 4.3 Graph lane palette

Eight hues, assigned per branch line (a lane keeps its colour for its whole length; a
colour must not jump when scrolling). Separate light/dark variants.

| # | Dark | Light |
|---|---|---|
| 1 | `#5E8BFF` blue | `#3D6BF5` |
| 2 | `#3FB97F` green | `#1F9D63` |
| 3 | `#E8A33D` amber | `#B7791F` |
| 4 | `#E0607E` rose | `#C93D60` |
| 5 | `#9B7BF0` violet | `#7653D9` |
| 6 | `#2BB3C0` teal | `#138A96` |
| 7 | `#F07A4A` orange | `#C9542A` |
| 8 | `#8FA2B8` slate | `#5E7088` |

The checked-out branch's lane is always colour 1 (accent family) when it is visible.

### 4.4 Typography

- UI: **Inter**, `font-feature-settings: "cv11", "ss01"`; numbers in tables use `"tnum"`.
- Code/diff/hashes: **JetBrains Mono**, ligatures **off** in diffs.
- Scale (px): 11 (badges, captions) · 12 (secondary, metadata) · **13 (base UI)** · 14 (panel titles) · 16 (dialog titles) · 20 (welcome screen heading). Diff text 12.5.
- Line-height 1.45 for UI text, 1.6 for diff lines (row height fixed per density).
- Weights: 400 body, 500 labels/selected, 600 titles. Never 700+ in the chrome.
- Sentence case everywhere ("Push changes", not "Push Changes" or "PUSH").
- UI font size is user-scalable (Settings → 12/13/14/15) via a root token.

### 4.5 Spacing, size, shape

- 4 px grid. Common gaps: 4, 8, 12, 16, 24.
- Radius: 4 (badges/chips) · 6 (buttons, inputs, list rows) · 8 (menus, popovers, cards) · 12 (dialogs) · 999 (pills, avatars).
- Control heights: 28 (default button/input) · 24 (compact/inline) · 32 (primary actions in dialogs).
- List row heights: **Comfortable** 30 / **Compact** 24 (history, file lists). Density is a setting.
- Icons: Lucide at 16 px, stroke 1.75; 14 px inside compact rows. Icon buttons are 28×28 with a 6 px radius hover background.
- Scrollbars: thin (8 px), overlay-style, thumb `--border-strong`, visible on hover/scroll only.

### 4.6 Motion

- Hover/press: 100–120 ms ease-out. Panels, popovers: 140–180 ms, opacity + 4 px translate.
- No bounces, no spring overshoot, no animated graph on scroll.
- Respect `prefers-reduced-motion` (disable all non-essential transitions).
- Loading: skeleton rows that match final layout; spinners only inside buttons (inline progress).

### 4.7 Window chrome

- **Single integrated top bar** (like Zed / browsers): repo tabs live in the title bar.
- macOS: native traffic lights via `titleBarStyle: "Overlay"`, tabs inset past them.
- Windows & Linux: `decorations: false`, custom min/max/close buttons drawn to platform
  conventions (Windows: right-aligned, 46×36, red close hover; Linux: right-aligned round
  GNOME-style buttons). `data-tauri-drag-region` on empty title-bar space; double-click
  maximizes. On Windows, keep Snap Layouts working if Tauri supports it; otherwise note the gap.
- Setting **"Use native title bar"** (restart required) as a fallback for tiling WMs and
  edge cases on Linux.

### 4.8 Layout (main window)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  [ tylia ▾ ×] [ my-app × ] [ + ]                        ⌘K   ─  □  ×   │ title bar + repo tabs (38)
├───────────────────────────────────────────────────────────────────────────────┤
│ ⎇ main ▾  ↑2 ↓0 │  ⟳ Fetch   ↓ Pull   ↑ Push ²  │  ⑂ Branch  ⊕ Stash  │  ⋯   │ toolbar (44)
├──────────────┬────────────────────────────────────────────────────────────────┤
│ WORKSPACE    │  Graph │ Description                     │ Author  │ Date │ Hash│
│  ◉ Changes 3 │  ●─┐   │ [main] [origin/main] Fix parser │ GC      │ 2h   │ a1b2│
│  ○ History   │  │ ●   │ [feature/x] Add lanes           │ AB      │ 5h   │ c3d4│
│              │  ●─┘   │ Merge branch 'feature/y'        │ GC      │ 1d   │ e5f6│
│ Branches  ▾  │  ●     │ Initial graph renderer          │ GC      │ 2d   │ 7a8b│
│  ✓ main  ↑2  │                                                                │
│  ▸ feature/  ├──────────────────────────────┬─────────────────────────────────┤
│ Remotes   ▾  │ Fix parser                    │ src/parser.rs              +4 −1│
│  ▸ origin    │ a1b2c3d · Gil · 2 hours ago   │ ─────────────────────────────── │
│ Tags      ▸  │ Parents: 9f8e7d               │ @@ -10,6 +10,9 @@ fn parse      │
│ Stashes   ▸  │ ───────────────────────────── │ 10  10   let x = 1;             │
│ Submodules ▸ │ M src/parser.rs        +4 −1  │ 11     - let y = 2;             │
│              │ A src/lanes.rs        +120    │     11 + let y = compute();     │
└──────────────┴──────────────────────────────┴─────────────────────────────────┘
```

- Sidebar 240 px default, resizable 180–400, collapsible (Ctrl/Cmd+B). Section headers
  are 11 px medium, `--text-muted`, sentence case — *not* the ALL-CAPS shown in the sketch.
- All splitters resizable; sizes persisted per repo.
- **Changes view** (Sourcetree's "File status"):

```
├──────────────┬──────────────────────────────┬─────────────────────────────────┤
│ sidebar      │ Unstaged (3)     Stage all ⤓ │ src/app.ts                      │
│              │ ☐ M src/app.ts               │ @@ -1,4 +1,6 @@   [Stage hunk]  │
│              │ ☐ ? notes.md                 │ ▢ 1  + import x from "y";       │
│              │ ☐ D old.ts                   │ ▣ 2  + import z from "w";       │
│              │ Staged (1)     Unstage all ⤒ │   3    const a = 1;             │
│              │ ☑ A src/new.ts               │       [Stage 1 line] [Discard]  │
│              ├──────────────────────────────┴─────────────────────────────────┤
│              │ Summary (subject)                                      38/72   │
│              │ Description…                                                   │
│              │ ☐ Amend   ☐ Push after commit             [ Commit  ⌘↵ ]       │
└──────────────┴────────────────────────────────────────────────────────────────┘
```

### 4.9 Component inventory (build in `src/ui/`, show all of them on a dev "Gallery" page)

Button (primary / secondary / ghost / danger; sizes 24/28/32; loading state) · IconButton
· SplitButton (Pull ▾) · Tooltip (with shortcut Kbd) · Kbd · Input · Textarea (auto-grow)
· Checkbox (incl. indeterminate) · Switch · Select · SegmentedControl · Tabs ·
RepoTab (closable, drag-reorder, dirty dot) · Menu / ContextMenu (icons, shortcuts,
submenus, separators, danger items) · Dialog (title, body, footer actions; Esc/Enter) ·
ConfirmDialog (explains consequences; destructive variant) · Popover · Toast (success /
error with "Details" / progress) · Badge/RefBadge (local branch, remote branch, tag,
HEAD, stash) · Avatar (initials, deterministic colour; image when opted in) ·
SplitPane · VirtualList · Tree (sidebar branches folding on `/`) · EmptyState ·
Skeleton · ErrorPanel (message + command + stderr, copy button) · ProgressRing ·
CommandPalette.

### 4.10 Ref badges

Pills, 18 px tall, 11 px text, radius 4, 1px border in lane colour at 40% + fill at 14%:
- Local branch: lane colour, branch icon. Current branch: solid accent fill, white text, check icon.
- Remote branch: same hue, outlined only, cloud icon; when a local and its remote point at
  the same commit, merge into one badge `main ⇄ origin` to save space.
- Tag: neutral slate fill, tag icon.
- HEAD (detached): warning colour.
- Overflow: show up to 3, then `+2` chip with a popover listing the rest.

### 4.11 Commit graph rendering spec

- Lane width 14 px (comfortable) / 12 (compact); left padding 8 px; graph column width
  auto-fits to the max lanes in the visible window, capped (e.g. 12 lanes) with a fade +
  "+n" indicator beyond.
- Line width 2 px (1.5 compact), round caps and joins. Lane changes drawn as smooth cubic
  Béziers within one row height, not 45° diagonals.
- Commit dot: 8 px filled circle in lane colour with a 2 px `--bg-app` outline (so lines
  appear to pass behind it). Merge commits: hollow ring. HEAD commit: dot + 3 px outer
  ring in accent. Stash entries (if shown): dashed ring.
- Uncommitted changes appear as a top pseudo-row ("Uncommitted changes · 3 files") with a
  dashed hollow dot above HEAD, like Sourcetree.
- Hover on a row highlights that commit's first-parent path faintly (optional, Phase 5).
- HiDPI: scale the canvas by `devicePixelRatio`; redraw only on visible-range or theme change.
- Draw only the visible window plus overscan; graph rows are computed in Rust and
  streamed in pages (§5.4).

### 4.12 Copy & tone

Short, plain, specific. Buttons are verbs ("Push", "Discard 3 files"). Confirmations state
the consequence ("This permanently deletes uncommitted changes in 3 files."). Errors say
what failed, then why (Git's stderr under "Details"). All strings live in
`src/i18n/en.ts` (typed keys) from day one so translations can be added later.

### 4.13 Visual review checklist (run after every UI change)

1. Screenshot both themes at 1280×800 and 1920×1080 (and 900×600 minimum window).
2. Alignment on the 4 px grid; consistent row heights; no text baseline jitter.
3. Only one accent colour visible per region; colour only where it means something.
4. No truncated labels without a tooltip; ellipsis in the middle for paths
   (`src/…/parser.rs`), at the end for messages.
5. Focus ring visible for keyboard navigation, invisible for mouse clicks (`:focus-visible`).
6. Empty, loading, error states exist and look intentional.
7. Contrast checks pass (§4.2).
8. Nothing looks like a default browser or OS control.

---

## 5. Architecture  → becomes `docs/ARCHITECTURE.md`

### 5.1 Repository layout

```
tylia/
├─ CLAUDE.md                 # working rules for AI sessions (from §8)
├─ README.md                 # screenshots, features, install, build, contribute
├─ LICENSE-MIT, LICENSE-APACHE
├─ CONTRIBUTING.md  CODE_OF_CONDUCT.md (Contributor Covenant)  SECURITY.md
├─ docs/  ROADMAP.md  DESIGN.md  ARCHITECTURE.md  KICKOFF.md
├─ .github/  workflows/ci.yml  ISSUE_TEMPLATE/  PULL_REQUEST_TEMPLATE.md
├─ Cargo.toml                # workspace
├─ crates/
│  └─ tylia-git/             # pure Rust Git layer: no Tauri dependency, fully unit-tested
│     ├─ src/ runner.rs      # spawn git, env, cancellation, progress parsing
│     │       repo.rs log.rs graph.rs status.rs diff.rs patch.rs refs.rs
│     │       remote.rs stash.rs ops/ (branch, merge, rebase, reset, tag, cherry_pick)
│     └─ tests/              # integration tests building temp repos
├─ src-tauri/                # Tauri app: commands, state, watcher, askpass, menus
│  ├─ src/ main.rs commands/ state.rs watcher.rs askpass.rs settings.rs
│  ├─ capabilities/          # minimal permissions
│  └─ tauri.conf.json
├─ src/                      # frontend
│  ├─ app/                   # shell, routing between views, providers, theme
│  ├─ ui/                    # design-system components (§4.9) + Gallery page
│  ├─ features/
│  │  ├─ welcome/  repo-tabs/  sidebar/  toolbar/  history/  graph/
│  │  ├─ commit-details/  diff/  changes/  commit-composer/  palette/  settings/
│  ├─ ipc/                   # generated bindings + typed wrappers
│  │  └─ mock/               # mock backend + fixtures for browser mode
│  ├─ i18n/  en.ts
│  ├─ styles/  tokens.css  base.css  fonts.css
│  └─ workers/  highlight.worker.ts
├─ e2e/                      # Playwright: screenshots + flows against mock IPC
└─ scripts/                  # screenshot runner, fixture dumper, contrast checker
```

### 5.2 Process model

- One Tauri window per app instance; multiple repos as tabs. Each open repo has a
  `RepoSession` in Rust: path, watcher, cached refs, an **operation queue**.
- **Reads** run concurrently. **Writes** are serialized per repo (one at a time) and the
  UI shows them as running operations (toolbar progress, cancel where Git allows).
- Long operations stream progress over a Tauri `Channel` (fetch/push/clone parse
  `--progress` stderr lines into `{phase, current, total}`).
- Cancellation: kill the child process (and its process group on Unix / job object on
  Windows); never leave a stale `index.lock` the app created — if one remains after
  cancel, surface it with a "Remove lock" action, never delete silently.

### 5.3 Running Git safely

- Always `Command::new(git_path).args([...])` — **never** a shell, never string concatenation.
- Validate user-entered ref names with `git check-ref-format --branch`.
- Separate pathspecs with `--`.
- Base args/env for every call: `-c core.quotepath=off -c color.ui=false
  -c log.showSignature=false`, `GIT_TERMINAL_PROMPT=0` (reads), `LC_ALL=C` for parsed
  output only, `GIT_OPTIONAL_LOCKS=0` for `status`/background refreshes.
- Prefer NUL-delimited machine formats (`-z`, `%x00`, `--porcelain=v2`).
- Git path discovery: `PATH`, then common install locations; user override in Settings.
  Show a friendly blocking screen if Git is missing or older than the minimum.
- Windows: `CREATE_NO_WINDOW` so no console flashes.

### 5.4 Key read paths

| Data | Command (sketch) | Notes |
|---|---|---|
| Refs | `git for-each-ref --format='%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track)%00%(HEAD)%00%(*objectname)' refs/heads refs/remotes refs/tags` | Peeled tags via `%(*objectname)` |
| History | `git log -z --date-order --format='%H%x00%P%x00%an%x00%ae%x00%at%x00%s' <refs or --all>` streamed | Parse incrementally; filter options: all branches / current branch / show remote; sort: date / topo |
| Graph | computed in Rust from the commit stream (§5.5) | Sent as pages of rows |
| Commit details | `git show -z --format=... --numstat --name-status -M <sha>` | Body, author/committer, parents, file stats |
| Diff | `git diff --no-color --no-ext-diff -M -U3 [--cached] -- <path>` / `git show <sha> -- <path>` | Large-file guard (>1 MB or >20k lines → collapsed with "Load anyway"); binary/image detection |
| Status | `git status --porcelain=v2 -z --branch --untracked-files=all` | Ahead/behind from `# branch.ab` |
| Stashes | `git stash list -z --format='%gd%x00%H%x00%at%x00%s'` | |
| Submodules | `git submodule status` | |

Large-repo targets (measure on Linux with `git/git`, ~75k commits, and a 50k-file worktree):
first history rows visible < 300 ms; full history streamed in the background; scrolling
at 60 fps; status refresh < 500 ms; opening a 5k-line diff < 150 ms to first paint.

### 5.5 Graph layout algorithm (Rust, `graph.rs`)

Input: commits in display order with parent lists. Maintain `lanes: Vec<Option<Oid>>`
(the commit each lane is waiting for) and `lane_color: Vec<u8>`.

For each commit `c`:
1. Find all lanes expecting `c`. If none, allocate the first free lane (new branch tip)
   with a new colour. The leftmost expecting lane becomes `c`'s lane; other expecting lanes
   end here (draw merge-in curves from them into `c`'s lane) and are freed.
2. First parent continues in `c`'s lane (same colour).
3. Each additional parent: if some lane already expects it, draw a fork curve to that lane;
   otherwise allocate the first free lane (new colour) and draw a fork curve.
4. Emit a row: `{ lane, color, is_merge, edges: [{from_lane, to_lane, color, kind: top|bottom|through}] }`.
5. Compact: when trailing lanes are free, shrink width. Keep lane positions stable where
   possible to avoid visual jitter (do not repack occupied lanes).

Colour assignment: round-robin over the palette, skipping colours used by the adjacent
lanes; the lane carrying the current branch gets colour 1. Write thorough unit tests with
ASCII snapshots (render rows as text like `●─┐`) for: linear history, simple merge,
octopus merge, criss-cross merge, many parallel branches, orphan branches, shallow clone
(missing parents), very long-lived lanes.

### 5.6 Hunk and line staging (`patch.rs`)

- Stage selected lines from a working-tree diff: build a patch containing only the
  selected changes — unselected `+` lines are dropped, unselected `-` lines become
  context — then `git apply --cached --recount --unidiff-zero=false -` via stdin.
- Unstage selected lines from an index diff: inverse — unselected `-` lines are dropped,
  unselected `+` lines become context — and apply with `git apply --cached --reverse --recount`.
- Discard selected lines: same as staging but applied to the worktree in reverse
  (`git apply --reverse`), with confirmation.
- Preserve `\ No newline at end of file` markers, CRLF content (operate on bytes, not
  re-encoded strings), mode changes, and renames. Untracked files: stage-lines uses
  `git add -N` first.
- Tests: table-driven, each case creates a temp repo, applies a selection, asserts
  `git diff --cached` exactly. Cover CRLF, no-EOL, first/last line, adjacent hunks,
  deleted file, new file, renamed + modified, binary (rejected cleanly), non-UTF-8 content.

### 5.7 Testing & visual verification

- **Rust:** unit + integration tests with temp repos (`tempfile`), run with `cargo test`.
  A fixture builder helper (`TestRepo::new().commit("a").branch("x").merge(...)`) keeps tests short.
- **Frontend:** Vitest for logic (stores, formatting, graph canvas math).
- **Mock IPC & browser mode:** `pnpm dev:web` runs the frontend in a normal browser with
  `src/ipc/mock` replacing Tauri `invoke` — fixtures are JSON dumped from real repos by
  `cargo run -p tylia-git --example dump-fixture -- <repo> <out.json>`.
- **Playwright screenshots:** `pnpm shots` renders key screens (welcome, history, commit
  details, changes with hunk selection, context menu, dialog, gallery) in light + dark at
  the sizes in §4.13 into `e2e/__screenshots__/`. **After every UI change, run it, open the
  PNGs, and review them against §4.13 before reporting the work as done.**
- **Real app smoke test:** `pnpm tauri dev` on the dev machine for anything touching
  windows, menus, dialogs, file pickers or the backend.

### 5.8 Security

- Tauri capabilities: only the commands we define + dialog/opener/clipboard plugins as needed.
- Strict CSP (no remote scripts, no `unsafe-eval`; fonts/styles local).
- Never render commit messages or file contents as HTML.
- Askpass: Tylia's own binary acts as `GIT_ASKPASS`/`SSH_ASKPASS` (with
  `SSH_ASKPASS_REQUIRE=force`), relaying prompts to the UI over a local, per-session,
  authenticated channel; secrets are never logged or persisted by Tylia (credential
  storage is Git's credential helper's job).

### 5.9 Settings (persisted JSON in the OS config dir)

Theme · density · UI font size · diff mode (unified/split) · whitespace ignore ·
context lines · tab width · history default (all branches vs current) · date format
(relative/absolute) · show avatars (off) · Gravatar (off) · git executable path · external
diff tool · external merge tool · terminal app · editor command · native title bar ·
recent repositories list.

---

## 6. Phases  → becomes `docs/ROADMAP.md`

Each phase ends with: all tests green, clippy/eslint/tsc clean, screenshots reviewed in
both themes, acceptance list ticked, a short summary to the user, and a **stop** for review.

### Phase 0 — Foundations
- [ ] Cargo workspace (`tylia-git`, `src-tauri`), Tauri 2 + React + TS + Vite + Tailwind v4 + pnpm.
- [ ] Tokens (`tokens.css`, both themes), base styles, bundled Inter + JetBrains Mono, Lucide.
- [ ] Theme switching (System/Light/Dark) without startup flash.
- [ ] Custom title bar per platform (§4.7) with tab strip placeholder + "Use native title bar" setting.
- [ ] `src/ui` primitives from §4.9 (at least: Button, IconButton, Tooltip, Kbd, Input, Textarea, Checkbox, Switch, SegmentedControl, Menu, ContextMenu, Dialog, ConfirmDialog, Toast, Badge, RefBadge, Avatar, SplitPane, VirtualList, Tree, EmptyState, Skeleton, ErrorPanel) and a **Gallery** dev page.
- [ ] IPC plumbing with generated TS types; one sample command (`git_version`) end to end.
- [ ] Mock IPC + `pnpm dev:web` + `pnpm shots` Playwright screenshot pipeline.
- [ ] Contrast-check script for the tokens.
- [ ] OSS files: README (vision, status, build instructions per OS), licenses, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue/PR templates.
- [ ] CI: matrix ubuntu/windows/macos — fmt, clippy, cargo test, eslint, tsc, vitest, `tauri build --no-bundle`.
- **Acceptance:** app launches on the dev OS showing an empty shell with title bar and
  theme toggle; Gallery page screenshots look polished in both themes; CI config valid.

### Phase 1 — Read-only viewer (the "Sourcetree look")
- [ ] Welcome screen: recent repos (name, path, branch, last opened), search, Open / Clone (disabled until Phase 3) / Create, drag-and-drop a folder.
- [ ] Open repo via folder picker; detect non-repo / bare repo / missing git with clear states.
- [ ] Repo tabs: open, close, reorder, restore on restart.
- [ ] Sidebar: Workspace (Changes count, History), Branches (tree by `/`, current marked, ahead/behind), Remotes, Tags, Stashes, Submodules; filter box; collapsed state persisted.
- [ ] History: streamed + virtualized; columns Graph / Description (ref badges + subject) / Author / Date / Hash; resizable + hideable columns; branch filter (all / current); "Uncommitted changes" pseudo-row.
- [ ] Commit graph renderer per §4.11 + Rust layout per §5.5 with snapshot tests.
- [ ] Commit details: subject, body, author/committer, date, parents (clickable), hash (copy), file list (flat/tree toggle, status icons, +/− counts).
- [ ] Diff viewer: unified + side-by-side, Shiki highlighting in a worker, word-level diff emphasis, line numbers, collapsed unchanged regions, binary/image preview (side-by-side images for PNG/JPG/SVG), large-file guard.
- [ ] Search/filter history by message, author, hash, path.
- [ ] Click a sidebar ref → scroll history to its commit.
- [ ] FS watcher refreshes refs/status/history head.
- [ ] Keyboard: ↑/↓ through history, Enter focuses details, Ctrl/Cmd+1..9 switch tabs, Ctrl/Cmd+W close tab.
- **Acceptance:** opens `git/git` (clone it for testing) with first rows < 300 ms and smooth
  scrolling on Linux; graph snapshot tests pass; screenshots match DESIGN.md.

### Phase 2 — Working copy
- [ ] Changes view (§4.8): unstaged / staged lists, status icons, stage/unstage per file, all, via checkbox, double-click, Space, drag between lists.
- [ ] Hunk staging/unstaging/discarding from the diff header.
- [ ] Line selection (click, Shift-click, drag in gutter) → stage / unstage / discard lines (§5.6).
- [ ] Discard file / all with confirmation; untracked → move to trash (OS trash, not permanent delete) where possible.
- [ ] Commit composer: subject with 50/72 guidance, body, amend (prefills last message), "Push after commit", Ctrl/Cmd+Enter, recent messages dropdown, commit hooks output shown on failure, GPG/SSH signing honoured (via git config).
- [ ] Context menus on files: Open, Open in file manager, Copy path, Ignore (add pattern to .gitignore), Show history (Phase 5), Resolve conflicts (Phase 4).
- [ ] Toasts for results; ErrorPanel with stderr.
- **Acceptance:** line-staging test matrix green; manual run-through of stage/unstage/discard/commit/amend on a real repo.

### Phase 3 — Remotes, auth, clone
- [ ] Fetch (all remotes, prune option), Pull (merge / rebase / ff-only from SplitButton), Push (current branch, set upstream on first push, tags option, force-with-lease behind explicit confirm).
- [ ] Progress in toolbar button + operation panel; cancel.
- [ ] Ahead/behind badges on toolbar and sidebar; periodic background fetch (off by default, configurable).
- [ ] Askpass bridge: username/password/token prompts and SSH passphrase prompts as dialogs; host-key confirmation surfaced clearly.
- [ ] Clone dialog: URL, destination, branch, shallow option, progress; opens in a new tab.
- [ ] Create repository (git init) from Welcome.
- [ ] Remotes management: add / edit URL / remove / rename.
- **Acceptance:** fetch/pull/push/clone verified against GitHub over HTTPS (token) and SSH (agent + passphrase key) on Linux and Windows.

### Phase 4 — Branching operations
- [ ] Branch: create (from any commit), checkout (with "stash & reapply" offer when dirty), rename, delete (local, and remote with confirm), set upstream, checkout remote branch as tracking.
- [ ] Merge into current (ff / no-ff options), rebase current onto, cherry-pick, revert, reset current to commit (soft / mixed / hard — hard confirms with file count).
- [ ] Tags: create (lightweight/annotated) on any commit, delete, push.
- [ ] Stashes: save (message, include untracked, keep index), apply, pop, drop, show diff.
- [ ] Context menus on history rows and sidebar refs exposing all of the above.
- [ ] Conflict state: banner ("Merging feature/x — 2 conflicts"), conflicted files list, open external mergetool, mark resolved, continue / skip / abort for merge, rebase, cherry-pick, revert.
- [ ] Drag a branch badge onto another branch row → menu: Merge / Rebase.
- **Acceptance:** each operation tested in `tylia-git` integration tests; conflict flows verified manually.

### Phase 5 — Power & polish
- [ ] Command palette (Ctrl/Cmd+K) with every action + fuzzy repo/branch switcher.
- [ ] Shortcut map (Settings → Keyboard), platform-correct modifiers.
- [ ] Interactive rebase editor: drag to reorder, pick / reword / edit / squash / fixup / drop, preview of resulting graph.
- [ ] Blame view; file history ("Log selected…") with follow-renames.
- [ ] Settings screen (§5.9); compact density; font size.
- [ ] Submodules (update/init, open as tab), worktrees list, LFS indicator, git-flow helpers (optional).
- [ ] Hover first-parent highlight in graph; jump-to-parent/child shortcuts.
- [ ] Accessibility pass: screen-reader labels, roles, focus order, reduced motion, 200% zoom.
- [ ] i18n readiness audit (no hardcoded strings).
- **Acceptance:** palette covers all actions; a11y checklist passes; screenshots updated in README.

### Phase 6 — Release
- [ ] Release workflow (tauri-action): Linux AppImage/deb/rpm, Windows NSIS/MSI, macOS dmg (universal).
- [ ] AUR `PKGBUILD` (`tylia-bin`), Flatpak manifest (later).
- [ ] Code-signing notes for Windows/macOS (unsigned builds documented until certificates exist).
- [ ] Opt-in update check via Tauri updater (off by default; no data sent beyond the request).
- [ ] Website at https://tylia.dev (GitHub Pages, custom domain, HTTPS enforced): one page with hero screenshot (light + dark), features, download links per OS, pronunciation.
- [ ] CHANGELOG.md (Keep a Changelog), semver tags, v0.1.0.

---

## 7. Feature inventory (Sourcetree parity reference)

Long-standing Sourcetree capabilities, used to judge completeness. ✅ = planned in the
phases above, ⏳ = later / backlog, ✗ = intentionally out of scope for v1.

| Area | Capability | Plan |
|---|---|---|
| Repos | Repository browser/bookmarks, recent list, tabs | ✅ P1 |
| Repos | Clone, create, add existing; hosting-account browsing (GitHub/Bitbucket/GitLab) | ✅ P3 / ⏳ accounts |
| History | Graph with branch lines, ref labels, all/current branch filter, date/ancestor order | ✅ P1 |
| History | Search by message/author/hash/file; jump to ref | ✅ P1 |
| History | Commit details, file list, diff; copy hash; parents navigation | ✅ P1 |
| Diff | Unified/side-by-side, whitespace ignore, context lines, image diff | ✅ P1 |
| Diff | External diff tool | ✅ P5 |
| Working copy | File status with staged/unstaged lists, stage file/hunk/line, discard hunk/line | ✅ P2 |
| Working copy | Ignore file/pattern, stop tracking, open in file manager/terminal | ✅ P2 |
| Commit | Message box, amend, push immediately, commit message history, sign-off/sign | ✅ P2 |
| Remotes | Fetch, pull (rebase option), push (tags, force), remotes management, ahead/behind | ✅ P3 |
| Branches | Create/checkout/rename/delete/track, merge, rebase, cherry-pick, revert, reset | ✅ P4 |
| Tags | Create/delete/push | ✅ P4 |
| Stash | Save/apply/pop/drop/view | ✅ P4 |
| Conflicts | Banner, external merge tool, mark resolved, continue/abort | ✅ P4 |
| Advanced | Interactive rebase, blame ("Annotate"), log selected file | ✅ P5 |
| Advanced | Submodules, Git LFS, git-flow, hg-flow | ✅ P5 (submodules) / ⏳ LFS / ⏳ git-flow / ✗ Mercurial |
| Advanced | Custom actions (user scripts in context menu) | ⏳ |
| Advanced | Patch create/apply, archive export | ⏳ |
| Advanced | Pull request creation on hosting providers | ✗ v1 |
| UX | Terminal button, Explorer/Finder button, settings, themes | ✅ |

If the user wants a stricter checklist, cross-check against Sourcetree's public release
notes (sourcetreeapp.com → release notes for Windows 3.x and macOS 4.x) and add rows.

---

## 8. Working rules  → becomes `CLAUDE.md`

```markdown
# CLAUDE.md

Tylia is an open-source, cross-platform (Linux / Windows / macOS) desktop Git client:
Tauri 2 + Rust backend (`crates/tylia-git`, `src-tauri`) + React/TypeScript frontend (`src/`).
Workflow and layout are inspired by Sourcetree; the visual design is our own — clean,
calm, modern, with first-class dark theme.

Read before working: `docs/ROADMAP.md` (current phase + checkboxes), `docs/DESIGN.md`
(design system — the source of truth for anything visual), `docs/ARCHITECTURE.md`.

## Commands
- `pnpm tauri dev` — run the app
- `pnpm dev:web` — frontend in a browser against the mock backend
- `pnpm shots` — Playwright screenshots (light + dark) into `e2e/__screenshots__/`
- `pnpm test` / `pnpm lint` / `pnpm typecheck`
- `cargo test --workspace` / `cargo clippy --workspace -- -D warnings` / `cargo fmt --all`

## Rules
- Work phase by phase from ROADMAP.md; tick checkboxes as items land; stop at the end of
  each phase for user review.
- Visual work is not done until `pnpm shots` has been run and the screenshots were
  reviewed against the DESIGN.md checklist in both themes.
- Colours, spacing, radii, fonts come from tokens only — no raw hex or magic numbers in components.
- All user-facing strings live in `src/i18n/en.ts`.
- Git is invoked only through `tylia-git`'s runner: `Command` with args, never a shell,
  `--` before pathspecs, ref names validated. Writes are serialized per repo.
- Never delete user data silently. Destructive actions confirm and explain the consequence.
- Every `tylia-git` feature gets integration tests on temp repos; the graph layout has
  ASCII snapshot tests; line staging has the table-driven matrix.
- Keep the frontend free of business logic that belongs in Rust (parsing, graph layout,
  patch building).
- Dependencies: permissive licenses only (MIT/Apache/BSD/ISC/OFL/Zlib/MPL-2.0); justify
  each new dependency in the PR/commit message.
- Never copy Sourcetree/Atlassian assets, text or branding.
- No telemetry; no network calls the user didn't trigger.
- Cross-platform: use platform-correct modifiers (Cmd on macOS, Ctrl elsewhere), path
  handling via `std::path`/`PathBuf`, test on Linux first for performance.
- Clean up unused imports and dead code in every change.

## Git
- Never commit unless the user asks in the current request.
- Commit messages: one terse lowercase line (e.g. `graph: draw merge curves as beziers`);
  no Co-Authored-By trailer.
```

---

## 9. Definition of done (every task)

1. Builds on the dev OS; CI config would pass (fmt, clippy, eslint, tsc, tests).
2. Tests added/updated for new behaviour.
3. Screenshots regenerated and reviewed (UI changes).
4. Empty / loading / error states handled.
5. Keyboard reachable; focus visible.
6. Strings in `en.ts`; tokens only; no dead code.
7. ROADMAP checkbox ticked; DESIGN/ARCHITECTURE updated if a decision changed.
