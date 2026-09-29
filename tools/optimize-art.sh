#!/usr/bin/env bash
# Downscale + convert the generated art set for the web bundle.
#
# Codex emits 1774x887 PNGs around 2-3 MB each. Shipped raw that is ~20 MB of
# PNG for a game whose whole stage is a handful of quads, on a phone-first
# project. These are backgrounds and VFX, never magnified past roughly the
# viewport, so WebP at a sane cap is the right trade.
#
# Source of truth stays assets/generated/. This writes apps/game/public/generated/.
set -euo pipefail

# The repo root is derived from this script's own location so a clone, a
# worktree, or a different checkout all work without editing anything.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/assets/generated"
DST="$ROOT/apps/game/public/generated"
MANIFEST="$SCRIPT_DIR/art-manifest.tsv"

[ -f "$MANIFEST" ] || { echo "missing asset manifest: $MANIFEST" >&2; exit 1; }

mkdir -p "$DST"

total_before=0
total_after=0
missing=()
converted=0

# name, maxWidth, alpha all come from the manifest. The alpha column is an
# explicit decision per asset rather than a name-prefix guess, because a new
# asset would otherwise silently inherit the wrong channel policy.
while IFS=$'\t' read -r name maxw alpha _prompt; do
  case "$name" in ''|'#'*) continue ;; esac
  in="$SRC/$name.png"
  if [ ! -s "$in" ]; then
    missing+=("$name")
    continue
  fi

  before=$(stat -f%z "$in")
  tmp="$DST/.$name.webp"

  if [ "$alpha" = "yes" ]; then
    cwebp -quiet -q 82 -resize "$maxw" 0 -alpha_q 90 "$in" -o "$tmp"
  else
    cwebp -quiet -q 84 -resize "$maxw" 0 -m 6 "$in" -o "$tmp"
  fi

  mv "$tmp" "$DST/$name.webp"
  after=$(stat -f%z "$DST/$name.webp")
  total_before=$((total_before + before))
  total_after=$((total_after + after))
  converted=$((converted + 1))
  printf '%-24s %6.1f KB -> %6.1f KB  (%.0f%% saved)\n' \
    "$name.webp" "$(echo "$before" | awk '{print $1/1024}')" \
    "$(echo "$after" | awk '{print $1/1024}')" \
    "$(echo "$before $after" | awk '{print (1-$2/$1)*100}')"
done < "$MANIFEST"

if [ "${#missing[@]}" -gt 0 ]; then
  # A manifest row with no source PNG used to be skipped silently, which left a
  # shipped asset stale with no signal. Name every one and fail the run.
  printf '\nmissing source PNG for %d manifest row(s):\n' "${#missing[@]}" >&2
  for name in "${missing[@]}"; do
    printf '  %s (expected %s)\n' "$name" "$SRC/$name.png" >&2
  done
  exit 1
fi

printf '\ntotal %d asset(s) %.1f MB -> %.1f MB\n' \
  "$converted" \
  "$(echo "$total_before" | awk '{print $1/1048576}')" \
  "$(echo "$total_after" | awk '{print $1/1048576}')"
