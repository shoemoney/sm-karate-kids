#!/usr/bin/env bash
# Proves the r169 review-set guards can fail.
#
# Every case mutates tools/review-shots.mjs in a throwaway copy of the repo
# layout and runs the REAL unit file against it. Nothing is stubbed: the point
# is to show `pnpm check` goes red on each shape of the r166/r169 defect, not
# that a fake can be made to fail.
#
# Baseline first. A harness whose fixture is already broken measures nothing.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST="apps/game/tests/unit/review-set-targets-named-rows.test.ts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
SHOTS="$WORK/tools/review-shots.mjs"
# Both paths must be the file the test actually reads. They were not, for one
# run: `restore` copied to and from `$WORK/shots`, which no command ever wrote,
# so it failed on every case and each mutation inherited the previous case's
# damage. Two of the seven then failed to APPLY — the one number here that must
# never be a lie, because a mutation that does not land measures nothing.
# Assert the file exists in both directions rather than trusting the path.
restore() {
  [ -f "$WORK/shots.orig" ] || { echo "  HARNESS BUG: no snapshot to restore"; return 1; }
  cp "$WORK/shots.orig" "$SHOTS" || return 1
  [ -f "$SHOTS" ] || { echo "  HARNESS BUG: restore produced no file"; return 1; }
}
snapshot() { cp "$SHOTS" "$WORK/shots.orig"; }

# Lay down just enough of the tree for the test to read.
mkdir -p "$WORK/apps/game/tests/unit" "$WORK/apps/game/src" "$WORK/tools"
cp "$REPO/$TEST" "$WORK/$TEST"
cp "$REPO/apps/game/index.html" "$WORK/apps/game/index.html"
cp "$REPO/tools/review-shots.mjs" "$SHOTS"
snapshot

run_case() {
  local name="$1" expect="$2"; shift 2
  restore
  "$@" || { echo "  MUTATION FAILED TO APPLY: $name"; fail=$((fail+1)); return; }
  local out rc
  out="$(cd "$WORK" && npx --prefix "$REPO" vitest run "$TEST" --root "$WORK" 2>&1)"
  rc=$?
  local ok=1
  if [ "$expect" = "red" ]; then
    [ $rc -ne 0 ] || ok=0
  else
    [ $rc -eq 0 ] || ok=0
  fi
  if [ $ok -eq 1 ]; then
    pass=$((pass+1))
    local why
    why="$(printf '%s' "$out" | grep -oE '(no capture may select[^|]*|names and the name is checked|refuses to shoot[^|]*|a frame captures the pick[^|]*|asserts the trade[^|]*|not reachable only[^|]*)' | head -1)"
    printf 'ok   %-52s %s\n' "$name" "$expect"
  else
    fail=$((fail+1))
    printf 'FAIL %-52s expected %s\n' "$name" "$expect"
    printf '%s\n' "$out" | tail -18 | sed 's/^/     /'
  fi
}

echo "mutation harness: review-set named rows (r169)"
echo

# 0. Baseline. If this is red the harness is measuring nothing.
if (cd "$WORK" && npx --prefix "$REPO" vitest run "$TEST" --root "$WORK" >/dev/null 2>&1); then
  pass=$((pass+1)); printf 'ok   %-52s %s\n' "baseline (fixed capture)" "green"
else
  fail=$((fail+1)); printf 'FAIL %-52s baseline is red\n' "baseline (fixed capture)"
fi

# 1. THE r169 DEFECT, restored verbatim: select by position, no assertion.
#    This is exactly what shipped in r166..r168. Both guards must go red.
mut_positional() {
  python3 - "$WORK/tools/review-shots.mjs" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
start = s.index('  const clickSetting = async (id, expectedLabel)')
end = s.index('  console.log(`  15 settings frame body class')
s = s[:start] + "  const rows = page.locator('.setting-row input');\n  await rows.nth(4).click();\n  await rows.nth(5).click();\n" + s[end:]
open(p,'w').write(s)
PY
}
run_case "r166 defect: rows.nth(4)/nth(5) restored" red mut_positional

# 2. Identity, but the assertion deleted — the softer form of the same defect.
#    The comment still names the rows; nothing checks. One guard must go red.
mut_no_assert() {
  python3 - "$WORK/tools/review-shots.mjs" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("""    if (label !== expectedLabel) {
      throw new Error(`settings capture: #${id} reads "${label}", expected "${expectedLabel}"`);
    }
""", "")
open(p,'w').write(s)
PY
}
run_case "identity kept, label assertion removed" red mut_no_assert

# 3. The non-default-theme guard removed. The r166 defect would then photograph
#    the sheet in the state r25 already cost two false contrast findings.
mut_no_theme_guard() {
  python3 - "$WORK/tools/review-shots.mjs" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
start = s.index('  if (/high-contrast|large-controls|left-handed/.test(bodyClass))')
end = s.index('  console.log(`  15 settings frame body class')
s = s[:start] + s[end:]
open(p,'w').write(s)
PY
}
run_case "non-default-theme guard removed" red mut_no_theme_guard

# 4. A capture that toggles a row whose label it asserts wrongly — the comment
#    would be a false record again, one row over.
mut_wrong_label() {
  python3 - "$WORK/tools/review-shots.mjs" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("await clickSetting('opt-show-perf', 'Show performance HUD');",
              "await clickSetting('opt-show-perf', 'Show the HUD');")
open(p,'w').write(s)
PY
}
run_case "asserts a label the row does not read" red mut_wrong_label

# 5. The pick frame deleted — the state r166 created, back out of the set.
mut_no_pick_frame() {
  python3 - "$WORK/tools/review-shots.mjs" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
start = s.index("await capture('23-phone-picked'")
end = s.index('/* ── The motion burst')
s = s[:start] + s[end:]
open(p,'w').write(s)
PY
}
run_case "the pick frame removed from the set" red mut_no_pick_frame

# 6. The frame survives but stops asserting the trade — back to being a photo of
#    a button, which is what shot 01 already was.
mut_no_trade_assert() {
  python3 - "$WORK/tools/review-shots.mjs" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
start = s.index('  // Two assertions, and the second is the one r166 exists for.')
end = s.index("  console.log(\n    `  23 pick:")
s = s[:start] + s[end:]
open(p,'w').write(s)
PY
}
run_case "pick frame no longer asserts the trade" red mut_no_trade_assert

# 6b. The alignment assertion dropped. The label still flips and the seats still
#     trade, so a screenshot-only check stays green — while `views` and `sim`
#     could disagree, which is a player steering the wrong body: invisible in a
#     photograph, fatal in play. This is the case that makes `seats()` two lists.
mut_no_align() {
  python3 - "$WORK/tools/review-shots.mjs" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("  const aligned = after.views.join('>') === after.sim.join('>');\n", "")
s = s.replace("if (!traded || !aligned || !labelFlipped) {", "if (!traded || !labelFlipped) {")
s = s.replace("traded=${traded} aligned=${aligned} label=${labelFlipped}", "traded=${traded} label=${labelFlipped}")
open(p,'w').write(s)
PY
}
run_case "sim/draw alignment assertion removed" red mut_no_align

# 7. The pick frame reached only through ?as= — photographing a state nobody
#    reaches the way a player reaches it.
mut_query_param() {
  python3 - "$WORK/tools/review-shots.mjs" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });\n  const swap",
              "await page.goto(`${BASE}/?as=habibi`, { waitUntil: 'networkidle' });\n  const swap")
open(p,'w').write(s)
PY
}
run_case "pick frame navigates by ?as= not the button" red mut_query_param

# 8. Restored — proves the harness leaves a working tree and that the guards are
#    not passing for some ambient reason.
run_case "restored after every mutation" green true

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]