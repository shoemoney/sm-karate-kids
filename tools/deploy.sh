#!/usr/bin/env bash
# The other half of tools/verify-deploy.sh: a way to actually PUT the bytes.
#
# WHY THIS EXISTS. Round 141 built a gate that could prove production was serving
# a stale build. Round 148 then found production stale and could not fix it,
# because a gate that detects a problem is not a way to solve one — the repo had
# no deploy path at all. The recorded reason was "no working credential":
#
#     ssh root@192.168.1.10  ->  Permission denied (publickey)
#
# which was true and incomplete. The same host accepts `shoemoney`, the deploy
# root is owned by `shoemoney`, and `rsync` works. Four rounds of a review loop
# treated a *root* refusal as no credential. A deploy tool that only knows one
# identity turns a login detail into an outage.
#
# WHAT IT DOES, in order, and why that order:
#
#   1. refuses to run without a local build, and reports its mtime — deploying
#      with no dist would upload nothing and look like a success
#   2. dry run first and PRINTS THE FILE LIST, because `--delete` on a web root
#      is the dangerous flag in this script and it must never be the first time
#      anyone sees what it would remove
#   3. `rsync --delay-updates`, so index.html is never swapped before the assets
#      it names are in place. Without it a player can load the new html and get
#      a 404 for the bundle it points at; that window is the whole class of bug
#      this repo already spent a round on ("right name, wrong bytes")
#   4. deletes stale hashed assets, which an nginx root will otherwise serve
#      forever
#   5. runs tools/verify-deploy.sh and propagates ITS exit code
#
# Step 5 is the point of the script. A deploy tool that reports its own success
# is the r141 failure wearing a different hat — the tool that did the writing is
# not evidence about the wire. The verdict comes from a fetch over HTTP,
# comparing sha256 against the local build, which is a different mechanism than
# the one that made the claim.
#
# USAGE
#   tools/deploy.sh                     # dry run, prints the plan, deploys nothing
#   tools/deploy.sh --yes               # actually deploy
#   tools/deploy.sh --yes --no-verify   # deploy without the gate (refused by
#                                       #   default; only useful when the site
#                                       #   is known-down and you want bytes up)
#   SMKK_DIST=/some/other/dist tools/deploy.sh --yes
#   DEPLOY_HOST=... DEPLOY_PATH=... tools/deploy.sh --yes
#
# EXIT
#   0  deployed and verify-deploy.sh returned 0
#   1  deploy or verification failed
#   2  usage / environment error (no local build, no rsync)
set -uo pipefail

REPO="/Users/shoemoney/Projects/sm-karate-kids"
DIST="${SMKK_DIST:-$REPO/apps/game/dist}"
HOST="${DEPLOY_HOST:-shoemoney@192.168.1.10}"
# Recorded rather than discovered: r141 lost four probes to this path. It is not
# under /mnt/tank, it is the NPM data mount's own arcade/smkk directory.
REMOTE="${DEPLOY_PATH:-/mnt/.ix-apps/app_mounts/nginx-proxy-manager/data/arcade/smkk}"
VERIFY="$REPO/tools/verify-deploy.sh"
BASE="${DEPLOY_BASE:-https://arcade.shoemoney.ai/smkk/}"

ASSUME_YES=0
DO_VERIFY=1
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --no-verify) DO_VERIFY=0 ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "FAIL: $*" >&2; exit 1; }
usage_die() { echo "FAIL: $*" >&2; exit 2; }

# ---------------------------------------------------------------- preconditions
# Resolved, not assumed, in the same order as the gate. A deploy that runs with
# no dist uploads nothing, exits 0, and reads exactly like a successful deploy.
command -v rsync >/dev/null 2>&1 || usage_die "no rsync on this machine"
[[ -d "$DIST" ]] || usage_die "no local build at $DIST — run pnpm build first"
[[ -f "$DIST/index.html" ]] || usage_die "no local build at $DIST — run pnpm build first"

if stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$DIST/index.html" >/dev/null 2>&1; then
  BUILT="$(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$DIST/index.html")"
else
  BUILT="$(stat -c '%y' "$DIST/index.html" 2>/dev/null | cut -d. -f1)"
fi

# The build must be at least as new as the newest SOURCE file it was built from.
# A dist older than the tree it claims to represent is a deploy of history, and
# it is the shape that made r141's stale build possible in the first place.
#
# The `-name dist` prune is load-bearing and was not foresight. `tsc -b` writes
# `packages/*/dist/**` — compiled .js plus a .tsbuildinfo — on every typecheck
# and every `pnpm check`, so a check run after the vite build makes the game
# dist look stale forever and this guard refuses a perfectly fresh deploy. It
# cost two real cycles to find, because the first fix pruned only `*.tsbuildinfo`
# and the compiled test .js tripped it on the very next run.
#
# Build OUTPUT is not evidence that the build is old; only edited source is. And
# a guard that is always red is worse than no guard: it teaches the next round
# to reach for the override, which is a gate disarmed by attrition.
NEWEST_SRC="$(find "$REPO/apps/game/src" "$REPO/apps/game/public" "$REPO/packages" \
  "$REPO/apps/game/index.html" \
  \( -type d \( -name node_modules -o -name dist -o -name .git \) -prune \) -o \
  -type f -newer "$DIST/index.html" -print -quit 2>/dev/null || true)"
[[ -z "$NEWEST_SRC" ]] || die "the build is older than $NEWEST_SRC — run pnpm build first"

echo "deploy plan"
echo "  build      $DIST (built $BUILT)"
echo "  host       $HOST"
echo "  path       $REMOTE"
echo "  gate       $BASE"

# ---------------------------------------------------------------- dry run
# Always, and always printed. `--delete` is what makes the web root converge
# (stale hashed bundles would otherwise be served forever), and it is also the
# one flag here that can remove something nobody asked to remove.
DRY="$(rsync -ain --delete -e ssh "$DIST/" "$HOST:$REMOTE/" 2>&1)"
DRY_STATUS=$?
[[ $DRY_STATUS -eq 0 ]] || die "rsync dry run failed (exit $DRY_STATUS):
$DRY"

DELETE_COUNT="$(printf '%s\n' "$DRY" | grep -c '^\*deleting' || true)"
SEND_COUNT="$(printf '%s\n' "$DRY" | grep -c '^<f' || true)"

if [[ "$SEND_COUNT" -eq 0 && "$DELETE_COUNT" -eq 0 ]]; then
  echo "  already    production already matches this build byte for byte"
else
  echo "  would send $SEND_COUNT file(s), delete $DELETE_COUNT stale file(s):"
  printf '%s\n' "$DRY" | sed 's/^/    /'
fi

if [[ $ASSUME_YES -eq 0 ]]; then
  echo
  echo "dry run only — nothing was sent. Re-run with --yes to deploy."
  exit 0
fi

# ---------------------------------------------------------------- push
# --delay-updates moves every changed file into place at the END of the
# transfer, so the new index.html cannot become visible before the bundle it
# names exists. Without it there is a real window where a player gets the new
# document and a 404 for its script.
# --delete-after is implied by --delete plus --delay-updates ordering in modern
# rsync, but stated because a stale hashed asset left behind is served forever
# by an nginx root and its name will never be requested again.
RSYNC_OUT="$(rsync -a --delete --delay-updates -e ssh "$DIST/" "$HOST:$REMOTE/" 2>&1)"
RSYNC_STATUS=$?
if [[ $RSYNC_STATUS -ne 0 ]]; then
  # Left deliberately in place: a failed --delete can remove assets the CURRENT
  # served html still names, which breaks a site that was working a moment ago.
  # Pruning by hand while reading the remote index.html is the repair.
  echo "FAIL: rsync failed (exit $RSYNC_STATUS)" >&2
  printf '%s\n' "$RSYNC_OUT" | sed 's/^/  /' >&2
  echo "  the remote tree may now be partial; inspect $REMOTE before retrying" >&2
  exit 1
fi

echo
echo "pushed $SEND_COUNT file(s), removed $DELETE_COUNT stale file(s)"

# ---------------------------------------------------------------- verify
# The verdict is not this script's. rsync's exit code says the bytes were
# written to a directory; it says nothing about what nginx serves from it, and
# r141 is entirely about that gap.
if [[ $DO_VERIFY -eq 0 ]]; then
  echo "SKIPPED: tools/verify-deploy.sh (--no-verify) — this deploy is UNVERIFIED"
  exit 0
fi

echo
bash "$VERIFY" "$BASE"
VERIFY_STATUS=$?
if [[ $VERIFY_STATUS -ne 0 ]]; then
  echo >&2
  echo "FAIL: bytes were pushed but the served build does not match them" >&2
  echo "  the deploy is NOT good. Inspect $REMOTE/assets — a partial --delete" >&2
  echo "  can leave the served index.html naming files that are gone." >&2
fi
exit $VERIFY_STATUS
