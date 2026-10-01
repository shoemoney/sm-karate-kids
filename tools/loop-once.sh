#!/usr/bin/env bash
# Unattended driver for the SM Karate Kids review loop.
#
# THE ANSWER TO "how do I get you to continue without me telling you to":
# this script. Not the model — I cannot re-enter a session. A process on this
# machine that starts a fresh one, on a schedule, is the whole of it.
#
#   ./tools/loop-once.sh          one unattended iteration, now
#   launchctl kickstart -k        whatever the schedule decides is due
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

REPO="/Users/shoemoney/Projects/sm-karate-kids"
LOG_DIR="${SMKK_LOOP_LOG:-$REPO/.loop}"
LOCK="$LOG_DIR/run.lock"
STAMP="$LOG_DIR/last-ok"
mkdir -p "$LOG_DIR"

# A hung or crashed previous run must not block every future one. If the lock is
# older than 45 minutes the previous process is gone — that is longer than any
# iteration should take, and long enough not to kill a slow one.
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

# cd and PATH first: pnpm is an nvm binary and has bitten three separate rounds
# in this loop, once for each of the two servers.
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:$PATH"
cd "$REPO" || exit 1

PROMPT=$(cat <<'EOF'
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
)

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
