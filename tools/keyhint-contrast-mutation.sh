#!/usr/bin/env bash
# Proves tools/keyhint-contrast.mjs can fail.
#
# The r141/r148 numbers for this label were produced by a tool that had never
# been shown a wrong answer, and the plan's own lesson (r149, r152) is that a
# gate which cannot fail is not evidence. Four mutations, each rebuilding the
# bundle and asserting BOTH the exit code and the diagnosis, because a probe
# that exits non-zero for the wrong reason is the r152 near-miss.
#
#   1. re-inline the literal          -> 1 PINNED      (the r152 defect itself)
#   2. token whose HC value == normal -> 1 PINNED      (proves it is not grepping for var())
#   3. control frozen in high-contrast-> 2 INCONCLUSIVE(proves the constant-false guard works)
#   4. hint too dim to pass AA        -> 1 CONTRAST
#
# Never production: a throwaway copy of styles.css, restored on every exit.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2
ROOT="$PWD"
CSS="apps/game/src/styles.css"
BACKUP="$(mktemp)"
OUT="$(mktemp)"
cp "$CSS" "$BACKUP"

restore() { [ -f "$BACKUP" ] && { cp "$BACKUP" "$CSS"; rm -f "$BACKUP"; }; return 0; }
trap restore EXIT INT TERM

pass=0 fail=0

# substitute <needle> <replacement> — refuses to continue if the anchor is gone.
# A mutation harness that silently no-ops on a moved anchor is the trap r152
# recorded: "a guard that fails on its own anchor cannot be trusted to fail on
# the defect."
substitute() {
  python3 - "$CSS" "$1" "$2" <<'PY'
import sys
path, needle, repl = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if s.count(needle) != 1:
    print(f"ANCHOR-MISS: expected exactly 1 occurrence of {needle!r}, found {s.count(needle)}")
    sys.exit(3)
open(path, 'w').write(s.replace(needle, repl))
PY
}

# expect <name> <wanted-exit> <wanted-substring>
expect() {
  local name="$1" want_exit="$2" want_text="$3"
  if ! pnpm build >/dev/null 2>&1; then
    echo "FAIL  $name — build failed"; fail=$((fail+1)); return
  fi
  node tools/keyhint-contrast.mjs > "$OUT" 2>&1
  local got=$?
  if [ "$got" != "$want_exit" ]; then
    echo "FAIL  $name — exit $got, wanted $want_exit"
    sed -n '9,12p' "$OUT"
    fail=$((fail+1)); return
  fi
  if ! grep -q "$want_text" "$OUT"; then
    echo "FAIL  $name — exit $got but no '$want_text' in the diagnosis:"
    grep -E 'PINNED|INCONCLUSIVE|CONTRAST|CLAIM-' "$OUT" | head -3
    fail=$((fail+1)); return
  fi
  echo "ok    $name — exit $got, $want_text"
  pass=$((pass+1))
}

echo "=== keyhint-contrast mutation harness ==="

# 0. Baseline: the fixed tree must pass. Without this the harness could pass
#    because the probe always exits 0.
expect "baseline (fixed tree)" 0 "CLAIM-TRUE"

# 1. The r152 defect, restored.
cp "$BACKUP" "$CSS"
substitute 'color: var(--key-hint-ink);' 'color: #b8a894;' \
  && expect "literal re-inlined at the call site" 1 "PINNED"

# 2. A token that is wired up but does not actually re-point. This is the
#    mutation that matters: grepping for var() would pass it, a pixel
#    measurement cannot.
cp "$BACKUP" "$CSS"
substitute '--key-hint-ink: var(--text-faint);' '--key-hint-ink: #b8a894;' \
  && expect "token present but HC value == normal" 1 "PINNED"

# 3. Freeze the CONTROL. The probe must refuse to answer rather than report a
#    verdict about the subject from an instrument that cannot see change.
cp "$BACKUP" "$CSS"
substitute '--text-muted: #f0f0f0;' '--text-muted: #b5a693;' \
  && expect "control frozen -> instrument inconclusive" 2 "INSTRUMENT INCONCLUSIVE"

# 4. Moves correctly but lands under AA in the default mode.
cp "$BACKUP" "$CSS"
substitute '--key-hint-ink: #b8a894;' '--key-hint-ink: #4a4038;' \
  && expect "hint moves but fails AA in normal mode" 1 "CONTRAST"

restore
echo
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ] || exit 1
echo "probe is falsifiable in both directions"