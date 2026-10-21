# Contributing to Tylia

Thanks for your interest. Tylia is pre-alpha (Phase 0, foundations), so things move
quickly. Check [`docs/ROADMAP.md`](docs/ROADMAP.md) for the current phase before starting
on something larger, and open an issue first if you want to propose a feature.

Please follow the [code of conduct](CODE_OF_CONDUCT.md). Report security problems
privately as described in [SECURITY.md](SECURITY.md).

## Prerequisites

All platforms:

- **Rust** stable, installed with [rustup](https://rustup.rs). The repository's
  `rust-toolchain.toml` selects the channel.
- **Node.js 24 LTS**.
- **pnpm 12**: run `corepack enable` (uses the version pinned in `package.json`), or
  `npm install --global pnpm@12`.
- **Git 2.40 or newer** on your `PATH`.

### Windows

- **WebView2** runtime. It ships with Windows 11 and current Windows 10; otherwise install
  the Evergreen runtime from Microsoft.
- **Microsoft C++ Build Tools** (Visual Studio Build Tools) with the
  **"Desktop development with C++"** workload.

### macOS

- **Xcode Command Line Tools**: `xcode-select --install`.

### Linux: Arch / CachyOS

```sh
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool
```

### Linux: Debian / Ubuntu

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Getting started

```sh
git clone https://github.com/tylia-dev/tylia.git
cd tylia
pnpm install
pnpm tauri dev
```

## Commands

| Command                                                 | What it does                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm install`                                          | Install frontend dependencies                                       |
| `pnpm tauri dev`                                        | Run the app                                                         |
| `pnpm dev:web`                                          | Run the frontend in a browser against the mock backend              |
| `pnpm shots`                                            | Playwright screenshots, light and dark, into `e2e/__screenshots__/` |
| `pnpm test`                                             | Frontend tests (Vitest)                                             |
| `pnpm lint`                                             | ESLint                                                              |
| `pnpm format`                                           | Prettier                                                            |
| `pnpm typecheck`                                        | `tsc --noEmit`                                                      |
| `pnpm contrast`                                         | Check contrast of the design tokens                                 |
| `pnpm gen:types`                                        | Regenerate the TypeScript IPC bindings from Rust                    |
| `cargo test --workspace`                                | Rust tests                                                          |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust lints                                                          |
| `cargo fmt --all`                                       | Format Rust code                                                    |

CI runs all of these checks on Linux, Windows and macOS. It also fails if the generated
bindings in `src/ipc/bindings` are out of date, so commit the result of `pnpm gen:types`
(or `cargo test`) when you change IPC types.

## Disk space

Rust's build cache grows over time, mostly from old incremental-compilation sessions in
`target/debug/incremental`. A clean `cargo test --workspace` plus a `pnpm tauri dev` build
needs about 3 GB, and a release build another 2 GB. When `target/` gets large, run
`cargo clean` (the next build starts from scratch).

The workspace `Cargo.toml` keeps the cache small:

- `[profile.dev] debug = "line-tables-only"`: our crates keep file and line numbers for
  panics and backtraces, without full debug info.
- `[profile.dev.package."*"] debug = false`: dependencies carry no debug info.

To step through code in a debugger, turn full debug info back on for one build:
`cargo build --config 'profile.dev.debug=true' --config 'profile.dev.package."*".debug=true'`.

## Working rules

The full rules live in [`CLAUDE.md`](CLAUDE.md); they apply to human contributors too. The
design system is [`docs/DESIGN.md`](docs/DESIGN.md) and the architecture is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). In short:

- Colours, spacing, radii and fonts come from design tokens only. No raw hex values or
  magic numbers in components.
- All user-facing strings live in `src/i18n/en.ts`.
- Git is invoked only through the `tylia-git` runner: a process with an argument list,
  never a shell, `--` before pathspecs, ref names validated.
- Logic such as parsing, graph layout and patch building belongs in Rust, not the frontend.
- Never delete user data silently. Destructive actions confirm and explain the consequence.
- Every `tylia-git` feature gets integration tests on temporary repositories. They form
  one test binary, `crates/tylia-git/tests/it/`, with a module per area; add a new area
  as a module in `it/main.rs`, not as a new file under `tests/`. Run one area with
  `cargo test -p tylia-git --test it flow`.
- No telemetry, and no network requests the user did not trigger.
- Use platform-correct modifiers (Cmd on macOS, Ctrl elsewhere) and `std::path` for paths.
- Do not copy assets, text or branding from other Git clients.
- Remove unused imports and dead code in every change.

## Screenshots before UI pull requests

Any change that affects the UI must include screenshots. Run `pnpm shots`, review the
images in `e2e/__screenshots__/` against the checklist in `docs/DESIGN.md` in **both light
and dark themes**, and attach the relevant ones to the pull request.

## Dependencies

Only permissively licensed dependencies are accepted: MIT, Apache-2.0, BSD, ISC, OFL,
Zlib or MPL-2.0. No GPL code in the shipped app. Fewer dependencies are better: justify
each new one in the pull request (what it does, why it is needed instead of a few lines of
our own code, and its license). Versions are pinned exactly; see the pinned versions table
in `docs/ARCHITECTURE.md`.

## Commits and branches

`pnpm install` turns on a `commit-msg` hook (`.githooks/`) that checks both rules below;
CI checks them again for every pull request. The rules live in `scripts/conventions.ts`.

### Workflow

`main` is always releasable, and releases are tags on `main` (see
[docs/RELEASING.md](docs/RELEASING.md)). Work happens on short-lived branches that are
rebased on `main` and merged when they pass review and CI. Keep each branch to one change.
History stays linear: merge with `--ff-only` or squash, never with a merge commit.

### Branch names

`<kind>/<topic>` in lowercase kebab-case, optionally with an issue number:

| Kind       | For                                         | Example                    |
| ---------- | ------------------------------------------- | -------------------------- |
| `feat`     | a new feature or visible behaviour          | `feat/open-in-terminal`    |
| `fix`      | a bug fix                                   | `fix/123-crlf-staging`     |
| `perf`     | speed or memory, same behaviour             | `perf/history-first-rows`  |
| `refactor` | code structure, same behaviour              | `refactor/split-diff-view` |
| `docs`     | documentation only                          | `docs/releasing`           |
| `test`     | tests only                                  | `test/rebase-matrix`       |
| `build`    | build, packaging, tooling                   | `build/aur-deps`           |
| `ci`       | GitHub Actions                              | `ci/cache-playwright`      |
| `deps`     | dependency updates                          | `deps/tauri-2.13`          |
| `chore`    | anything else that isn't user-facing        | `chore/commit-conventions` |
| `release`  | preparing a release, when it needs a branch | `release/v0.2.0`           |

At most 60 characters. Bot branches (`dependabot/…`, `renovate/…`) are exempt.

### Commit messages

```
<area>: <summary>

<body: optional; why the change, not what the diff already says>
```

- **Subject:** one line of at most 72 characters. `<area>` is the part of the codebase
  (below). The summary is lowercase, in the imperative ("add", "fix", not "added",
  "fixes"), with no full stop: `graph: draw merge curves as beziers`. Add `!` after the
  area for a change that breaks users' expectations or data: `settings!: rename the
theme key`.
- **Body** (after a blank line), when the subject isn't enough: why the change is needed,
  what was considered, and anything a reviewer or a future reader needs. Wrap at 72.
- **New dependency:** the body must say what it does, why it's needed rather than a few
  lines of our own code, and its license (see [Dependencies](#dependencies)).
- Git's own subjects (`Merge …`, `Revert "…"`, `fixup! …`) are accepted.

Areas:

- **Features:** `a11y`, `branch`, `changes`, `commit`, `conflict`, `diff`, `file-view`,
  `flow`, `graph`, `history`, `i18n`, `palette`, `rebase`, `remote`, `repo`, `settings`,
  `sidebar`, `terminal`, `toolbar`, `update`, `welcome`.
- **Layers:**
  - `app`: the shell, window and state
  - `git`: `crates/tylia-git`
  - `ipc`: commands, bindings, mock
  - `ui`: design-system components and tokens
- **Project:** `build`, `ci`, `deps`, `docs`, `release`, `site` (the website), `test`.

A new area goes in `AREAS` in `scripts/conventions.ts`.

No sign-off is required: Tylia does not use a DCO.

## Pull requests

Fill in the pull request template. A change is done when it meets the definition of done
in `docs/ROADMAP.md`: tests added or updated, formatting, lints and type checks clean,
screenshots reviewed for UI changes, empty, loading and error states handled, and
keyboard access with visible focus.

## License

Tylia is licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed
as above, without any additional terms or conditions.
