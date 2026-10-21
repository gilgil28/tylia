# Tylia

The Git client you would show someone to prove a GUI can be faster and clearer than the
command line: beautiful commit graph, effortless line-level staging, zero clutter.

Tylia is pronounced **TEE-lee-a**. The name is a respelling of _Tilia_, botanical Latin
for the linden tree.

Website: https://tylia.dev · Repository: https://github.com/tylia-dev/tylia

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/history-dark.png">
  <img width="1280" alt="Tylia's history view: the commit graph, a commit's details and its diff" src="docs/screenshots/history-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/changes-dark.png">
  <img width="1280" alt="Tylia's changes view: unstaged and staged files, a diff and the commit message" src="docs/screenshots/changes-light.png">
</picture>

## Status

**0.1.0, the first release.** History and graph, staging down to single lines, commits,
remotes with sign-in, branching, merge / rebase with per-block conflict resolution,
interactive rebase, blame, file history, git-flow helpers, a command palette and
rebindable shortcuts. See [`CHANGELOG.md`](CHANGELOG.md) for what's in each release and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for the plan.

## Download

Get the latest version from [tylia.dev](https://tylia.dev) or the
[releases page](https://github.com/tylia-dev/tylia/releases/latest):

- **Windows 10 and 11:** `Tylia_<version>_x64-setup.exe` (or the `.msi`).
- **macOS 12+:** `Tylia_<version>_universal.dmg` (Apple silicon and Intel).
- **Linux:** `.AppImage`, `.deb` or `.rpm`. On Arch and CachyOS, install
  [`tylia-bin`](https://aur.archlinux.org/packages/tylia-bin) from the AUR.

Tylia needs Git 2.40 or newer on your `PATH`. Builds are not code-signed yet:

- **Windows:** SmartScreen asks first. Choose **More info → Run anyway**.
- **macOS:** right-click the app and choose **Open** the first time.

See [docs/RELEASING.md](docs/RELEASING.md#code-signing-not-set-up-yet) for details.

## Principles

- **Calm by default.** Content first, chrome last. Colour is reserved for meaning.
- **The graph is the hero.** Legible at a glance and instant on huge repositories.
- **Keyboard-first, mouse-friendly.** Every action in a command palette and a shortcut.
- **Never lose work.** Destructive operations confirm and explain what will be lost.
- **Honest about Git.** Show the real command and the real error when something fails.
- **Fast.** Navigation feels instant; nothing blocks the UI.
- **Private.** No telemetry, no network requests you did not trigger.
- **Cross-platform, native-respectful.** One app on Linux, Windows and macOS that follows
  each platform's conventions.

Tylia is inspired by the workflow of Sourcetree; its design and code are its own. It uses
the system `git` binary, so hooks, credential helpers, signing and your Git config work
exactly as they do on the command line.

## Platforms

| OS                                                    | Webview       | Notes                              |
| ----------------------------------------------------- | ------------- | ---------------------------------- |
| Linux (Arch/CachyOS first-class, also Ubuntu, Fedora) | WebKitGTK 4.1 | Performance is measured here first |
| Windows 10 and 11                                     | WebView2      |                                    |
| macOS 12+ (Apple silicon and Intel)                   | WKWebView     |                                    |

Packages: AppImage, deb, rpm and AUR on Linux; an NSIS installer and an MSI on Windows; a
universal dmg on macOS. To build from source:

## Build from source

You need Rust stable (via rustup), Node.js 24 LTS, pnpm 12 and Git 2.40 or newer, plus:

- **Windows:** WebView2 runtime and the MSVC Build Tools with "Desktop development with C++".
- **macOS:** Xcode Command Line Tools.
- **Arch / CachyOS:** `webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool`
- **Debian / Ubuntu:** `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

Exact install commands are in [CONTRIBUTING.md](CONTRIBUTING.md#prerequisites).

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
| `pnpm test`                                             | Frontend tests                                                      |
| `pnpm lint`                                             | ESLint                                                              |
| `pnpm format`                                           | Prettier                                                            |
| `pnpm typecheck`                                        | TypeScript type check                                               |
| `pnpm contrast`                                         | Check contrast of the design tokens                                 |
| `pnpm gen:types`                                        | Regenerate the TypeScript IPC bindings from Rust                    |
| `cargo test --workspace`                                | Rust tests                                                          |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust lints                                                          |
| `cargo fmt --all`                                       | Format Rust code                                                    |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).
Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Privacy

Tylia has no telemetry. It only goes on the network for Git operations you start, such as
fetch, pull, push and clone, and for features you opt into. The update check is off by
default; when you turn it on (or press "Check now"), Tylia downloads the latest release's
`latest.json` from GitHub and sends nothing else. Avatars are off by default.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed
as above, without any additional terms or conditions.
