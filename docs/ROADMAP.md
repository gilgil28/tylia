# Tylia roadmap

Current phase: **Phase 6 — Release** (built and verified locally; awaiting review). Phases 0–4 approved; Phase 5 delivered 2026-10-20. Phase 3's SSH acceptance passed locally on 2026-10-21; the GitHub run is still open.

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
| Advanced     | Custom actions (user scripts in context menu)                                       | ⏳                                                         |
| Advanced     | Patch create/apply, archive export                                                  | ⏳                                                         |
| Advanced     | Pull request creation on hosting providers                                          | ✗ v1                                                       |
| UX           | Terminal button, Explorer/Finder button, settings, themes                           | ✅                                                         |

If the user wants a stricter checklist, cross-check against Sourcetree's public release
notes (sourcetreeapp.com → release notes for Windows 3.x and macOS 4.x) and add rows.
