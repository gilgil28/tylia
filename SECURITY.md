# Security policy

## Supported versions

Tylia is pre-1.0. Security fixes go into the latest release and `main`. Update to the
newest version to get them.

| Version                | Supported |
| ---------------------- | --------- |
| Latest release (0.1.x) | Yes       |
| `main` (latest)        | Yes       |
| Anything older         | No        |

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately instead:

- **GitHub private vulnerability reporting:**
  https://github.com/gilgil28/tylia/security/advisories/new

Include what you can:

- affected commit or version, OS and Git version
- steps to reproduce, or a proof of concept
- the impact as you understand it

We will acknowledge the report, keep you updated while we work on a fix, and credit you in
the advisory unless you ask us not to. Please give us a reasonable amount of time to
release a fix before disclosing the issue publicly.

## Scope

Areas we are especially interested in:

- **Askpass bridge.** Tylia's own binary acts as `GIT_ASKPASS` / `SSH_ASKPASS` and relays
  credential and passphrase prompts to the UI over a local, per-session, authenticated
  channel. Anything that lets another process read or answer those prompts, or that causes
  a secret to be logged or persisted by Tylia, is in scope.
- **Git invocation.** Git is run as a process with an argument list, never through a
  shell; pathspecs are separated with `--` and ref names are validated. Argument or option
  injection through branch names, paths, remote URLs, commit messages or repository
  configuration is in scope.
- **Webview and CSP.** The frontend runs under a strict Content Security Policy with no
  remote scripts and no `unsafe-eval`, and commit messages and file contents are never
  rendered as HTML. Script injection, CSP bypasses and access to Tauri commands or
  capabilities beyond those the app defines are in scope.

Out of scope: vulnerabilities in Git itself, in your credential helper or SSH agent, or in
the operating system webview, unless Tylia makes them exploitable in a way they would not
be otherwise. Hooks and configuration inside a repository you open run as Git runs them;
that is Git's behaviour, not a Tylia vulnerability.

## Privacy

Tylia has no telemetry. It makes no network requests you did not trigger: network access
happens only for Git operations you start (fetch, pull, push, clone) and for features you
opt into, such as Gravatar avatars, which are off by default.
