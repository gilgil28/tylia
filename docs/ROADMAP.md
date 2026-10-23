# Tylia roadmap

Current phase: **Phase 9 — Workflow polish and hosting accounts** (2026-10-23: released as **v0.3.0** together with Phase 8, as one release instead of v0.3.0 and v0.4.0; untested against the real hosting APIs and a real LFS server; the OAuth device flow waits for the user's OAuth apps). Phase 8 is built and verified locally except what needs the user’s accounts, a Mac or Windows Sandbox. Phases 0–6 delivered; Phase 7 closed early on 2026-10-22 with **v0.2.0**, the first public release (https://github.com/gilgil28/tylia/releases/tag/v0.2.0), and the website at https://gilgil28.github.io/tylia/. The GitHub acceptance run from Phase 3 is still open.

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
small `target/`, and adds three long-requested power features. It ends with **v0.3.0**
(v0.2.0 shipped mid-phase, see "Release").

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

_Open items continue in Phase 8; the details below still apply._

Windows:

- [x] **NSIS `.exe`, the primary Windows download:**
  - **Install mode:** `installMode: "currentUser"` (no admin needed). **Decide**: also
    allow a per-machine install with `"both"` (recommendation: `"currentUser"`; the MSI
    covers managed per-machine installs).
  - **Shortcuts and uninstall:** Start Menu folder `Tylia`, a desktop shortcut as a
    checkbox (unchecked), and the uninstaller keeps the user's settings unless they
    tick a box. Ask NSIS: does it offer that? If not, use `installerHooks`.
  - **Language:** English only.
  - **Hooks:** `installerHooks` (`src-tauri/windows/hooks.nsh`) for OS integration (D).
- [x] **MSI:** the same branding and the same registry entries, via a WiX
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
  - **Website and README:** list the AUR packages again once they're published (the
    `tylia-bin` entry was removed on 2026-10-22 because it didn't exist yet).
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

_Open items continue in Phase 8; the details below still apply._

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

_Open items continue in Phase 8; the details below still apply._

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

_Open items continue in Phase 8; the details below still apply._

- [ ] GitHub acceptance run (HTTPS token and SSH) once the repository is pushed (Phase 3).
- [x] First real release: push `main` and a tag, check the draft and every asset,
      publish, and confirm the download links (docs/RELEASING.md). _v0.2.0 was released
      2026-10-22. No website domain for now: links point at the repository, and the
      site can go to https://gilgil28.github.io/tylia/ by hand._
- [ ] macOS: run the dmg on a Mac (or a hosted runner with screenshots).
- [ ] Linux performance on the user's CachyOS machine: `git/git` first rows and
      scrolling, against the Phase 1 numbers.
- [ ] Code signing when certificates exist (Azure Trusted Signing / Apple Developer ID;
      docs/RELEASING.md).

#### Release

- [x] **v0.2.0, the first public release** (2026-10-22, asked for mid-phase): workstreams
      A and B, the Windows installer integration and the command line / single instance.
      GitHub release assets only; the other channels in C come with v0.3.0.
- Status 2026-10-22: **closed early, at the user's request, with v0.2.0.**
  - **Done:**
    - **A, build hygiene:** clean `target/` 7.84 → 2.79 GB, tests build 177 → 127 s and
      run 118 → 80 s; CI's app check is a debug build (about 8 min → 36 s).
    - **B, artwork:** `pnpm artwork` (icons, NSIS / WiX images, dmg background, Open Graph
      image, README wordmark) and `pnpm shots:publish` (README and website screenshots
      at 2×). The README has a logo header.
    - **Windows installers:** per user, "Add the tylia command to PATH" and "Open in Tylia"
      options, no desktop shortcut by default or in silent installs, clean uninstall;
      tested with a real silent install on the dev machine. MSI: same entries for all
      users, tables checked, not installed.
    - **D, partly:** one window (single instance), `tylia <path>`, `--help`, `--version`,
      Explorer integration; macOS Finder / Dock open events (untested).
    - **Repository and release:** public at https://github.com/gilgil28/tylia (SSH remote,
      key `~/.ssh/id_ed25519_gilgil28` via the repository's `core.sshCommand`); v0.2.0
      published with installers for all three OSes and a signed `latest.json`;
      `latest.json` notes fixed in the workflow for later releases.
    - **Website:** no domain (tylia.dev was never registered); published at
      https://gilgil28.github.io/tylia/ by the Pages workflow on site changes and on
      every published release.
  - **Moved to Phase 8:** everything still unticked above.

### Phase 8 — Packages, power features and v0.3.0

**Goal:** Tylia installs from the package managers people use on every OS, opens from
every file manager and the command line, gains three power features, and has run for
real on Linux and macOS. It ends with **v0.3.0**.

**How to run this phase (clean session):**

- **Before starting:**
  - Read `CLAUDE.md`, this section, Phase 7 above (its sections C–F hold the details of
    the items below), `docs/RELEASING.md`, `CONTRIBUTING.md` → "Commits and branches",
    `docs/ARCHITECTURE.md` §5.19 and `docs/DESIGN.md`.
  - Ask the user which of the accounts below exist yet. Build and verify everything
    locally either way; publishing waits for them.
- **While working:**
  - One commit per feature, bug or fix, each on its own `<kind>/<topic>` branch (kinds:
    feat, fix, perf, refactor, docs, test, build, ci, deps, chore, release; `site` is an
    area, not a kind), fast-forwarded into `main`. The `commit-msg` hook checks both.
  - Push to `origin` (`git@github.com:gilgil28/tylia.git`) only when the user asks.
    The local `gh` CLI is logged in as the user's work account: it can read the public
    repository but not write to it or see drafts.
  - Verify every pinned version against crates.io / npm / the action's repository before
    adding it, and justify each new dependency in its commit body.
  - Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `cargo fmt --all -- --check`
    and clippy before every push: CI runs them on three OSes.
  - **Installers:** never drive an installer with synthetic key presses on the user's
    machine (an MSI got installed that way once). Use Windows Sandbox or a VM, or a silent
    per-user install only with the user's consent, backing up `%APPDATA%\dev.tylia.app`
    and `HKCU\Environment` first.
  - Docker Desktop is available: Ubuntu 22.04 (+ the git-core PPA) for Linux builds, the
    Arch container for `makepkg`. Use a throwaway updater key there.
- **Decided already:** Flatpak bundles Git (host Git as an opt-in setting); NSIS is per
  user; Scoop uses a portable zip; AUR updates stay manual until after the first one.
- **The user provides:** an AUR account with an SSH key; a fork of
  `microsoft/winget-pkgs`; empty repositories `gilgil28/homebrew-tap` and
  `gilgil28/scoop-bucket`; a Flathub submission (GitHub account).

#### A. Linux packages and integration (first)

- [x] **Desktop entry and AppStream:** finish branch `build/linux-desktop-metadata` (not
      merged): `packaging/linux/tylia.desktop` (`MimeType=inode/directory`,
      `Exec=tylia %F`), `dev.tylia.app.metainfo.xml` and `src-tauri/tauri.linux.conf.json`.
      Validate with `appstreamcli validate`, build deb / rpm / AppImage in the Ubuntu
      container, check each package's files, and that "Open With Tylia" appears for
      folders (`gio open` / `xdg-mime query default inode/directory` under Xvfb). Add a
      v0.2.0 entry to the metainfo `<releases>`. Details: Phase 7 C → Linux.
      _Done 2026-10-22 (ARCHITECTURE §5.19). The AppStream ID is the Flathub app ID,
      `io.github.gilgil28.tylia`, in every package. AppStream 1.2.1 validates the metainfo
      (with its URL checks); `desktop-file-validate` passes. Built in Ubuntu 22.04: the deb,
      rpm and AppImage each carry `Tylia.desktop`, the metainfo, icons and `/usr/bin/tylia`.
      With the deb installed, `gio mime inode/directory` lists Tylia; under Xvfb `gio open`
      on a repository started Tylia with it, and `tylia <subfolder of another repo>` handed
      off in 41 ms and opened it as a second tab. WM_CLASS is `tylia` / `Tylia` (and the
      Wayland app ID is `tylia`), which `StartupWMClass=tylia` matches; `apt remove` leaves
      no files._
- [ ] **AUR `tylia-bin`** (repackaged release `.deb`) and **`tylia`** (from source), with
      the desktop file, metainfo, icons and licenses; `makepkg -si` in the Arch container,
      then start the app under Xvfb. Publish with the user's AUR account. Then list the
      AUR packages again in the README and on the website (removed until they exist).
      _Built and checked 2026-10-22, not published (no AUR account yet; new registrations
      are paused, see docs/RELEASING.md). `packaging/aur/tylia` builds from the tag
      tarball; both packages built with makepkg in the Arch container, installed with
      `pacman -U`, opened a repository under Xvfb, and `pacman -R` left no files.
      `update.sh` bumps both. Left: the first push of each, then the README / website._
- [ ] **Flathub:**
  - [x] **Decide the app ID with the user:** `io.github.gilgil28.tylia` (2026-10-22). It
        is also the AppStream ID of every Linux package.
  - The rest as in Phase 7 C (bundled Git, permissions, credential helpers, updates off,
    manifest in `packaging/flatpak/`, `flatpak-builder` check).
    _Done 2026-10-22, not submitted (ARCHITECTURE §5.19, RELEASING → Flatpak). GNOME 51;
    Git 2.56 built in, `credential.helper=libsecret`; offline cargo / pnpm sources from
    `update-sources.sh`. Built and run with flatpak-builder in a privileged container: the
    bundled Git opens a repository, Settings says Flathub updates it. Opt-in "Use the
    system's Git" (flatpak-spawn, needs a `flatpak override`) verified there: 212 Git calls
    reached the host, and an HTTPS 401 brought up Tylia's sign-in dialog through the host
    helper script. flatpak-builder-lint wants exceptions for `--filesystem=home`,
    `ssh-auth` and `gpg-agent` (justification in RELEASING). **Blocked:** Flathub's
    rust-stable is 1.98, Tylia needs 1.99 (the test build used `--ignore-rust-version`).
    Known gap: "Open in terminal" finds no terminal inside the sandbox._

#### B. Windows and macOS channels

- [ ] **winget** `Tylia.Tylia` (installer type `nullsoft`, user scope; silent installs
      already add PATH and the Explorer menu and no desktop shortcut). Verify the update
      action and its license before using it (e.g. `vedantmgoyal9/winget-releaser`).
      _Manifests for 0.2.0 in `packaging/winget` (`winget validate` passes). winget-releaser
      is AGPL-3.0, so the **winget** workflow uses Microsoft's wingetcreate (MIT, pinned
      and checksummed) instead. Waiting for the fork and the first pull request by hand._
- [ ] **Scoop:** add a `Tylia_<v>_x64_portable.zip` (`tylia.exe` + `bin/tylia.cmd`) to the
      release workflow, then `tylia.json` in `gilgil28/scoop-bucket` with `checkver` and
      `autoupdate`.
      _The release workflow uploads the zip (with `portable.txt`, so Tylia never runs the
      installer from it; the update dialog says `scoop update tylia`); dry-run locally.
      `packaging/scoop/tylia.json` is ready; waiting for the bucket repository._
- [ ] **Homebrew cask** `tylia` in `gilgil28/homebrew-tap` (url, sha256,
      `auto_updates true`, `zap` for `~/Library/Application Support/dev.tylia.app`, the
      Gatekeeper note
      for unsigned apps).
      _`packaging/homebrew/tylia.rb` written (also links the `tylia` command);
      `packaging/release-manifests.sh` fills in Scoop, Homebrew and winget after a release.
      Not checked with `brew audit` (needs a Mac); waiting for the tap repository._
- [ ] **Windows installer, still to check** (Windows Sandbox if the user enables it): the
      interactive install with both options unticked, an update over 0.2.0 (choices kept),
      and the MSI install / uninstall.
      _Not done: Windows Sandbox isn't enabled on the dev machine._
- [x] **macOS command line:** "Install the `tylia` command" in the palette, linking
      `/usr/local/bin/tylia` (asks for permission).
      _Done 2026-10-22, unverified on a Mac (the macOS code only compiles there; its logic
      is unit-tested everywhere). Found on the way: the bundle declared no document types,
      so Finder / Dock folder opening couldn't work; `src-tauri/Info.plist` fixes that._
- **Acceptance:** each channel installs v0.3.0 on a clean machine or container (Windows
  Sandbox, the Arch container, `flatpak-builder`, a GitHub macOS runner); uninstall
  leaves only the user's settings; in-app updates are offered only where they can
  install, and other channels say how to update.

#### C. Power features

Details and tests: Phase 7 E.

- [x] **Create and apply patches** (`git format-patch` / `git diff --binary`;
      `git apply --check` / `git am --3way`).
      _Done 2026-10-22 (ARCHITECTURE §5.20): commit menu, Changes list buttons, palette,
      an apply dialog with the check, commits and files; `git am` is a new operation kind
      in the banner. Integration tests: binary, renames, CRLF, conflicts (continue /
      abort), a patch that doesn't apply. Commits from several selected commits wait for
      multi-selection in the history._
- [x] **Export an archive** of any commit, branch or tag (`git archive`).
      _Done 2026-10-22: commit, branch and tag menus, palette (current branch); zip or
      tar.gz by extension; integration tests read both archives' file lists._
- [x] **Custom actions:** user-defined programs with variables in context menus and the
      palette, run without a shell, output in a panel.
      _Done 2026-10-22: Settings → Actions; Rust splits and substitutes (unit tests incl. a
      `; rm -rf ~` file name), Stop kills a running action; real-app check with a `sh`
      script on Linux (confirm, output, exit code)._
- **Acceptance:** each is in its context menus and the palette, with integration / unit
  and e2e tests, and passes axe in both themes.

#### D. Real hardware and accounts (the user)

- [ ] Run 0.2.0 (or later) on the user's **CachyOS** machine: first run on a real Linux
      desktop, and `git/git` first rows and scrolling against the Phase 1 numbers.
      _2026-10-23, first start (0.3.0 build, NVIDIA RTX 3070, driver 615.78, Wayland):
      the window died with "Error 71 (Protocol error) dispatching to Wayland display".
      Worked around for 0.3.0 (see "Known issues"). The `git/git` numbers are still to
      do._
- [ ] Run the dmg on a **Mac** (unsigned: right-click → Open). Also exercises the Finder /
      Dock open events.
- [ ] **GitHub acceptance run** (Phase 3): fetch / pull / push to `gilgil28/tylia` from
      Tylia over HTTPS (token) and SSH.
- [ ] **Code signing** when certificates exist (docs/RELEASING.md).

#### Release

- [x] CHANGELOG `[0.3.0]`, version bump in `package.json` and `Cargo.toml`, tag `v0.3.0`
      (the user publishes the draft with Release label "None"), then the channels above.
      Check `latest.json` now carries the notes. Update this ROADMAP and stop for review.
      _2026-10-23: tagged `v0.3.0` with Phase 9 included (the user chose one release over
      two). Before the tag, a first run on the user's CachyOS machine found two Linux bugs,
      fixed in it: the NVIDIA / Wayland crash at start (see "Known issues") and "System"
      staying light on a dark KDE. The AUR package was built and installed there (icon,
      theme and live theme switching checked). The channels wait for the user's accounts._

### Phase 9 — Workflow polish, hosting accounts and v0.4.0

**Goal:** the everyday workflow feels right to people coming from Sourcetree: changes flow
upwards from Unstaged to Staged to the commit, and the history can act on several commits
at once. Signing in to a hosting account lists your repositories to clone. Git LFS gets a
UI, and the Flatpak and Linux packaging gaps found in Phase 8 are closed. It ends with
**v0.4.0**.

**How to run this phase (clean session):**

- **Before starting:** read `CLAUDE.md`, this section, `docs/DESIGN.md` (the Changes view,
  §4.x), `docs/ARCHITECTURE.md` §5.19–5.20 and `CONTRIBUTING.md` → "Commits and branches".
  The items marked **Decide** have a recommendation; confirm them with the user before
  building that part.
- **While working:** the Phase 8 rules apply: one commit per feature, bug or fix on its own
  `<kind>/<topic>` branch, fast-forwarded into `main`; push only when the user asks; verify
  every pinned version and justify each new dependency (what, why, license); run the CI
  checks before every push; screenshots in both themes for every visual change.
- **Phase 8 leftovers** that wait for the user's accounts, a Mac or Windows Sandbox stay in
  Phase 8 (A, B and D); do them whenever they become possible.

#### A. Changes flow upwards (first)

- [x] **Staged above Unstaged**, as in Sourcetree: unstaged and untracked files at the
      bottom, staged files above them, so staging moves a file up towards the commit.
      _Done 2026-10-22. Decided with the user: Conflicts stay on top, the commit box stays
      at the bottom. ↑ / ↓ cross between the lists (Shift extends within one); the lists
      have no shared split, so no saved layout to migrate. DESIGN.md, the README / website
      screenshots and e2e updated._
  - **Order of the lists:** Conflicts (when there are any) on top, then Staged, then
    Unstaged. **Decide** whether conflicts stay first (recommendation: yes, they block the
    commit) or go just above Unstaged.
  - **The commit message box:** today it sits under both lists. **Decide** (recommendation:
    keep it at the bottom of the left column, under Unstaged, as Sourcetree does, so the
    window layout stays put; the alternative is directly under Staged, which makes the
    upward flow literal but moves the box as the lists grow).
  - **Everything that knows the order follows it:** keyboard navigation between the lists
    (↑/↓ across the boundary, Tab order), drag and drop between them, "Stage all" /
    "Unstage all" and the new "Save … as a patch" buttons, the split between the lists and
    its saved size (migrate a saved layout instead of resetting it), empty states, and the
    toolbar Commit button's focus target.
  - **Docs and tests:** DESIGN.md's Changes wireframe and text, the e2e tests that rely on
    the order, `pnpm shots` and the published README / website screenshots
    (`pnpm shots:publish`).

#### B. Several commits at once

- [x] **Multi-select in the history:** Ctrl/Cmd+click toggles a commit, Shift+click and
      Shift+↑/↓ extend a range, Esc goes back to one. The selection model in
      `repo-store.ts` becomes a set with an anchor (today it is one commit).
  - **Details pane:** for several commits, a summary (how many, authors, date span) and the
    combined list of changed files; one commit shows as today.
  - **Menus act on the whole selection where that means something:** save as patches (a
    numbered `format-patch` series), cherry-pick (oldest first, one operation, the existing
    conflict banner), revert, copy hashes; single-commit items are disabled with a tooltip
    saying why.
  - **Tests:** unit tests for the selection model, e2e for the keyboard and mouse
    gestures, integration tests for the multi-commit patch series and cherry-pick.
  - _Done 2026-10-22 (ARCHITECTURE §5.21). Changed from the plan: the menu of a
    selection lists only what works on all of it (cherry-pick, revert, save as patches,
    copy hashes) instead of greying out single-commit items; a right-click outside the
    selection is that commit's own menu. Found on the way: muted text in a focused
    selection was under 4.5:1 in the light theme (fixed in its own commit)._

#### C. Hosting accounts

- [x] **Sign in to GitHub, GitLab and Bitbucket** to list your repositories in the Clone
      dialog (search, owner / organization filter) and clone with one click. This is the
      "⏳ accounts" item of the feature inventory.
  - **Decide how to sign in:** **an OAuth device flow** (recommended: no password or token
    to paste, revocable from the provider's settings; needs a registered OAuth app per
    provider) or a personal access token pasted by the user.
  - **Decide where tokens live:** **the OS keychain** (recommended: Windows Credential
    Manager, macOS Keychain, Secret Service; a new dependency such as `keyring`, license to
    check) or Git's credential helper.
  - **Privacy:** nothing is sent unless the user signs in or opens the list; Settings →
    Accounts shows each account, its scopes and "Sign out", which deletes the token. No
    avatars unless the existing Gravatar opt-in is on.
  - **Tests:** the API clients against recorded responses (no network in tests); e2e with
    the mock.
  - _Done 2026-10-22 with personal access tokens (ARCHITECTURE §5.21). Decided with the
    user: tokens only for now (a device flow needs OAuth apps registered by the user; add
    later), stored with Git's credential helpers rather than a keychain crate (keyring 4
    splits into a store crate per OS, with D-Bus on Linux). No new crates: `reqwest` and
    `rustls` were already built for the updater. Not done: an owner / organization filter
    (the search matches `owner/name`); showing each token's scopes. Untested against the
    real APIs, which needs the user's tokens._
- [ ] **OAuth device flow** for GitHub and GitLab, once the user has registered the OAuth
      apps (client IDs only; no secret ships).

#### D. Git LFS

- [x] **LFS beyond indicators:** detect `git lfs` and say when a repository needs it but it
      isn't installed; mark LFS files in Changes and the history; "Track with LFS…" for a
      file or extension (writes `.gitattributes`); pull / fetch LFS objects; file locks
      where the server supports them (lock, unlock, who holds a lock).
  - **Decide** whether locks are in scope (recommendation: yes for read-only display and
    lock / unlock on the selected file; no lock management screens).
  - **Tests:** integration tests on a temp repository with a local LFS remote
    (`git lfs` installed in CI), skipped with a message where it isn't.
  - _Done 2026-10-22 (ARCHITECTURE §5.21). Decided with the user: locks shown, with lock /
    unlock (a dialog lists them; only your own can be released). Integration tests cover
    marking and tracking (tracking skips without git-lfs); pull and locks need an LFS
    server, so their output parsing is unit-tested and the UI e2e-tested with the mock.
    Untested against a real LFS server._

#### E. Fixes found in Phase 8

- [x] **Flatpak: "Open in terminal"** runs the host's terminal through
      `flatpak-spawn --host` when the user granted the same permission as "Use the
      system's Git"; without it, the error explains how to grant it instead of "No
      terminal was found".
      _Done 2026-10-22: the usual candidates are looked up on the host
      (`command -v` through `flatpak-spawn`). Checked in the Flatpak container: without
      the override the error gives the `flatpak override` command; with it, the host's
      xterm opens in the repository._
- [x] **Flatpak: the system's Git without the permission:** opening a repository says that
      Tylia may not run the system's Git yet, with the `flatpak override` command and a
      link to Settings → Git, instead of "Couldn't open repository".
      _Done 2026-10-22, checked in the Flatpak container. The message names Settings → Git
      → "Use the system's Git" in words rather than linking to it (errors are plain text);
      the permission is probed once per run, as it only changes with a restart._
- [x] **Linux icons:** Tauri installs the 256-px icon as `256x256@2` (a 512-px slot), so it
      looks soft on HiDPI desktops. Install it as `hicolor/256x256` in the deb, rpm and
      AppImage (and check what `tauri icon` should generate), like the AUR and Flatpak
      packages already do.
      _Done 2026-10-22: the bundler names a slot after the PNG's pixels plus `@2` for an
      `@2x` file name, so `pnpm artwork` now saves `tauri icon`'s `128x128@2x.png` as
      `256x256.png`. Checked in the Ubuntu container: deb, rpm and AppImage install 32, 64,
      128, 256 and 512 with no `@2` slot._
- [x] **Faster review builds:** a `review` Cargo profile (release with `lto = "thin"` and
      `codegen-units = 16`) for local builds, documented in CONTRIBUTING.md; measure a
      rebuild after a one-line change against today's 238 s. Release builds keep full LTO.
      _Done 2026-10-22, changed from the plan: thin LTO only took a one-line rebuild from
      245 s to 205 s, so `review` has no LTO, 16 incremental codegen units: 55 s (64 s
      with the frontend through `pnpm build:review`). Measured on Windows, 4 jobs._
- **Acceptance:** each fix is checked where it applies (the Flatpak and Linux packages in
  the containers used in Phase 8), with tests where the code allows.

#### Release

- [x] ~~CHANGELOG `[0.4.0]`, version bump, tag `v0.4.0`~~ Released in **v0.3.0** with
      Phase 8 (2026-10-23, the user's choice); the OAuth device flow (C) is still open.

## Known issues

Workarounds that stand in for a real fix. Check each one now and then, and replace it
once the cause is fixed upstream.

- **NVIDIA on Wayland (Linux):** WebKitGTK's GPU buffers fail with NVIDIA's explicit
  sync, and the window dies at start with "Error 71 (Protocol error) dispatching to
  Wayland display" (found 2026-10-23: driver 615.78, WebKitGTK 2.54.1, CachyOS).
  _Workaround since 0.3.0:_ `nvidia_wayland_workaround` (`src-tauri/src/lib.rs`) sets
  `__NV_DISABLE_EXPLICIT_SYNC=1` when the NVIDIA driver is loaded on Wayland and the user
  hasn't set it (by exec'ing itself with it, as `unsafe_code` is forbidden). It keeps GPU rendering, unlike `WEBKIT_DISABLE_DMABUF_RENDERER=1` (CPU
  copies, on every GPU) or `GDK_BACKEND=x11` (blurry at fractional scales).
  - **Look for a real fix:** follow WebKitGTK's and NVIDIA's release notes for explicit
    sync on Wayland. With each new WebKitGTK or driver version, start Tylia with
    `__NV_DISABLE_EXPLICIT_SYNC=0` (the workaround leaves a set value alone). When it
    starts, limit the workaround to the versions that still need it, or remove it.

## Feature inventory (Sourcetree parity reference)

Long-standing Sourcetree capabilities, used to judge completeness. ✅ = planned in the
phases above, ⏳ = later / backlog, ✗ = intentionally out of scope for v1.

| Area         | Capability                                                                          | Plan                                                          |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Repos        | Repository browser/bookmarks, recent list, tabs                                     | ✅ P1                                                         |
| Repos        | Clone, create, add existing; hosting-account browsing (GitHub/Bitbucket/GitLab)     | ✅ P3 / ✅ P9 accounts                                        |
| History      | Graph with branch lines, ref labels, all/current branch filter, date/ancestor order | ✅ P1                                                         |
| History      | Search by message/author/hash/file; jump to ref                                     | ✅ P1                                                         |
| History      | Commit details, file list, diff; copy hash; parents navigation                      | ✅ P1                                                         |
| Diff         | Unified/side-by-side, whitespace ignore, context lines, image diff                  | ✅ P1                                                         |
| Diff         | External diff tool                                                                  | ✅ P5                                                         |
| Working copy | File status with staged/unstaged lists, stage file/hunk/line, discard hunk/line     | ✅ P2                                                         |
| Working copy | Ignore file/pattern, stop tracking, open in file manager/terminal                   | ✅ P2                                                         |
| Commit       | Message box, amend, push immediately, commit message history, sign-off/sign         | ✅ P2                                                         |
| Remotes      | Fetch, pull (rebase option), push (tags, force), remotes management, ahead/behind   | ✅ P3                                                         |
| Branches     | Create/checkout/rename/delete/track, merge, rebase, cherry-pick, revert, reset      | ✅ P4                                                         |
| Tags         | Create/delete/push                                                                  | ✅ P4                                                         |
| Stash        | Save/apply/pop/drop/view                                                            | ✅ P4                                                         |
| Conflicts    | Banner, external merge tool, mark resolved, continue/abort                          | ✅ P4                                                         |
| Advanced     | Interactive rebase, blame ("Annotate"), log selected file                           | ✅ P5                                                         |
| Advanced     | Submodules, Git LFS, git-flow, hg-flow                                              | ✅ P5 (submodules) / ✅ P9 LFS / ✅ P6 git-flow / ✗ Mercurial |
| Advanced     | Custom actions (user scripts in context menu)                                       | ✅ P8                                                         |
| Advanced     | Patch create/apply, archive export                                                  | ✅ P8                                                         |
| Advanced     | Pull request creation on hosting providers                                          | ✗ v1                                                          |
| UX           | Terminal button, Explorer/Finder button, settings, themes                           | ✅                                                            |

If the user wants a stricter checklist, cross-check against Sourcetree's public release
notes (sourcetreeapp.com → release notes for Windows 3.x and macOS 4.x) and add rows.
