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
#   tools/deploy.sh                     # explains the real path, deploys nothing
#   SMKK_DIST=/some/other/dist tools/deploy.sh
#
# EXIT
#   0  nothing to do (see the retirement notice below)
#   2  environment error
#
# ---------------------------------------------------------------------------
# RETIRED at r159. This script no longer deploys anything, on purpose.
# ---------------------------------------------------------------------------
#
# It used to rsync apps/game/dist to
# shoemoney@192.168.1.10:/mnt/.ix-apps/.../arcade/smkk, which is the OLD arcade
# on arcade.shoemoney.ai. That host still answers 200 and still serves `td/` and
# `shoetris/`, so nothing about it looks broken — it just stopped being where
# this game lives. The game ships now as:
#
#   https://arcade.shoemoney.com/karate-kids/
#
# and that host is owned by a different checkout, ~/Projects/SMA-arcade, which
# deploys an ATOMIC RELEASE (tar to /var/www/arcade.shoemoney.com/releases/<id>,
# then a `current` symlink flip, with the shared SQLite backed up first) behind a
# privacy-gate clearance receipt.
#
# Why not just repoint the rsync at the new path? Because the two mechanisms are
# not interchangeable. An rsync into `current/public/karate-kids/` would write
# THROUGH a symlink that an atomic flip owns, so a failure mid-copy leaves a
# half-written game live under a release that still claims to be good — and it
# would skip the backup and the clearance receipt. That is a worse deploy than
# no deploy, and it would be invisible until someone loaded the page.
#
# A tool that writes to one origin and verifies another is the r141 failure in a
# new hat: green, over the wrong bytes. So this script refuses rather than
# guessing, and the gate that still works — tools/verify-deploy.sh — is pointed
# at the real route.
#
# THE REAL PATH, per the `upload-to-arcade` skill:
#
#   python3 ~/Projects/SMA-arcade/ops/build-release.py \
#     --arcade-root ~/Projects/SMA-arcade
#   python3 ~/Projects/SMA-arcade/ops/deploy.py \
#     --payload <release-payload> --clearance <receipt.json> [--dry-run]
#   bash tools/verify-deploy.sh          # same origin, same route, byte-compared
#
# `karate-kids` is already registered in both arcade registries and
# ops/game-sources.json already points at this checkout's apps/game, so this is a
# build-and-release, not an onboarding.
set -uo pipefail

REPO="/Users/shoemoney/Projects/sm-karate-kids"
DIST="${SMKK_DIST:-$REPO/apps/game/dist}"
BASE="${DEPLOY_BASE:-https://arcade.shoemoney.com/karate-kids/}"
ARCADE="${ARCADE_ROOT:-$HOME/Projects/SMA-arcade}"

cat <<EOF
deploy.sh is retired — arcade.shoemoney.ai/smkk is not where this game ships.

  live route   $BASE
  arcade       $ARCADE (owns the atomic release deploy)
  local build  $DIST

Deploy through the arcade checkout, which owns that host:

  python3 $ARCADE/ops/build-release.py --arcade-root $ARCADE
  python3 $ARCADE/ops/deploy.py --payload <payload> --clearance <receipt.json> --dry-run
  python3 $ARCADE/ops/deploy.py --payload <payload> --clearance <receipt.json>

Then gate it here — this origin, this route, byte for byte:

  bash $REPO/tools/verify-deploy.sh $BASE

Nothing was sent. The retired rsync path is documented in the header of this
script rather than executed, on purpose: it writes through a symlink an atomic
flip owns, and skips both the shared-DB backup and the clearance receipt.
EOF
exit 0
