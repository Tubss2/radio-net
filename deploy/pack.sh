#!/usr/bin/env bash
# Build deploy/radionet-src.tgz (server source + setup.sh + systemd units) for deploy.ps1 or a manual scp.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/radionet-src/deploy"
cp -r "$HERE/../spike/server" "$TMP/radionet-src/server"
rm -rf "$TMP/radionet-src/server/node_modules" "$TMP"/radionet-src/server/*.log
cp -r "$HERE/setup.sh" "$HERE/systemd" "$TMP/radionet-src/deploy/"
tar czf "$HERE/radionet-src.tgz" -C "$TMP" radionet-src
echo "wrote $HERE/radionet-src.tgz"
