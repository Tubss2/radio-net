#!/bin/sh
# Rebuild codec2.wasm from Codec2 1.2.0 (commit 06d4c11).
# Needs emsdk, cmake, and a C compiler. Run from this directory.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
SRC="${CODEC2_SRC:-/tmp/codec2}"
NATIVE="${CODEC2_NATIVE:-/tmp/codec2-native}"
COMMIT="06d4c11"

if [ ! -f "$SRC/src/codec2.c" ]; then
  git clone --depth 1 --branch 1.2.0 https://github.com/drowe67/codec2.git "$SRC"
fi
git -C "$SRC" checkout "$COMMIT"

if [ ! -f "$NATIVE/src/codebook.c" ]; then
  cmake -S "$SRC" -B "$NATIVE" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$NATIVE" --target codec2
fi

# shellcheck disable=SC1091
. "${EMSDK:-/tmp/emsdk}/emsdk_env.sh"

SRCS="
  codec2.c quantise.c pack.c lpc.c lsp.c nlp.c sine.c postfilter.c phase.c
  interp.c kiss_fft.c kiss_fftr.c codec2_fft.c newamp1.c mbest.c dump.c
"
set -- "$ROOT/c2_wasm.c"
for name in $SRCS; do
  set -- "$@" "$SRC/src/$name"
done
for name in codebook.c codebookd.c codebookjmv.c codebookge.c codebooknewamp1.c codebooknewamp1_energy.c; do
  set -- "$@" "$NATIVE/src/$name"
done

emcc -O2 -DNDEBUG -DGIT_HASH=\"$COMMIT\" \
  -I "$SRC/src" -I "$NATIVE" \
  "$@" \
  -s STANDALONE_WASM=1 \
  -s EXPORTED_FUNCTIONS='["_c2_open","_c2_close","_c2_samples","_c2_bytes","_c2_in","_c2_out","_c2_process","_malloc","_free"]' \
  -s INITIAL_MEMORY=2097152 \
  -Wl,--no-entry \
  -o "$ROOT/codec2.wasm"

echo "wrote $ROOT/codec2.wasm"
