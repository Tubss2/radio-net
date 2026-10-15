#!/usr/bin/env bash
# Runs on the VPS. Writes /tmp/rn-backup.tgz and checks it contains secrets.env.
# deploy.ps1 -Backup and backup.sh upload this, then download the archive.
set -euo pipefail
test -s /etc/radionet/secrets.env
rm -f /tmp/rn-backup.tgz
paths=(etc/radionet)
if [[ -f /var/lib/radionet/store.json ]]; then
  paths+=(var/lib/radionet/store.json)
fi
tar czf /tmp/rn-backup.tgz -C / "${paths[@]}"
tar tzf /tmp/rn-backup.tgz | sed 's|^\./||' | grep -qx 'etc/radionet/secrets.env'
echo backup-ok
