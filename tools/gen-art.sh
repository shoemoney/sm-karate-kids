#!/usr/bin/env bash
# Generate the art set with the codex (GPT-6 Astra) built-in image tool.
# One codex process per asset, all in parallel — each writes into its own scratch
# dir so two runs can never clobber each other's output, then the finished PNG is
# moved into assets/generated/ under a stable name.
set -uo pipefail

ROOT="/Users/shoemoney/Projects/sm-karate-kids"
OUT="$ROOT/assets/generated"
SCRATCH="/tmp/smkk-art"
JOBS="${1:-6}"

mkdir -p "$OUT" "$SCRATCH"

# name|prompt
ASSETS=$(cat <<'SPEC'
dojo-backdrop|Photorealistic traditional Japanese dojo interior, the far back wall seen straight on from floor level. Tall wooden-framed shoji screen panels with translucent rice-paper glowing warm from light behind them, dark stained timber posts and beams, a polished dark wood floor strip at the base, deep atmospheric shadow in the upper corners. Cinematic, moody, warm amber and deep brown palette, volumetric haze. Empty room, absolutely no people, no text, no characters, no logos. Wide landscape composition, 2:1 aspect.
dojo-floor|Seamless tileable texture of traditional Japanese tatami mat flooring viewed straight down from directly above. Pale green-straw woven rush mat surface with the fine horizontal weave texture clearly visible, bound by dark indigo fabric edges. Even flat lighting, no shadows, no vignette, no highlights, no perspective, perfectly uniform so it repeats seamlessly as a tile. Photographic, high detail, muted natural colors.
crowd-silhouette|A row of seated karate students in white gi, seen from behind and slightly above, rendered as a dark flat silhouette band across the bottom of the frame. Simple clean shapes, no facial detail, no visible features, pure dark navy-black shapes on a fully transparent background. Evenly spaced, some sitting cross-legged, some kneeling upright. Studio game sprite asset, cut out cleanly, no shadow, no background.
banner-vertical|A long narrow vertical hanging fabric banner, deep crimson red with a subtle woven silk texture and gold embroidered border trim running down both edges. Blank center, no text, no characters, no symbols, no writing of any kind. Slightly weathered with soft folds. Hanging straight, viewed flat from the front. Game texture asset, transparent background, no shadow.
volumetric-shaft|A single soft volumetric light shaft, a broad cone of warm golden haze angling down from the upper right to the lower left. Just the light and the dust motes suspended in it, no room, no walls, no objects, no people. Very soft feathered edges fading to fully transparent. Brightest in the center. Additive blend style game VFX texture, transparent background.
impact-flash|A single bright white-hot starburst impact flash, sharp brilliant white core with warm orange and yellow radiating spikes fading to transparent at the tips. Radial, symmetrical, soft feathered outer edge. Game VFX sprite, transparent background, no smoke, no debris, no room, no people.
impact-ring|A single thin bright circular shockwave ring, white-cyan hot edge, perfectly round, uniform thickness, fading smoothly to fully transparent both inside the ring and outside it. Sharp glowing outline, soft glow bleed. Game VFX sprite, transparent background, no room, no people.
dust-mote|A single tiny soft round dot of warm white dust, a small radial glow blob, bright center fading smoothly to fully transparent. Very small, simple, soft. Game particle sprite, transparent background, no room, no people.
title-backdrop|Dramatic cinematic poster background for a karate video game title screen. A dark empty traditional dojo interior at night, single shaft of warm light from a high window falling across an empty tatami mat, heavy atmospheric haze and dust in the beam, deep shadows, vignette darkening the corners. Moody, high contrast, painterly digital art. No people, no fighters, no text, no letters, no logos, no UI. Wide landscape composition.
dojo-ceiling|Photorealistic traditional Japanese dojo ceiling and upper wall junction, seen looking up and forward. Dark exposed wooden beams and rafters, hanging paper lantern with warm glow, deep shadow. Cinematic, moody, warm amber and deep brown palette. Empty, no people, no text. Wide landscape composition.
SPEC
)

# Read the whole spec first. Piping the spec into `while read` and backgrounding
# inside that loop hands the remaining lines to each background job as its stdin,
# which silently eats the rest of the list.
NAMES=()
PROMPTS=()
while IFS='|' read -r n p; do
  [ -z "$n" ] && continue
  NAMES+=("$n")
  PROMPTS+=("$p")
done <<< "$ASSETS"

pending=()
for i in "${!NAMES[@]}"; do
  if [ -s "$OUT/${NAMES[$i]}.png" ]; then
    echo "skip ${NAMES[$i]} (exists)"
    continue
  fi
  pending+=("$i")
done

for i in "${pending[@]}"; do
  while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do sleep 2; done
  name="${NAMES[$i]}"
  prompt="${PROMPTS[$i]}"
  dir="$SCRATCH/$name"
  rm -rf "$dir"; mkdir -p "$dir"
  (
    cd "$dir" || exit 1
    printf 'Generate an image and save it as art.png in the current directory.\n\n%s\n' "$prompt" > prompt.txt
    codex exec --sandbox workspace-write --skip-git-repo-check --ephemeral \
      -o reply.txt "$(cat prompt.txt)" > codex.log 2>&1 </dev/null
    if [ -s art.png ]; then
      cp art.png "$OUT/$name.png" && echo "ok $name" || echo "FAIL-copy $name"
    else
      echo "FAIL-gen $name"
    fi
  ) &
done

wait
echo "=== DONE ==="
ls -la "$OUT"
