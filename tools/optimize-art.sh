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

ROOT="/Users/shoemoney/Projects/sm-karate-kids"
SRC="$ROOT/assets/generated"
DST="$ROOT/apps/game/public/generated"

mkdir -p "$DST"

# name|maxWidth  — widths chosen per role, not one size for all.
SPEC="dojo-backdrop:1920
dojo-ceiling:1600
dojo-floor:1024
crowd-silhouette:1024
banner-vertical:512
volumetric-shaft:1280
title-backdrop:1920
impact-flash:512
impact-ring:512
dust-mote:128
champion-crowd:1600"

total_before=0
total_after=0

while IFS=: read -r name maxw; do
  [ -z "$name" ] && continue
  in="$SRC/$name.png"
  [ -s "$in" ] || continue

  before=$(stat -f%z "$in")
  tmp="$DST/.$name.webp"

  # Backgrounds and VFX want alpha preserved (crowd, shaft, flashes); the
  # opaque room plates do not and lose a lot of weight without it.
  case "$name" in
    crowd-*|volumetric-*|impact-*|dust-*) alpha="yes" ;;
    *) alpha="no" ;;
  esac

  if [ "$alpha" = "yes" ]; then
    cwebp -quiet -q 82 -resize "$maxw" 0 -alpha_q 90 "$in" -o "$tmp"
  else
    cwebp -quiet -q 84 -resize "$maxw" 0 -m 6 "$in" -o "$tmp"
  fi

  mv "$tmp" "$DST/$name.webp"
  after=$(stat -f%z "$DST/$name.webp")
  total_before=$((total_before + before))
  total_after=$((total_after + after))
  printf '%-24s %6.1f KB -> %6.1f KB  (%.0f%% saved)\n' \
    "$name.webp" "$(echo "$before" | awk '{print $1/1024}')" \
    "$(echo "$after" | awk '{print $1/1024}')" \
    "$(echo "$before $after" | awk '{print (1-$2/$1)*100}')"
done <<< "$SPEC"

printf '\ntotal %.1f MB -> %.1f MB\n' \
  "$(echo "$total_before" | awk '{print $1/1048576}')" \
  "$(echo "$total_after" | awk '{print $1/1048576}')"
