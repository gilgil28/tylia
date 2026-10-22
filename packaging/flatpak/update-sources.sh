#!/usr/bin/env bash
# Regenerates the Flatpak's offline sources from Cargo.lock and pnpm-lock.yaml, and with a
# version also points the manifest at that release's source tarball:
#
#   ./update-sources.sh          # after a dependency change
#   ./update-sources.sh 0.3.0    # after tagging a release
#
# Needs git, python3, pipx and curl. Uses flatpak-builder-tools (MIT) at a pinned commit.
set -euo pipefail

tools_commit=74697c75b630d7330e77250fc13cb5ea688d9479
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone -q https://github.com/flatpak/flatpak-builder-tools.git "$work/tools"
git -C "$work/tools" checkout -q "$tools_commit"

python3 "$work/tools/cargo/flatpak-cargo-generator.py" "$root/Cargo.lock" \
  -o "$here/cargo-sources.json"
# pnpm 12 keeps a v9 lockfile but a v11 store.
pipx run --spec "$work/tools/node" flatpak-node-generator pnpm "$root/pnpm-lock.yaml" \
  --pnpm-store-version v11 -o "$work/node-sources.json"
# Playwright's browsers are for the screenshot tests only; the build never runs them.
python3 - "$work/node-sources.json" "$here/node-sources.json" <<'PY'
import json, sys
sources = json.load(open(sys.argv[1]))
kept = [s for s in sources if "ms-playwright" not in s.get("dest", "")]
json.dump(kept, open(sys.argv[2], "w"), indent=4)
open(sys.argv[2], "a").write("\n")
print(f"node-sources.json: {len(kept)} sources ({len(sources) - len(kept)} Playwright ones left out)")
PY

if [ -n "${1:-}" ]; then
  version="$1"
  url="https://github.com/gilgil28/tylia/archive/refs/tags/v${version}.tar.gz"
  sha="$(curl -sSfL "$url" | sha256sum | cut -d' ' -f1)"
  sed -i -E \
    -e "s#(url: https://github.com/gilgil28/tylia/archive/refs/tags/)v[0-9.]+\.tar\.gz#\1v${version}.tar.gz#" \
    -e "/tags\/v${version}\.tar\.gz/,/sha256:/{/# Filled in by/d;s/sha256: \"?[0-9a-f]+\"?/sha256: ${sha}/}" \
    "$here/io.github.gilgil28.tylia.yml"
  echo "The manifest now builds v${version} (sha256 ${sha})."
fi
