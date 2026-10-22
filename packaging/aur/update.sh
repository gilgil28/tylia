#!/usr/bin/env bash
# Bumps the AUR packages to a published release: sets pkgver, resets pkgrel, fills in the
# checksums from the release assets and regenerates .SRCINFO (needs makepkg, i.e. an Arch
# system or container). Then commit and push each directory to its AUR repository:
#   tylia-bin -> ssh://aur@aur.archlinux.org/tylia-bin.git (repackages the release .deb)
#   tylia     -> ssh://aur@aur.archlinux.org/tylia.git     (builds from the tag's source)
#
#   ./update.sh 0.3.0
set -euo pipefail

version="${1:?usage: update.sh <version>}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "update.sh: not a version: $version" >&2
  exit 1
fi
for pkg in tylia-bin tylia; do
  (
    cd "$(dirname "$0")/$pkg"
    sed -i -e "s/^pkgver=.*/pkgver=${version}/" -e "s/^pkgrel=.*/pkgrel=1/" PKGBUILD
    updpkgsums
    makepkg --printsrcinfo > .SRCINFO
  )
done
echo "tylia-bin and tylia are now at ${version}. Review the diff, then push them to the AUR."
