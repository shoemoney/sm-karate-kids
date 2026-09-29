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

# ---------------------------------------------------------------------------
# Brand marks.
#
# Same job, different folder: the ShoeMoney marks are already 256px PNGs, so
# there is no generated/ source to read from and the PNG beside the WebP is
# the source of truth. Alpha is non-negotiable here — the emblem is a decal
# painted onto a gi chest — and the emblem is deliberately left alone; it is
# already 35 KB and nothing has ever complained.
#
# The publisher mark is the one that earns the conversion: it is 1024px of
# RGBA (376 KB) and the pre-boot card draws it at most 144 CSS px, which is
# under 300 device px on any phone worth the name. 10 KB instead of 376 KB,
# fetched before the game module has even been evaluated.
# ---------------------------------------------------------------------------
BRAND="$ROOT/apps/game/public/brand"
if [ -s "$BRAND/shoemoney-logo.png" ] && [ ! -s "$BRAND/shoemoney-logo.webp" ]; then
  before=$(stat -f%z "$BRAND/shoemoney-logo.png")
  cwebp -quiet -q 88 -resize 256 0 -alpha_q 95 -m 6 \
    "$BRAND/shoemoney-logo.png" -o "$BRAND/shoemoney-logo.webp"
  after=$(stat -f%z "$BRAND/shoemoney-logo.webp")
  printf '\n%-24s %6.1f KB -> %6.1f KB  (%.0f%% saved)\n' \
    "shoemoney-logo.webp" "$(echo "$before" | awk '{print $1/1024}')" \
    "$(echo "$after" | awk '{print $1/1024}')" \
    "$(echo "$before $after" | awk '{print (1-$2/$1)*100}')"
fi
