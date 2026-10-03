#!/usr/bin/env bash
# Proves the unattended driver can notice that production is stale.
#
# WHY THIS HARNESS EXISTS
# -----------------------
# r161's whole claim is that the driver now re-measures production every
# iteration. A claim like that is exactly what this loop has been wrong about
# nine times: a gate that is correct, mutation-proved, and consulted by nobody
# (r159 -> r160, which is what cost 65 commits of drift), or a check that emits
# success without having measured (r154, r155).
#
# The baseline is not "the note says STALE". It is the WHOLE path:
#   loop-once.sh --preflight -> prod-freshness-note.sh -> the gate's exit code
#   -> the prompt the next round actually reads.
# Each case breaks one link and requires the path to go quiet rather than
# confident.
#
# THE REAL TOOLS ARE WHAT RUN. production-freshness.py is reached through
# SMKK_PROD_GATE and replaced with a stub that prints a canned verdict and exits
# a chosen code; the driver and the note script are the shipping files, invoked
# in place. An earlier draft copied both into a throwaway tree -- and every
# fixture in it was misnamed, so the harness spent its first half-hour reporting
# a machine problem that was a path typo. Never the probe's fault, this time.
#
# One deliberate asymmetry: the harness does NOT mutate the driver. launchd is
# running it every few minutes and this file may be executed from a scheduled
# round; a killed harness leaving the driver broken is the r159 lesson. The
# wiring is asserted behaviourally instead -- if loop-once.sh stopped injecting
# the note, the baseline and the stale case both go red on the missing marker,
# which is the same assertion the baseline is for.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTE="$REPO/tools/prod-freshness-note.sh"
DRIVER="$REPO/tools/loop-once.sh"
STUB_DIR="$(mktemp -d "$REPO/.loop/stub-gate.XXXXXX")"
LOGS="$REPO/.loop/fresh-mutation-logs"
mkdir -p "$LOGS"
trap 'rm -rf "$STUB_DIR"' EXIT

# The note script's mapping, exit code, and driver are the shipping files.
BEFORE="$(shasum -a 256 "$NOTE" "$DRIVER" | shasum -a 256)"

pass=0
fail=0
ok()  { echo "  PASS  $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL  $1"; fail=$((fail + 1)); }

# stub <name> <exit-code> <verdict-line>
# The pin/drift block is only printed when the gate is STALE, because that is
# the only path the real tools/production-freshness.py takes it. A stub that
# printed a commit distance on an inconclusive result would make case 8 pass for
# the wrong reason -- the fixture lying, not the tool.
stub() {
  local path="$STUB_DIR/$1.py" code="$2" verdict="$3" extra="${4:-}"
  {
    echo 'import sys'
    printf 'print(%s)\n' "\"$verdict\""
    if [[ "$code" -eq 1 ]]; then
      echo "print('  pinned  served markup matches apps/game/index.html at deadbee (2026-09-30)')"
      echo "print('          42 commit(s) behind HEAD -- an UPPER BOUND on the drift,')"
      echo "print('          because that file is unchanged across stretches of commits.')"
      echo "print('  css     index-XXXX.css: 154 tokens declared')"
      echo "print('          READ BUT NEVER DECLARED, no fallback: --coach-plate, --leading-relaxed')"
    fi
    # Arms 5 and 6 run on ANY verdict the tool reaches, so a byte-identical
    # origin can carry a live no-op or a dangling reference. That is the whole
    # point of the case below: those lines used to be dropped unless there was
    # drift to print them beside, which is how a real defect on a real origin
    # reached nobody.
    [[ -n "$extra" ]] && echo "print('$extra')"
    echo "sys.exit($code)"
  } > "$path"
  printf '%s' "$path"
}

# note <stub-path> -> the note the driver would inject
note() {
  SMKK_PROD_GATE="$1" SMKK_PROD_REPORT="$STUB_DIR/report.txt" "$NOTE" 2>&1
  return $?
}

# prompt <stub-path> -> the prompt the next unattended round actually receives
prompt() {
  SMKK_PROD_GATE="$1" SMKK_PROD_REPORT="$STUB_DIR/report.txt" \
    SMKK_LOOP_LOG="$LOGS" "$DRIVER" --preflight 2>/dev/null
}

has() { grep -qF -- "$2" <<<"$1"; }

echo "loop-freshness-mutation: proving the unattended driver can see a stale origin"
echo

STALE="$(stub stale 1 "STALE  the origin answers and disagrees with the local build")"

# --- baseline, FIRST ------------------------------------------------------
# A harness whose fixture is wrong measures a broken probe and reports it as a
# tidy set of passes. That was r160's own harness bug, case 3.
OUT="$(note "$STALE")"; RC=$?
if [[ $RC -eq 1 ]] && has "$OUT" "STALE"; then ok "baseline: the gate's STALE reaches the note"
else bad "baseline: a STALE gate did not produce a STALE note (rc=$RC) -- every case below is meaningless"; fi

P="$(prompt "$STALE")"
if has "$P" "MEASURED JUST NOW" && has "$P" "--coach-plate"; then
  ok "baseline: the verdict reaches the prompt the next round reads"
else bad "baseline: the verdict did NOT reach the prompt -- the wiring is not load-bearing"; fi

# --- 1. equal -------------------------------------------------------------
OUT="$(note "$(stub equal 0 "EQUAL  the origin is serving this tree's build")")"; RC=$?
if [[ $RC -eq 0 ]] && has "$OUT" "EQUAL" && ! has "$OUT" "STALE"; then
  ok "an equal origin reads EQUAL, not STALE"
else bad "an equal origin did not read EQUAL (rc=$RC)"; fi

# --- 1b. a served-artifact defect on an EQUAL origin must still reach the note
# Added at r164. The note used to print the live-no-op and drift lines ONLY when
# a commit distance was present, i.e. only when the origin was STALE. So the one
# situation in which a served-artifact defect is most misleading -- bytes that
# match perfectly, and a shipped artifact pointing at a file it does not ship --
# was the one situation that reported nothing. Measured live at r164: the served
# bundle ended in a sourceMappingURL for a map the origin 404s.
OUT="$(note "$(stub equal_dangling 0 "EQUAL  the origin is serving this tree's build" \
  "  DANGLING assets/index-CEpXIazX.js references index-CEpXIazX.js.map, which the origin does not serve")")"; RC=$?
if [[ $RC -eq 0 ]] && has "$OUT" "live dangling reference" && has "$OUT" "index-CEpXIazX.js.map" \
   && ! has "$OUT" "STALE"; then
  ok "a dangling reference on an EQUAL origin reaches the note"
else bad "a dangling reference on an equal origin did NOT reach the note (rc=$RC)"; fi

# and the other direction: the note must not manufacture the line.
OUT="$(note "$(stub equal_clean 0 "EQUAL  the origin is serving this tree's build")")"
if ! has "$OUT" "live dangling reference" && ! has "$OUT" "live no-op"; then
  ok "an equal origin with no defect reports no defect"
else bad "the note printed a defect that the report does not contain"; fi

# --- 2. stale, with the actionable number ----------------------------------
OUT="$(note "$STALE")"
if has "$OUT" "42 commit(s) behind" && has "$OUT" "UPPER BOUND"; then
  ok "a stale origin reports the commit distance and labels its own limit"
else bad "a stale origin did not report the commit distance"; fi

# --- 3. a dead origin must not read as stale ------------------------------
# The r160 exit-code contract. An unreachable origin is a fact about the world,
# not a deploy verdict, and conflating them sends an operator hunting a problem
# they do not have -- verify-deploy.sh's rc=2 exists for the same reason.
OUT="$(note "$(stub dead 2 "INCONCLUSIVE: https://arcade.shoemoney.com/karate-kids/ did not answer 200 with a body")")"; RC=$?
if [[ $RC -eq 2 ]] && has "$OUT" "INCONCLUSIVE" && ! has "$OUT" "STALE"; then
  ok "a dead origin reads INCONCLUSIVE, not STALE"
else bad "a dead origin was reported as STALE or as equal (rc=$RC)"; fi

# --- 4. no local build is also INCONCLUSIVE -------------------------------
OUT="$(note "$(stub nobuild 2 "INCONCLUSIVE: no local build at /nope/apps/game/dist/index.html")")"; RC=$?
if [[ $RC -eq 2 ]] && has "$OUT" "INCONCLUSIVE"; then
  ok "an absent local build reads INCONCLUSIVE"
else bad "an absent local build was not INCONCLUSIVE (rc=$RC)"; fi

# --- 5. THE DETECTOR MUST FIRE ON A VACUOUS PASS ---------------------------
# Build the r154 shape for real -- a note whose exit code no longer tracks the
# gate's, so a STALE origin reads EQUAL -- and require this harness to catch it.
# The mutant is NEVER installed; it is input to the detector, so what is proved
# is that the assertion cases 1-4 rely on can actually go red.
cp "$NOTE" "$STUB_DIR/noteswallow.sh"
sed -i '' 's/^rc=\$?$/rc=0/' "$STUB_DIR/noteswallow.sh"
if ! grep -q '^rc=0$' "$STUB_DIR/noteswallow.sh"; then
  bad "the vacuous-pass mutant did not apply -- this case proved nothing"
else
  MUTANT="$(SMKK_PROD_GATE="$STALE" SMKK_PROD_REPORT="$STUB_DIR/report.txt" bash "$STUB_DIR/noteswallow.sh" 2>&1)"
  # The gate's own report is the ground truth; the note is the claim under test.
  GROUND_TRUTH="$(cat "$STUB_DIR/report.txt" 2>/dev/null)"
  if has "$GROUND_TRUTH" "STALE" && has "$MUTANT" "EQUAL" && ! has "$MUTANT" "STALE"; then
    ok "a note that contradicts the gate is detected, not trusted"
  else
    bad "the vacuous-pass mutant was not caught -- this harness cannot see the r154 shape"
  fi
fi

# --- 6. a missing gate must not read as equal ------------------------------
OUT="$(SMKK_PROD_GATE="$STUB_DIR/does-not-exist.py" SMKK_PROD_REPORT="$STUB_DIR/r.txt" "$NOTE" 2>&1)"; RC=$?
if [[ $RC -eq 3 ]] && has "$OUT" "NOT MEASURED" && ! has "$OUT" "EQUAL"; then
  ok "a missing gate reads NOT MEASURED, not EQUAL"
else bad "a missing gate was reported as EQUAL (rc=$RC)"; fi

# --- 7. an undocumented exit code is refused, not passed --------------------
OUT="$(note "$(stub weird 42 "STALE  the origin answers and disagrees with the local build")")"; RC=$?
if [[ $RC -eq 3 ]] && ! has "$OUT" "42 commit(s) behind"; then
  ok "an exit code the gate does not document is refused, not reported"
else bad "an undocumented exit code was taken at face value (rc=$RC)"; fi

# --- 8. the prompt carries INCONCLUSIVE, not a deploy verdict --------------
P="$(prompt "$(stub dead 2 "INCONCLUSIVE: https://arcade.shoemoney.com/karate-kids/ did not answer 200 with a body")")"
if has "$P" "INCONCLUSIVE" && ! has "$P" "42 commit(s) behind"; then
  ok "the prompt passes INCONCLUSIVE through without inventing a drift number"
else bad "the prompt misrepresented an inconclusive check"; fi

# --- 9. preflight must not be blocked by an in-progress iteration ----------
# This harness may run while a scheduled round holds the lock. A driver whose
# preflight blocked on it would make this file unsafe to run unattended.
LOGS/run.lock.touch() { :; }
touch "$LOGS/run.lock"
P="$(prompt "$STALE")"
if has "$P" "MEASURED JUST NOW"; then ok "preflight runs with the lock held"
else bad "preflight was blocked by an in-progress iteration"; fi
rm -f "$LOGS/run.lock"

# --- 11. the prompt is safe as a CLI argument -----------------------------
# It is passed as `opencode run "$PROMPT"`. A prompt whose first byte is `-` is
# parsed as a flag, and opencode exits 1 on "Unrecognized flag" before a model
# is ever called. be20e71 opened the prompt with `--- MEASURED ...` and every
# scheduled round from then on died in the argument parser.
P="$(prompt "$STALE")"
if [[ -n "$P" && "${P:0:1}" != "-" ]]; then ok "the prompt does not open with a dash"
else bad "the prompt opens with '-' -- opencode will read it as a flag"; fi

# --- 12. a green verdict clears a red marker --------------------------------
# .loop/production-stale is the out-of-band signal. A marker that survives the
# deploy that fixed it is a stale claim of staleness.
printf 'STALE\n' > "$LOGS/production-stale"
prompt "$(stub equal 0 "EQUAL  the origin is serving this tree's build")" >/dev/null
if [[ ! -e "$LOGS/production-stale" ]]; then ok "an EQUAL verdict clears the stale marker"
else bad "the stale marker survived an EQUAL verdict"; fi
rm -f "$LOGS/production-stale"

# --- 10. the real tools are byte-identical ----------------------------------
AFTER="$(shasum -a 256 "$NOTE" "$DRIVER" | shasum -a 256)"
if [[ "$BEFORE" == "$AFTER" ]]; then ok "the shipping driver and note are byte-identical"
else bad "a shipping tool was modified by this harness"; fi

echo
echo "loop-freshness-mutation: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]] || exit 1
echo "PASS: the driver can be made to go quiet, and cannot claim EQUAL without measuring"