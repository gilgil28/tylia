#!/usr/bin/env bash
# Bumps tylia-bin to a published release: sets pkgver, resets pkgrel, fills in the checksums
# from the release assets and regenerates .SRCINFO (needs makepkg, i.e. an Arch system or
# container). Then commit and push the tylia-bin directory to aur.archlinux.org/tylia-bin.git.
#
#   ./update.sh 0.1.0
set -euo pipefail

version="${1:?usage: update.sh <version>}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "update.sh: not a version: $version" >&2
  exit 1
fi
cd "$(dirname "$0")/tylia-bin"

sed -i -e "s/^pkgver=.*/pkgver=${version}/" -e "s/^pkgrel=.*/pkgrel=1/" PKGBUILD
updpkgsums
makepkg --printsrcinfo > .SRCINFO
echo "tylia-bin is now at ${version}. Review the diff, then push it to the AUR."
