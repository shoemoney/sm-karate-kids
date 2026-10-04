#!/usr/bin/env bash
# Proves tools/champion-probe.mjs can fail — and proves the limit of what it can see.
#
# The probe has never been shown a wrong answer, and the plan's own lesson
# (r149, r152, r155) is that a gate which cannot fail is not evidence. This
# harness also has a second job, which is the more interesting one: the probe's
# header claims it covers the record line reaching the DOM but NOT the branch,
# and a scope claim nobody can check is a comment.
#
#   0. baseline (fixed tree)                          -> probe 0, unit green
#   1. main.ts drops every TEXT piece on the way to the DOM   -> probe 1
#   2. main.ts drops the SCORE piece on the way to the DOM   -> probe 1
#   3. the r166 bug restored (persist.ts)              -> probe 0, unit RED
#
# Cases 1 and 2 are why the browser gate exists at all. The unit test renders
# the pieces through its own local `render()` helper and never builds a DOM
# node; its only guard on the call site is a string match on main.ts's source.
# Both mutations leave recordPieces itself perfectly correct and the unit suite
# completely green — the pieces are produced and then thrown away on the way to
# the screen. That is the "declared but never invoked" class this repo has hit
# four times, and only a browser sees it.
#
# Case 3 is the scope check, and it is a NEGATIVE assertion: the probe stays
# GREEN while the unit test goes RED. Every arm seeds an unreachable best of
# 30,000, so the card lands on the branch the buggy code also rendered, and an
# idle player scores 0 so `newBest` is never true at all. So the defect this
# probe was written against is invisible to it — which is exactly what its
# header says, proven rather than asserted. Neither gate subsumes the other:
# the browser proves it reaches the screen, the unit test proves the branch, and
# this case is the demonstration that both statements are load-bearing.
#
# Runs against a live Vite dev server and mutates SOURCE only — no build, so no
# risk of leaving dist describing a tree that no longer exists. The end-of-run
# assertion is that both source files came back, by CHECKSUM and not by
# `git diff`: this round's work is uncommitted by design, so a diff is red from
# the moment the harness starts.
#
# Runtime is ~8 minutes by design. Each probe run is six arms at ~17s, and a
# stubbed probe would not be the probe.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2
MAIN="apps/game/src/main.ts"
PERSIST="apps/game/src/persist.ts"
TOOL="tools/champion-probe.mjs"
UNIT="apps/game/tests/unit/champion-titles-visible.test.ts"
BASE="${SMKK_BASE:-http://127.0.0.1:5173}"

WORK="$(mktemp -d)"
MAIN_BAK="$WORK/main.ts"; PERSIST_BAK="$WORK/persist.ts"
cp "$MAIN" "$MAIN_BAK"; cp "$PERSIST" "$PERSIST_BAK"

# The end-of-run check compares against the state at ENTRY, not against HEAD.
MAIN_ENTER="$(shasum "$MAIN" | cut -d' ' -f1)"
PERSIST_ENTER="$(shasum "$PERSIST" | cut -d' ' -f1)"

pass=0 fail=0

restore() {
  [ -f "$MAIN_BAK" ] && cp "$MAIN_BAK" "$MAIN"
  [ -f "$PERSIST_BAK" ] && cp "$PERSIST_BAK" "$PERSIST"
  return 0
}
trap 'restore; rm -rf "$WORK"' EXIT INT TERM

# A mutation harness that silently no-ops on a moved anchor is the trap r152
# recorded: "a guard that fails on its own anchor cannot be trusted to fail on
# the defect." Refuse to continue rather than record a pass earned by nothing.
substitute() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, needle, repl = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if s.count(needle) != 1:
    print(f"ANCHOR-MISS: expected exactly 1 occurrence of {needle!r} in {path}, found {s.count(needle)}")
    sys.exit(3)
open(path, 'w').write(s.replace(needle, repl))
PY
}

# expect_probe <name> <wanted-exit> <wanted-substring>
expect_probe() {
  local name="$1" want_exit="$2" want_text="$3"
  SMKK_BASE="$BASE" node "$TOOL" > "$WORK/out" 2>&1
  local got=$?
  if [ "$got" != "$want_exit" ]; then
    echo "FAIL  $name — probe exit $got, wanted $want_exit"
    sed -n '1,16p' "$WORK/out"
    fail=$((fail+1)); return
  fi
  if ! grep -q "$want_text" "$WORK/out"; then
    echo "FAIL  $name — probe exit $got but no '$want_text' in the diagnosis:"
    grep -E '^ FAIL' "$WORK/out" | head -4
    fail=$((fail+1)); return
  fi
  echo "ok    $name — probe exit $got, $want_text"
  pass=$((pass+1))
}

# The unit suite must be GREEN for a browser-only mutation to be interesting:
# if the unit test catches it too, the case proves nothing about coverage.
expect_unit_green() {
  local name="$1"
  if pnpm exec vitest run "$UNIT" > "$WORK/unit" 2>&1; then
    echo "ok    $name — unit suite still green, as this case requires"
    pass=$((pass+1))
  else
    echo "FAIL  $name — unit suite went red too, so the case proves nothing about coverage"
    grep -E '✕|×|FAIL' "$WORK/unit" | head -4
    fail=$((fail+1))
  fi
}

expect_unit_red() {
  local name="$1"
  if pnpm exec vitest run "$UNIT" > "$WORK/unit" 2>&1; then
    echo "FAIL  $name — unit suite stayed GREEN; the header's scope claim would be wrong"
    fail=$((fail+1))
  else
    echo "ok    $name — unit suite red while the probe stayed green"
    pass=$((pass+1))
  fi
}

echo "=== champion-probe mutation harness ==="

# Standing rule 4: an immediate timeout is an environment question first. Check
# the server before blaming the probe, and say which one it was.
if ! curl -s -o /dev/null --max-time 6 "$BASE/"; then
  echo "FAIL  no server answering at $BASE — start one with 'pnpm dev' first."
  echo "      This is NOT a probe result: a harness whose fixture is wrong measures"
  echo "      a broken probe and reports it as a tidy pass."
  exit 2
fi

# 0. Baseline: the fixed tree must pass, and the unit suite must be green. Without
#    this the harness could pass because the probe always exits 0.
restore
expect_probe "baseline (fixed tree)" 0 "RECORD LINE OK"
expect_unit_green "baseline unit suite"

# 1. The count never reaches the screen. Every TEXT piece is replaced with an
#    empty text node on the way to the fragment, so the card shows a bare
#    "30,000" and the word "titles" is never rendered anywhere on it.
restore
substitute "$MAIN" \
  "'score' in piece ? scoreFragment(piece.score) : document.createTextNode(piece.text)," \
  "'score' in piece ? scoreFragment(piece.score) : document.createTextNode('')," \
  && expect_probe "text pieces dropped before the DOM" 1 'the card shows "titles 0"'

# 2. The score never reaches the screen. The other half of the same loop: the
#    words survive and the number does not, so the line reads "Best  · titles 2".
restore
substitute "$MAIN" \
  "'score' in piece ? scoreFragment(piece.score) : document.createTextNode(piece.text)," \
  "'score' in piece ? document.createTextNode('') : document.createTextNode(piece.text)," \
  && expect_probe "score piece dropped before the DOM" 1 'standing best is still on the line'

# 3. SCOPE, as a negative assertion. The r166 defect itself: on a new best the
#    line says "New best score" whether or not the run was a championship, which
#    is where the count used to be lost. Every arm here has newBest === false, so
#    the probe cannot see it — and the unit test, which can, must go red.
restore
substitute "$PERSIST" \
  "  return args.champion ? [titles, { text: ' · new best' }] : [{ text: 'New best score' }];" \
  "  return [{ text: 'New best score' }];" \
  && expect_probe "r166 bug restored — probe is blind to it" 0 "RECORD LINE OK"
expect_unit_red "r166 bug restored"

restore
echo ""
echo "--- both files back? ---"
if [ "$(shasum "$MAIN" | cut -d' ' -f1)" = "$MAIN_ENTER" ] &&
   [ "$(shasum "$PERSIST" | cut -d' ' -f1)" = "$PERSIST_ENTER" ]; then
  echo "ok    source restored by checksum"
  pass=$((pass+1))
else
  echo "FAIL  source did NOT come back — a mutated file is still in the tree"
  fail=$((fail+1))
fi

echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
