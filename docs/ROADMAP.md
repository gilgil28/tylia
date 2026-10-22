# Tylia roadmap

Current phase: **Phase 7 — Distribution, OS integration and polish** (planned 2026-10-21; not started). Phases 0–6 delivered; v0.1.0 is tagged locally (not pushed). The GitHub acceptance run from Phase 3 is still open.

## Product vision

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

## Definition of done (every task)

1. Builds on the dev OS; CI config would pass (fmt, clippy, eslint, tsc, tests).
2. Tests added/updated for new behaviour.
3. Screenshots regenerated and reviewed (UI changes).
4. Empty / loading / error states handled.
5. Keyboard reachable; focus visible.
6. Strings in `en.ts`; tokens only; no dead code.
7. ROADMAP checkbox ticked; DESIGN/ARCHITECTURE updated if a decision changed.

## Phases

Each phase ends with: all tests green, clippy/eslint/tsc clean, screenshots reviewed in
both themes, acceptance list ticked, a short summary to the user, and a **stop** for review.

### Phase 0 — Foundations

- [x] Cargo workspace (`tylia-git`, `src-tauri`), Tauri 2 + React + TS + Vite + Tailwind v4 + pnpm.
- [x] Tokens (`tokens.css`, both themes), base styles, bundled Inter + JetBrains Mono, Lucide.
- [x] Theme switching (System/Light/Dark) without startup flash.
- [x] Custom title bar per platform (§4.7) with tab strip placeholder + "Use native title bar" setting.
- [x] `src/ui` primitives from §4.9 (at least: Button, IconButton, Tooltip, Kbd, Input, Textarea, Checkbox, Switch, SegmentedControl, Menu, ContextMenu, Dialog, ConfirmDialog, Toast, Badge, RefBadge, Avatar, SplitPane, VirtualList, Tree, EmptyState, Skeleton, ErrorPanel) and a **Gallery** dev page.
- [x] IPC plumbing with generated TS types; one sample command (`git_version`) end to end.
- [x] Mock IPC + `pnpm dev:web` + `pnpm shots` Playwright screenshot pipeline.
- [x] Contrast-check script for the tokens.
- [x] OSS files: README (vision, status, build instructions per OS), licenses, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue/PR templates.
- [x] CI: matrix ubuntu/windows/macos — fmt, clippy, cargo test, eslint, tsc, vitest, `tauri build --no-bundle`.
- **Acceptance:** app launches on the dev OS showing an empty shell with title bar and
  theme toggle; Gallery page screenshots look polished in both themes; CI config valid.
- Status 2026-10-19: **done on Windows 11.** Release build (`tauri build --no-bundle`) and
  `pnpm tauri dev` run; in the real window: first visible frame is fully rendered in the
  right theme (no flash), custom caption buttons minimize/maximize/restore, theme menu
  persists `settings.json`, native title bar mode works after restart, and `git_version`
  reports the system Git over Tauri IPC. Not yet checked on Linux/macOS (CI covers builds);
  CI has not run on GitHub yet. Not built yet from §4.9 (later phases): Select, Tabs,
  CommandPalette.

### Phase 1 — Read-only viewer (the "Sourcetree look")

- [x] Welcome screen: recent repos (name, path, branch, last opened), search, Open / Clone / Create, drag-and-drop a folder.
- [x] Clone dialog: URL, destination, branch, shallow option, progress, cancel; opens in a new tab. _(Moved here from Phase 3 at the user's request, 2026-10-19. Authentication relies on the user's Git credential setup until the askpass bridge lands in Phase 3.)_
- [x] Open repo via folder picker; detect non-repo / bare repo / missing git with clear states.
- [x] Repo tabs: open, close, reorder, restore on restart.
- [x] Sidebar: Workspace (Changes count, History), Branches (tree by `/`, current marked, ahead/behind), Remotes, Tags, Stashes, Submodules; filter box; collapsed state persisted.
- [x] History: streamed + virtualized; columns Graph / Description (ref badges + subject) / Author / Date / Hash; resizable + hideable columns; branch filter (all / current); "Uncommitted changes" pseudo-row.
- [x] Commit graph renderer per §4.11 + Rust layout per §5.5 with snapshot tests.
- [x] Commit details: subject, body, author/committer, date, parents (clickable), hash (copy), file list (flat/tree toggle, status icons, +/− counts).
- [x] Diff viewer: unified + side-by-side, Shiki highlighting in a worker, word-level diff emphasis, line numbers, collapsed unchanged regions, binary/image preview (side-by-side images for PNG/JPG/SVG), large-file guard.
- [x] Search/filter history by message, author, hash, path.
- [x] Click a sidebar ref → scroll history to its commit.
- [x] FS watcher refreshes refs/status/history head.
- [x] Keyboard: ↑/↓ through history, Enter focuses details, Ctrl/Cmd+1..9 switch tabs, Ctrl/Cmd+W close tab.
- **Acceptance:** opens `git/git` (clone it for testing) with first rows < 300 ms and smooth
  scrolling on Linux; graph snapshot tests pass; screenshots match DESIGN.md.
- Status 2026-10-19: **built; verified on Windows 11** in browser mode (30 screenshot tests, both
  themes) and in the real app: opened this repo (unborn branch), `git/git` (85,641 commits)
  and a fresh clone; watcher refresh, keyboard navigation and tab shortcuts checked over CDP.
  Not exercised in the real app by automation: the native folder picker, dropping a folder,
  and dragging tabs (code paths only). Performance on `git/git`, Windows, release build:
  first rows 160–190 ms warm (330 ms cold) **when the repository has a commit-graph** — about
  0.8 s without one (`git log --date-order` must walk the whole history first); all rows in
  ~1.1 s (backend) / ~2.2 s in the UI; scrolling median 10 ms per frame. Not yet measured on
  Linux. Tylia writes a commit-graph after its own clones; for other repositories, see the
  Phase 5 follow-up.

### Phase 2 — Working copy

- [x] Changes view (§4.8): unstaged / staged lists, status icons, stage/unstage per file, all, via checkbox, double-click, Space, drag between lists.
- [x] Hunk staging/unstaging/discarding from the diff header.
- [x] Line selection (click, Shift-click, drag in gutter) → stage / unstage / discard lines (§5.6).
- [x] Discard file / all with confirmation; untracked → move to trash (OS trash, not permanent delete) where possible.
- [x] Commit composer: subject with 50/72 guidance, body, amend (prefills last message), Ctrl/Cmd+Enter, recent messages dropdown, commit hooks output shown on failure, GPG/SSH signing honoured (via git config). _"Push after commit" moves to Phase 3 with push itself._
- [x] Context menus on files: Open, Open in file manager, Copy path, Ignore (add pattern to .gitignore), Show history (Phase 5), Resolve conflicts (Phase 4).
- [x] Toasts for results; ErrorPanel with stderr.
- **Acceptance:** line-staging test matrix green; manual run-through of stage/unstage/discard/commit/amend on a real repo.
- Status 2026-10-19: **built; verified on Windows 11.** Real app, scratch repository: staged one
  selected line (exact `git diff --cached` checked), discarded a hunk after confirmation,
  staged a file by checkbox and committed with Ctrl+Enter. Browser mode: drag between lists,
  checkbox unstage, commit enablement, discard dialog and context menu (Playwright). Rust:
  27 line-staging tests (the §5.6 matrix incl. CRLF, no-EOL, untracked, renames, binary,
  non-UTF-8, stale fingerprint) and worktree tests (unborn branch, hook failure output,
  amend). Not exercised in the real app: moving untracked files to the Recycle Bin, Open /
  Show in Explorer / Ignore from the context menu (code paths and unit tests only).
  "Show history" (Phase 5) and "Resolve conflicts" (Phase 4) menu items come with their phases.

### Phase 3 — Remotes, auth, clone

- [x] "Push after commit" option in the commit composer (moved from Phase 2).
- [x] Fetch (all remotes, prune option), Pull (merge / rebase / ff-only from SplitButton), Push (current branch, set upstream on first push, tags option, force-with-lease behind explicit confirm).
- [x] Progress in toolbar button + operation panel; cancel.
- [x] Ahead/behind badges on toolbar and sidebar; periodic background fetch (off by default, configurable).
- [x] Askpass bridge: username/password/token prompts and SSH passphrase prompts as dialogs; host-key confirmation surfaced clearly.
- Clone dialog and create repository: moved to Phase 1.
- [x] Remotes management: add / edit URL / remove / rename.
- **Acceptance:** fetch/pull/push/clone verified against GitHub over HTTPS (token) and SSH (agent + passphrase key) on Linux and Windows.
- Status 2026-10-20: **built; verified in the real app on Windows 11 against a local
  Git smart-HTTP server with Basic auth** (`git http-backend` behind a test server; the
  repository's credential helper disabled so Git asks Tylia). Passed: fetch with the
  username + token dialogs (credentials reached the server), pull (fast-forward, merge
  conflicts → toast → Changes), push, push rejected when behind, force push with lease
  (confirmation counts the commits lost), stale lease refused with the teammate's commit
  kept, cancel during a stalled transfer (Git and `git-remote-http` stopped, no error),
  Cancel in the sign-in dialog (cancels the operation quietly), wrong token (clear
  "Couldn't sign in" message), first push of a new branch (dialog, upstream set), push
  after commit, add / rename + push URL / remove remote, background fetch (never prompts;
  reports once that it needs a sign-in). Also: `tylia-git` integration tests against
  local bare repositories, askpass tests with the real binary, browser-mode Playwright.
  **Still pending (acceptance):** GitHub over HTTPS (token) and SSH (agent, passphrase key,
  host-key prompt) — no SSH server on this machine; Linux. Clone with credentials in the
  real app not exercised (Git Credential Manager is the system helper here).
  **2026-10-21, SSH:** verified in the real app on Windows 11 against OpenSSH in a local
  container. Unknown host key asks first (Cancel leaves `known_hosts` untouched, Trust
  saves it), passphrase key fetch / pull / push, a wrong passphrase reports "Couldn't
  sign in", and a key held only by ssh-agent fetches and pushes without any prompt.
  **Still open:** the same run against GitHub (HTTPS token and SSH) with the maintainer's
  account.

### Phase 4 — Branching operations

- [x] Branch: create (from any commit), checkout (with "stash & reapply" offer when dirty), rename, delete (local, and remote with confirm), set upstream, checkout remote branch as tracking.
- [x] Merge into current (ff / no-ff options), rebase current onto, cherry-pick, revert, reset current to commit (soft / mixed / hard — hard confirms with file count).
- [x] Tags: create (lightweight/annotated) on any commit, delete, push.
- [x] Stashes: save (message, include untracked, keep index), apply, pop, drop, show diff.
- [x] Context menus on history rows and sidebar refs exposing all of the above.
- [x] Conflict state: banner ("Merging feature/x — 2 conflicts"), conflicted files list, open external mergetool, mark resolved, continue / skip / abort for merge, rebase, cherry-pick, revert.
- [x] Drag a branch badge onto another branch row → menu: Merge / Rebase.
- **Acceptance:** each operation tested in `tylia-git` integration tests; conflict flows verified manually.
- Status 2026-10-20: **built; verified in the real app on Windows 11** against a scratch
  repository: new branch from a commit, switch from the toolbar switcher and by double-click,
  checkout refused by local changes → "Stash and switch" (conflicting reapply leaves the
  conflict and keeps the stash), merge with two conflicts (take theirs for one, conflict-marker
  warning, hand edit + mark resolved, Commit merge → merge commit, no MERGE_HEAD), rebase
  stopped on a conflict → banner with step → Abort (branch back where it was), cherry-pick,
  revert, hard reset (confirmation names the files lost), annotated tag, stash with untracked
  files → show → pop, delete an unmerged branch (second confirmation), drag a branch badge
  onto the current branch → Merge, merge tool refused when none is configured. Plus 42
  `tylia-git` integration tests (§5.15) and browser-mode Playwright. Not exercised: launching
  a configured GUI merge tool; deleting a remote branch and pushing a tag in the real app
  (integration-tested against a bare remote).

### Phase 5 — Power & polish

- [x] Command palette (Ctrl/Cmd+K) with every action + fuzzy repo/branch switcher.
- [x] Shortcut map (Settings → Keyboard), platform-correct modifiers.
- [x] Interactive rebase editor: drag to reorder, pick / reword / edit / squash / fixup / drop, preview of resulting graph.
- [x] Blame view; file history ("Log selected…") with follow-renames.
- [x] Settings screen (§5.9); compact density; font size.
- [x] Submodules (update/init, open as tab), worktrees list, LFS indicator, git-flow helpers (optional). _git-flow helpers built in Phase 6 (see there)._
- [x] Hover first-parent highlight in graph; jump-to-parent/child shortcuts.
- [x] Offer to write a commit-graph for repositories that lack one (explicit action, explains what it does) — history then streams in ~0.2 s instead of ~0.8 s on large repositories.
- [x] Accessibility pass: screen-reader labels, roles, focus order, reduced motion, 200% zoom.
- [x] i18n readiness audit (no hardcoded strings).
- **Acceptance:** palette covers all actions; a11y checklist passes; screenshots updated in README.
- Status 2026-10-20: **built; verified in the real app on Windows 11** (scratch repository
  with a rename, a submodule, a second worktree, an LFS pattern and SSH commit signing):
  palette density toggle, Settings → Git shows the Git version, rebinding saved to
  `settings.json` and working at once, reset all; worktrees, submodule list and update, LFS
  chip; file history across the rename, blame with the uncommitted line, Alt+Left back; the
  configured GUI diff tool launched with the file, a terminal tool refused with a reason;
  interactive rebase reword with every rewritten commit still signed (`%G?` = G); Alt+↓ /
  Alt+↑ parent / child; commit-graph written from the palette. Every
  toolbar, menu and view action is registered in one action registry, so the palette and
  Settings → Keyboard list the same set (repo actions appear once a repository has been
  open); no two defaults collide. Also built: external diff tool (the configured
  `diff.guitool` / `diff.tool`, terminal tools refused with a reason) from the palette,
  Ctrl/Cmd+D and file context menus; per-block conflict resolution (Phase 4 follow-up).
  Checks: axe-core (WCAG 2.1 A/AA) clean on welcome, history, changes, palette, settings,
  dialogs and menus in both themes, plus a 200 % zoom pass at 640 × 400; `pnpm contrast`
  (muted and status text ≥ 4.5:1); `pnpm i18n:audit` finds no hardcoded strings. Rust
  integration tests for blame, file history (renames), interactive rebase (reorder, reword
  — signed when `commit.gpgSign` is on —, edit stops, squash / fixup, drop, refusals),
  worktrees, LFS, submodule update and diff-tool refusals; Playwright 119 tests.

### Phase 6 — Release

- [x] Release workflow (tauri-action): Linux AppImage/deb/rpm, Windows NSIS/MSI, macOS dmg (universal).
- [x] AUR `PKGBUILD` (`tylia-bin`), Flatpak manifest (later). _Flatpak is still later:
      it needs a decision on running the host's Git from the sandbox (docs/RELEASING.md)._
- [x] Code-signing notes for Windows/macOS (unsigned builds documented until certificates exist).
- [x] Opt-in update check via Tauri updater (off by default; no data sent beyond the request).
- [x] Website at https://tylia.dev (GitHub Pages, custom domain, HTTPS enforced): one page with hero screenshot (light + dark), features, download links per OS, pronunciation. _Domain registration, DNS and "Enforce HTTPS" are repository settings (docs/RELEASING.md)._
- [x] CHANGELOG.md (Keep a Changelog), semver tags, v0.1.0.
- [x] Open in terminal (toolbar, palette, Ctrl/Cmd+Shift+T, Settings → Terminal): it was marked done in the feature inventory but had never been built. Added 2026-10-21 at the user's request.
- [x] Closed the open items: git-flow helpers, interactive rebase in the real app, SSH acceptance, screen-reader check, earlier untested real-app paths.
- Status 2026-10-21: **built; verified locally.**
  - **Release:** `.github/workflows/release.yml` drafts a release from the tag's
    CHANGELOG section, then tauri-action builds on three OSes and uploads the installers,
    the updater bundles with their `.sig` files, and `latest.json`. Publishing the draft by
    hand starts the Pages workflow. Not run on GitHub yet; the repository isn't published.
  - **Linux:** checked in Docker on Ubuntu 22.04 (the release runner's OS). All Rust tests
    pass with current Git (22.04's own Git 2.34 is below our 2.40 minimum). The bundler
    produced `Tylia_0.1.0_amd64.deb`, `Tylia-0.1.0-1.x86_64.rpm` and
    `Tylia_0.1.0_amd64.AppImage`, each with an updater signature.
  - **Arch:** the AUR package built from that .deb, installed cleanly (no missing
    libraries; namcap clean apart from implicit glibc/gcc-libs), and **the app started and
    rendered its welcome screen under Xvfb with WebKitGTK**. That is the first Linux run.
  - **Windows:** a local release build with a test key produced
    `Tylia_0.1.0_x64-setup.exe` (4.4 MB) and `Tylia_0.1.0_x64_en-US.msi` (6.2 MB), each
    with an updater signature. Neither was installed.
  - **Updater:** `tauri-plugin-updater` 2.14.0, called only through Tylia's own
    `check_update` / `install_update` commands. Off by default; Settings → General has the
    switch and "Check now", and the palette has "Check for updates". In the real app it
    read a locally served `latest.json` signed with a test key, showed 9.9.9 with its notes,
    and offered the download page, because a dev build can't replace itself. The setting
    is saved. Signing key generated; its secrets and rotation are in docs/RELEASING.md.
  - **Website:** `website/` plus `.github/workflows/pages.yml`, with download links filled
    in from the latest release at build time. No external requests (CSP `'self'`), and
    axe-clean in both themes.
  - **git-flow** (`flow.rs`, plain Git, CLI-compatible `gitflow.*` config): set up, start
    and finish features, releases and hotfixes. Finishing pre-checks every merge with
    `git merge-tree` and changes nothing if one would conflict. 11 integration tests; in
    the real app, set up → feature start / commit / finish → release finish with an
    annotated `v1.0.0` tag, ending on develop.
  - **Other open items, now verified in the real app:**
    - interactive rebase: drag to reorder, stop at an `edit` commit, amend, Continue;
    - a configured GUI merge tool launched on a conflicted file;
    - pushing a tag, and deleting a remote branch;
    - "Ignore all *.log files";
    - discarding an untracked file moves it to the Recycle Bin (checked through the Shell);
    - dragging tabs to reorder.
  - **Screen reader:** read the real window's UI Automation tree, which is what Narrator
    and NVDA read. It has no unnamed interactive elements. Fixed: avatar initials were
    read before author names, column headers included their resize handle's label, and
    the "+3 −0" diff counts were read as fragments.
  - **Checks:** Playwright 131 tests (12 new), vitest, eslint, Prettier, tsc, i18n audit,
    contrast, clippy and all Rust tests on Windows and Linux.
  - **Not done:**
    - **GitHub:** the repository and the `v0.1.0` tag aren't pushed (no remote); the GitHub
      HTTPS/SSH acceptance run is still open.
    - **Code signing:** no certificates.
    - **Real install:** no installer was installed on this machine.
    - **macOS:** never built or run (CI only).
    - **Native file picker / drop:** not driven by automation.
    - **Screen reader by ear:** no hands-on listening test with a real screen reader.

- Follow-ups after the Phase 6 review (2026-10-21), each in its own commit:
  - Open in terminal.
  - Path search with suggestions from history.
  - Commit and branch conventions with a commit-msg hook.
  - Push / pull / fetch feedback.
  - Commit button.
  - History search row.
  - Last fetch in Fetch's tooltip.
  - Lighter dark panels.
  - Settings button replacing the theme menu.
  - Tooltip and dialog-animation fixes.
  - Repository settings (remotes with HTTPS ↔ SSH, SSH key, saved sign-ins, identity).

### Phase 7 — Distribution, OS integration and polish

**Goal:** Tylia installs the way each platform expects, from the stores and package
managers people use:

- **Windows:** branded NSIS `.exe` (plus MSI), winget, Scoop.
- **macOS:** branded dmg, Homebrew cask.
- **Linux:** AppImage / deb / rpm, AUR (`tylia-bin` and `tylia`), Flathub.

It also opens from the file manager and the command line, builds and tests faster with a
small `target/`, and adds three long-requested power features. It ends with **v0.2.0**.

**How to run this phase (clean session):**

- **Before starting:**
  - Read `CLAUDE.md`, this section, `docs/RELEASING.md`, `CONTRIBUTING.md` → "Commits and
    branches" and `docs/DESIGN.md`.
  - The decisions marked **Decide** below have a recommendation; confirm them with the
    user before building that part.
- **While working:**
  - Work through the workstreams in order (A first: it makes everything after it faster).
  - One commit per feature, bug or fix, each on its own `<kind>/<topic>` branch,
    fast-forwarded into `main` once it is approved. Never bundle (user rule, 2026-10-21).
  - Verify every pinned version against crates.io / npm before adding it, and justify
    each new dependency in its commit body (what, why, license).
  - The user tests in their own repositories (read-only: `C:\Dev\android\BeamerV3`) and
    runs release builds from `target\release\tylia.exe`. Use scratch repositories in
    `C:\Dev\tylia-test-repos` for anything that writes.
- **The user provides** (ask at the start; nothing is published without them):
  - the GitHub repository `gilgil28/tylia` pushed, with the `TAURI_SIGNING_*` secrets;
  - an AUR account with an SSH key;
  - a Flathub submission (GitHub account);
  - a fork for winget-pkgs PRs (or a token for an automation);
  - a Homebrew tap repository (`gilgil28/homebrew-tap`);
  - a Scoop bucket repository (`gilgil28/scoop-bucket`).

#### A. Build hygiene (first)

`target/` reached 29.7 GB on 2026-10-21:

- **`debug/incremental`, 13.2 GB:** 23 stale `tylia_lib` sessions alone took 7.6 GB.
- **`debug/deps`, 11.6 GB:** full debug info for every dependency, 3.3 GB of `.pdb`
  files, and about 16 integration-test executables that each link all of `tylia-git`.
- **`debug/build`, 2.2 GB.**
- **`release`, 2.4 GB.**

The items:

- [x] Debug info: `[profile.dev] debug = "line-tables-only"` and, for dependencies,
      `[profile.dev.package."*"] debug = false`, so dependencies carry none and our
      crates keep line numbers for panics and backtraces. Measure `target/` before and after a full `cargo test`
      plus a `tauri dev` build, and record both numbers here.
      _2026-10-21, Windows, from `cargo clean`: `target/` **7.84 GB → 3.02 GB**
      (`debug/deps` 4.08 → 1.71 GB, `incremental` 1.35 → 0.55 GB, `build` 0.57 → 0.34 GB);
      building the tests 177 s → 143 s, running them 118 s → 104 s. The 29.7 GB was
      mostly accumulated incremental sessions, which `cargo clean` removes._
- [x] Merge `crates/tylia-git/tests/*.rs` into one integration-test binary
      (`tests/it/main.rs` with one module per current file, keeping `tests/common`). That
      is one link instead of about 16. Test names and filters must keep working, e.g.
      `cargo test -p tylia-git --test it flow`.
      _Done: 14 files, 141 tests, one binary. From clean: `target/` 3.02 → 2.79 GB,
      building the tests 143 → 127 s, running them 104 → 80 s (all tests now share one
      parallel run)._
- [x] Release `target/` is 2.4 GB, but almost none of it ships: `tylia.exe` is 15.8 MB
      and the installers are 4–6 MB. The rest is build cache: - 423 compiled libraries (`.rlib`, 1.0 GB, larger because `lto = true` keeps LLVM
      bitcode in them); - their metadata (`.rmeta`, 0.6 GB); - proc-macro DLLs with their `.lib` / `.pdb` (0.3 GB).

      `windows` (~100 MB each) and `tauri-utils` are each built twice, once with
      build-script features and once for the app. Check `cargo tree -d -e normal,build`
      and feature unification; consider `lto = "thin"` if release builds or the cache
      matter more than the last few % of binary size. Record the binary size before and
      after.

      _Measured 2026-10-21 on Windows, clean `tauri build --no-bundle`: `lto = true` takes
      478 s, `target/release` 1.83 GB and `tylia.exe` 15.84 MB. `lto = "thin"` takes 438 s
      (−8 %) for a 16.60 MB binary (+4.8 %) and the same 1.83 GB. Kept `lto = true`. The
      double builds are the Tauri build scripts: `tauri-build` and `tauri-plugin` use
      `tauri-utils` and `windows` with other features than the app, and build scripts are
      compiled unoptimized, so Cargo can't share them. Nothing to change on our side._

- [x] CI: cache with `Swatinem/rust-cache` keyed per job. Run the Linux bindings check
      without a second full build.
      _The cache was already in place (its key includes OS and job); now only `main`
      saves it. The bindings check reuses `cargo test`'s build. The real second build was
      the LTO release build in "Tauri build": it is now `tauri build --debug`, which
      recompiles only `tauri`, its plugins and `tylia` (36 s instead of about 8 min)._
- [x] Document `cargo clean` and these settings in CONTRIBUTING.md ("Disk space").
- **Acceptance:** after `cargo clean` and one `cargo test --workspace` plus one `pnpm
tauri dev` build, `target/` is under 8 GB on Windows; full `cargo test` wall time is
  no worse than before.
  _Met 2026-10-21: 2.79 GB (was 7.84 GB from clean, 29.7 GB accumulated); tests build in
  127 s (was 177 s) and run in 80 s (was 118 s)._

#### B. Artwork and resources

The app icon (`src-tauri/icons/app-icon.svg`, the "y" drawn as two graph lanes) is the
one source. Everything else is generated from it, and the generators are committed.

- [x] `scripts/artwork.ts` (`pnpm artwork`) renders the SVG and the installer images with
      Playwright (already a dev dependency) and writes BMPs with a small BMP encoder
      (24-bit; no new dependency). Then it runs `pnpm tauri icon` for the app icons. It
      produces:
  - **App icons:** `.ico` (16, 24, 32, 48, 64, 256), `.icns`, Linux PNGs 32–512, the
    Windows Store tiles, and `website/favicon.svg` / `assets/icon-256.png` from the same
    source.
  - **NSIS:** `bundle.windows.nsis.installerIcon` (the app `.ico`), `headerImage` 150×57
    BMP and `sidebarImage` 164×314 BMP (wordmark on `--bg-app` dark, calm, no
    gradients).
  - **MSI (WiX):** `bundle.windows.wix.bannerPath` 493×58 and `dialogImagePath` 493×312.
  - **macOS dmg:** `bundle.macOS.dmg.background` (660×400 @1x and @2x), `windowSize`,
    `appPosition` and `applicationFolderPosition`, so the window shows the app, an arrow
    and Applications.
  - **Open Graph image** for the website, 1200×630.
    _Done 2026-10-21. Artwork is HTML with the design tokens and the bundled Inter, rendered
    by Playwright's Chromium; BMPs come from a small PNG decoder + BMP writer (no new
    dependency). `tauri icon` writes the `.icns` entries in random order, so the script sorts
    them. `pnpm artwork --check` passes twice in a row on Windows (not in CI: font
    rasterization differs per OS). The NSIS header sits top left in Tauri's template, so
    the wordmark is left-aligned. The dmg background is 1× only: a Retina variant needs a
    multi-resolution TIFF made with macOS's `tiffutil`. Seen in the real installers:
    NSIS welcome page (sidebar), its inner pages (header) and the title-bar icon; MSI
    welcome dialog (dialog image). Not seen yet: the MSI banner, the dmg._
- [x] Screenshots: refresh `docs/screenshots/*` (README) and `website/assets/*` from
      `pnpm shots`. Since they were taken, the Commit button, search row, lighter dark
      panels and Settings button have landed. Add a "screenshots" spec that renders the
      exact README / website set at 2× in both themes, so a refresh is one command.
      _Done: `pnpm shots:publish` (`e2e/publish.spec.ts`, its own Playwright project so
      `pnpm shots` doesn't overwrite committed images) writes the README and website
      images at 2560 × 1600, plus WebP copies encoded by Chromium._
- [ ] README and website copy updated for v0.2.0 features and the new install channels.
- **Acceptance:** `pnpm artwork` reproduces every committed image byte-for-byte. The
  installers show Tylia's icon, header and sidebar instead of Tauri / NSIS defaults
  (screenshots of each installer page reviewed in both themes where they apply).

#### C. Installers and distribution channels

Windows:

- [ ] **NSIS `.exe`, the primary Windows download:**
  - **Install mode:** `installMode: "currentUser"` (no admin needed). **Decide**: also
    allow a per-machine install with `"both"` (recommendation: `"currentUser"`; the MSI
    covers managed per-machine installs).
  - **Shortcuts and uninstall:** Start Menu folder `Tylia`, a desktop shortcut as a
    checkbox (unchecked), and the uninstaller keeps the user's settings unless they
    tick a box. Ask NSIS: does it offer that? If not, use `installerHooks`.
  - **Language:** English only.
  - **Hooks:** `installerHooks` (`src-tauri/windows/hooks.nsh`) for OS integration (D).
- [ ] **MSI:** the same branding and the same registry entries, via a WiX
      `fragmentPaths` fragment.
- _Progress 2026-10-22 (NSIS + MSI): built, not installed yet (ARCHITECTURE §5.19). NSIS:
  `installMode: "currentUser"`, Start Menu folder `Tylia`, English; the desktop shortcut
  starts unticked; Tauri's uninstaller already keeps settings unless "Delete the
  application data" is ticked, so no hook was needed for that. The welcome page offers
  "Add the tylia command to PATH" and "Open in Tylia" (both on); screenshot reviewed.
  Verified without installing: `bin\tylia.cmd` with the release exe (`--version`,
  `--help` and errors reach the console); the PATH edit against a scratch registry key
  (2,352-character PATH, `%VAR%` kept, no duplicates, removal leaves the rest); the MSI's
  Registry / Environment / File tables (64-bit components, HKLM, system PATH).
  2026-10-22, installed on the dev machine (silent, per user, with the user's consent):
  files in `%LOCALAPPDATA%\Tylia` incl. `bin\tylia.cmd`; PATH appended and still
  `REG_EXPAND_SZ` with `%NVM_HOME%` kept; `tylia --version` from a new console; the
  Explorer command opened a folder as a tab in the installed app. Silent installs added a
  desktop shortcut (Tauri does that when the finish page is skipped); the hook now removes
  it unless one existed before. Uninstall left nothing: `HKCU\Environment` byte-identical
  to before, no menu keys, shortcuts, files or uninstall entry; settings kept. Still to do:
  the interactive install with options unticked, an update over an older version, the
  MSI install._
- [ ] **winget:** manifest `Tylia.Tylia` (installer type `nullsoft`, user scope).
      Submitted to microsoft/winget-pkgs. The release workflow opens the update PR on
      each release (e.g. `vedantmgoyal9/winget-releaser`; verify the current action and
      its license first).
- [ ] **Scoop:** a bucket `gilgil28/scoop-bucket` with `tylia.json`, `checkver` and
      `autoupdate` against GitHub releases. The NSIS installer can't be "portable", so
      the manifest uses the release's plain zipped binary. **Decide**: add
      `uploadPlainBinary` and a zip to the release (recommendation: yes, a
      `Tylia_<v>_x64_portable.zip` with `tylia.exe`; settings still go to `%APPDATA%`).

macOS:

- [ ] **dmg** branding (B).
- [ ] **Homebrew cask** `tylia` in `gilgil28/homebrew-tap`, with url, sha256,
      `auto_updates true`, and a `zap` stanza for
      `~/Library/Application Support/dev.tylia.app`. Move it to homebrew-cask once the
      project meets its notability rules.
- [ ] **Unsigned apps:** the cask and README explain the Gatekeeper step until there is a
      Developer ID (docs/RELEASING.md).

Linux:

- [ ] **Desktop entry and AppStream:**
  - `Categories=Development;RevisionControl;`, `Keywords=git;version control;`,
    `StartupWMClass`, and `MimeType=inode/directory;`, so file managers offer "Open
    With Tylia" (D).
  - AppStream `dev.tylia.app.metainfo.xml` (summary, description, screenshots from B,
    releases from CHANGELOG, OARS, `content_rating`), validated with `appstreamcli
validate`.
  - Shipped in deb / rpm / AppImage (`bundle.linux.*.files` / desktop template).
- [ ] **AUR:**
  - **`tylia-bin`:** add the `.desktop` / metainfo checks.
  - **`tylia` (build from source):** `makedepends=(rust cargo nodejs pnpm git)`,
    `pnpm install --frozen-lockfile`, `pnpm tauri build --no-bundle`, then install the
    binary, the desktop file, metainfo, icons and licenses. Verify with makepkg in the
    Arch container used in Phase 6.
  - **Automation:** a release job pushes both packages to the AUR (an SSH deploy key as
    a secret), or `packaging/aur/update.sh` stays manual. **Decide** (recommendation:
    automate after the first manual release).
- [ ] **Flathub `dev.tylia.app`:**
  - **Decide how Git is found (recommendation in bold):**
    1. **Bundle Git in the Flatpak** (a manifest module built from the Git release
       tarball) and talk to the user's ssh-agent with `--socket=ssh-auth`. A sandbox
       that works on its own, and Flathub reviewers accept it.
    2. Run the host's Git with `flatpak-spawn --host git`
       (`--talk-name=org.freedesktop.Flatpak`): exact parity with the CLI, but it
       weakens the sandbox and Flathub may refuse it.

    Offer option 2 as Settings → Git → "Use the system's Git", only when running in a
    Flatpak.

  - **Permissions:** `--filesystem=home` (repositories live anywhere under home; explain
    in the submission), `--share=network`, `--socket=wayland`, `--socket=fallback-x11`,
    `--device=dri`, plus GPG agent access for signed commits.
  - **Credential helpers:** the system's Git Credential Manager / libsecret aren't
    reachable from the sandbox, so Tylia's askpass dialogs handle sign-in.
    `credential.helper=cache` (or libsecret via the portal, if available) is the
    default inside the Flatpak; document it.
  - **Updates:** in-app updates off (Flatpak updates through Software / Flathub).
    Detect `FLATPAK_ID` and say so in Settings → General.
  - **Manifest and verification:** the manifest lives in `packaging/flatpak/`, builds
    from the release tarball, and its generated cargo / npm sources are checked in.
    Verify with `flatpak-builder` (Docker or a Linux VM) and `flatpak run`.
- **Acceptance:**
  - Every channel installs v0.2.0 on a clean machine or container (Windows Sandbox for
    NSIS / MSI / winget / Scoop; the Arch container for both AUR packages;
    `flatpak-builder` for Flathub; a GitHub macOS runner for the cask / dmg).
  - Uninstall leaves no files except the user's settings (unless they chose to remove
    them).
  - In-app update is offered only where it can install, and every other channel says
    how to update.

#### D. OS integration

- [x] **One window, many tabs.** Opening Tylia again (or with a path) focuses the running
      window and opens the path as a tab (`tauri-plugin-single-instance`; verify its
      version and license; on Linux it uses D-Bus, which works in the Flatpak).
      _Done: tauri-plugin-single-instance 2.5.4 (MIT OR Apache-2.0). Real app, Windows: a
      second launch hands off in 335 ms and the running window opens its folder as a tab
      (ARCHITECTURE §5.19)._
- [ ] **Command line:**
  - **`tylia <path>`** (the path or any folder inside a repository) opens it; `tylia`
    alone shows the window; `tylia --help` / `--version`. Paths are resolved against
    the caller's working directory before they are handed to the running instance.
  - **Linux:** the binary is already on `PATH` (deb / rpm / AUR / Flatpak via `flatpak
run`).
  - **Windows:** an NSIS option "Add Tylia to PATH" (user `PATH`, removed on uninstall).
  - **macOS:** "Install the `tylia` command" in the palette, which links
    `/usr/local/bin/tylia` (asks for permission; same pattern as VS Code).
- [ ] **File managers:**
  - **Windows:** "Open in Tylia" on folders and folder backgrounds in Explorer
    (`HKCU\Software\Classes\Directory\shell\Tylia` and
    `Directory\Background\shell\Tylia`, with icon). Written by the NSIS hook and the
    WiX fragment, removed on uninstall. Windows 11 shows it under "Show more options";
    note that, since a top-level entry needs a packaged app (MSIX), which is out of scope.
  - **Linux:** `MimeType=inode/directory` (C) gives "Open With Tylia" in Nautilus,
    Dolphin and Thunar.
  - **macOS:** register folders as openable (`CFBundleDocumentTypes` with
    `public.folder`, role Viewer), so a folder dropped on the Dock icon, or opened via
    "Open With", opens as a tab.
- **Acceptance:** each entry point opens the right repository (or the welcome screen with
  "not a repository" for other folders) in the already-running window. Tested on
  Windows; Linux in the container under Xvfb with `gio open`; the macOS part on a CI
  runner (or marked unverified).

#### E. Power features (backlog)

- [ ] **Create and apply patches:**
  - **Create:** from one or more selected commits (`git format-patch`, to a folder the
    user picks) or from the working copy / staged changes (`git diff [--cached]
--binary` to a `.patch` file).
  - **Apply:** apply a `.patch` / `.diff` (or mailbox) file: first `git apply --check` /
    `git am --3way` dry-run style. Show what it touches, then apply, or with `am`
    create commits. Conflicts use the existing conflict banner.
  - **Tests:** tylia-git integration tests (binary files, renames, a patch that doesn't
    apply, CRLF).
- [ ] **Export an archive** of any commit, branch or tag, with
      `git archive --format=zip|tar.gz --prefix=<repo>-<ref>/`, to a file the user
      picks, from history / sidebar context menus and the palette. Integration tests check the archive's file list.
- [ ] **Custom actions** (Sourcetree's "custom actions"):
  - **Where:** user-defined commands in Settings → Actions.
  - **Each action has:** a name, a program, arguments with variables (`{repo}`,
    `{sha}`, `{shortSha}`, `{branch}`, `{file}`, `{files}`), where it appears (commit,
    file or branch menus; the palette), "ask before running" and "show output".
  - **How they run:** without a shell. The program is started with an argument list
    after substitution, so a variable can never inject commands (a file named
    `; rm -rf ~` stays one argument).
  - **Output:** in a panel, with exit code and stderr; failures toast with Details.
  - **Storage:** in `settings.json`.
  - **Tests:** unit tests for substitution and quoting; e2e with the mock; a real-app
    check with a harmless script.
- **Acceptance:** each feature is reachable from its context menus and the palette, has
  integration / unit tests and e2e coverage, and passes axe in both themes.

#### F. Carried over (needs the user's accounts or hardware)

- [ ] GitHub acceptance run (HTTPS token and SSH) once the repository is pushed (Phase 3).
- [ ] First real release: push `main` and a tag, check the draft and every asset,
      publish, and confirm tylia.dev's links (docs/RELEASING.md).
- [ ] macOS: run the dmg on a Mac (or a hosted runner with screenshots).
- [ ] Linux performance on the user's CachyOS machine: `git/git` first rows and
      scrolling, against the Phase 1 numbers.
- [ ] Code signing when certificates exist (Azure Trusted Signing / Apple Developer ID;
      docs/RELEASING.md).

#### Release

- [ ] CHANGELOG `[0.2.0]`, version bump in `package.json` and `Cargo.toml`, tag
      `v0.2.0`, release through every channel in C. Then update the ROADMAP status and
      stop for review.

## Feature inventory (Sourcetree parity reference)

Long-standing Sourcetree capabilities, used to judge completeness. ✅ = planned in the
phases above, ⏳ = later / backlog, ✗ = intentionally out of scope for v1.

| Area         | Capability                                                                          | Plan                                                       |
| ------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Repos        | Repository browser/bookmarks, recent list, tabs                                     | ✅ P1                                                      |
| Repos        | Clone, create, add existing; hosting-account browsing (GitHub/Bitbucket/GitLab)     | ✅ P3 / ⏳ accounts                                        |
| History      | Graph with branch lines, ref labels, all/current branch filter, date/ancestor order | ✅ P1                                                      |
| History      | Search by message/author/hash/file; jump to ref                                     | ✅ P1                                                      |
| History      | Commit details, file list, diff; copy hash; parents navigation                      | ✅ P1                                                      |
| Diff         | Unified/side-by-side, whitespace ignore, context lines, image diff                  | ✅ P1                                                      |
| Diff         | External diff tool                                                                  | ✅ P5                                                      |
| Working copy | File status with staged/unstaged lists, stage file/hunk/line, discard hunk/line     | ✅ P2                                                      |
| Working copy | Ignore file/pattern, stop tracking, open in file manager/terminal                   | ✅ P2                                                      |
| Commit       | Message box, amend, push immediately, commit message history, sign-off/sign         | ✅ P2                                                      |
| Remotes      | Fetch, pull (rebase option), push (tags, force), remotes management, ahead/behind   | ✅ P3                                                      |
| Branches     | Create/checkout/rename/delete/track, merge, rebase, cherry-pick, revert, reset      | ✅ P4                                                      |
| Tags         | Create/delete/push                                                                  | ✅ P4                                                      |
| Stash        | Save/apply/pop/drop/view                                                            | ✅ P4                                                      |
| Conflicts    | Banner, external merge tool, mark resolved, continue/abort                          | ✅ P4                                                      |
| Advanced     | Interactive rebase, blame ("Annotate"), log selected file                           | ✅ P5                                                      |
| Advanced     | Submodules, Git LFS, git-flow, hg-flow                                              | ✅ P5 (submodules) / ⏳ LFS / ✅ P6 git-flow / ✗ Mercurial |
| Advanced     | Custom actions (user scripts in context menu)                                       | ⏳ P7                                                      |
| Advanced     | Patch create/apply, archive export                                                  | ⏳ P7                                                      |
| Advanced     | Pull request creation on hosting providers                                          | ✗ v1                                                       |
| UX           | Terminal button, Explorer/Finder button, settings, themes                           | ✅                                                         |

If the user wants a stricter checklist, cross-check against Sourcetree's public release
notes (sourcetreeapp.com → release notes for Windows 3.x and macOS 4.x) and add rows.
