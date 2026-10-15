#!/usr/bin/env bash
# Fixture checks for restore-backup.sh. No VPS.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTORE="$HERE/restore-backup.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

make_tree() {
  local root="$1"
  mkdir -p "$root/etc/radionet" "$root/var/lib/radionet"
  printf 'LIVEKIT_API_KEY=API123\nCOMMUNITY_SETUP_CODE=abcd-efgh-ijkl\n' > "$root/etc/radionet/secrets.env"
  printf '{"communities":[{"id":"wdnz"}]}\n' > "$root/var/lib/radionet/store.json"
}

assert_restored() {
  local dest="$1"
  grep -q 'LIVEKIT_API_KEY=API123' "$dest/etc/radionet/secrets.env"
  grep -q 'wdnz' "$dest/var/lib/radionet/store.json"
  [[ "$(stat -c '%a' "$dest/etc/radionet/secrets.env")" == "600" ]]
  [[ "$(stat -c '%a' "$dest/var/lib/radionet/store.json")" == "600" ]]
}

src="$work/src"
make_tree "$src"
archive="$work/ok.tgz"
tar czf "$archive" -C "$src" etc/radionet var/lib/radionet/store.json
dest="$work/dest"
mkdir -p "$dest"
bash "$RESTORE" "$archive" "$dest"
assert_restored "$dest"

secrets_only="$work/secrets-only.tgz"
tar czf "$secrets_only" -C "$src" etc/radionet
dest2="$work/dest2"
mkdir -p "$dest2"
out="$(bash "$RESTORE" "$secrets_only" "$dest2")"
[[ "$out" == *"no store.json"* ]]
[[ -f "$dest2/etc/radionet/secrets.env" ]]
[[ ! -e "$dest2/var/lib/radionet/store.json" ]]

python3 - <<PY
import io, tarfile
from pathlib import Path
work = Path("$work")
def pack(name, members):
    path = work / name
    with tarfile.open(path, "w:gz") as tar:
        for member, payload in members:
            info = tarfile.TarInfo(member)
            if payload is None:
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tar.addfile(info)
            else:
                data = payload.encode()
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    return path
secret = "LIVEKIT_API_KEY=API123\n"
pack("escape.tgz", [
    ("etc/radionet/secrets.env", secret),
    ("etc/radionet/../../tmp/pwned", "pwned\n"),
])
pack("cron.tgz", [
    ("etc/radionet/secrets.env", secret),
    ("etc/cron.d/radionet", "* * * * * root true\n"),
])
pack("absolute.tgz", [
    ("/etc/radionet/secrets.env", secret),
])
link = work / "linksrc"
(link / "etc/radionet").mkdir(parents=True)
(link / "etc/radionet/secrets.env").write_text(secret)
(link / "etc/radionet/passwd").symlink_to("/etc/passwd")
with tarfile.open(work / "symlink.tgz", "w:gz") as tar:
    tar.add(link / "etc", arcname="etc")
PY

refuse() {
  local name="$1"
  local dest="$work/refuse-$name"
  mkdir -p "$dest"
  if bash "$RESTORE" "$work/$name.tgz" "$dest" >"$work/$name.out" 2>"$work/$name.err"; then
    echo "expected $name to be refused" >&2
    exit 1
  fi
  [[ ! -e "$dest/etc/radionet/secrets.env" ]]
  [[ ! -e "$work/tmp/pwned" && ! -e /tmp/pwned ]]
}

badsec="$work/badsec"
mkdir -p "$badsec/etc/radionet"
printf 'LIVEKIT_API_KEY=$(reboot)\n' > "$badsec/etc/radionet/secrets.env"
tar czf "$work/inject.tgz" -C "$badsec" etc/radionet

refuse escape
refuse cron
refuse absolute
refuse symlink
refuse inject
grep -q 'simple assignment' "$work/inject.err"
grep -q 'Refusing' "$work/escape.err"
grep -q 'Refusing' "$work/symlink.err"

echo "restore-backup.test.sh ok"
