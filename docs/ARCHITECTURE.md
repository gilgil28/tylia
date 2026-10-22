# Tylia architecture

Platforms, stack, naming and architecture. Section numbers (§2, §3, §5.x) are kept from the original kickoff plan.

## Naming & identifiers

The name is decided: **Tylia**, pronounced **TEE-lee-a**. State the pronunciation once
near the top of the README.

- Origin: a respelling of _Tilia_, botanical Latin for the linden tree (the Git tree
  metaphor). The **y** reads as a fork in a branch — use that for the logo/wordmark (the
  y's arms drawn as two graph lanes joining). Lithuanian _tyla_ means "silence", which
  fits "calm by default" (have a native speaker confirm before using it in copy).
- Availability checked on 2026-10-19: GitHub org `tylia-dev` free (bare `tylia` taken);
  crates.io `tylia` and `tylia-git` free; npm `tylia` free; domain `tylia.dev` unregistered
  (`tylia.com`, `.net`, `.org`, `.io` are taken by others); no developer tools on GitHub
  use the name. Trademarks were not checked.
- GitHub: repository **`github.com/gilgil28/tylia`** (the maintainer's account; chosen
  2026-10-22 instead of a `tylia-dev` organization) — use this URL in README, `Cargo.toml`
  (`repository`), `package.json` (`repository`, `bugs`), issue templates, SECURITY.md, the
  website, packaging, the updater endpoint and the releases link the app may open.
- Website: **https://gilgil28.github.io/tylia/** (GitHub Pages' default address; the
  domain `tylia.dev` was not registered, decided 2026-10-22). Use it as `homepage` in
  `Cargo.toml`, `package.json`, `tauri.conf.json` and packaging, and in the README.
  Published from `website/` (docs/RELEASING.md).
  Security reports go through GitHub's private vulnerability reporting only.
- Identifiers: product name `Tylia`; bundle identifier `dev.tylia.app` (reverse-DNS of
  tylia.dev, kept although the domain isn't ours: it names the settings folder of
  installed copies); Cargo packages `tylia` (app) and `tylia-git` (core); binary `tylia`.
- Keep the name in exactly one place per ecosystem (`package.json` `name`/`productName`,
  `tauri.conf.json` `productName`/`identifier`, Cargo package names).

## Legal / branding guardrail

Recreate the **workflow and information layout** of Sourcetree, never its assets.
Do not copy Atlassian icons, images, colours-as-branding, text, the Sourcetree name or
logo, or any code. All icons come from an open icon set (Lucide, ISC) or are drawn by us.
Never describe Tylia as "Sourcetree for Linux" in product text; "inspired by" in the
README is fine.

## 2. Target platforms

| OS                                                   | Webview       | Packages (Phase 6)                                |
| ---------------------------------------------------- | ------------- | ------------------------------------------------- |
| Linux (Arch/CachyOS first-class, also Ubuntu/Fedora) | WebKitGTK 4.1 | AppImage, .deb, .rpm, AUR PKGBUILD; Flatpak later |
| Windows 10/11                                        | WebView2      | NSIS installer (+ MSI)                            |
| macOS 12+ (arm64 + x64)                              | WKWebView     | .dmg (universal)                                  |

WebKitGTK is the slowest of the three webviews: **all performance work is measured on Linux.**

## 3. Tech stack

| Concern                     | Choice                                                                                        | Why                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Shell                       | **Tauri 2**                                                                                   | Small binaries, native webviews, Rust backend, all three OSes              |
| Backend                     | **Rust** (stable), cargo workspace                                                            | Fast, safe process + file handling                                         |
| Git (writes, most reads)    | **system `git` binary** via `std::process::Command` / `tokio::process`                        | Exact parity with the CLI: hooks, credential helpers, config, LFS, signing |
| Git (hot read paths, later) | `gix` (gitoxide) — only where profiling shows `git` is the bottleneck                         | Pure Rust, fast object access                                              |
| FS watching                 | `notify` (+ debounce)                                                                         | Refresh status/refs on change                                              |
| IPC types                   | `tauri-specta` (or `ts-rs` if specta isn't stable)                                            | Generated TS types from Rust — one source of truth                         |
| Frontend                    | **React + TypeScript + Vite**                                                                 | Mature, Claude-friendly, huge ecosystem                                    |
| Styling                     | **Tailwind CSS v4** driven by CSS custom-property tokens                                      | Design tokens in one place; themes = token swaps                           |
| Primitives                  | **Radix UI** (unstyled)                                                                       | Accessible menus, context menus, dialogs, tooltips, tabs                   |
| Icons                       | **Lucide**                                                                                    | Clean 1.5–2px line icons, ISC license                                      |
| Fonts (bundled, offline)    | **Inter** (UI), **JetBrains Mono** (code)                                                     | OFL; never fetched from Google at runtime                                  |
| Virtualization              | `@tanstack/react-virtual`                                                                     | History, file lists, diff lines                                            |
| State                       | **Zustand** (UI state) + `@tanstack/react-query` (backend data cache/invalidation)            | Small, explicit                                                            |
| Syntax highlighting         | **Shiki** in a Web Worker, lazy, per visible hunk                                             | VS Code-quality grammars + themes                                          |
| Commit graph                | **Canvas 2D** renderer per visible window                                                     | Thousands of rows at 60 fps; DOM for text columns                          |
| Tests                       | `cargo test` (temp-repo fixtures), **Vitest**, **Playwright** (browser mode against mock IPC) | See §5.7                                                                   |
| Lint/format                 | `rustfmt`, `clippy -D warnings`, ESLint (flat config), Prettier, `tsc --noEmit`               |                                                                            |
| Package manager             | **pnpm**                                                                                      |                                                                            |
| CI                          | GitHub Actions matrix: ubuntu, windows, macos                                                 |                                                                            |

Dependency rule: every dependency must be MIT / Apache-2.0 / BSD / ISC / OFL / Zlib / MPL-2.0.
No GPL in the shipped app. Prefer fewer dependencies.

### 3.1 Pinned versions (verified against crates.io / npm / static.rust-lang.org on 2026-10-19)

Exact versions are pinned in `Cargo.toml` / `package.json` (no `^`/`~`). Re-verify before bumping.

| Tool / package                                                      | Version                             | Note                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Rust                                                                | 1.99.1 stable                       | `rust-toolchain.toml` pins `stable` channel; MSRV = 1.99                                                                       |
| Node.js                                                             | 24.x LTS (Krypton)                  | Vite 8 needs `^20.19 \|\| >=22.12`; `engines.node >=22.12`                                                                     |
| pnpm                                                                | 12.14.0                             | `packageManager` field                                                                                                         |
| tauri / tauri-build / @tauri-apps/cli / @tauri-apps/api             | 2.12.4 / 2.7.3 / 2.12.3 / 2.12.4    | Tauri 3 is alpha only — stay on 2                                                                                              |
| tauri-plugin-dialog / -opener / -clipboard-manager / -os            | 2.8.3 / 2.7.2 / 2.5.0 / 2.4.0       | added only when a feature needs them                                                                                           |
| tauri-plugin-updater                                                | 2.14.0                              | Phase 6 opt-in update check; adds reqwest + rustls (ring), minisign-verify, zip (all permissive)                               |
| tauri-plugin-single-instance                                        | 2.5.4                               | Phase 7: one window; a second launch hands its arguments over (named mutex on Windows, D-Bus on Linux, a Unix socket on macOS) |
| **ts-rs**                                                           | 12.0.1                              | **Decision:** `tauri-specta` for Tauri 2 is still `2.0.0-rc.25`, so per §3 we use ts-rs                                        |
| serde / serde_json / tokio / thiserror                              | 1.0.229 / 1.0.154 / 1.53.3 / 2.0.21 |                                                                                                                                |
| notify / notify-debouncer-full                                      | 8.2.0 / 0.7.0                       | 9.x is RC                                                                                                                      |
| tempfile                                                            | 3.27.0                              | dev-dependency                                                                                                                 |
| getrandom                                                           | 0.4.3                               | askpass session token (§5.13); already in the tree via Tauri                                                                   |
| gix                                                                 | 0.89.0                              | not added until profiling justifies it                                                                                         |
| react / react-dom                                                   | 19.3.1                              |                                                                                                                                |
| **typescript**                                                      | 6.0.3                               | **Decision:** TS 7.0 (native) is `latest`, but typescript-eslint 8.71 supports `<6.1.0`                                        |
| vite / @vitejs/plugin-react                                         | 8.3.4 / 6.1.2                       |                                                                                                                                |
| tailwindcss / @tailwindcss/vite                                     | 4.3.3                               |                                                                                                                                |
| radix-ui                                                            | 1.8.1                               | umbrella package                                                                                                               |
| lucide-react                                                        | 1.59.0                              |                                                                                                                                |
| @tanstack/react-virtual / @tanstack/react-query                     | 3.14.21 / 5.104.4                   |                                                                                                                                |
| zustand                                                             | 5.0.15                              |                                                                                                                                |
| shiki                                                               | 4.5.0                               | Phase 1                                                                                                                        |
| @fontsource-variable/inter / jetbrains-mono                         | 5.3.0                               | OFL, bundled into the build (never fetched at runtime)                                                                         |
| vitest                                                              | 5.0.5                               |                                                                                                                                |
| @playwright/test                                                    | 1.64.1                              |                                                                                                                                |
| eslint / @eslint/js / typescript-eslint / eslint-plugin-react-hooks | 10.13.0 / 10.0.1 / 8.71.2 / 7.1.1   | flat config                                                                                                                    |
| prettier                                                            | 3.9.10                              |                                                                                                                                |

## 5.1 Repository layout

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

## 5.2 Process model

- One Tauri window per app instance; multiple repos as tabs. Each open repo has a
  `RepoSession` in Rust: path, watcher, cached refs, an **operation queue**.
- **Reads** run concurrently. **Writes** are serialized per repo (one at a time) and the
  UI shows them as running operations (toolbar progress, cancel where Git allows).
- Long operations stream progress over a Tauri `Channel` (fetch/push/clone parse
  `--progress` stderr lines into `{phase, current, total}`).
- Cancellation: kill the child process (and its process group on Unix / job object on
  Windows); never leave a stale `index.lock` the app created — if one remains after
  cancel, surface it with a "Remove lock" action, never delete silently.

## 5.3 Running Git safely

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

## 5.4 Key read paths

| Data           | Command (sketch)                                                                                                                                        | Notes                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Refs           | `git for-each-ref --format='%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track)%00%(HEAD)%00%(*objectname)' refs/heads refs/remotes refs/tags` | Peeled tags via `%(*objectname)`                                                                    |
| History        | `git log -z --date-order --format='%H%x00%P%x00%an%x00%ae%x00%at%x00%s' <refs or --all>` streamed                                                       | Parse incrementally; filter options: all branches / current branch / show remote; sort: date / topo |
| Graph          | computed in Rust from the commit stream (§5.5)                                                                                                          | Sent as pages of rows                                                                               |
| Commit details | `git show -z --format=... --numstat --name-status -M <sha>`                                                                                             | Body, author/committer, parents, file stats                                                         |
| Diff           | `git diff --no-color --no-ext-diff -M -U3 [--cached] -- <path>` / `git show <sha> -- <path>`                                                            | Large-file guard (>1 MB or >20k lines → collapsed with "Load anyway"); binary/image detection       |
| Status         | `git status --porcelain=v2 -z --branch --untracked-files=all`                                                                                           | Ahead/behind from `# branch.ab`                                                                     |
| Stashes        | `git stash list -z --format='%gd%x00%H%x00%at%x00%s'`                                                                                                   |                                                                                                     |
| Submodules     | `git submodule status`                                                                                                                                  |                                                                                                     |

Large-repo targets (measure on Linux with `git/git`, ~75k commits, and a 50k-file worktree):
first history rows visible < 300 ms; full history streamed in the background; scrolling
at 60 fps; status refresh < 500 ms; opening a 5k-line diff < 150 ms to first paint.

## 5.5 Graph layout algorithm (Rust, `graph.rs`)

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

## 5.6 Hunk and line staging (`patch.rs`)

- Stage selected lines from a working-tree diff: build a patch containing only the
  selected changes — unselected `+` lines are dropped, unselected `-` lines become
  context — then `git apply --cached --recount --unidiff-zero=false -` via stdin.
- Unstage selected lines from an index diff: inverse — unselected `-` lines are dropped,
  unselected `+` lines become context — and apply with `git apply --cached --reverse --recount`.
- Discard selected lines: **unstage-style** transform (unselected `+` lines become context,
  unselected `-` lines are dropped), applied to the worktree with `git apply --reverse`, with
  confirmation. _(Corrected 2026-10-19: the original "same as staging" fails whenever other
  unstaged changes are near the selection, because the patch's new side must match the
  working tree, which holds all unstaged changes. Test: `discard_is_not_staging_style`.)_
- The UI sends `[hunk, line]` indices plus the shown diff's fingerprint (hash of its hunks)
  and context; the backend re-runs the same diff (`diff_args`, shared with the viewer) as raw
  bytes and refuses if the fingerprint differs ("the file changed since the diff was shown").
- Hunk headers of the built patch are recomputed (and `--recount` passed); `--unidiff-zero`
  when context is 0. Mode changes are never applied by line operations (a pending mode change
  is staged with the whole file). Partial results on new/deleted files become plain
  modifications; unstaging/discarding lines of a rename modifies the new path only (keeps the
  rename). `\ No newline at end of file` markers follow their lines; an unselected marked
  change that becomes context with lines following is split into a `-`/`+` pair.
- Untracked files: fingerprint checked against the shown `--no-index` diff, then
  `git add -N`, re-diff (compared by parsed content: `--no-index` doesn't apply autocrlf),
  stage; on any failure the intent-to-add entry is removed again.
- Working-copy diffs use `--no-textconv`, so their hunks can be applied back.
- Tests: table-driven, each case creates a temp repo, applies a selection, asserts
  `git diff --cached` exactly. Cover CRLF, no-EOL, first/last line, adjacent hunks,
  deleted file, new file, renamed + modified, binary (rejected cleanly), non-UTF-8 content.

## 5.7 Testing & visual verification

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

## 5.8 Security

- Tauri capabilities: only the commands we define + dialog/opener/clipboard plugins as needed.
- Strict CSP (no remote scripts, no `unsafe-eval`; fonts/styles local).
- Never render commit messages or file contents as HTML.
- Askpass: Tylia's own binary acts as `GIT_ASKPASS`/`SSH_ASKPASS` (with
  `SSH_ASKPASS_REQUIRE=force`), relaying prompts to the UI over a local, per-session,
  authenticated channel; secrets are never logged or persisted by Tylia (credential
  storage is Git's credential helper's job). Details in §5.13.

## 5.9 Settings (persisted JSON in the OS config dir)

Theme · density · UI font size · diff mode (unified/split) · whitespace ignore ·
context lines · tab width · history default (all branches vs current) · date format
(relative/absolute) · show avatars (off) · Gravatar (off) · git executable path · external
diff tool · external merge tool · terminal app · editor command · native title bar ·
recent repositories list.

## 5.10 Implementation notes (Phase 0)

- **IPC types:** Rust types derive `ts_rs::TS` with `#[ts(export)]`; `pnpm gen:types`
  (`cargo test export_bindings`) writes them to `src/ipc/bindings/` (path set by
  `TS_RS_EXPORT_DIR` in `.cargo/config.toml`). The bindings are committed; CI fails if they
  drift. Commands return `Result<T, IpcError>` (`kind`, `message`, `command`, `stderr`).
- **Backend interface:** `src/ipc/backend.ts` defines `Backend`; `src/ipc/tauri.ts`
  implements it with `invoke`, `src/ipc/mock/` with fixtures. `vite --mode web`
  (`pnpm dev:web`) selects the mock; the mock is a dynamic import, so it never ships.
- **Flash-free start:** `src-tauri/src/window.rs` creates the main window hidden, with its
  background set to the theme's `--bg-app` and `window.__TYLIA_BOOT__` (settings + platform)
  injected as an initialization script. `public/boot.js` runs before CSS and sets
  `data-theme` / `data-platform` on `<html>`; `main.tsx` shows the window after the first
  painted frame (with a 3 s fallback in Rust).
- **Title bar:** Windows/Linux use `decorations: false` and draw controls in
  `src/app/WindowControls.tsx`; macOS uses `TitleBarStyle::Overlay` with native traffic
  lights. "Use native title bar" is read at window creation, so it applies after restart.
- **Settings:** `settings.json` in the OS app config dir, written atomically; an unreadable
  file is kept as `settings.invalid.json`, never deleted.
- **Gallery:** `#/gallery`, lazy-loaded and routed only in dev / web mode; release bundles
  don't contain it (the `import.meta.env` check in `App.tsx` is folded at build time).
- **Vite:** `optimizeDeps.entries` scans all of `src/` so lazily loaded routes don't trigger
  a dependency re-optimization and page reload in dev.

## 5.11 Implementation notes (Phase 1)

- **History:** `Git::stream_history` (`history.rs`) wraps `stream_log` (NUL-terminated
  records, `0x1f` field separators, batches of 200 then 2000) with `GraphBuilder`
  (`graph.rs`, decisions in its module docs). The `stream_history` command sends batches over
  a Tauri `Channel`; a newer stream for the same repository stops older ones (generation
  counter). The frontend keeps rows outside React state (`HistoryStream`) and restarts the
  stream whenever the refs snapshot changes.
- **Graph wire format:** `GraphBuilder` emits every edge of every row, but on branchy
  histories ~97% are lanes running straight through (372 MB of JSON for `git/git`).
  `SegmentTracker` (`history.rs`) merges them into vertical segments `[lane, color, start,
end]` in half-row units; rows keep only their dot and curves (30 MB for `git/git`). Batches
  carry the segments that closed in them plus the still-open ones.
- **Graph canvas:** `features/graph` draws only the visible window into a canvas pinned to
  the history viewport (sticky, zero-height wrapper), at device pixel ratio, with colours read
  from the lane tokens (re-read on theme change). Segments overlapping the window come from a
  bucketed index (`segment-index.ts`). Lines are clipped at 12 lanes; commits on lanes past
  the cap get their dot in an extra edge column.
- **Watcher:** `watcher.rs` (notify + debouncer, 400 ms) watches the working tree and git dir
  and emits `repo-changed { repo, refs, worktree }`; the frontend invalidates refs (→ history),
  status and working-copy diffs. Ignored paths still trigger status refreshes (cheap, but a
  candidate for filtering via `check-ignore` later).
- **Clone:** `clone.rs` refuses non-empty destinations and option-like URLs, validates the
  branch with `check-ref-format`, parses `--progress` lines, and on failure or cancel removes
  only what it created (the folder, or the contents of a folder that was empty).
- **UI state:** tabs, recent repositories and per-repo layout are a JSON document owned by the
  frontend (`ui-state.json`, `load_ui_state` / `save_ui_state`), restored before first render.
- **Fixtures:** `pnpm fixture` builds a synthetic demo repository (`scripts/make-fixture.ts`)
  and dumps it with `cargo run -p tylia-git --example dump-fixture` into
  `src/ipc/mock/fixtures/demo.json` (machine paths replaced). Third-party repositories are not
  dumped into the repo.
- **Performance check:** `cargo run --release -p tylia-git --example history-timing -- <repo>`
  (refs, first rows, all rows, payload size). Without a commit-graph, `log --date-order`
  only starts after walking all history; Tylia writes one after its own clones.
- **Submodules** are loaded separately (`get_submodules`) and only while the sidebar section
  is open: `git submodule status` alone took 660 ms on `git/git`.

## 5.12 Responsiveness notes (Phase 2 follow-up, 2026-10-19)

- Measured on Windows: a `git` call costs ~30 ms (status on a 1.9k-file repo ~75 ms), so a
  write plus refreshes is ~100 ms of Git. The real slowness came from the **watcher**: in an
  Android project, Gradle wrote ~18k files into ignored `build/` folders in 30 minutes, and
  every burst refreshed status and diffs; notify-debouncer-full's file-ID cache also walked
  the whole tree (13 GB) at start and rescanned new folders.
- The watcher now uses `NoCache` and drops events under ignored paths
  (`git ls-files --others --ignored --exclude-standard --directory`, re-read when a
  `.gitignore` changes).
- Writes update the cached status optimistically (`useRepoAction({ optimistic })`) and mark
  the repository as just-written; the watcher's echo of Tylia's own write (~0.5 s later) is
  ignored for 1.2 s.
- Unstage tries `git restore --staged` first and only checks for an unborn HEAD if that
  fails (one process instead of two).
- Diffs of the files next to the shown one are prefetched (working copy and commits), so
  moving through a list shows them immediately.

## 5.13 Askpass bridge (`src-tauri/src/askpass*`)

Git and ssh ask for credentials through Tylia's own executable, so prompts appear as Tylia
dialogs (`src/features/askpass/AskpassHost.tsx`) instead of a terminal or another app's window.

- **Server:** at start the app binds `127.0.0.1:0` (std `TcpListener`, one thread per
  connection, at most 32 at once) and draws a 32-byte token from the OS (`getrandom`).
- **Env** (`Askpass::env(op, repo)`, added to fetch/pull/push/clone): `GIT_ASKPASS` and
  `SSH_ASKPASS` = `current_exe()`, `SSH_ASKPASS_REQUIRE=force`, `TYLIA_ASKPASS_ADDR`,
  `TYLIA_ASKPASS_TOKEN`, `TYLIA_ASKPASS_OP`. On Unix, `DISPLAY=:0` is added only if
  `DISPLAY` is unset: OpenSSH before 8.4 ignores `SSH_ASKPASS` without it (it only checks
  that the variable exists). The runner already sets `GIT_TERMINAL_PROMPT=0`, so a cancelled
  prompt never falls back to a terminal. `env_quiet()` (background fetch) sets the helper
  plus `TYLIA_ASKPASS_DENY=1`, which makes it decline at once without contacting the app,
  and `GCM_INTERACTIVE=never` so Git Credential Manager stays quiet too.
- **Helper** (`main.rs` → `askpass::client`, before anything of Tauri starts): when
  `TYLIA_ASKPASS_TOKEN` or `TYLIA_ASKPASS_DENY` is set it sends one JSON line
  `{token, op, prompt: argv[1], hint: $SSH_ASKPASS_PROMPT}`, keeps the connection open, and
  reads `{answer}` back. An answer is printed with `\n`, exit 0; `null` or any error exits 1,
  so Git/ssh fail with their usual authentication error. Windows release builds use the GUI
  subsystem: there is no console, but the standard handles Git passes are inherited, so
  stdout reaches Git's pipe (`gui_subsystem_helper_answers_git` checks this with a copy of
  the binary patched to the GUI subsystem).
- **Server side:** the request must arrive within 5 s and 64 KiB; the token is compared in
  constant time; a wrong token is dropped without a reply or a prompt. Prompts are accepted
  only for operations between `env()` and `end_operation()`. The prompt is classified
  (`askpass/classify.rs`: `username`, `password`, `passphrase`, `hostKey`, `confirm` and
  `notice` from `SSH_ASKPASS_PROMPT`, else `other`, treated as secret) with host, username /
  key path / fingerprint pulled out, and sent as the `askpass-prompt` event
  (`AskpassPrompt`). `askpass_respond(id, answer | null)` answers; `end_operation` (operation
  finished or cancelled) cancels its open prompts; a helper that disconnects (ssh killing
  its notice helper, a killed process tree) cancels its prompt. Withdrawn prompts are
  announced with `askpass-closed` so the dialog disappears. No window ⇒ cancelled.
- **UI:** one dialog at a time, in arrival order. Secrets use a masked field with show/hide
  and are cleared after submit (each prompt remounts the dialog). The host-key dialog shows
  host and fingerprint, focuses Cancel and has no submit-on-Enter. HTTPS password prompts
  mention personal access tokens.
- **Secrets** are never logged, stored, put in errors or sent anywhere but the asking helper;
  storing credentials is the credential helper's job. The token only guards against other
  users on the machine: the user's own processes can read it from the environment anyway.

## 5.14 Network operations (Phase 3)

- **Runner:** `Git::run_operation` (runner.rs) runs clone / fetch / pull / push with
  `--progress`, parses `Phase: NN% (cur/total)` lines from stderr into `Progress`, drains
  stdout, and keeps the last 16 KiB of non-progress output for errors (stdout first, so
  pull's CONFLICT lines and push's per-ref status are in the report). `OpContext` carries the
  cancel receiver, extra env (askpass) and the progress callback. Cancelling kills the whole
  process tree (Windows `taskkill /T /F` before killing Git; Unix: own process group,
  `kill -KILL -- -pgid`), so remote helpers and ssh don't outlive Git.
- **remote.rs:** `fetch` (`--all` or one remote, optional `--prune`), `pull` (current branch
  from its upstream with `--no-rebase` / `--rebase` / `--ff-only`, `--no-edit`; refuses
  clearly without an upstream; returns `upToDate` / `updated` / `conflicts`, the last when
  the failed pull left unmerged entries), `push` (`--porcelain`, explicit
  `refs/heads/a:refs/heads/b` refspec after `--`, `--set-upstream`, `--tags`,
  `--force-with-lease=<ref>:<expected oid>`; a `!` porcelain line becomes
  `GitError::PushRejected` with `behind` / `stale` / `remote` / `other`, mapped to the IPC
  kinds `pushBehind` / `pushStale` / `pushRejected`). Remote management uses `git remote
add|set-url [--push]|rename|remove --`; an empty push URL unsets `remote.<name>.pushurl`.
  Remote names are validated before Git sees them; URLs may not start with `-`.
- **Access failures:** a failed operation whose output says authentication failed (or
  "could not read Username", "Permission denied (publickey)", HTTP 401/403) becomes
  `GitError::AccessDenied { reason: auth }`, host-key problems `reason: hostKey`; IPC kinds
  `authFailed` / `hostKeyFailed` (messages are matched in the C locale).
- **Refs:** branches carry `upstreamRemote` / `upstreamBranch` (`%(upstream:remotename)`,
  `%(upstream:remoteref)`), remotes a separate `pushUrl`; `git remote -v` is parsed by tab
  and last space, so local paths with spaces work.
- **Tauri side:** `operation.rs` `Operation` registers the cancel handle under the
  frontend's id and the askpass env; its `Drop` unregisters and ends open prompts. Pull holds
  the repository's write lock; fetch and push don't (they don't touch the working copy).
- **Frontend:** `features/remote/operations.ts` runs at most one network operation per
  repository (a background fetch is cancelled, and awaited, to make way), keeps progress for
  the toolbar, refreshes refs (and status after pull) when done, and turns errors into
  toasts with a next step. Preferences (pull mode, prune, auto-fetch minutes, push after
  commit) are in `Settings`. Background fetch (`useAutoFetch`) uses `quiet`, so it never
  prompts, and reports a failure once per repository until a fetch succeeds.

## 5.15 Branching operations (Phase 4)

- **Modules:** `branch.rs` (create, checkout, rename, delete, delete remote, upstream),
  `tag.rs`, `stash.rs`, `integrate.rs` (merge, rebase, cherry-pick, revert, reset,
  continue / skip / abort, resolving conflicts, merge tool) and the private `ops.rs`
  (validation, `Attempt`, error classification). Commands that fail as a normal outcome run
  through `Git::attempt` (C locale, every exit code accepted) so stdout and stderr can both
  be inspected; the error report then carries both.
- **Validation:** branch names via `check-ref-format --branch` plus a refusal of leading
  `-`, `@{` and `HEAD`; tag names via `check-ref-format refs/tags/<name>`; remote-tracking
  names via `refs/remotes/<name>`; commit-ishes must not start with `-` or contain
  whitespace and are resolved with `rev-parse --verify <rev>^{commit}` (unknown →
  `InvalidInput`). Stash indices become `stash@{N}` and are checked to exist. Taken branch /
  tag names are refused before Git runs. New branches start from the resolved oid, so they
  never silently track; "checkout remote branch" uses
  `switch --track -c <local> refs/remotes/<remote>/<branch>`.
- **Operation state** (`WorkingStatus::operation`): read from the git dir without another
  Git process. The git dir is the nearest `.git` folder, or the target of a `gitdir:` file
  (linked worktrees, submodules — their MERGE_HEAD / rebase state is per worktree);
  `rev-parse --absolute-git-dir` only as a fallback for the write operations. Rebase:
  `rebase-merge/` (`head-name`, `onto`, `msgnum`, `end`) or `rebase-apply/` (`next`,
  `last`; ignored when it is `git am`), incoming = `REBASE_HEAD`. Merge: `MERGE_HEAD`, with
  the branch / tag name parsed from MERGE_MSG ("Merge branch 'x'", "Merge remote-tracking
  branch 'origin/x'", "Merge tag 'v1'"), else the short oid. Cherry-pick / revert:
  `CHERRY_PICK_HEAD` / `REVERT_HEAD`, else the first command of `sequencer/todo`.
- **No editor, ever:** every operation that could commit runs with `GIT_EDITOR=:`,
  `GIT_SEQUENCE_EDITOR=:` (Git treats `:` as "don't launch anything" and keeps the prepared
  message) and `GIT_MERGE_AUTOEDIT=no`; these override `core.editor`. Merge uses
  `--no-edit`, revert `--no-edit`; continuing a merge is `commit --no-edit --cleanup=strip`
  (MERGE_MSG without the commented `# Conflicts:` list).
- **Starting an operation:** refused with `InvalidInput` while another is in progress or the
  index has unmerged entries (Git's own refusal would look like new conflicts). Merge:
  `merge --no-edit --no-autostash --ff|--ff-only|--no-ff <rev>`; rebase:
  `rebase --no-autostash <oid>`; cherry-pick / revert add `-m 1` for merge commits. Autostash is
  always off so a dirty tree gives a predictable `LocalChanges` error (the UI can offer to
  stash). Outcome: success with HEAD unchanged → `upToDate`; HEAD now at the target →
  `fastForward`; otherwise `done`; failure with unmerged entries → `conflicts`; any other
  failure → `LocalChanges` (parsed from "…would be overwritten by …:" lists, or "cannot
  rebase: You have unstaged changes", where the files come from
  `git diff --name-only HEAD`) or `Failed`. An error can still leave an operation in progress (e.g. a rebase step
  blocked by an untracked file): `status.operation` is the source of truth.
- **Empty picks:** a cherry-pick whose change is already in HEAD (Git stops with
  CHERRY_PICK_HEAD and "now empty") is dropped with `cherry-pick --skip` and reported as
  `upToDate`; a revert with nothing to commit is `upToDate` too. Continuing a cherry-pick or
  revert whose resolution left the index equal to HEAD skips that commit (like rebase, which
  drops commits that became empty) and returns `done`.
- **Continue / skip / abort** detect the kind from the git dir. Continue refuses while
  conflicts remain; returns `conflicts` when the next rebase / pick step stops again. A merge
  can't be skipped (`InvalidInput`). Nothing in progress → `InvalidInput`.
- **Checkout with stash & reapply:** after validating the target,
  `stash push --include-untracked --message="Tylia: local changes, switching to <x>"`, `switch`, then
  apply `stash@{0}` (with `--index`) and drop it. Conflicts on reapply →
  `stashConflicts` with the stash kept. If the switch itself fails, the stash is applied
  back on the original branch before the error is returned.
- **Stash apply / pop:** `stash apply --index`; when Git answers "conflicts in index. Try
  without --index" (nothing was changed), a plain `stash apply`. Pop = apply, then
  `stash drop` only if there were no conflicts.
- **Branch deletion:** the checked-out branch is refused up front; `branch -d` refusing an
  unmerged branch becomes `NotFullyMerged`. Deleting a remote branch pushes
  `:refs/heads/<branch>` (`--porcelain`, rejections → `PushRejected`); if the remote says
  the ref doesn't exist, the stale remote-tracking branch is removed and it succeeds.
  `set_upstream(None)` is idempotent.
- **Conflict resolution:** `resolve_with` reads the stages of each path
  (`ls-files --unmerged`); if the chosen side has the file, `checkout --ours|--theirs` + `add`, if that
  side deleted it, `rm` (removing it is the resolution). `mark_resolved` adds files present
  in the working tree and `rm --cached` those deleted there. Pathspecs run with
  `GIT_LITERAL_PATHSPECS=1`. Line actions on a `conflicted` diff are rejected.
- **Merge tool:** `merge.guitool` (run with `mergetool --gui`) or `merge.tool` must be set;
  terminal tools (vimdiff / nvimdiff variants, emerge) are refused, as are files that aren't
  conflicted. `mergetool.keepBackup=false` unless the user set it, so no `.orig` files
  appear. Runs in the user's locale (the tool inherits the environment).

### Conflict blocks (`conflict.rs`)

`conflict_file` reads the working file (no Git process) and splits it into plain-line runs
and conflict blocks (`<<<<<<<`, optional `|||||||` base, `=======`, `>>>>>>>`; marker size
7, labels kept). Parsing works on bytes, so `resolve_block` replaces exactly one block with
ours / theirs / both and leaves everything else (line endings, encoding) untouched. Each
`ConflictFile` carries a fingerprint of the file's bytes; `resolve_block` refuses a stale one
(the file changed since it was shown). Markers out of order make the file "no blocks" (the UI
falls back to the diff). Resolving the last block runs `mark_resolved`.

### Interactive rebase (`rebase.rs`, Phase 5)

- **Range:** `rebase_todo(base)` lists `base..HEAD` oldest first (`log --reverse -z`), with
  each commit's full message and whether it is on a remote-tracking branch (`rev-list
base..HEAD --not --remotes`). `base` must be an ancestor of HEAD other than HEAD
  (`merge-base --is-ancestor`; `is_rebase_base` answers the context menu). **Merges:** a
  range with a merge commit (`rev-list --count --merges`) is refused with `InvalidInput`
  — Tylia doesn't do `--rebase-merges`; the user can start after the merge.
- **Plan:** `rebase_interactive(base, plan)` takes every commit of the range exactly once,
  in the new order, each `pick | reword {message} | edit | squash {message?} | fixup |
drop`. Refused (`InvalidInput`) before Git runs: unknown / missing / duplicate oids (the
  branch moved), a squash / fixup with no kept commit before it, empty messages, everything
  dropped, another operation in progress. A dirty tree is Git's own refusal →
  `LocalChanges`.
- **No editor, todo:** the todo list (`pick|edit|fixup|drop <full oid>` lines) is written to
  `<git dir>/tylia-rebase-todo` and `rebase -i --no-autostash --no-update-refs <base>` runs
  with `GIT_SEQUENCE_EDITOR` set to a small shell function that copies that file over Git's
  todo using only shell built-ins (`while read -r … printf`), so it works in Git for
  Windows' bundled `sh` with no `cp` on `PATH`. The file's path reaches the function through
  the `TYLIA_REBASE_TODO` environment variable (forward slashes on Windows), never quoted
  into the command, so spaces, quotes and `$` in paths are harmless. The file is removed
  after Git returns. `-c rebase.missingCommitsCheck=ignore` because reworded commits are
  replaced (below). `GIT_EDITOR=:` as for every operation.
- **No editor, messages:** a commit whose message changes — a reword, or the first commit of
  a squash group — is recreated first with `commit-tree <oid>^{tree} -p <oid>^ -F -` (same
  tree, parent, author name / email / date; the message cleaned like
  `--cleanup=whitespace`), and the todo picks that copy. Every squash then becomes `fixup`,
  which keeps the (already final) message. A group's message is the last squash `message`
  given, else Git's default: the target's (or reworded) message and each squashed commit's
  message joined by blank lines (fixups contribute none). Unchanged commits before the first
  change are fast-forwarded by Git and keep their ids. `commit-tree` runs no hooks and
  doesn't sign on its own, so `-S` is passed when `commit.gpgSign` is on.
- **Outcome:** success with HEAD unchanged → `upToDate`; a rebase still in progress after
  Git exits 0 → `stopped` (paused at an `edit`); conflicts → `conflicts`. Continue / skip
  also return `stopped` when they reach the next `edit`. `RepoOperation::editing` is set
  while `rebase-merge/amend` exists (Git writes it only for `edit` stops); `incoming` is
  `REBASE_HEAD`. Continuing an `edit` stop with staged changes amends that commit (Git's
  behaviour, message kept).

## 5.16 File history and blame (Phase 5)

- **File history** (`file_history.rs`, `get_file_history`): `git log --follow -M -z
--name-status --diff-merges=first-parent` with an RS-prefixed `--format` (C locale), from
  `rev` (HEAD by default) for one path. Each entry carries the file's path _in that commit_
  and its status against the first parent (`R`/`C` add the old path), so a rename shows as
  `old → new` and older entries use the old name; the parser tracks the name backwards
  through renames. Paged with `--skip` / `--max-count` (one extra to know whether more
  follow; pages of 200, at most 1000): Git re-walks from the start for each page, which keeps
  `--follow`'s rename tracking correct and the first page fast on long histories. A merge
  that didn't change the file against its first parent has no status. Unborn branches and
  untracked files return an empty page.
- **Blame** (`blame.rs`, `get_blame`): `git blame --porcelain [rev] -- path` (C locale);
  `rev = None` blames the working copy, where uncommitted lines get Git's all-zero id. Commits
  are returned once (author, time, summary, the file's path there, and `previous` = the parent
  and path to "blame before this change"), lines refer to them by index — far smaller than
  `--line-porcelain` on large files. Before running blame, `ls-tree -l` (or the file on
  disk) gives the size and the first 8000 bytes are checked for NUL: binary files and files
  over 1 MiB (unless forced) are reported (`binary` / `tooLarge`) without blaming; a path
  missing from the commit, untracked, deleted, or not yet in HEAD is `missing`. C-quoted
  paths in porcelain output are unquoted. Both are reads: no write lock.
- **UI**: the repository view gains `view: "file"` with `{ path, mode, rev, line }` in the
  repo store (`openFile` / `closeFile`; Back restores the previous view and selected file).
  Blame lines are virtualized and highlighted by the Shiki worker in 250-line chunks around
  the viewport (`useLineHighlights`). The working-copy blame and the HEAD history refetch when
  the status / refs queries update (their update time is part of the query key).

## 5.17 Actions, shortcuts and settings (Phase 5)

- **Action registry** (`src/app/actions.ts`): components register `Action`s (`id`, title,
  group, default shortcut, `disabled` / `hidden` / `searchOnly`, `run`) with
  `useRegisterActions(source, actions, active)` while they're on screen (a repository's
  actions only while its tab is visible). The registry also remembers every bindable action
  seen this session for Settings → Keyboard.
- **Shortcuts** (`src/app/keyboard.ts`): one keydown listener turns events into canonical
  strings (`Mod+Ctrl+Alt+Shift+Key`, letters and digits from `KeyboardEvent.code`, so layouts
  and Shift don't change them) and runs the matching action. Bindings: `settings.shortcuts`
  (action id → shortcut, `""` = unbound) over the action's default. No raw window keydown
  listeners for app shortcuts.
- **Settings** additions: `density`, `uiFontSize` (CSS variables on `<html>`, applied before
  first paint by `public/boot.js`), `dateFormat`, `tabWidth`, `gitPath` (used by
  `state::git()` and the watcher; `GitError::NotFound` if the file is missing), `shortcuts`.
- **Repository extras** (`crates/tylia-git/src/extras.rs`): `submodule_update` (network
  operation: `submodule update --init --recursive --progress -- <paths>`), `worktrees`
  (`worktree list --porcelain -z`), `lfs_status` (`.gitattributes` uses `filter=lfs`;
  `git lfs version` runs). `has_commit_graph` / `write_commit_graph` (clone.rs).
  `diff_tool` (integrate.rs): `git difftool --no-prompt [--gui]` for a commit, the index or
  the working tree, refused without a configured graphical tool.
- **Checks:** `pnpm i18n:audit` (no literal UI text in components), `pnpm contrast` (token
  contrast incl. status colours as text), e2e/a11y.spec.ts (axe WCAG 2.1 AA in both themes,
  200% zoom).

## 5.18 Release, updates and git-flow (Phase 6)

- **Version:** `package.json` is the app's version (`tauri.conf.json` has
  `"version": "../package.json"`; Vite injects it as `import.meta.env.VITE_APP_VERSION`);
  `Cargo.toml`'s `[workspace.package] version` is kept equal. The release workflow refuses a
  tag that doesn't match both. See docs/RELEASING.md.
- **Packaging:** `.github/workflows/release.yml` (tauri-action v1) on `v*.*.*` tags: draft
  release with the CHANGELOG section as notes; Linux AppImage/deb/rpm (Ubuntu 22.04),
  Windows NSIS + MSI, macOS universal dmg. `src-tauri/tauri.release.conf.json` turns on
  `createUpdaterArtifacts` only for release builds, so local `tauri build` needs no key.
  The .deb and .rpm depend on `git`. AUR: `packaging/aur/tylia-bin` repackages the .deb.
- **Updater** (`src-tauri/src/commands/update.rs`, tauri-plugin-updater): `check_update`
  and `install_update` only (no plugin commands are exposed to the webview). Endpoint
  `releases/latest/download/latest.json` with no URL variables, so the request carries no
  version or platform details; bundles are verified against the minisign public key in
  `tauri.conf.json`. Runs only on the user's request (Settings, palette) or at start with
  `settings.checkForUpdates` (default false). `canInstall` is false for builds that can't
  replace themselves (dev builds, deb/rpm without their package tool, any install where
  `pacman` exists, i.e. the AUR package); the dialog then opens the releases page, the only
  URL the opener capability allows.
- **Distribution** (`BootInfo.distribution`, from `commands/update.rs`): `flatpak` when
  `/.flatpak-info` exists, `pacman` when pacman is on `PATH`; on Windows `scoop` or
  `portable` when `portable.txt` (only in the portable zip) sits next to `tylia.exe`, `scoop`
  if that folder is `…\apps\tylia\<version>`; else `other`. Only `other` installs updates
  itself. A Flatpak never checks for updates (no start-up check, no palette action; Settings
  → General says Flathub updates it). For `pacman` and `scoop` the update dialog names the
  package manager's command; `portable` gets the download page.
- **Open in terminal** (`src-tauri/src/terminal.rs`, command `open_terminal`): the terminal
  program is started directly, never through a shell, with the repository as its working
  directory (plus the folder flag of terminals that ignore it).
  - **Choice:** `settings.terminal` first. If that program is missing, Tylia reports it
    instead of falling back. Otherwise:
    - **Windows:** `wt.exe -d`, then pwsh, powershell, cmd.
    - **macOS:** `open -a Terminal` (an app name in the setting also goes through `open -a`).
    - **Linux:** `$TERMINAL`, the desktop's own terminal (`XDG_CURRENT_DESKTOP`),
      `x-terminal-emulator`, then a list of common terminals.
  - **Lookup:** programs are found on `PATH` with `symlink_metadata`, because `wt.exe` is
    an app execution alias.
  - **Environment:** Tylia sets no variables on its own process, so the terminal inherits
    a clean one.
- **Path search** (`crates/tylia-git/src/paths.rs`, `src-tauri/src/path_index.rs`):
  - **Index:** every path the history has had (`log --stdin --no-renames --diff-filter=A
--name-only`, refs fed on stdin) is kept per repository for the session.
  - **Updates:** the next update walks only commits not reachable from the tips already
    walked. That's about 5 s the first time on git/git, then milliseconds.
  - **Resolving a query:** the search resolves what was typed (a name anywhere, a path,
    a folder, wildcards; case ignored) into exact `:(literal)` pathspecs, which Git
    searches with tree pruning and changed-path Bloom filters. A glob pathspec on git/git
    takes 5–7 s, against 0.3 s for exact paths. A single file uses `--follow`. Over 200
    matches fall back to one `:(glob,icase)` pathspec.
  - **Suggestions** (`path_suggestions`) never wait for the first build: until it's
    ready they rank tracked files and report `indexing`.
  - **In the search box:** recent path searches (`RepoLayout.recentPaths`) and the
    `path:`-style prefixes are handled by the history search box (`HistorySearch.tsx`).
- **git-flow** (`crates/tylia-git/src/flow.rs`): plain Git, no git-flow binary. Setup is
  read from and written to `gitflow.branch.{master,develop}` and `gitflow.prefix.*`
  (CLI-compatible). Finish = `merge --no-ff` into the production branch (annotated tag
  `<versiontag><name>`) and the development branch (a hotfix goes into an open release
  instead), then `branch -d`. Before any change, every merge is simulated with
  `git merge-tree --write-tree` (Git ≥ 2.38, below our minimum); a conflict refuses with
  the file names and leaves the repository untouched, and tracked local changes refuse
  with `LocalChanges`.
- **Repository settings** (`crates/tylia-git/src/repo_config.rs`): reads `user.*`,
  `core.sshCommand`, `credential.helper` and remote URLs with `config --show-scope -z`.
  - **Writes** are only ever `--local`:
    - identity: `user.name` / `user.email`, or `--unset-all`;
    - SSH key: `core.sshCommand = ssh -i '<key>' -o IdentitiesOnly=yes`, with the path
      quoted for the shell Git runs it through (refused for `.pub` files and missing
      files);
    - forget a sign-in: `git credential reject` with `url=` on stdin.
  - **Protocol switch:** SSH ↔ HTTPS alternatives are computed in Rust
    (`https://host/owner/repo` ↔ `git@host:owner/repo.git`).

## 5.19 Launching and OS integration (Phase 7)

- **Command line** (`src-tauri/src/launch.rs`, parsed in `main.rs` before the app
  starts): `tylia [PATH]...`, `-h` / `--help`, `-V` / `--version`; an unknown option exits
  with code 2. Each path is resolved against the caller's working directory, and a file
  stands for its folder. Git's askpass calls are recognized first (§5.13).
- **One window** (tauri-plugin-single-instance, registered before every other plugin): a
  second launch never starts the app; the plugin hands its arguments and working directory
  to the running process and exits (335 ms on Windows, debug build). The running process
  focuses its window and parses them the same way.
- **Open requests:** paths from the first launch and from later ones go into one queue
  (`OpenRequests`). Rust emits `open-requested`; the frontend (`useOpenRequests`) calls
  `take_open_requests` on that event and once at start, then opens each path with
  `openRepoAt`, in order. A folder inside a repository opens the repository; anything else
  shows the "not a repository" toast.
- **macOS** sends folders opened from Finder or dropped on the Dock icon as
  `RunEvent::Opened`; they join the same queue. `src-tauri/Info.plist` (merged into the
  bundle's by Tauri) declares `public.folder` as a document type (role Viewer, rank
  Alternate), without which macOS offers neither.
- **The `tylia` command on macOS** (`cli_link.rs`, palette: "Install the tylia command"): a
  symbolic link `/usr/local/bin/tylia` → the binary inside Tylia.app. Without write access
  to `/usr/local/bin`, `osascript … with administrator privileges` asks for a password; the
  path is passed as `argv` and reaches the shell through `quoted form of`. It refuses a
  translocated copy (run from Downloads), a non-bundle build and an existing file that isn't
  a link; an older link is replaced. The Homebrew cask links the command itself.
- **Windows installers** (`src-tauri/tauri.windows.conf.json`, merged by Tauri on Windows):
  - **NSIS** installs for the current user (no admin), Start Menu folder `Tylia`, English.
    `windows/hooks.nsh` adds two welcome-page options, both on by default and in passive
    / silent installs: the `tylia` command and "Open in Tylia" in Explorer
    (`Software\Classes\Directory\shell\Tylia` and `Directory\Background\shell\Tylia`,
    `"tylia.exe" "%V"`). The desktop shortcut starts unticked. An update (passive, no
    welcome page) keeps the earlier choice: the menu key's presence and an `OnPath` marker
    under `Software\Tylia` record it. Uninstalling removes both; settings stay unless the
    user ticks Tauri's "Delete the application data".
  - **The `tylia` command:** `bin\tylia.cmd` (a bundle resource) is what goes on `PATH`.
    `tylia.exe` is a GUI-subsystem program, so Windows gives it no console: the shim
    starts it without waiting for paths, and pipes `--help` / `--version` output through
    `findstr` for options. `PATH` is edited through the .NET registry API (Windows
    PowerShell, `HKCU\Environment`), because NSIS strings stop at 1024 characters. The
    edit keeps `REG_EXPAND_SZ` and removes only Tylia's entry. The folder is passed in an
    environment variable, never quoted into the command.
  - **MSI** (per machine): `windows/wix-fragment.wxs` writes the same Explorer entries
    under HKLM and appends `[INSTALLDIR]bin` to the system `PATH` with WiX's `Environment`
    element; Windows Installer removes both. No options: managed deployments configure
    machines their own way.
  - Windows 11 shows "Open in Tylia" under "Show more options"; a top-level entry needs a
    packaged (MSIX) app, which is out of scope.
- **Linux packages** (`src-tauri/tauri.linux.conf.json`, merged by Tauri on Linux): the
  deb and rpm use `packaging/linux/tylia.desktop` as their desktop template, installed as
  `Tylia.desktop`. It has `Exec=tylia %F` and `MimeType=inode/directory;`, so file
  managers list "Open With Tylia" for folders. Its `StartupWMClass=tylia` matches both the
  X11 WM_CLASS and the Wayland app ID, which GTK takes from the program name because
  `enableGTKAppId` is off. The metainfo goes to `/usr/share/metainfo` in the deb, rpm and
  AppImage.
  - **AppStream ID:** `io.github.gilgil28.tylia`, the Flathub app ID, in every package, so
    software centres show the distribution packages and the Flatpak as one app. The bundle
    identifier `dev.tylia.app` is separate: it names the settings folder.
- **Flatpak** (`packaging/flatpak/`, GNOME 51 runtime): builds Git 2.56 from its release
  tarball into `/app` (with `git-credential-libsecret`, the system-level
  `credential.helper=libsecret` in `/app/etc/gitconfig`), then Tylia from the tag's tarball
  with the generated offline cargo / pnpm sources (`update-sources.sh`). Permissions:
  network, home, Wayland / X11, DRI, the ssh and gpg agents, and the Secret Service. Settings
  live in `~/.var/app/io.github.gilgil28.tylia/config/dev.tylia.app`. The sandbox has no
  host programs: the bundled Git can't run external diff / merge tools or the host's
  credential helpers (the system's Git, below, can), and "Open in terminal" finds no
  terminal.
- **The system's Git in the Flatpak** (Settings → Git, `settings.hostGit`, off by default):
  `Git::flatpak_host()` runs `flatpak-spawn --host --watch-bus --directory=<cwd>
--env=<each variable> git …`, so nothing of the sandbox's own environment leaks to the
  host, and killing `flatpak-spawn` (cancel) ends the host's Git. Needs the
  `org.freedesktop.Flatpak` bus name, which the manifest doesn't request (it weakens the
  sandbox); the user grants it with `flatpak override --user
--talk-name=org.freedesktop.Flatpak io.github.gilgil28.tylia`, which Settings shows when
  `git --version` fails. Credential prompts: `GIT_ASKPASS` / `SSH_ASKPASS` point at
  `$XDG_DATA_HOME/tylia-askpass`, a script (written on first use; the host sees the same
  path) that runs `flatpak run --command=tylia <app id>`; that helper reaches the askpass
  server over the shared loopback.

## 5.20 Patches, archives and custom actions (Phase 8)

- **Patch files** (`crates/tylia-git/src/patch_file.rs`; `patch.rs` is line staging):
  - **Save:** a commit with `format-patch -1 --stdout` (a mailbox with author, date and
    message); staged or unstaged changes with `diff [--cached] --binary -M` (untracked files
    aren't in either). The frontend asks for the file with the save dialog
    (`dialog:allow-save`); Rust writes it.
  - **Preview** (`preview_patch`): mailbox subjects from the `From <oid>` / `Subject:`
    headers; files and line counts from `apply --numstat -z`, renames from the patch's own
    `rename from` / `rename to` headers (numstat names only the new path); then
    `apply --check`, else `apply --check --3way`: `clean`, `threeWay` or `fails`, with Git's
    message.
  - **Apply** (`apply_patch_file`, write-locked): to the working tree with `apply`, falling
    back to `apply --3way` (conflicted files, no operation to continue); or a mailbox's
    commits with `am --3way --keep-cr` (`--keep-cr` keeps CRLF files' patches intact; it is
    left out when the mailbox's own lines end in CRLF, i.e. it came from a mail client).
  - **`git am` in progress** is `OperationKind::Am` (`rebase-apply/applying`): subject from
    `final-commit`, step / total from `next` / `last`; Continue / Skip / Abort run
    `am --continue / --skip / --abort`, and the banner says "Applying … · patch n of m".
  - **UI:** "Save as patch…" in the commit menu, a button on each Changes list header, the
    palette ("Apply patch…", "Save … as a patch…"); `ApplyPatchDialog` shows the check, the
    commits and the files before anything changes.
- **Archives** (`crates/tylia-git/src/archive.rs`): `git archive --format=zip|tar.gz
--prefix=<repo>-<label>/ --output=<file> <oid>` after `resolve_commit`, so an option-like
  or unknown revision is refused before Git writes anything. The folder name replaces
  characters Windows refuses (`feature/graph` → `feature-graph`) and drops leading dots.
  The format follows the extension chosen in the save dialog (`.tar.gz` / `.tgz`, else
  zip). "Export archive…" is in the commit, branch and tag menus, and the palette exports
  the current branch.
- **Custom actions** (`src-tauri/src/custom_action.rs`, Settings → Actions,
  `settings.customActions`): a name, a program, one line of arguments, a scope
  (palette / commit / branch / file menus), "ask before running" and "show output".
  - **Command line:** Rust splits the line (whitespace separates; `"…"` and `'…'` group),
    then substitutes `{repo}`, `{sha}`, `{shortSha}`, `{branch}`, `{file}` and `{files}`
    in each argument (`{files}` alone becomes one argument per file). A missing value is
    an error, unknown braces stay. The program is started directly with that list (no
    shell), in the repository folder, so a value never becomes more arguments or commands.
    `custom_action_command` returns the list for the confirmation; the frontend never
    splits or substitutes.
  - **Running:** with "show output" the command waits, keeps up to 1 MB of each stream and
    registers in the operations map, so `cancel_operation` (Stop) kills it; otherwise it is
    started with no pipes and reaped in the background. A missing program is reported as
    such.
  - **UI:** commit and branch menus, the Changes file menu (the selected files), and the
    palette as `custom.<id>` (rebindable; each for the selected commit, current branch or
    selected file). The output panel shows the command line, exit code, output and errors.

## 5.21 Workflow polish (Phase 9)

- **Several commits in the history** (`repo-store.ts`, `history/multiSelect.ts`):
  `selection` stays the focused commit, so everything single-commit is unchanged;
  `selectedOids` holds the commits selected with it (newest first, empty for one). Clicks
  and keys go through `nextSelection` (plain replaces, Ctrl/Cmd toggles, Shift ranges from
  the anchor; only commit rows), which is unit-tested. A right-click inside the selection
  opens `CommitsItems`: cherry-pick (`cherry_pick_many`, oldest first, one sequencer
  operation with the usual banner), revert (`revert_many`, newest first), a patch series
  (`save_commit_patches`: format-patch into a staging folder inside the chosen one, then
  moved, refusing if a name is taken, so nothing is overwritten) and copy hashes. The
  details pane shows `SeveralCommits` (authors, dates, files, from the first 100).
- **Hosting accounts** (`src-tauri/src/hosting.rs`, `commands/hosting.rs`, Settings →
  Accounts, `settings.hostingAccounts`): GitHub (and Enterprise Server), GitLab (any host)
  and Bitbucket Cloud, signed in with a personal access token (an OAuth device flow needs
  registered apps; later).
  - **Tokens** never reach settings.json: `tylia_git::credential` stores them with
    `git credential approve` under `https://<API host>` and the username `tylia:<login>`,
    apart from the user's own Git sign-in for that host, and reads them with a `fill` that
    can't prompt (no askpass, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`,
    `credential.interactive=never`). Without a helper nothing is stored, and a
    per-session copy in `AppState` keeps the account usable until Tylia quits (the UI
    says so). Sign out runs `git credential reject`.
  - **Network:** `reqwest` (with rustls / ring, the same build as the updater's), only when
    the user signs in (`GET /user` checks the token) or chooses "Your repositories" in the
    Clone dialog (up to 10 pages of 100, most recently active first). Bitbucket uses Basic
    auth with the account email; the others a bearer token.
  - **Parsing** of each provider's answers is pure and tested with recorded JSON.
- **Git LFS** (`crates/tylia-git/src/lfs.rs`, `commands/lfs.rs`, `features/lfs/`): LFS
  files come from `git check-attr -z --stdin filter` (no Git LFS needed; history rows use
  today's attributes, close enough for a mark). "Track with LFS" runs `git lfs track
<pattern>` (refused for option-like patterns) for a file or its extension. Pull
  (`git lfs pull`) and locks (`git lfs locks --verify --json`, `lock` / `unlock -- <path>`)
  are network operations through the usual runner: progress, cancel, askpass, the
  toolbar's operation state. The toolbar's LFS badge is their menu; the locks dialog reads
  the server each time it opens and lets you release only your own locks.
