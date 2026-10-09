#!/usr/bin/env bash
# Build deploy/radionet-src.tgz (server source + setup.sh + systemd units + optional UI preview)
# for deploy.ps1 or a manual scp.
# PREVIEW_DIST: folder with the built browser preview (spike/client `npm run preview:build` -> preview-dist,
# or the `ui-preview` Actions artifact). Defaults to ../spike/client/preview-dist when it exists.
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
  echo "including UI preview from $PREVIEW_DIST"
else
  echo "no UI preview found at $PREVIEW_DIST (skipping)"
fi
tar czf "$HERE/radionet-src.tgz" -C "$TMP" radionet-src
echo "wrote $HERE/radionet-src.tgz"
