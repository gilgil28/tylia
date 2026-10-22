#!/usr/bin/env bash
# After a release is published: points the Scoop manifest, the Homebrew cask and a new set
# of winget manifests at its assets, with their SHA-256 checksums. Then copy them to
# gilgil28/scoop-bucket (bucket/tylia.json), gilgil28/homebrew-tap (Casks/tylia.rb) and a
# winget-pkgs pull request (docs/RELEASING.md). The AUR and the Flatpak have their own
# scripts (aur/update.sh, flatpak/update-sources.sh).
#
#   packaging/release-manifests.sh 0.3.0
set -euo pipefail

version="${1:?usage: release-manifests.sh <version>}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release-manifests.sh: not a version: $version" >&2
  exit 1
fi
here="$(cd "$(dirname "$0")" && pwd)"
base="https://github.com/gilgil28/tylia/releases/download/v${version}"

sha256_of() {
  curl -sSfL "$1" | sha256sum | cut -d' ' -f1
}

# Scoop: the portable zip.
zip_sha="$(sha256_of "$base/Tylia_${version}_x64_portable.zip")"
sed -i -E \
  -e "s/(\"version\": \")[0-9.]+/\1${version}/" \
  -e "s#(releases/download/)v[0-9.]+/Tylia_[0-9.]+_x64_portable\.zip#\1v${version}/Tylia_${version}_x64_portable.zip#" \
  -e "s/(\"hash\": \")[0-9a-f]+/\1${zip_sha}/" \
  "$here/scoop/tylia.json"

# Homebrew: the universal dmg.
dmg_sha="$(sha256_of "$base/Tylia_${version}_universal.dmg")"
sed -i -E \
  -e "s/^(  version \")[0-9.]+/\1${version}/" \
  -e "s/^(  sha256 \")[0-9a-f]+/\1${dmg_sha}/" \
  "$here/homebrew/tylia.rb"

# winget: a copy of the latest manifests under the new version (multi-file format).
winget="$here/winget/manifests/t/Tylia/Tylia"
latest="$(ls "$winget" | sort -V | tail -n 1)"
if [ "$latest" != "$version" ]; then
  exe_sha="$(sha256_of "$base/Tylia_${version}_x64-setup.exe" | tr '[:lower:]' '[:upper:]')"
  rm -rf "${winget:?}/$version"
  cp -r "$winget/$latest" "$winget/$version"
  for f in "$winget/$version"/*.yaml; do
    sed -i -E \
      -e "s/^PackageVersion: .*/PackageVersion: ${version}/" \
      -e "s#v${latest}/Tylia_${latest}_x64-setup\.exe#v${version}/Tylia_${version}_x64-setup.exe#" \
      -e "s/^(    InstallerSha256: ).*/\1${exe_sha}/" \
      -e "s/^ReleaseDate: .*/ReleaseDate: $(date -u +%Y-%m-%d)/" \
      -e "s#releases/tag/v${latest}#releases/tag/v${version}#" \
      "$f"
  done
  rm -rf "${winget:?}/$latest"
fi

echo "Scoop, Homebrew and winget manifests now point at v${version}. Review the diff."
