#!/usr/bin/env bash
# Bundle the last N hours of Radio Net logs plus a metrics snapshot.
# Run on the VPS as root after setup.sh:
#   radionet-collect-logs 6
# Prints the archive path. The archive does not contain secrets.env.
set -euo pipefail

HOURS="${1:-6}"
[[ "$HOURS" =~ ^[0-9]+$ ]] || { echo "Hours must be a whole number" >&2; exit 1; }
if (( HOURS < 1 || HOURS > 168 )); then
  echo "Hours must be between 1 and 168" >&2
  exit 1
fi

SECRETS=/etc/radionet/secrets.env
[[ -r "$SECRETS" ]] || { echo "Cannot read $SECRETS (run as root on the server)" >&2; exit 1; }
# shellcheck disable=SC1090
source "$SECRETS"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROOT="$(mktemp -d)"
DEST="$ROOT/scale-$STAMP"
OUT_DIR=/var/lib/radionet/bundles
mkdir -p "$DEST" "$OUT_DIR"
trap 'rm -rf "$ROOT"' EXIT

{
  echo "collected_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "hours=$HOURS"
  echo "hostname=$(hostname)"
  uname -a || true
  echo
  echo "# memory"
  free -h || true
  echo
  echo "# load"
  uptime || true
  echo
  echo "# disk"
  df -h / /var || true
  echo
  echo "# listeners"
  ss -lntup || true
} > "$DEST/host.txt"

journalctl -u livekit -u radionet-api -u radionet-caddy -u prometheus -u node_exporter \
  --since "${HOURS} hours ago" --no-pager > "$DEST/journal.txt" || echo "journalctl failed" >> "$DEST/journal.txt"

if [[ -n "${METRICS_PASSWORD:-}" ]]; then
  netrc="$(mktemp)"
  chmod 600 "$netrc"
  printf 'machine 127.0.0.1 login metrics password %s\n' "$METRICS_PASSWORD" > "$netrc"
  curl -fsS --max-time 5 --netrc-file "$netrc" http://127.0.0.1:6789/metrics > "$DEST/livekit.prom" \
    || echo "# livekit metrics unavailable" > "$DEST/livekit.prom"
  rm -f "$netrc"
else
  echo "# METRICS_PASSWORD missing" > "$DEST/livekit.prom"
fi

curl -fsS --max-time 5 http://127.0.0.1:9100/metrics > "$DEST/node.prom" \
  || echo "# node metrics unavailable" > "$DEST/node.prom"

mkdir -p "$DEST/prom"
while IFS='|' read -r name query; do
  [[ -n "$name" ]] || continue
  curl -fsS --max-time 5 -G http://127.0.0.1:9090/api/v1/query --data-urlencode "query=${query}" \
    > "$DEST/prom/${name}.json" || echo '{"status":"error"}' > "$DEST/prom/${name}.json"
done <<'QUERIES'
participants|sum(livekit_participant_total)
rooms|sum(livekit_room_total)
cpu|100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))
ram|100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))
loss|histogram_quantile(0.95, sum by (le) (rate(livekit_packet_loss_percent_bucket[5m])))
jitter_us|histogram_quantile(0.95, sum by (le) (rate(livekit_jitter_us_bucket[5m])))
QUERIES

if [[ -d /var/lib/radionet/diagnostics ]]; then
  mkdir -p "$DEST/diagnostics"
  cp -a /var/lib/radionet/diagnostics/. "$DEST/diagnostics/" 2>/dev/null || true
fi

if [[ -f /var/log/caddy/access.log ]]; then
  cp -a /var/log/caddy/access.log "$DEST/caddy-access.log" || true
fi

find "$DEST" -name 'secrets.env' -delete
rm -f "$DEST/prometheus.yml"

ARCHIVE="$OUT_DIR/scale-$STAMP.tgz"
tar -czf "$ARCHIVE" -C "$ROOT" "scale-$STAMP"
chown root:root "$ARCHIVE"
chmod 600 "$ARCHIVE"
echo "$ARCHIVE"
