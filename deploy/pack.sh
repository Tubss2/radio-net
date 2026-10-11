#!/usr/bin/env bash
# Build deploy/radionet-src.tgz (server source + setup.sh + systemd units)
# for deploy.ps1 or a manual scp.
# A leftover preview-dist is still packed when it exists, so an old tree does not
# change shape. That server mock is retired. The web app is
# https://tubss2.github.io/radio-net/
# PREVIEW_DIST defaults to ../spike/client/preview-dist when that folder exists.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREVIEW_DIST="${PREVIEW_DIST:-$HERE/../spike/client/preview-dist}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/radionet-src/deploy"
cp -r "$HERE/../spike/server" "$TMP/radionet-src/server"
rm -rf "$TMP/radionet-src/server/node_modules" "$TMP"/radionet-src/server/*.log
cp -r "$HERE/setup.sh" "$HERE/systemd" "$TMP/radionet-src/deploy/"
if [[ -f "$PREVIEW_DIST/index.html" ]]; then
  if grep -q 'src="/' "$PREVIEW_DIST/index.html"; then
    echo "Preview build uses absolute asset paths; rebuild with base './' (npm run preview:build)" >&2; exit 1
  fi
  cp -r "$PREVIEW_DIST" "$TMP/radionet-src/preview"
  echo "packed a retired mock from $PREVIEW_DIST (not the web app)"
else
  echo "no retired mock at $PREVIEW_DIST (skipping)"
fi
tar czf "$HERE/radionet-src.tgz" -C "$TMP" radionet-src
echo "wrote $HERE/radionet-src.tgz"
