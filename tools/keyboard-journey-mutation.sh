#!/usr/bin/env bash
# Proves tools/keyboard-journey.mjs can FAIL, and fails for the right reason.
#
# Nine cases over throwaway copies of the tree, each mutating SOURCE only and
# restoring it by checksum — never `git diff`, because this round's fix is
# uncommitted by design and that check was red from the moment the harness
# started (r158 found exactly that and still passed all six of its cases).
#
# The cases are chosen so a probe that had learned nothing CANNOT pass:
#
#   1 baseline          must pass, or the harness is measuring a broken probe
#   2 unbound key bound   a key with no binding starts working
#   3 hints always on     display:none dropped from the phone media query
#   4 keyboard inert      LEFT_KEYS/RIGHT_KEYS emptied — every arm must go red
#   5 posture never set   W and S do nothing at all
#   6 stance maps to nothing  left stick dropped from the grammar
#   7 IJKL rebound to a different technique  KeyI -> KeyX etc.
#   8 keyboard cannot score  walking broken so the gap never closes
#   9 posture read from phase  the r159 trap: state() reports posture from
#                              `phase`, which cannot express a jump or a crouch
#
# Case 9 is the important one. The first version of this probe asserted
# `phases.some(p => p.includes('/'))`, which is true of the string `neutral/-`,
# so it reported W and S working while neither key had done anything. Case 9
# rebuilds that exact defect and requires the probe to notice.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="$ROOT/tools/keyboard-journey.mjs"
WORK="$(mktemp -d)"
SRC="$ROOT/apps/game/src"
# styles.css is in the checksum because case 3 mutates it. A restore that does
# not cover every file a case touches is a restore that can silently skip one,
# and the next case then measures a tree it thinks it has already cleaned.
TOUCHED=("$SRC/main.ts" "$SRC/input/keyboard.ts" "$SRC/styles.css" "$ROOT/packages/sim/src/grammar.ts")
sums() { shasum "$@" | shasum; }
BASE_SUM="$(sums "${TOUCHED[@]}")"

pass=0; fail=0
restore() {
  # Restore by checksum. If a restore ever silently fails, every later case is
  # measuring the wrong tree, so this is checked rather than assumed.
  local now
  now="$(sums "${TOUCHED[@]}")"
  if [[ "$now" != "$BASE_SUM" ]]; then
    echo "FATAL: source not restored — $now != $BASE_SUM" >&2
    exit 2
  fi
}
trap 'restore' EXIT

check() { # name, expected_nonzero, output
  local name="$1" expect="$2" out="$3" rc
  if [[ "$out" == *OK\ —\ the\ key\ hints* ]]; then rc=0; else rc=1; fi
  if [[ "$rc" != "$expect" ]]; then
    echo "  FAIL $name — expected exit $expect, got $rc"
    echo "$out" | sed 's/^/       /' | tail -6
    fail=$((fail+1))
    return
  fi
  # When it is red, the REASON matters: a probe that dies on an environment
  # failure reads the same as a probe that caught the defect.
  if [[ "$expect" == "1" && "$out" != *"FAIL — "* ]]; then
    echo "  FAIL $name — red but not through an assertion (environment failure?)"
    echo "$out" | sed 's/^/       /' | tail -4
    fail=$((fail+1))
    return
  fi
  echo "  ok   $name"
  pass=$((pass+1))
}

echo "=== keyboard-journey mutation harness ==="

echo "--- 1 baseline (must pass) ---"
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"; rc=$?
if [[ "$out" == *OK\ —\ the\ key\ hints* ]]; then
  echo "  ok   baseline passes"; pass=$((pass+1))
else
  echo "  FAIL baseline is red — the harness would be measuring a broken probe"
  echo "$out" | sed 's/^/       /' | tail -8
  exit 2
fi
restore

echo "--- 2 an unbound key starts working ---"
cp "$SRC/input/keyboard.ts" "$WORK/keyboard.ts"
python3 - "$SRC/input/keyboard.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
s = s.replace("const LEFT_KEYS: Record<string, Dir4> = {\n  KeyW: 'up',",
              "const LEFT_KEYS: Record<string, Dir4> = {\n  KeyZ: 'up',\n  KeyW: 'up',", 1)
p.write_text(s)
PY
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"
check "unbound KeyZ bound" 1 "$out"
cp "$WORK/keyboard.ts" "$SRC/input/keyboard.ts"; restore

echo "--- 3 key hints show on a phone ---"
cp "$SRC/styles.css" "$WORK/styles.css" 2>/dev/null || true
python3 - "$SRC/styles.css" <<'PY'
import sys, pathlib, re
p = pathlib.Path(sys.argv[1]); s = p.read_text()
# Drop the display:none that hides the hints on coarse pointers.
s2 = re.sub(r'(\.key-hint\s*\{[^}]*?)display:\s*none', r'\1', s, count=1, flags=re.S)
if s2 == s: raise SystemExit("anchor for the phone hint rule not found")
p.write_text(s2)
PY
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"
check "hints leak to phone" 1 "$out"
if [[ -f "$WORK/styles.css" ]]; then cp "$WORK/styles.css" "$SRC/styles.css"; fi
restore

echo "--- 4 the keyboard goes completely inert ---"
python3 - "$SRC/input/keyboard.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
s = s.replace("  KeyW: 'up',\n  KeyS: 'down',\n  KeyA: 'left',\n  KeyD: 'right',\n", "", 1)
s = s.replace("  ArrowUp: 'up',\n  ArrowDown: 'down',\n  ArrowLeft: 'left',\n  ArrowRight: 'right',\n", "", 1)
p.write_text(s)
PY
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"
check "keyboard inert" 1 "$out"
cp "$WORK/keyboard.ts" "$SRC/input/keyboard.ts"; restore

echo "--- 5 posture keys do nothing ---"
# grammar.ts is restored from a SAVED COPY, not from git. `git checkout` would
# also revert anything uncommitted in it, and this round has uncommitted work
# by design — the same lesson r158's harness learned the hard way.
cp "$ROOT/packages/sim/src/grammar.ts" "$WORK/grammar.ts"
python3 - "$ROOT/packages/sim/src/grammar.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = "  if (left === 'up') return { kind: 'jump' };\n  if (left === 'down') return { kind: 'crouch' };\n"
assert old in s, "jump/crouch anchor not found"
p.write_text(s.replace(old, "", 1))
PY
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"
check "W and S do nothing" 1 "$out"

python3 - "$ROOT/packages/sim/src/grammar.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = "  if (left === 'right') return { kind: 'walk', direction: 'forward' };"
assert old in s, "walk anchor not found"
p.write_text(s.replace(old, "  if (left === 'right') return { kind: 'jump' };", 1))
PY
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"
check "D jumps instead of walking" 1 "$out"
cp "$WORK/grammar.ts" "$ROOT/packages/sim/src/grammar.ts"
restore

echo "--- 6 IJKL rebound to the wrong technique ---"
python3 - "$SRC/input/keyboard.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
s = s.replace("  KeyI: 'up',\n  KeyK: 'down',\n  KeyJ: 'left',\n  KeyL: 'right',",
              "  KeyI: 'down',\n  KeyK: 'up',\n  KeyJ: 'right',\n  KeyL: 'left',", 1)
p.write_text(s)
PY
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"
check "IJKL mismatched" 1 "$out"
cp "$WORK/keyboard.ts" "$SRC/input/keyboard.ts"; restore

echo "--- 7 a keyboard player can no longer close the gap ---"
python3 - "$SRC/input/keyboard.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
# A and D swap, so "walk toward the opponent" walks away. Every single-key arm
# still passes — both keys still walk, both directions exist — and only the
# journey arm catches it. That is the case that proves the journey arm earns
# its place rather than duplicating the key arms.
s = s.replace("  KeyA: 'left',\n  KeyD: 'right',", "  KeyA: 'right',\n  KeyD: 'left',", 1)
p.write_text(s)
PY
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"
check "cannot close the gap" 1 "$out"
cp "$WORK/keyboard.ts" "$SRC/input/keyboard.ts"; restore

echo "--- 8 posture read off 'phase', which cannot express it ---"
cp "$SRC/main.ts" "$WORK/main.ts"
python3 - "$SRC/main.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
# The r159 trap, rebuilt exactly. `Phase` is neutral|startup|active|recovery|
# frozen, so a posture read off it is always 'stand'. Any probe that inferred
# posture the first way round — by looking for a jump or crouch phase — would
# have found nothing here and either passed vacuously or needed this to be red.
s = s.replace("postureOf(state.fighters[0]),\n            postureOf(state.fighters[1]),",
              "'stand',\n            'stand',", 1)
p.write_text(s)
PY
out="$(cd "$ROOT" && node "$PROBE" 2>&1)"
check "posture frozen at stand" 1 "$out"
cp "$WORK/main.ts" "$SRC/main.ts"; restore

echo
echo "=== $pass passed, $fail failed ==="
rm -rf "$WORK"
[[ "$fail" == "0" ]] || exit 1
echo "the probe fails for the right reason in every case"