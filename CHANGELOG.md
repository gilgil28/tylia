# Changelog

All notable changes to Tylia are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Tylia uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor version
can change behaviour.

## [Unreleased]

### Added

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

## [0.1.0] - 2026-10-21

The first release.

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

[Unreleased]: https://github.com/gilgil28/tylia/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gilgil28/tylia/releases/tag/v0.1.0
