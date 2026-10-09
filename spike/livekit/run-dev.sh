#!/usr/bin/env bash
# Local LiveKit server in dev mode (API key "devkey", secret "secret"). Linux x64 dev only.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x bin/livekit-server ]; then
  mkdir -p bin
  curl -sL https://github.com/livekit/livekit/releases/download/v1.13.9/livekit_1.13.9_linux_amd64.tar.gz | tar xz -C bin
fi
exec bin/livekit-server --dev --bind 127.0.0.1
