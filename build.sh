#!/usr/bin/env bash
# Build Polyarena for upload: copies only the files the game needs into a
# clean folder (default: dist/). There is no compile step; the game is plain
# HTML/CSS/JS with three.js vendored, and every asset path is relative, so
# the folder runs from any static host or sub-path.
#
#   ./build.sh            -> dist/
#   ./build.sh some/dir   -> some/dir/
#
# Left out: tools/, the source FBX/zip uploads, README, git and CI files.

set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-dist}"

rm -rf "$OUT"
mkdir -p "$OUT/assets/models" "$OUT/assets/anims"

cp index.html sw.js manifest.json "$OUT/"
cp -R css js vendor fonts icons "$OUT/"
cp assets/models/*.bin "$OUT/assets/models/"
cp assets/anims/anims.json assets/anims/anims.bin "$OUT/assets/anims/"

files=$(find "$OUT" -type f | wc -l | tr -d ' ')
size=$(du -sh "$OUT" | cut -f1)
echo "Built $OUT/  ($files files, $size)"
echo "File types: $(find "$OUT" -type f -name '*.*' | sed 's/.*\.//' | sort -u | tr '\n' ' ')"
