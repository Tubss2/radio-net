#!/usr/bin/env bash
# Put a Radio Net backup in place before setup.sh.
# The archive is relative paths: etc/radionet/ (secrets.env and the other
# config files) and, when the server had saved communities, var/lib/radionet/store.json.
# Extracting anywhere else, or following a link out of the archive, is refused.
#
#   restore-backup.sh /tmp/rn-backup.tgz            # writes under /
#   restore-backup.sh /tmp/rn-backup.tgz /tmp/dest  # writes under /tmp/dest (tests)
set -euo pipefail

ARCHIVE="${1:?usage: restore-backup.sh archive.tgz [dest-root]}"
DEST="${2:-/}"

[[ -f "$ARCHIVE" ]] || { echo "No archive: $ARCHIVE" >&2; exit 1; }
[[ -d "$DEST" ]] || { echo "No destination: $DEST" >&2; exit 1; }

allowed() {
  local m="$1"
  m="${m#./}"
  [[ "$m" != /* ]] || return 1
  [[ "$m" != *\\* ]] || return 1
  case "$m" in
    *..*) return 1 ;;
  esac
  local bare="${m%/}"
  case "$bare" in
    etc|etc/radionet|var|var/lib|var/lib/radionet) return 0 ;;
    etc/radionet/*|var/lib/radionet/store.json) return 0 ;;
    *) return 1 ;;
  esac
}

while IFS= read -r member || [[ -n "$member" ]]; do
  [[ -z "$member" ]] && continue
  if ! allowed "$member"; then
    echo "Refusing archive member: $member" >&2
    exit 1
  fi
done < <(tar tzf "$ARCHIVE")

stage="$(mktemp -d)"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT

# Root's tar would otherwise restore owners from the archive. Stay the current user
# until setup.sh chowns the files to the radionet user. Leading slashes are stripped
# by default; the member check above already refused absolute names and "..".
tar --restrict --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$stage"

if find "$stage" -mindepth 1 \( -type l -o -type p -o -type s -o -type b -o -type c \) | grep -q .; then
  echo "Refusing an archive that contains a link or a special file." >&2
  exit 1
fi
if find "$stage" -type f -links +1 | grep -q .; then
  echo "Refusing an archive that contains a hard link." >&2
  exit 1
fi

while IFS= read -r -d '' path; do
  rel="${path#"$stage"/}"
  if ! allowed "$rel"; then
    echo "Refusing extracted path: $rel" >&2
    exit 1
  fi
done < <(find "$stage" -mindepth 1 -print0)

secrets="$stage/etc/radionet/secrets.env"
[[ -f "$secrets" && ! -L "$secrets" && -s "$secrets" ]] || {
  echo "Archive has no etc/radionet/secrets.env" >&2
  exit 1
}
# setup.sh sources this file. Only simple KEY=value lines can be restored.
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  if [[ ! "$line" =~ ^[A-Z0-9_]+=[A-Za-z0-9-]+$ ]]; then
    echo "Refusing secrets.env line that is not a simple assignment." >&2
    exit 1
  fi
done < "$secrets"

mkdir -p "$DEST/etc/radionet" "$DEST/var/lib/radionet"
cp -a "$stage/etc/radionet/." "$DEST/etc/radionet/"
chmod 600 "$DEST/etc/radionet/secrets.env"
if [[ -f "$stage/var/lib/radionet/store.json" ]]; then
  cp -a "$stage/var/lib/radionet/store.json" "$DEST/var/lib/radionet/store.json"
  chmod 600 "$DEST/var/lib/radionet/store.json"
  echo "Restored /etc/radionet and /var/lib/radionet/store.json"
else
  echo "Restored /etc/radionet (archive had no store.json)"
fi
