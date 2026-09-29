#!/usr/bin/env bash
# Generate the art set with the codex (GPT-6 Astra) built-in image tool.
# One codex process per asset, all in parallel — each writes into its own scratch
# dir so two runs can never clobber each other's output, then the finished PNG is
# moved into assets/generated/ under a stable name.
set -uo pipefail

# The repo root is derived from this script's own location so a clone, a
# worktree, or a different checkout all work without editing anything.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
OUT="$ROOT/assets/generated"
SCRATCH="${TMPDIR:-/tmp}/smkk-art"
MANIFEST="$SCRIPT_DIR/art-manifest.tsv"
JOBS="${1:-6}"

[ -f "$MANIFEST" ] || { echo "missing asset manifest: $MANIFEST" >&2; exit 1; }

mkdir -p "$OUT" "$SCRATCH"

# Read the whole manifest first. Piping the manifest into `while read` and
# backgrounding inside that loop hands the remaining lines to each background
# job as its stdin, which silently eats the rest of the list.
NAMES=()
PROMPTS=()
while IFS=$'\t' read -r n _maxw _alpha p; do
  case "$n" in ''|'#'*) continue ;; esac
  NAMES+=("$n")
  PROMPTS+=("$p")
done < "$MANIFEST"

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
