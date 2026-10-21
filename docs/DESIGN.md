# Tylia design system

Source of truth for anything visual. Section numbers (§4.x) are kept from the original kickoff plan so cross-references stay valid.

## 4.1 Feel

Reference points for _feel_, not for copying: Linear, Zed, Raycast, Arc, Sublime Merge,
GitHub's dark theme. Flat surfaces separated by subtle 1px borders and small tonal
steps; shadows only on floating layers (menus, popovers, dialogs, toasts).
Generous but desktop-dense: this is a tool for long sessions.

**Never:** gradients on controls, bevels, inset 3D borders, heavy drop shadows on panels,
pure black (#000) or pure white text on dark, ALL-CAPS headers, more than one accent
colour, icon+label toolbars with 15 items, default OS scrollbars on Windows/Linux,
modal dialogs where an inline affordance works.

## 4.2 Tokens (CSS custom properties; Tailwind reads them)

All colours are tokens. Components never use raw hex.

**Dark (default when OS is dark)**

| Token                      | Value                                                           | Use                                                |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `--bg-app`                 | `#0F1115`                                                       | Main content background                            |
| `--bg-panel`               | `#23272F`                                                       | Sidebar, toolbar, panel headers                    |
| `--bg-titlebar`            | `#0B0D10`                                                       | Title bar / tab strip (a step below panels)        |
| `--bg-tab-active`          | `#2C313B`                                                       | The active tab, lifted off the strip               |
| `--bg-elevated`            | `#2C313B`                                                       | Menus, popovers, dialogs, toasts                   |
| `--bg-input`               | `#0B0D10`                                                       | Text inputs, commit message box                    |
| `--bg-hover`               | `rgba(255,255,255,0.06)`                                        | Row/control hover                                  |
| `--bg-active`              | `rgba(255,255,255,0.10)`                                        | Pressed                                            |
| `--bg-selected`            | `rgba(94,139,255,0.20)`                                         | Selected row                                       |
| `--bg-selected-strong`     | `rgba(94,139,255,0.30)`                                         | Selected + focused list                            |
| `--border-subtle`          | `rgba(255,255,255,0.08)`                                        | Panel dividers                                     |
| `--border`                 | `rgba(255,255,255,0.14)`                                        | Inputs, cards                                      |
| `--border-strong`          | `rgba(255,255,255,0.22)`                                        | Focused inputs (with ring)                         |
| `--text`                   | `#E6E8EC`                                                       | Primary text                                       |
| `--text-secondary`         | `#ADB3BE`                                                       | Secondary text, metadata                           |
| `--text-muted`             | `#98A0AC`                                                       | Placeholders, disabled, hints                      |
| `--accent`                 | `#5E8BFF`                                                       | Primary buttons, focus ring, current-branch marker |
| `--accent-text`            | `#FFFFFF`                                                       | Text on accent                                     |
| `--focus-ring`             | `0 0 0 2px rgba(94,139,255,0.55)`                               | Keyboard focus                                     |
| `--success` / `--added`    | `#3FB97F`                                                       | Added, success                                     |
| `--danger` / `--removed`   | `#F0616D`                                                       | Removed, destructive                               |
| `--warning` / `--modified` | `#E8B04B`                                                       | Modified, conflicts, warnings                      |
| `--info` / `--renamed`     | `#4FB3D9`                                                       | Renamed/copied                                     |
| `--diff-add-bg`            | `rgba(63,185,127,0.10)`                                         | Added line                                         |
| `--diff-add-word`          | `rgba(63,185,127,0.28)`                                         | Word-level emphasis                                |
| `--diff-del-bg`            | `rgba(240,97,109,0.10)`                                         | Removed line                                       |
| `--diff-del-word`          | `rgba(240,97,109,0.28)`                                         | Word-level emphasis                                |
| `--diff-hunk-bg`           | `rgba(94,139,255,0.08)`                                         | Hunk header                                        |
| `--shadow-popover`         | `0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)` | Floating layers                                    |

**Light**

| Token                      | Value                                                        |
| -------------------------- | ------------------------------------------------------------ |
| `--bg-app`                 | `#FFFFFF`                                                    |
| `--bg-panel`               | `#EFF1F4`                                                    |
| `--bg-titlebar`            | `#DDE1E7`                                                    |
| `--bg-tab-active`          | `#FFFFFF`                                                    |
| `--bg-elevated`            | `#FFFFFF`                                                    |
| `--bg-input`               | `#FFFFFF`                                                    |
| `--bg-hover`               | `rgba(0,0,0,0.05)`                                           |
| `--bg-active`              | `rgba(0,0,0,0.09)`                                           |
| `--bg-selected`            | `rgba(61,107,245,0.13)`                                      |
| `--bg-selected-strong`     | `rgba(61,107,245,0.20)`                                      |
| `--border-subtle`          | `rgba(0,0,0,0.09)`                                           |
| `--border`                 | `rgba(0,0,0,0.14)`                                           |
| `--border-strong`          | `rgba(0,0,0,0.24)`                                           |
| `--text`                   | `#1C2024`                                                    |
| `--text-secondary`         | `#5B6370`                                                    |
| `--text-muted`             | `#5F6776`                                                    |
| `--accent`                 | `#3D6BF5`                                                    |
| `--success` / `--added`    | `#157A4B`                                                    |
| `--danger` / `--removed`   | `#C0283B`                                                    |
| `--warning` / `--modified` | `#8C5C10`                                                    |
| `--info` / `--renamed`     | `#126D94`                                                    |
| `--diff-add-bg`            | `rgba(31,157,99,0.09)`                                       |
| `--diff-add-word`          | `rgba(31,157,99,0.24)`                                       |
| `--diff-del-bg`            | `rgba(217,54,74,0.08)`                                       |
| `--diff-del-word`          | `rgba(217,54,74,0.22)`                                       |
| `--shadow-popover`         | `0 8px 24px rgba(16,24,40,0.12), 0 0 0 1px rgba(0,0,0,0.06)` |

Theme setting: **System** (default) / Light / Dark, applied via `data-theme` on `<html>`,
switching with no flash on startup (resolve theme in Rust before the window shows, or
set the background colour of the window to match).

Verify with a contrast check: body text ≥ 7:1, secondary text ≥ 4.5:1, graph lane
colours ≥ 3:1 against `--bg-app` in **both** themes. Adjust values if a check fails and
record the change in DESIGN.md.

## 4.3 Graph lane palette

Eight hues, assigned per branch line (a lane keeps its colour for its whole length; a
colour must not jump when scrolling). Separate light/dark variants.

| #   | Dark             | Light     |
| --- | ---------------- | --------- |
| 1   | `#5E8BFF` blue   | `#3D6BF5` |
| 2   | `#3FB97F` green  | `#1F9D63` |
| 3   | `#E8A33D` amber  | `#B7791F` |
| 4   | `#E0607E` rose   | `#C93D60` |
| 5   | `#9B7BF0` violet | `#7653D9` |
| 6   | `#2BB3C0` teal   | `#138A96` |
| 7   | `#F07A4A` orange | `#C9542A` |
| 8   | `#8FA2B8` slate  | `#5E7088` |

The checked-out branch's lane is always colour 1 (accent family) when it is visible.

## 4.4 Typography

- UI: **Inter**, `font-feature-settings: "cv11", "ss01"`; numbers in tables use `"tnum"`.
- Code/diff/hashes: **JetBrains Mono**, ligatures **off** in diffs.
- Scale (px): 11 (badges, captions) · 12 (secondary, metadata) · **13 (base UI)** · 14 (panel titles) · 16 (dialog titles) · 20 (welcome screen heading). Diff text 12.5.
- Line-height 1.45 for UI text, 1.6 for diff lines (row height fixed per density).
- Weights: 400 body, 500 labels/selected, 600 titles. Never 700+ in the chrome.
- Sentence case everywhere ("Push changes", not "Push Changes" or "PUSH").
- UI font size is user-scalable (Settings → 12/13/14/15) via a root token.

## 4.5 Spacing, size, shape

- 4 px grid. Common gaps: 4, 8, 12, 16, 24.
- Radius: 4 (badges/chips) · 6 (buttons, inputs, list rows) · 8 (menus, popovers, cards) · 12 (dialogs) · 999 (pills, avatars).
- Control heights: 28 (default button/input) · 24 (compact/inline) · 32 (primary actions in dialogs).
- List row heights: **Comfortable** 30 / **Compact** 24 (history, file lists). Density is a setting.
- Icons: Lucide at 16 px, stroke 1.75; 14 px inside compact rows. Icon buttons are 28×28 with a 6 px radius hover background.
- Scrollbars: thin (8 px), overlay-style, thumb `--border-strong`, visible on hover/scroll only.

## 4.6 Motion

- Hover/press: 100–120 ms ease-out. Panels, popovers: 140–180 ms, opacity + 4 px translate.
- No bounces, no spring overshoot, no animated graph on scroll.
- Respect `prefers-reduced-motion` (disable all non-essential transitions).
- Loading: skeleton rows that match final layout; spinners only inside buttons (inline progress).

## 4.7 Window chrome

- **Single integrated top bar** (like Zed / browsers): repo tabs live in the title bar.
- macOS: native traffic lights via `titleBarStyle: "Overlay"`, tabs inset past them.
- Windows & Linux: `decorations: false`, custom min/max/close buttons drawn to platform
  conventions (Windows: right-aligned, 46×36, red close hover; Linux: right-aligned round
  GNOME-style buttons). `data-tauri-drag-region` on empty title-bar space; double-click
  maximizes. On Windows, keep Snap Layouts working if Tauri supports it; otherwise note the gap.
- Setting **"Use native title bar"** (restart required) as a fallback for tiling WMs and
  edge cases on Linux.

## 4.8 Layout (main window)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  [ tylia ▾ ×] [ my-app × ] [ + ]                        ⌘K   ─  □  ×   │ title bar + repo tabs (38)
├───────────────────────────────────────────────────────────────────────────────┤
│ ⎇ main ▾ ↑2 │ ⊸ Commit ³ │ ⟳ Fetch  ↓ Pull ¹  ↑ Push ² │ ⑂ ⊕ ⋯       ⌨ 📁 │ toolbar (44)
├──────────────┬────────────────────────────────────────────────────────────────┤
│              │ [🔍 Message ▾  Search messages   Ctrl F]   [All | Current]   │ history filter row (40)
│              ├────────────────────────────────────────────────────────────────┤
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
  are 11 px medium, `--text-muted`, sentence case — _not_ the ALL-CAPS shown in the sketch.
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

## 4.9 Component inventory (build in `src/ui/`, show all of them on a dev "Gallery" page)

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

## 4.10 Ref badges

Pills, 18 px tall, 11 px text, radius 4, 1px border in lane colour at 40% + fill at 14%:

- Local branch: lane colour, branch icon. Current branch: solid accent fill, white text, check icon.
- Remote branch: same hue, outlined only, cloud icon; when a local and its remote point at
  the same commit, merge into one badge `main ⇄ origin` to save space.
- Tag: neutral slate fill, tag icon.
- HEAD (detached): warning colour.
- Overflow: show up to 3, then `+2` chip with a popover listing the rest.

## 4.11 Commit graph rendering spec

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

## 4.12 Copy & tone

Short, plain, specific. Buttons are verbs ("Push", "Discard 3 files"). Confirmations state
the consequence ("This permanently deletes uncommitted changes in 3 files."). Errors say
what failed, then why (Git's stderr under "Details"). All strings live in
`src/i18n/en.ts` (typed keys) from day one so translations can be added later.

## 4.13 Visual review checklist (run after every UI change)

1. Screenshot both themes at 1280×800 and 1920×1080 (and 900×600 minimum window).
2. Alignment on the 4 px grid; consistent row heights; no text baseline jitter.
3. Only one accent colour visible per region; colour only where it means something.
4. No truncated labels without a tooltip; ellipsis in the middle for paths
   (`src/…/parser.rs`), at the end for messages.
5. Focus ring visible for keyboard navigation, invisible for mouse clicks (`:focus-visible`).
6. Empty, loading, error states exist and look intentional.
7. Contrast checks pass (§4.2).
8. Nothing looks like a default browser or OS control.

## Decisions and deviations log

Changes to the values above, and additions, with the reason. Newest last.

- **2026-10-19 — solid fills under white text (dark theme).** White on `--accent` `#5E8BFF`
  is 3.18:1 and on `--danger` `#F0616D` 3.16:1, below 4.5:1 for button labels. Added
  `--accent-fill` / `--danger-fill` for solid fills that carry `--accent-text`: dark uses
  `#3D6BF5` / `#D9364A` (4.55:1 / 4.59:1); light uses `--accent` / `--danger` unchanged.
  `--accent` itself stays `#5E8BFF` for focus rings, markers and graph lane 1. Hover shades
  `--accent-hover` / `--danger-hover` are darker so they also pass (≥ 5.1:1).
- **2026-10-19 — added tokens not in the original table:** `--accent-hover`,
  `--danger-hover`, `--overlay` (dialog scrim), `--titlebar-close-hover` (`#C42B1C`, the
  Windows caption close red), light `--diff-hunk-bg` (`rgba(61,107,245,0.07)`), light
  `--focus-ring` (`0 0 0 2px rgba(61,107,245,0.5)`), and size/shape/motion tokens
  (`--titlebar-h`, `--toolbar-h`, `--row-h`, `--badge-h`, `--tree-indent`, radii, durations).
- **2026-10-19 — Windows caption buttons** are 46 px wide and the full title-bar height
  (38 px) rather than 46×36, so their hover fills the bar edge to edge.
- **2026-10-19 — Windows Snap Layouts:** with `decorations: false`, Tauri 2 does not show the
  Snap Layouts flyout when hovering our maximize button (it needs native `HTMAXBUTTON`
  hit-testing). Win+Z and edge snapping still work. Known gap; revisit in Phase 5.
- **2026-10-19 — Tailwind wiring.** `src/styles/index.css` maps tokens into Tailwind
  (`bg-app`, `bg-panel`, `text-fg-secondary`, `border-line-subtle`, `rounded-control`,
  `text-small`, `shadow-float`, …) and clears Tailwind's default palette, so raw colours
  can't be used. `--spacing` is pinned to 4 px. ESLint rejects hex/rgb literals in `src/`.
- Contrast results (`pnpm contrast`): all required checks pass in both themes; lowest are
  light `--success` / lane 2 at 3.46:1 and light primary button label at 4.55:1.
- **2026-10-19 — diff viewer.** Syntax colours come from Shiki's `github-light-default` /
  `github-dark-default` (designed for near-identical backgrounds; readable over the diff
  tints). Line rows are `round(--text-diff × 1.6)` = 20 px; hunk header rows 28 px (room for
  a 24 px "Stage hunk" button); collapsed-region rows 24 px. The gutter stays pinned while
  code scrolls horizontally.
- **2026-10-19 — repository layout.** Until the user drags the divider, the details area
  under the history takes 42 % of the height (a fixed 320 px starved the history at
  900×600). Sidebar 240 px, file list 320 px, history columns Author 168 / Date 128 /
  Hash 84 px (resizable, hideable from the header's context menu).
- **2026-10-19 — welcome screen.** Logo + three action cards (Open / Clone / Create) and a
  filterable recent list (name, path with middle ellipsis, branch, last opened; "Not found"
  badge for missing folders; reveal/remove on hover). Dropping a folder anywhere opens it.
- **2026-10-19 — history columns resize individually** (user feedback). Each column has its
  own width and a handle on its right edge; dragging changes only that column and shifts the
  ones after it. Description fills the remaining space until a column is resized, then keeps
  its own width; an empty filler track takes any leftover space, and the history scrolls
  horizontally when columns are wider than the view (header kept in step). Double-click a
  handle to reset.
- **2026-10-19 — Changes view (§4.8).** Sidebar "Changes" (or the uncommitted row in the
  history) switches the repository to the Changes view: Unstaged and Staged lists stacked on
  the left (checkbox per file, status glyph, name + folder; selected file marked with an
  accent bar), the diff on the right with hunk actions in each hunk header ("Discard hunk" as
  a quiet red `ghostDanger` button, "Stage hunk" secondary; they read "Discard 3 lines" /
  "Stage 3 lines" when lines are selected), and the commit composer across the bottom
  (summary with a 50/72 counter, description, amend, recent messages, Commit ⌘/Ctrl+Enter).
  Discarding always confirms and says what happens: tracked changes are lost, untracked files
  go to the Recycle Bin / Trash.
- **2026-10-19 — diffs show changes only by default** (user request). Hunks with 3 lines of
  context; a header toggle (unfold/fold icon, "Show full file" / "Show changes only") shows
  the whole file. It resets to changes only for every newly selected file. Collapsed
  "N unchanged lines" rows also expand to the full file.
- **2026-10-19 — staging feels instant.** Stage / unstage / discard update the lists
  optimistically; Git's answer replaces them (or restores them on error, with a toast).
- **2026-10-19 — more contrast** (user feedback: tabs barely distinguishable from the bar,
  active vs inactive tabs too similar, other elements too faint). Surfaces now step more
  (panel vs content), borders/hover/selection are stronger, and muted text must reach
  4.5:1 on content and 4:1 on panels (checked by `pnpm contrast`). The title bar has its own
  darker tone (`--bg-titlebar`); the active tab is lifted off it (`--bg-tab-active`: white /
  raised surface) with a visible edge, an accent bar on top, medium text and an accent icon;
  inactive tabs only get a light hover. Values in the tables above are the new ones.
- **2026-10-19 — one commit message box** (user feedback: "summary" vs "description" was
  confusing). A single "Commit message" field; its first line is the commit's title, and a
  small counter (n/72, warning past 50, red past 72) explains that in its tooltip.
- **2026-10-19 — Fetch / Pull / Push (Phase 3).** Three split buttons after the branch
  indicator. Pull and Push carry a count badge (commits to pull / to push). Pull's menu picks
  merge / rebase / fast-forward only, runs it and remembers it as the button's default
  (merge until changed). Push goes to the upstream; without one (first push) it opens the
  Push dialog: remote (Select), branch name on the remote, "Track this branch", "Push all
  tags", "Force push" (warning text, then a destructive confirmation that says what is lost;
  always `--force-with-lease` against the last fetched commit). Fetch's menu holds "Remove
  deleted remote branches" and "Fetch automatically" (Off / 5 / 10 / 30 minutes; off by
  default). While an operation runs, a progress ring replaces its icon and the button opens
  a small panel (title, Git's phase, bar, Cancel); one network operation per repository at a
  time (a background fetch makes way). Results are toasts; refusals say what to do next with
  an action (behind → Pull; stale lease → Fetch; conflicts → Show changes). Below 72rem of
  toolbar width the labels collapse to icons (container query).
- **2026-10-19 — remotes in the sidebar.** One row per remote (cloud icon) with its branch
  tree under it, so a remote without fetched branches still shows. Hover ⋯ menu and context
  menu: Edit… (name, URL, optional push URL), Copy URL, Remove… (confirms; nothing changes on
  the server). "+" on the Remotes header adds one.
- **2026-10-19 — dialogs start in their field.** Initial focus goes to the field marked
  `autoFocus` (else the first field), never the close button, even when a menu opened the
  dialog. Destructive confirmations still focus Cancel.
- **2026-10-19 — Select** added to `src/ui/` (Radix Select, field-styled, optional hint text
  per option).
- **2026-10-20 — from the real-app run of Phase 3.** Cancel in a sign-in, passphrase or
  host-key dialog cancels the whole operation, quietly (the dialog is modal, so the toolbar's
  Cancel is out of reach, and an error about a missing password would blame the user for
  cancelling). Starting another operation in a repository clears that repository's earlier
  operation error toasts. Authentication and host-key failures get their own message and
  what to check ("Couldn't sign in to the remote", "Couldn't verify the server"); a
  background fetch that needs credentials says so and offers Fetch.
- **2026-10-20 — branching (Phase 4).** The branch name in the toolbar is a switcher (filter
  field, Enter takes the first match; remote-only branches appear while filtering and are
  checked out as tracking branches). "Branch" and "Stash" buttons follow Fetch / Pull / Push
  (icons only below 90rem of toolbar width). Every commit row, sidebar branch / remote branch
  / tag / stash has a context menu with the same items (shared in `features/branching/
menus.tsx`); a commit's menu also has a submenu per ref on it, and "Merge options" offers
  "Always create a merge commit" / "Fast-forward only" next to the plain merge. Double-click a sidebar branch
  to check it out; click a stash to see its changes. Drag a branch badge onto the current
  branch's row → Merge / Rebase. Confirmations explain consequences: rebase (new ids, force
  push if pushed), hard reset (number of files whose changes are lost; a second confirmation),
  deleting an unmerged branch (second step, Cancel focused), deleting on a remote, dropping a
  stash, aborting (resolutions lost). A checkout Git refuses lists the files and offers
  "Stash and switch".
- **2026-10-20 — operations in progress and conflicts.** A banner under the toolbar while a
  merge / rebase / cherry-pick / revert is in progress: what is happening (rebase: commit n of
  m), conflicts left, "Show conflicts", Abort (confirms), Skip commit (not for merge), and
  Continue / Commit merge (disabled until conflicts are resolved). In Changes, conflicted files
  get their own list above Unstaged (selected first); the diff pane shows the file with its
  markers against "my version", with Use my version / Use their version (during a rebase: the
  base version / my commit's version, since ours and theirs swap), Open merge tool, and Mark
  resolved, which warns if conflict markers are still in the file. Merge / rebase / pick /
  revert refused by local changes say "commit or stash first" and offer Stash. Tylia's own
  refusals show their sentence in the toast, not only under Details.
- **2026-10-20 — resolve conflicts block by block** (user request). A conflicted file with
  conflict markers shows as its blocks instead of a diff: each block is a card ("Conflict 1 of
  2 · line 4") with Mine (accent tint) and Theirs (teal tint) sections labelled with Git's
  marker labels, the common ancestor when the conflict style includes it, and Use mine / Use
  theirs / Use both (during a rebase: Use base / Use my commit). Unchanged runs between blocks
  collapse to three lines of context. Resolving the last block marks the file resolved. The
  whole-file actions stay above. Files without markers (e.g. deleted on one side) keep the
  diff view.
- **2026-10-20 — interactive rebase (Phase 5).** "Interactively rebase from here…" on a
  commit's context menu (enabled for ancestors of HEAD, not HEAD itself, with no operation in
  progress) and in the palette for the selected commit opens a wide dialog: the commits after
  it **oldest first, labelled as such** (the order Git applies them, like its todo list — not
  the history's newest-first), each row a drag handle, an action menu (Pick / Reword / Edit /
  Squash / Fixup / Drop, each with a one-line hint), the short hash and subject, and a
  "Pushed" warning badge for commits already on a remote. Squash / fixup rows show a
  fold-up arrow; dropped rows are struck through. Reword opens the message under the row;
  a squash group gets one "Message for the combined commit" editor under its last squash,
  prefilled with the joined messages. Rows take Git's todo letters (P R E S F D), Alt+↑/↓
  moves, ↑/↓ moves focus; the handle drags with pointer events. On the right, "Result": the
  base, then the resulting commits on a line (accent dots: new ids; muted: unchanged), with
  "+n folded in", "New message", "Stops to edit" and the branch badge at the tip;
  "5 commits → 3", how many get new ids and how many are already pushed. Errors sit under
  their row ("Nothing above to fold this into", empty message); Rebase… stays disabled until
  something changed and nothing is wrong. The confirmation states how many commits are
  rewritten, dropped commits, edit stops, and — when pushed commits are rewritten — the force
  push, as a destructive confirmation (Cancel focused). An `edit` stop toasts "Stopped to edit
  <hash>" and the operation banner reads "Rebasing main: stopped to edit <hash>" with "Amend
  or add commits, then continue". A range with a merge commit shows the reason in the dialog
  instead of the list.
- **2026-10-20 — file history and blame (Phase 5).** "Show history" and "Blame" open a file
  view in place of History / Changes: a 36 px header (Back, the path with its folder dimmed,
  an "at a1b2c3d" chip with × to return to the latest version, and a History | Blame
  segmented control). History is the list of commits that changed the file (two-line rows:
  status glyph + subject; author · date · hash, and "Renamed from …" in the info colour)
  beside that commit's diff of the file, which follows renames (`old → new` in the diff
  header). Blame shows the whole file, highlighted, with a 264 px commit column: hash ·
  author · relative date on the first line of each run of lines from one commit, a hairline
  between runs, and a 3 px age bar per line in the accent colour (faint = oldest, full =
  newest, by rank) — uncommitted lines get the warning colour and "Not committed yet". The
  current line is marked in the commit column (selection tint) and by a 2 px accent edge on its
  code, not a tint behind the code (it would cost syntax colours contrast); other lines of its
  commit are tinted in the commit column.
  Hovering a run shows the summary, author, date and hash; clicking the hash (or Enter /
  double-click) shows the commit in History (uncommitted lines open Changes); the context
  menu adds "Blame before this change" (the parent, at the same line) and Copy hash.
  Entry points: file context menus in Changes and in a commit's file list, two compact icon
  buttons in diff headers, the palette, `Mod+Shift+H` / `Mod+Shift+A`; Back is the header
  arrow, Esc, or Alt+← (⌘[ on macOS).
- **2026-10-20 — command palette and shortcuts (Phase 5).** Mod+K opens the palette: every
  registered action with its group and current shortcut, fuzzy-matched (contiguous and
  word-start matches first; matched letters highlighted); recently run actions first when the
  query is empty; while searching it also offers "Switch to <branch>", "Check out
  <remote branch>" and "Open <recent repository>". Disabled actions are listed greyed. All
  shortcuts go through one dispatcher: plain keys never fire in text fields, nothing fires
  behind a dialog. Defaults: Mod+K palette, Mod+, Settings, Mod+O open, Mod+T/W tabs,
  Mod+1…9, Mod+Tab (Ctrl+Tab on macOS) next tab, Alt+1/2 Changes/History, Mod+B sidebar,
  Mod+F search, F5 refresh, Mod+Shift+F/L/P fetch/pull/push, Mod+P switch branch,
  Mod+Shift+B new branch, Mod+Shift+S stash, Mod+D external diff tool, Alt+↓/↑ parent/child
  commit.
- **2026-10-20 — Settings (Mod+,).** A dialog with General (theme, row density, font size
  12–15, diff layout, tab width, dates relative/absolute, native title bar), Git (Git
  executable with the detected version, pull mode, prune, background fetch, push after
  commit) and Keyboard (every action seen this session with its shortcut; click and press
  new keys to rebind, Esc cancels; a shortcut taken from another action unbinds it there;
  per-action reset and remove, "Reset all"). Also reachable from the title-bar menu.
- **2026-10-20 — graph, history, repository extras.** Hovering a commit underlines its
  first-parent line in the graph (a soft band in the commit's lane colour). Large
  repositories (5,000+ commits) without a commit-graph get a one-line offer to write one,
  saying it only adds an index file to .git ("Not now" remembered per repository; also a
  palette action). Submodules: double-click / "Open as tab", "Initialize and update" /
  "Update" (with progress), "Update all" in the section header. Worktrees section (shown
  when there is more than one): open as tab, reveal; the current one marked. An "LFS" chip
  in the toolbar when the repository uses Git LFS (warning colour and explanation when Git
  LFS isn't installed). "Open in external diff tool" (Mod+D) uses the configured
  diff.guitool / diff.tool and explains when none is configured.
- **2026-10-20 — accessibility pass.** axe (WCAG 2.1 AA) runs in e2e on the main screens and
  dialogs in both themes. Fixes: tab list holds only tabs (the close button is mouse-only;
  Mod+W and middle-click close too), the history is one grid with row groups and cells,
  row checkboxes in the change lists are mouse-only (Space stages), names include visible
  text, and contrast now meets 4.5:1 for all text: muted text and the status colours were
  darkened (light) / lightened (dark), and `pnpm contrast` checks them on content, panels,
  menus and selected rows. At 200% zoom (640 px) the toolbar keeps Fetch / Pull / Push and
  search; the branch-scope switch and Branch / Stash buttons move to the palette.
- **2026-10-21 — Commit button in the toolbar.** First after the branch, with the number
  of changed files in the same accent count as Push / Pull. It is bordered (secondary)
  when there is something to commit and quiet (ghost) when there isn't, and opens Changes
  with the cursor in the commit message (also Mod+Shift+C and the palette).
- **2026-10-21 — History search on its own row.** The search box and the All / Current
  branch switch moved from the toolbar to a 40 px row above the history, so the toolbar
  only holds repository actions. The search box gets up to 30rem there, and Mod+F reaches
  it from any view.
- **2026-10-21 — Last fetch in Fetch's tooltip.** Incoming changes can't be known without
  fetching, so Fetch's tooltip says when the repository last fetched (from `FETCH_HEAD`).
- **2026-10-21 — more separation between dark surfaces** (user feedback: the two dark
  backgrounds were too similar).
  - **Panels:** `--bg-panel` (sidebar, toolbar, headers, composer) went from #181B21 to
    #23272F against `--bg-app` #0F1115, which more than doubles the step.
  - **Raised surfaces:** `--bg-elevated` / `--bg-tab-active` went from #20242C to
    #2C313B, so menus, dialogs and the active tab stay above the panels.
  - **Text:** dark `--text-secondary` went from #A2A9B5 to #ADB3BE and `--text-muted`
    from #8C94A1 to #98A0AC, so muted text keeps ≥ 4.5:1 on the lighter raised surfaces.
    `pnpm contrast` passes.
- **2026-10-21 — Settings in the title bar.** The app's Settings (gear) has its own
  title-bar button. It replaces the Appearance menu: theme and title-bar style are in
  Settings → General (and the palette).
