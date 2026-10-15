#!/usr/bin/env bash
# Simulate a Radio Net op against a LiveKit server.
# One process per channel: a few people talking (audio publishers) and listeners.
# Multi-net listeners are extra subscribers joined to every channel, which is how
# the web app tunes several nets (one LiveKit room per channel).
#
# Run this on a PC, not on the 2GB voice server. The Sydney box is refused
# unless RN_LOAD_TEST_CONFIRM=1.
#
#   LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
#     bash deploy/load-test.sh
#
#   RN_LOAD_TEST_CONFIRM=1 LIVEKIT_URL=wss://voice.5by5.app \
#     LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
#     ROOMS=4 TALKERS=2 LISTENERS=15 MULTI=10 DURATION=5m \
#     bash deploy/load-test.sh
set -euo pipefail

URL="${LIVEKIT_URL:-${1:-}}"
KEY="${LIVEKIT_API_KEY:-}"
SECRET="${LIVEKIT_API_SECRET:-}"
ROOMS="${ROOMS:-4}"
TALKERS="${TALKERS:-2}"
LISTENERS="${LISTENERS:-10}"
MULTI="${MULTI:-8}"
DURATION="${DURATION:-3m}"
PREFIX="${PREFIX:-rnscale}"
LK="${LK:-lk}"

if [[ -z "$URL" || -z "$KEY" || -z "$SECRET" ]]; then
  echo "Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET." >&2
  exit 1
fi
case "$URL" in
  *149.28.170.200*|*lk-149-28-170-200*|*voice.5by5.app*)
    if [[ "${RN_LOAD_TEST_CONFIRM:-}" != "1" ]]; then
      echo "Refusing the Sydney server. Read docs/SCALE-TEST-RUNBOOK.md and set RN_LOAD_TEST_CONFIRM=1." >&2
      exit 2
    fi
    ;;
esac
command -v "$LK" >/dev/null || { echo "Install the LiveKit CLI (lk) and put it on PATH." >&2; exit 1; }
[[ "$ROOMS" =~ ^[0-9]+$ && "$TALKERS" =~ ^[0-9]+$ && "$LISTENERS" =~ ^[0-9]+$ && "$MULTI" =~ ^[0-9]+$ ]] || {
  echo "ROOMS, TALKERS, LISTENERS, and MULTI must be whole numbers." >&2
  exit 1
}
if (( ROOMS < 1 || ROOMS > 16 || TALKERS > 30 || LISTENERS > 200 || MULTI > 80 )); then
  echo "Those counts are outside the script's safety cap." >&2
  exit 1
fi

peers=$(( ROOMS * (TALKERS + LISTENERS + MULTI) ))
echo "Channels: $ROOMS  talkers/channel: $TALKERS  listeners/channel: $LISTENERS  multi-net: $MULTI"
echo "Peer connections: about $peers   duration: $DURATION"
echo "Logs: /tmp/${PREFIX}-*.log"

pids=()
cleanup() {
  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_room() {
  local room="$1" pubs="$2" subs="$3" tag="$4"
  "$LK" load-test \
    --url "$URL" --api-key "$KEY" --api-secret "$SECRET" \
    --room "$room" \
    --audio-publishers "$pubs" \
    --subscribers "$subs" \
    --duration "$DURATION" \
    --num-per-second 5 \
    --identity-prefix "${PREFIX}-${tag}" \
    > "/tmp/${PREFIX}-${tag}.log" 2>&1 &
  pids+=("$!")
}

for i in $(seq 1 "$ROOMS"); do
  room="$(printf 'net-%02d' "$i")"
  start_room "$room" "$TALKERS" "$LISTENERS" "r${i}"
done

if (( MULTI > 0 )); then
  for i in $(seq 1 "$ROOMS"); do
    room="$(printf 'net-%02d' "$i")"
    start_room "$room" 0 "$MULTI" "multi-r${i}"
  done
fi

echo "Running ${#pids[@]} lk load-test processes. Ctrl-C stops them."
fail=0
for pid in "${pids[@]}"; do
  wait "$pid" || fail=1
done
trap - EXIT
if (( fail )); then
  echo "One or more load-test processes failed. See /tmp/${PREFIX}-*.log" >&2
  exit 1
fi
echo "Load test finished."
