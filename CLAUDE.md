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

## Docs

- `docs/ROADMAP.md` — vision, phases with checkboxes, feature inventory, definition of done
- `docs/DESIGN.md` — design system (§4.x)
- `docs/ARCHITECTURE.md` — platforms, stack + pinned versions, naming, architecture (§5.x)
- `docs/KICKOFF.md` — original kickoff plan (history; read only if needed)
