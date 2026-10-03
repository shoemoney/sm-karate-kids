#!/usr/bin/env bash
# Prove tools/contrast-reach.py can FAIL.
#
# A census tool that prints "0 unreachable" because it cannot see a token is
# indistinguishable from a clean file, which is the tenth time this loop has hit
# that shape. Every branch below is one a plausible reader would get wrong.
#
# Each case mutates a THROWAWAY COPY and points the tool at it. The real
# stylesheet is never touched. Self-locating via BASH_SOURCE, so a mutated copy
# of THIS harness exercises the copy of the tool sitting beside it — the defect
# r156 found in its sibling harness.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TOOL="$HERE/contrast-reach.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/apps/game/src" "$WORK/tools"
cp "$REPO/apps/game/src/styles.css" "$WORK/apps/game/src/styles.css"
cp "$TOOL" "$WORK/tools/contrast-reach.py"

PASS=0; FAIL=0
ok()  { echo "  ok   $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; echo "       $2"; FAIL=$((FAIL+1)); }
run() { (cd "$WORK" && python3 tools/contrast-reach.py 2>&1); }
exitof() { (cd "$WORK" && python3 tools/contrast-reach.py >/dev/null 2>&1); echo $?; }
row()  { run | grep -F "$1" | head -1; }
CSSF="$WORK/apps/game/src/styles.css"
restore() { cp "$REPO/apps/game/src/styles.css" "$CSSF"; }

echo "case 1 — honest baseline"
E=$(exitof); R=$(row "settings sheet scrim")
[[ "$E" == "0" ]] && ok "all ten reach, exit 0" || bad "baseline" "exit=$E"
[[ "$R" == *"NO"* ]] && bad "baseline row" "$R" || ok "every site reads + re-points"
[[ "$(run | grep -c 'NEVER reached')" == "1" ]] && ok "census prints its unreachable count" || bad "census" "no count line"
UNREACH=$(run | sed -n 's/.*NEVER reached  *\([0-9]*\)/\1/p')
[[ "$UNREACH" == "11" ]] && ok "11 tokens unreachable" || bad "census number" "got '$UNREACH' want 11"

echo "case 2 — a token removed from :root must be reported"
sed -i '' 's/  --shadow-knob: rgb(0 0 0 \/ 0.6);//' "$CSSF"
R=$(row "settings switch knob shadow"); E=$(exitof)
[[ "$R" == *"NO"* && "$E" == "1" ]] && ok "missing from :root -> NO, exit 1" || bad "root declaration" "row='$R' exit=$E"
restore

echo "case 3 — a token's high-contrast re-point removed must be reported"
sed -i '' 's/  --shadow-knob: rgb(0 0 0 \/ 0.95);//' "$CSSF"
R=$(row "settings switch knob shadow"); E=$(exitof)
[[ "$R" == *"NO"* && "$E" == "1" ]] && ok "no re-point -> NO, exit 1" || bad "re-point" "row='$R' exit=$E"
restore

echo "case 4 — a site reverted to an inline literal must be reported"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("  box-shadow: 0 1px 2px var(--shadow-knob);","  box-shadow: 0 1px 2px rgb(0 0 0 / 0.6);")
open(p,'w').write(s)
PY
R=$(row "settings switch knob shadow"); E=$(exitof)
[[ "$R" == *"NO"* && "$E" == "1" ]] && ok "inline literal -> reads NO, exit 1" || bad "inline literal" "row='$R' exit=$E"
cp "$REPO/tools/css-literals.py" "$WORK/tools/css-literals.py"
LC=$( (cd "$WORK" && python3 tools/css-literals.py >/dev/null 2>&1); echo $? )
[[ "$LC" == "1" ]] && ok "css-literals.py rejects it too — two readers, one file" || bad "cross-check" "css-literals exit=$LC"
restore

echo "case 5 — a token nested in a SHORTHAND still counts as reading it"
# The first draft required `prop: var(` immediately after the colon, so the four
# sites whose token trails a shorthand — `box-shadow: 0 1px 2px var(--x)` — or
# sits inside a gradient reported ANCHOR GONE against a file that is correct.
# Reinstating that requirement must make the tool go red on exactly those.
#
# The mutation moved to the CHECK rather than the regex, and that is not
# cosmetic. The first version patched the `decl` regex to require `var(` after
# the colon, which REMOVED ITS CAPTURE GROUP — so `m.group(1)` raised
# IndexError, the tool died, and `exit 1` was earned by a traceback rather than
# by the behaviour under test. The `-ge 4` half of this assertion is what caught
# it (it read `gone=0`); the exit-code half alone would have passed. A harness
# case whose two halves disagree is telling you which one you actually tested.
python3 - "$WORK/tools/contrast-reach.py" <<'PY'
import sys
t = sys.argv[1]
s = open(t).read()
old = 'if m and re.search(rf"var\\(\\s*{re.escape(token)}\\s*[,)]", m.group(1)):'
new = 'if m and m.group(1).lstrip().startswith("var(") and re.search(rf"var\\(\\s*{re.escape(token)}\\s*[,)]", m.group(1)):'
assert old in s, "TOOL SHAPE CHANGED — this case patches a line the tool no longer has"
open(t, "w").write(s.replace(old, new))
PY
E=$(exitof); SH=$(run | grep -c 'ANCHOR GONE')
[[ "$E" == "1" && "$SH" -ge 4 ]] && ok "shorthand-only anchoring loses $SH sites, exit 1" \
  || bad "shorthand anchoring" "exit=$E gone=$SH — a mutation that did not apply reads exactly like one the tool survives"
cp "$TOOL" "$WORK/tools/contrast-reach.py"

echo "case 6 — a NEW unreachable token must appear in the census"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("  --space-1: 0.25rem;","  --probe-unreached: rgb(1 2 3 / 0.5);\n  --space-1: 0.25rem;")
open(p,'w').write(s)
PY
U2=$(run | sed -n 's/.*NEVER reached  *\([0-9]*\)/\1/p')
[[ "$U2" == "12" ]] && ok "census 11 -> 12" || bad "census growth" "got '$U2' want 12"
[[ "$(run | grep -c -- '--probe-unreached')" == "1" ]] && ok "named in the report" || bad "census naming" "not listed"
restore

echo "case 7 — a token added to BOTH blocks is reachable, not unreachable"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("  --space-1: 0.25rem;","  --probe-reached: #445566;\n  --space-1: 0.25rem;")
s=s.replace("body.high-contrast {\n","body.high-contrast {\n  --probe-reached: #aabbcc;\n",1)
open(p,'w').write(s)
PY
[[ "$(run | grep -c -- '--probe-reached')" == "0" ]] && ok "overridden token is NOT reported unreachable" || bad "false positive" "listed as unreachable"
restore

echo
echo "$PASS passed, $FAIL failed"
if [[ "$FAIL" -ne 0 ]]; then exit 1; fi
exit 0
