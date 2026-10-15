#!/usr/bin/env bash
# Copy /etc/radionet and /var/lib/radionet/store.json off the VPS before it is deleted.
# The tarball contains LiveKit keys, the setup code, the monitor password, and communities.
# Do not commit it.
#
#   ./backup.sh root@203.0.113.10
#   ./backup.sh root@203.0.113.10 "$HOME/radio-net-deploy/rn-backup.tgz"
set -euo pipefail
TARGET="${1:?usage: backup.sh user@host [outfile]}"
OUT="${2:-rn-backup.tgz}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$(dirname "$OUT")"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
scp "${SSH_OPTS[@]}" "$HERE/backup-remote.sh" "$TARGET:/tmp/backup-remote.sh"
ssh "${SSH_OPTS[@]}" "$TARGET" "bash /tmp/backup-remote.sh && rm -f /tmp/backup-remote.sh"
scp "${SSH_OPTS[@]}" "$TARGET:/tmp/rn-backup.tgz" "$OUT"
ssh "${SSH_OPTS[@]}" "$TARGET" "rm -f /tmp/rn-backup.tgz"
echo "Wrote $OUT"
echo "This file contains server secrets. Keep it off git, then delete the VPS."
