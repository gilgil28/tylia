# Releasing Tylia

How a version goes from a tag to installers, the website and the AUR. Tylia uses
[semantic versioning](https://semver.org); tags are `vX.Y.Z`.

## One-time setup

1. **Updater signing key.** Updates are verified with a minisign key pair. The public key
   is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. The private key must never
   be committed. Add two repository secrets (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of the private key file.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.

   The current key pair was generated on 2026-10-21 into `%USERPROFILE%\.tauri\` on the
   maintainer's machine (`tylia-updater.key`, `.key.pub`, and the password in
   `tylia-updater.password.txt`). Keep the key and password in a password manager, then
   delete the password file. **If the key is lost, installed copies can't verify any
   future update:** users would have to download the next version by hand. To rotate the
   key, run `pnpm tauri signer generate -w <file>`, put the new public key in
   `tauri.conf.json`, ship one release signed with the **old** key, and switch the secrets
   to the new key from the release after that.

2. **Website.** `website/` is published at **https://gilgil28.github.io/tylia/** by the
   **Pages** workflow (Settings → Pages → Source: "GitHub Actions"). It runs when the site
   changes on `main`, when a release is published (the download links name the version),
   and by hand (Actions → Pages → Run workflow). The project has no domain of its own.
   - **With a domain later:** add `website/CNAME` with the domain and set it under Settings →
     Pages → Custom domain (DNS: `A` records to 185.199.108.153–185.199.111.153, `AAAA` to
     2606:50c0:8000::153–2606:50c0:8003::153); tick **Enforce HTTPS** once the certificate
     is issued, and verify the domain for your account so nobody else can claim it. Then
     change `<base href>` in `website/404.html` to `/`, the absolute URLs in
     `website/index.html`, and the `homepage` fields.
3. **AUR.** Create the `tylia-bin` package on aur.archlinux.org with a maintainer SSH key.
   The package sources are in `packaging/aur/tylia-bin`.

## Making a release

1. Update `CHANGELOG.md`: move the entries from "Unreleased" into a new
   `## [X.Y.Z] - YYYY-MM-DD` section and update the links at the bottom. The release
   workflow uses that section as the release notes, and the update dialog shows it.
2. Set the version in `package.json` (the app's version, which `tauri.conf.json` reads)
   and in `Cargo.toml` (`[workspace.package] version`). Run `cargo check` so `Cargo.lock`
   follows. The workflow refuses a tag that doesn't match both.
3. Commit (`release: vX.Y.Z`), then tag and push:

   ```sh
   git tag -a vX.Y.Z -m "Tylia X.Y.Z"
   git push origin main vX.Y.Z
   ```

4. The **Release** workflow (`.github/workflows/release.yml`) creates a draft release and
   builds on all three OSes:
   - **Linux:** `.AppImage`, `.deb`, `.rpm`, built on Ubuntu 22.04 for the widest glibc
     support.
   - **Windows:** NSIS `-setup.exe` and `.msi`.
   - **macOS:** universal `.dmg` for Apple silicon and Intel.

   It also uploads the updater bundles with their `.sig` signatures, and `latest.json`,
   the manifest the update check reads. Its `notes` are the CHANGELOG section (shown in
   the update dialog). Because the release is a draft while the jobs run, its bundle URLs
   are GitHub API asset URLs (`api.github.com/.../releases/assets/<id>`); they serve the
   file to requests with `Accept: application/octet-stream`, which the updater sends.

5. Check the draft: every asset is there, and `latest.json` lists `linux-x86_64`,
   `windows-x86_64` and `darwin-*` entries. Install at least one build. Then **publish**
   the release (Release label: **None**; a pre-release would be skipped by
   `releases/latest`, which the update check and download links use). Publishing by hand
   matters: it starts the Pages workflow, which a release published by the workflow's own
   token would not.
6. Update the AUR package from an Arch machine or container:
   `packaging/aur/update.sh X.Y.Z`. Check `makepkg -si` installs and starts Tylia, then
   commit `PKGBUILD` and `.SRCINFO` and push them to `ssh://aur@aur.archlinux.org/tylia-bin.git`.

Installed copies with "Check for updates" on find the new version at their next start.
Anyone can check from Settings → General → "Check now". The check fetches
`https://github.com/gilgil28/tylia/releases/latest/download/latest.json`; the URL carries
no version or machine details. The bundle it points to is installed only if its signature
matches the public key built into the app.

## Code signing (not set up yet)

Release builds are **not code-signed** until certificates exist. What users see:

- **Windows:** SmartScreen shows "Windows protected your PC" for the installer. Users
  choose **More info → Run anyway**. Fixing this needs Authenticode signing:
  - **Azure Trusted Signing** (cheapest; an identity-validated organization), or
  - an OV/EV certificate on a hardware token or cloud HSM.

  Tauri signs during the build when `bundle.windows.signCommand` (for Trusted Signing, a
  `trusted-signing-cli` call) or `certificateThumbprint` is set. Add it to
  `tauri.release.conf.json` and the secrets to the Windows job. Reputation for a new
  certificate still builds up over the first downloads.

- **macOS:** Gatekeeper refuses an unsigned, un-notarized app downloaded from the web
  ("can't be opened because Apple cannot check it"). Users right-click the app → **Open**
  the first time, or allow it under System Settings → Privacy & Security → **Open
  Anyway**. Fixing this needs an Apple Developer Program membership and a **Developer ID
  Application** certificate. Set these secrets for the macOS job; tauri-action signs and
  notarizes when they are present:
  - `APPLE_CERTIFICATE` (base64 .p12)
  - `APPLE_CERTIFICATE_PASSWORD`
  - `APPLE_SIGNING_IDENTITY`
  - `APPLE_ID`
  - `APPLE_PASSWORD` (an app-specific password)
  - `APPLE_TEAM_ID`
- **Linux:** packages are not signed. GitHub shows each asset's SHA-256 digest on the
  release page, and the AUR package pins them. Signing the
  AppImage (`SIGN=1` with a GPG key) or the packages can come later.

Updates are protected separately from code signing: every update bundle carries a
minisign signature from the updater key, and the app refuses one that doesn't verify.

## Flatpak (later)

Not packaged yet. Tylia runs the system `git`, so in a Flatpak sandbox it would need
`flatpak-spawn --host git` (the `--talk-name=org.freedesktop.Flatpak` permission) or a
bundled Git, plus access to the repositories on disk (`--filesystem=home` or portals).
Both weaken the sandbox, so this needs a design decision first.
