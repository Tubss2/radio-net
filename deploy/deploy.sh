#!/usr/bin/env bash
# Push the Radio Net server to a fresh VPS and run setup.sh there.
#   ./deploy.sh root@203.0.113.10            (from the repo's deploy/, or anywhere)
#   ACME_EMAIL=you@example.com ./deploy.sh root@203.0.113.10
# Needs: ssh access to the VPS (key-based), rsync locally.
set -euo pipefail
TARGET="${1:?usage: deploy.sh user@host}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SRC="${SERVER_SRC:-$HERE/../spike/server}"
REMOTE=/opt/radionet-src
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)

# shellcheck disable=SC2029  # REMOTE expands locally on purpose
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p $REMOTE/deploy $REMOTE/server && (command -v rsync >/dev/null || (apt-get update -qq && apt-get install -y -qq rsync))"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" --exclude node_modules --exclude '*.log' "$SERVER_SRC/" "$TARGET:$REMOTE/server/"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$HERE/setup.sh" "$HERE/systemd" "$TARGET:$REMOTE/deploy/"
# shellcheck disable=SC2029  # values expand locally on purpose
ssh "${SSH_OPTS[@]}" "$TARGET" "ACME_EMAIL='${ACME_EMAIL:-}' PUBLIC_IP='${PUBLIC_IP:-}' API_HOST='${API_HOST:-}' LK_HOST='${LK_HOST:-}' bash $REMOTE/deploy/setup.sh"
