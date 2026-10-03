#!/usr/bin/env bash
# Proves tools/coach-legend-probe.mjs can fail — and can stay quiet when it should.
#
# The probe has never been shown a wrong answer, and the plan's own lesson
# (r149, r152, r155) is that a gate which cannot fail is not evidence. Five
# mutations, each asserting BOTH the exit code and the diagnosis, because a
# probe that exits non-zero for the wrong reason is how a round gets spent
# chasing a defect that does not exist.
#
#   0. baseline (fixed tree)              -> 0 OK
#   1. the r158 order fix reverted         -> 1 different arrow orders
#   2. the divider rule removed            -> 1 no rule between the halves
#   3. the plate narrowed                 -> 1 overflow the plate's content box
#   4. the strip never attaches                 -> 1 positive control did not fire
#   5. the strip becomes permanent               -> 1 not once-only
#
# Cases 4 and 5 are the ones that matter most. This probe has two arms, and an
# arm that cannot fail is a gate that has learned nothing — r155's whole
# lesson, arrived at through a review set containing no gameplay at all. Case 4
# proves arm 1 (the strip is there on a first run) can go red; case 5 proves
# arm 2 (the strip is gone for a returning player) can too.
#
# Runs against a live Vite dev server and mutates SOURCE only — no build, so no
# risk of leaving dist describing a tree that no longer exists. The end-of-run
# assertion is that the source came back.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2
ROOT="$PWD"
CSS="apps/game/src/styles.css"
COACH="apps/game/src/coach.ts"
TOOL="tools/coach-legend-probe.mjs"
BASE="${SMKK_BASE:-http://127.0.0.1:5173}"

WORK="$(mktemp -d)"
CSS_BAK="$WORK/styles.css"; COACH_BAK="$WORK/coach.ts"
cp "$CSS" "$CSS_BAK"; cp "$COACH" "$COACH_BAK"

# The end-of-run check compares against the state at ENTRY, not against HEAD.
# This round's fix is uncommitted by design, so `git diff --quiet` is red the
# moment the harness starts — a gate that reports the round's own work as
# damage. The first version of this line did exactly that, and it passed its
# six cases and still exited 1, which is the worst of both.
CSS_ENTER="$(shasum "$CSS" | cut -d' ' -f1)"
COACH_ENTER="$(shasum "$COACH" | cut -d' ' -f1)"

pass=0 fail=0

restore() {
  [ -f "$CSS_BAK" ] && cp "$CSS_BAK" "$CSS"
  [ -f "$COACH_BAK" ] && cp "$COACH_BAK" "$COACH"
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

# expect <name> <wanted-exit> <wanted-substring>
expect() {
  local name="$1" want_exit="$2" want_text="$3"
  SMKK_BASE="$BASE" node "$TOOL" > "$WORK/out" 2>&1
  local got=$?
  if [ "$got" != "$want_exit" ]; then
    echo "FAIL  $name — exit $got, wanted $want_exit"
    sed -n '1,12p' "$WORK/out"
    fail=$((fail+1)); return
  fi
  if ! grep -q "$want_text" "$WORK/out"; then
    echo "FAIL  $name — exit $got but no '$want_text' in the diagnosis:"
    grep -E '^FAIL' "$WORK/out" | head -3
    fail=$((fail+1)); return
  fi
  echo "ok    $name — exit $got, $want_text"
  pass=$((pass+1))
}

echo "=== coach-legend-probe mutation harness ==="

# Standing rule 4: an immediate timeout is an environment question first. Check
# the server before blaming the probe, and say which one it was.
if ! curl -s -o /dev/null --max-time 6 "$BASE/"; then
  echo "FAIL  no server answering at $BASE — start one first; this is not a probe result"
  exit 2
fi

# 0. Baseline: the fixed tree must pass. Without this the harness could pass
#    because the probe always exits 0.
expect "baseline (fixed tree)" 0 "the plate reads as two legends"

# 1. The r158 fix, reverted. The stance half goes back to up/down first.
restore
substitute "$COACH" "'◀ back', '▶ in', '▲ jump', '▼ crouch'" "'◀ back', '▲ jump', '▶ in', '▼ crouch'" \
  && expect "stance order reverted" 1 "different arrow orders"

# 2. The boundary removed. The plate is four cells per row on one baseline grid
#    again, and nothing marks where one legend stops and the other starts.
restore
substitute "$CSS" ".coach-half + .coach-half {
  border-left: 1px solid var(--edge-faint);
  padding-left: var(--space-3);
}" ".coach-half + .coach-half {
  padding-left: var(--space-3);
}" \
  && expect "divider rule removed" 1 "no rule between the halves"

# 3. The plate narrowed until a legend cell spills out of it. Content-driven
#    `repeat(2, auto)` columns mean this is reachable by any future padding or
#    column-gap change, not just by editing the text.
restore
substitute "$CSS" "  inset-inline: var(--space-3);" "  inset-inline: 90px;" \
  && expect "plate narrowed past its content" 1 "overflow the plate"

# 4. The strip stops rendering at all — the failure this probe's first arm
#    exists to catch. With nothing in the DOM there is nothing to measure.
#
#    Note what this is NOT: it is not the r157 regression
#    (`retire()` writing the flag at boot), which was written here first and
#    did not fail. The reason is worth keeping, because it is the whole reason
#    r157's probe uses `?mode=dojo` as its positive arm: DOJO NEVER CALLS
#    `startRound` AT BOOT, so the boot path that made the flag write early is
#    not reachable from this route at all. Restoring the bug here leaves the
#    strip rendering perfectly.
#
#    That regression is covered where it is reachable — `coach-probe.mjs`'s
#    tournament arm — and two gates covering two routes is the right shape. It
#    is not covered here, and this harness does not pretend otherwise.
restore
substitute "$COACH" "      pad.appendChild(strip);" "      /* mutated: never attached */" \
  && expect "strip never attached to the pad" 1 "positive control did not fire"

# 5. The strip never retires. Arm 2's whole claim is that a returning player
#    sees nothing, and this is what makes that claim falsifiable.
restore
substitute "$COACH" "if (shown || loadValue(SEEN_KEY, isTrue, false)) return;" "if (shown) return;" \
  && expect "strip permanent" 1 "not once-only"

restore
echo
echo "=== $pass passed, $fail failed ==="
[ "$fail" -ne 0 ] && exit 1

# The harness's own last word: did the source come back byte for byte? A
# harness that ends dirty hands the next round a tree it did not mean to write.
if [ "$(shasum "$CSS" | cut -d' ' -f1)" != "$CSS_ENTER" ] || [ "$(shasum "$COACH" | cut -d' ' -f1)" != "$COACH_ENTER" ]; then
  echo "FAIL  source not restored after the run"
  exit 1
fi
echo "source restored byte-for-byte; both arms proved falsifiable"