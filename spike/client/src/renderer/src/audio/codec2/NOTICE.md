# Codec2

This directory holds Codec2 1.2.0, commit `06d4c11`, built as a standalone WebAssembly module (`codec2.wasm`).

Codec2 is free software under the GNU Lesser General Public License, version 2.1. The licence text is `LICENSE` in this directory. Source: <https://github.com/drowe67/codec2>.

Radio Net does not link Codec2 into the main script. The Digital preset fetches this module and compiles it inside an AudioWorklet. You can replace `codec2.wasm` with your own build of the same exports. `build-wasm.sh` records that build.

The generated codebook C files come from a native Codec2 build. They are not committed.
