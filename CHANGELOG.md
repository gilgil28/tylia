# Changelog

All notable changes to Tylia are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Tylia uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor version
can change behaviour.

## [Unreleased]

### Added

- **Patches:**
  - **Save:** "Save as patch…" in a commit's menu writes it as a patch file
    (`git format-patch`, with author, date and message). A button on each Changes list
    saves the staged or unstaged changes.
  - **Apply:** "Apply patch…" (palette) shows what a patch file would change first: its
    commits, the files with line counts, and whether it applies cleanly, only with a
    merge, or not at all.
  - **Two ways to apply:** apply to the working copy, or create the patch's commits. When
    creating them stops on conflicts, the banner continues, skips or aborts, as for a
    rebase.
- **Export archive…** of any commit, branch or tag as a zip or tar.gz, from their menus or
  the palette (the current branch).
- **Custom actions** (Settings → Actions): your own programs in commit, branch and file
  menus and the palette.
  - **Arguments** can use the repository, commit, branch and selected files
    (`{repo}`, `{sha}`, `{shortSha}`, `{branch}`, `{file}`, `{files}`).
  - **Running:** they run without a shell, so a file name can never become a command.
    Optionally Tylia asks first (showing the exact command line), or shows the output,
    exit code and errors, with Stop.
- **Linux:** the deb, rpm and AppImage register Tylia for folders, so file managers offer
  "Open With Tylia", and carry AppStream metadata for software centres.
- **macOS:** "Install the tylia command" in the palette links `/usr/local/bin/tylia`
  (it asks for your password when needed). Folders open in Tylia from Finder's "Open
  With" and when dropped on the Dock icon.
- **Flatpak** (for Flathub): Tylia brings its own Git and keeps HTTPS sign-ins in your
  keyring. Settings → Git → "Use the system's Git" switches to the Git installed on your
  computer, with its credential helpers and tools, after a one-time permission. Updates
  come from Flathub.
- **Packages:** a portable zip on each release (for Scoop), and the manifests for Scoop,
  Homebrew, winget and the AUR (`tylia-bin` and `tylia`, built from source).
- **Several commits at once:** Ctrl/Cmd+click and Shift+click (or Shift+↑/↓) select more
  than one commit in the history; Esc goes back to one. The details pane sums them up
  (authors, dates, changed files), and their menu cherry-picks (oldest first), reverts
  (newest first), saves them as a numbered patch series or copies their hashes.
- **Hosting accounts** (Settings → Accounts): add a GitHub, GitLab or Bitbucket account
  with a personal access token (GitLab and GitHub Enterprise on your own server too). The
  Clone dialog then lists your repositories to search and clone. Tokens are kept by Git's
  credential helper; "Sign out" deletes them.
- **Git LFS:** LFS files are marked in Changes and in a commit's files; a file's menu
  tracks it, or its extension, with LFS. The toolbar's LFS menu pulls the LFS objects and
  lists the locks, where you can lock a file or release your own locks. Tylia says when a
  repository uses LFS but Git LFS isn't installed.

### Changed

- **Changes flow upwards:** Staged is now above Unstaged (conflicts stay on top), so
  staging moves a file up towards the commit box. ↑ / ↓ cross between the lists.
- Muted text in a focused selection is easier to read in the light theme.

- The update dialog says how to update copies installed with pacman (the AUR) or Scoop,
  instead of offering an installer that would leave a second copy.

### Fixed

- **Linux with an NVIDIA graphics card on Wayland:** Tylia no longer closes at start with
  "Error 71 (Protocol error)". Setting `__NV_DISABLE_EXPLICIT_SYNC` yourself overrides
  the fix.
- On Windows, cancelling a clone could leave the half-cloned folder behind.
- **Flatpak:** "Open in terminal" opens your computer's terminal (with the same one-time
  permission as "Use the system's Git") instead of saying none was found. With "Use the
  system's Git" on but not yet permitted, opening a repository explains how to allow it.
- **Linux:** the deb, rpm and AppImage install the 256-pixel icon in the right size slot,
  so it is sharp on HiDPI desktops.
- Remote URLs and key paths in Repository settings now use the code font.

## [0.2.0] - 2026-10-22

The first public release of Tylia, a calm, fast desktop Git client: a commit graph that
stays fast on large repositories, staging down to single lines, fetch / pull / push with
sign-in dialogs, branching with per-block conflict resolution, interactive rebase, blame,
file history, git-flow helpers and a command palette. It includes everything listed under
0.1.0 below (which was never published), plus the changes in this section.

**This is an early release.** It is used daily on Windows; read "Known limitations" below
before installing.

### Added

- **Open folders from the command line:** `tylia <path>` opens a repository, or any
  folder or file inside one, as a tab; `tylia --help` and `tylia --version` work too.
  Opening Tylia again, with or without a path, brings the running window forward instead
  of starting a second copy. On macOS, folders opened from Finder or dropped on the Dock
  icon open as tabs.
- **Windows installer options:** "Add the tylia command to PATH" and "Open in Tylia" in
  Explorer's menu for folders and folder backgrounds, both on by default. Uninstalling
  removes them; updates keep your choice. The MSI adds both for all users.
- **Open in terminal** (toolbar, palette, Ctrl/Cmd+Shift+T) opens your terminal in the
  repository folder. It uses Windows Terminal (else PowerShell) on Windows, Terminal on
  macOS, and `$TERMINAL` or your desktop's terminal on Linux. Settings → General →
  Terminal picks another program.
- **Search history by file:**
  - **What you can type:** a file or folder name finds it in any folder, case doesn't
    matter, and wildcards work (`*.gradle`, `src/**/*.rs`).
  - **Renames:** a single file's search follows them.
  - **Suggestions** come from every file and folder the history has had, so deleted and
    renamed files appear too, marked "History only". Your recent path searches are
    offered first.
  - **Prefixes:** typing `path:` (or `file:`, `author:`, `message:`, `hash:`) in the
    search box switches what it searches.
- **Commit button in the toolbar,** with the number of changed files. It opens Changes
  with the cursor in the message box (also Ctrl/Cmd+Shift+C).
- **Fetch's tooltip** says when you last fetched.
- **Repository settings** (toolbar, palette, the sidebar's Remotes header), with three
  sections:
  - **Remotes:** add, edit, rename and remove remotes, and switch one between HTTPS and
    SSH in one click.
  - **Authentication:** pick the SSH key this repository uses, or forget a saved HTTPS
    sign-in (after changing a token).
  - **Identity:** the name and email for commits in this repository.

### Changed

- **Windows:** the installer installs for your user account without administrator rights,
  and shows Tylia's own artwork. The desktop shortcut is now unticked by default, and
  silent installs (winget, for example) don't add one.
- The history search and the All / Current branch switch moved from the toolbar to their
  own row above the history.
- **Dark theme:** panels (sidebar, toolbar, headers) and menus are lighter, so they stand
  apart from the history and diffs. Grey text is slightly lighter to keep its contrast.
- **Settings** has its own button in the title bar. It replaces the theme menu: the theme
  is in Settings → General and in the palette.

### Fixed

- **Feedback after push, pull and fetch:**
  - A push, pull or fetch asked for while another one was running in the same
    repository was dropped without a word. It now says what to wait for.
  - A fetch you start now confirms success too.
  - After success, the button shows a check mark, and its tooltip keeps the last result
    with the time. Success messages stay up 6 seconds instead of 4.
- A button's tooltip no longer stays on screen after its menu closes with a click
  elsewhere.
- Dialogs no longer slide in from the left; they fade in where they open.

### Known limitations

- **Not code-signed yet.** Windows SmartScreen asks first (choose **More info → Run
  anyway**); on macOS, right-click the app and choose **Open** the first time.
- **macOS** builds pass the test suite on GitHub's runners but haven't been tried on a Mac
  yet. Please report what you find.
- **Linux** packages were tested in containers, not yet on a desktop.
- Tylia needs **Git 2.40 or newer** on your `PATH`.

## 0.1.0 - 2026-10-21 (not published)

The first version, built and tested locally; its contents shipped in 0.2.0.

### Added

- **History:** a commit graph drawn per lane with stable colours, streamed and virtualized
  for large repositories (85,000 commits on `git/git`). Search by message, author, hash or
  path. All branches or only the current one. First-parent highlight on hover, and jump to
  parent or child with Alt+↓ / Alt+↑. Resizable columns.
- **Commit details and diffs:** unified and side-by-side diffs with syntax highlighting,
  word-level emphasis, and image diffs. Changes-only by default, with "Show full file".
- **Working copy:** stage, unstage and discard files, hunks or single lines. Untracked
  files go to the OS trash when discarded. Commit, amend, commit-message history, push
  after commit. Hooks and GPG/SSH signing follow your Git config.
- **Remotes:** fetch, pull (merge, rebase or fast-forward only) and push with progress and
  cancel. Force push with lease after a confirmation. Sign-in and SSH passphrase prompts
  are app dialogs, and unknown host keys ask first. Optional background fetch. Add,
  rename, edit and remove remotes. Clone, and create a new repository.
- **Branching:** create, switch (with "stash and switch"), rename, delete and track
  branches. Merge, rebase, cherry-pick, revert and reset. Tags and stashes. Drag a branch
  onto another to merge or rebase.
- **Conflicts:** a banner for merges, rebases, cherry-picks and reverts in progress, with
  continue, skip and abort. Resolve per file or per conflict block, or open your
  configured merge tool.
- **Interactive rebase:** reorder by dragging, and pick, reword, edit, squash, fixup or
  drop each commit, with a preview of the result.
- **Blame and file history**, following renames.
- **git-flow helpers:** set up, then start and finish features, releases and hotfixes.
  Every merge is checked for conflicts before finishing starts. The settings use the
  same `gitflow.*` keys as the git-flow command-line tool.
- **Command palette** (Ctrl/Cmd+K) with every action. **Rebindable shortcuts**, using
  Cmd on macOS and Ctrl elsewhere.
- **Settings:** theme (system, light, dark), row density, font size, diff layout, tab
  width, date format, Git executable, and pull, fetch and push defaults.
- **Submodules** (open as a tab, update), a **worktree** list and a **Git LFS** indicator.
- **External diff tool** (`diff.guitool` / `diff.tool`).
- **Commit-graph offer** for large repositories that don't have one, which makes history
  load faster.
- **Opt-in update check:** off by default. When on, Tylia checks GitHub for a new release
  at start. "Check now" is in Settings and the palette. Updates are verified against
  Tylia's signing key before they're installed.
- **Accessibility:** screen-reader labels and roles, visible focus, reduced motion, and
  layouts that work at 200% zoom. Muted text meets 4.5:1 contrast.
- **Packages:** Windows installer (NSIS) and MSI, macOS universal dmg, Linux AppImage,
  deb and rpm, and an AUR package (`tylia-bin`).

[Unreleased]: https://github.com/gilgil28/tylia/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/gilgil28/tylia/releases/tag/v0.2.0
