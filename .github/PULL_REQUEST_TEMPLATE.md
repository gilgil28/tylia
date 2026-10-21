## Summary

<!-- What does this change do, and why? Link the issue or ROADMAP item. -->

## Checklist

- [ ] Tests added or updated for new behaviour
- [ ] `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` pass
- [ ] `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` pass
- [ ] Generated IPC bindings are up to date (`pnpm gen:types`), if IPC types changed
- [ ] UI changes: `pnpm shots` run and screenshots reviewed in both light and dark themes, attached below
- [ ] Empty, loading and error states handled
- [ ] Keyboard reachable, focus visible
- [ ] User-facing strings in `src/i18n/en.ts`; design tokens only; no dead code
- [ ] New dependencies justified below, with their license (MIT, Apache-2.0, BSD, ISC, OFL, Zlib or MPL-2.0)
- [ ] ROADMAP checkbox ticked; DESIGN or ARCHITECTURE updated if a decision changed

## Screenshots

<!-- Light and dark, for UI changes. Delete this section otherwise. -->

## New dependencies

<!-- Name, version, license and why it is needed. Delete this section if none. -->
