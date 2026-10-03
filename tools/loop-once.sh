#!/usr/bin/env bash
# Unattended driver for the SM Karate Kids review loop.
#
# THE ANSWER TO "how do I get you to continue without me telling you to":
# this script. Not the model — I cannot re-enter a session. A process on this
# machine that starts a fresh one, on a schedule, is the whole of it.
#
#   ./tools/loop-once.sh          one unattended iteration, now
#   ./tools/loop-once.sh --preflight
#                                 everything except the model call: the freshness
#                                 verdict and the header it injects. Zero cost,
#                                 which is what makes the wiring testable --
#                                 a gate that cannot be exercised is decoration.
#   launchctl kickstart -k        whatever the schedule decides is due
#
# SMKK_REPO overrides the repo root and SMKK_LOOP_LOG the log directory, so
# tools/loop-freshness-mutation.sh can run a COPY of this driver against a stub
# without touching the one launchd is executing every few minutes.
#
# It is deliberately dull. Three rules are in the prompt because a run with
# nobody watching is exactly when they matter, and all three are the result of a
# round in this loop going wrong:
#
#   r127  regenerate the review set before every review — stale frames produced
#         a false finding about code that had already been fixed
#   r127  read the gate log before committing — a red gate was committed and
#         deployed, and it turned out fine, which was luck
#   r90   never ship on a number not read off a clock or a pixel — three
#         separate rounds shipped a metric that agreed with a no-op
set -uo pipefail

PREFLIGHT=0
for arg in "$@"; do
  case "$arg" in
    --preflight) PREFLIGHT=1 ;;
    *) echo "unknown argument: $arg (expected --preflight)" >&2; exit 2 ;;
  esac
done

REPO="${SMKK_REPO:-/Users/shoemoney/Projects/sm-karate-kids}"
LOG_DIR="${SMKK_LOOP_LOG:-$REPO/.loop}"
LOCK="$LOG_DIR/run.lock"
STAMP="$LOG_DIR/last-ok"

# Preflight deliberately runs BEFORE the lock: it must never be able to block or
# be blocked by a live iteration, or testing the driver would disturb it.
if [[ "$PREFLIGHT" -eq 1 ]]; then
  mkdir -p "$LOG_DIR"
fi

# A hung or crashed previous run must not block every future one. If the lock is
# older than 45 minutes the previous process is gone — that is longer than any
# iteration should take, and long enough not to kill a slow one.
#
# The whole block is skipped in preflight: testing the driver must never be able
# to disturb a live iteration, and a live iteration is exactly when you want to
# test it.
if [[ "$PREFLIGHT" -eq 0 ]]; then
  if [[ -f "$LOCK" ]]; then
    if [[ -n "$(find "$LOCK" -mmin +45 2>/dev/null)" ]]; then
      echo "previous run is stale (>45m), reclaiming" >&2
      rm -f "$LOCK"
    else
      echo "a run is already in progress ($(date -r "$LOCK" '+%H:%M')), skipping" >&2
      exit 0
    fi
  fi
  touch "$LOCK"
  trap 'rm -f "$LOCK"' EXIT
fi

# cd and PATH first: pnpm is an nvm binary and has bitten three separate rounds
# in this loop, once for each of the two servers.
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:$PATH"
cd "$REPO" || exit 1
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# Production freshness, re-measured every iteration (r161).
#
# This is the half r160 said was missing: the gate reported, and nobody was
# obliged to run it, so production drifted 65 commits while the plan still
# claimed "byte-identical over the wire". The failure was inheritance of an
# UNVERIFIED claim, not a wrong number, so the guard is not another gate -- it
# is putting a fresh measurement at the top of the next round's field of view,
# where a reader has to look past it to reach the plan.
#
# A non-zero verdict is deliberately NOT fatal to the iteration. Production is
# blocked on a human, so this will be red for as long as that is true, and a
# driver that refuses to work is a driver that stops reporting. It is loud in
# three places instead: stderr, this marker file, and the prompt itself.
# ---------------------------------------------------------------------------
PROD_NOTE="$("$REPO/tools/prod-freshness-note.sh" 2>&1)"
PROD_RC=$?
[[ "$PROD_RC" -eq 3 ]] && rm -f "$LOG_DIR/production-stale"
[[ "$PROD_RC" -eq 1 ]] && printf '%s\n' "$PROD_NOTE" > "$LOG_DIR/production-stale"

echo "=== production freshness (rc=$PROD_RC) ===" >&2
echo "$PROD_NOTE" >&2

PROMPT=$(cat <<EOF
--- MEASURED JUST NOW, NOT INHERITED FROM ANY DOCUMENT ---
$PROD_NOTE
(exit $PROD_RC; re-read it above any claim in docs/COMPLETION-PLAN.md about
production, deploy, or freshness. r160 spent a whole round proving the
documents were wrong about this because nobody re-ran the gate.)
--------------------------------------------------------------------------

EOF
)
# Command substitution strips trailing newlines, so restore the blank line that
# separates this block from the standing instructions below it.
PROMPT+=$'\n'

PROMPT+="$(cat <<'EOF'
Continue the SM Karate Kids review loop. You are unattended — nobody is reading
this until the run finishes, and no human is available to answer a question.

Read docs/COMPLETION-PLAN.md first; it holds every open item and the reasoning
behind the ones already closed. Then do the next real piece of work.

Standing rules, all of which exist because a round broke them:

1. Regenerate the review set with `node tools/review-shots.mjs /tmp/smkk-loop`
   BEFORE running tools/review-codex.sh. Stale frames produced a false finding
   about code that had already been fixed (round 127).
2. Read the gate output before the git line. `check=`, `e2e=`, THEN `git`. A red
   gate was committed and deployed in round 135; it turned out fine, which was
   luck and not process.
3. Never ship on a number that has not been read off a clock or a pixel. Rounds
   90, 93 and 95 each shipped a metric that agreed with a no-op.
4. If a probe times out immediately, check the probe and the servers before the
   code. Three rounds in a row were environment failures wearing the costume of
   regressions.
5. A measurement that cannot be reproduced is not a result. Say so and stop.

Prefer finishing an open plan item over starting a new one. Commit conventionally,
never add AI attribution, and log what happened in REVIEW-LOOP.md — including
the rounds that found nothing, which are results.
EOF
)"

if [[ "$PREFLIGHT" -eq 1 ]]; then
  printf '%s\n' "$PROMPT"
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
OUT="$LOG_DIR/iter-$TS.log"

echo "=== unattended run $TS ===" >&2
# The default (build) agent. An explicit `-m provider/model` id was
# smoke-tested and returned a server error, and a driver that fails on its first
# real run is worse than no driver — so this uses the path that answered.
opencode run "$PROMPT" >"$OUT" 2>&1
status=$?

if [[ $status -eq 0 ]]; then
  date +%s > "$STAMP"
  echo "ok -> $OUT" >&2
else
  echo "exit $status -> $OUT (see the log; not marked as a success)" >&2
fi
exit $status
