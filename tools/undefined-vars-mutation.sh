#!/usr/bin/env bash
# Prove tools/undefined-vars.py can FAIL — and can stay quiet when it should.
#
# A gate that can only ever say FAIL is as useless as one that can only say
# pass, and this tool's first draft did the former: it reported all 612 var()
# uses as undefined, including `--text`, which line 60 declares. It exited 1
# correctly and was wrong about everything. The second draft then flagged
# `var(--peak, 0.5)` — a WORKING fallback on an undeclared token — as a defect,
# which is the failure that teaches a reader to ignore the output.
#
# So this harness asserts BOTH directions, and case 4 is the one that matters
# most: a false positive on a working fallback.
#
# Self-locating via BASH_SOURCE, so a mutated copy of THIS harness exercises the
# copy of the tool sitting beside it — the defect r156 found in css-literals'.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TOOL="$HERE/undefined-vars.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/apps/game/src" "$WORK/tools"
cp "$REPO/apps/game/src/styles.css" "$WORK/apps/game/src/styles.css"
cp "$TOOL" "$WORK/tools/undefined-vars.py"
CSSF="$WORK/apps/game/src/styles.css"

PASS=0; FAIL=0
ok()  { echo "  ok   $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; echo "       $2"; FAIL=$((FAIL+1)); }
run() { (cd "$WORK" && python3 tools/undefined-vars.py 2>&1); }
exitof() { (cd "$WORK" && python3 tools/undefined-vars.py >/dev/null 2>&1); echo $?; }
restore() { cp "$REPO/apps/game/src/styles.css" "$CSSF"; }

echo "case 1 — honest baseline"
E=$(exitof)
[[ "$E" == "0" ]] && ok "every var() reads a declared token, exit 0" || bad "baseline" "exit=$E"
[[ "$(run | grep -c 'every var() reads')" == "1" ]] && ok "says so in words" || bad "baseline message" "no verdict line"

echo "case 2 — a var() reading an UNDECLARED token must be reported"
printf '\n.probe-undefined { color: var(--no-such-token); }\n' >> "$CSSF"
E=$(exitof); R=$(run | grep -c -- '--no-such-token')
[[ "$E" == "1" && "$R" -ge 1 ]] && ok "flagged, exit 1" || bad "undeclared token" "exit=$E rows=$R"
restore

echo "case 3 — a token declared only inside a COMMENT is still undeclared"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace(".tech-rules {", "/* --leading-relaxed: 1.5; */\n.tech-rules {\n  line-height: var(--leading-relaxed);",1)
open(p,'w').write(s)
PY
E=$(exitof); R=$(run | grep -c -- '--leading-relaxed')
[[ "$E" == "1" && "$R" -ge 1 ]] && ok "comment is not a declaration (the r153 trap)" || bad "comment token" "exit=$E rows=$R"
restore

echo "case 4 — an undeclared token WITH a fallback must NOT be reported"
# The false positive this tool actually shipped. `var(--peak, 0.5)` on a token
# that does not exist computes to 0.5: the declaration is valid and the author
# chose the outcome. Flagging it teaches the reader to ignore the tool.
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s += "\n.probe-fallback { opacity: var(--also-missing, 0.5); }\n"
open(p,'w').write(s)
PY
E=$(exitof); R=$(run | grep -c -- '--also-missing')
[[ "$E" == "0" && "$R" == "1" ]] && ok "listed as safe, exit 0" || bad "fallback false positive" "exit=$E rows=$R (a working fallback must not fail the gate)"
restore

echo "case 5 — a token declared ONLY inside body.high-contrast is still declared"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("body.high-contrast {\n","body.high-contrast {\n  --hc-only-token: #445566;\n",1)
s += "\n.probe-hc { color: var(--hc-only-token); }\n"
open(p,'w').write(s)
PY
E=$(exitof)
[[ "$E" == "0" ]] && ok "declared on any selector counts, exit 0" || bad "hc declaration" "exit=$E"
restore

echo "case 6 — a token declared by @property counts"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s += "\n@property --at-property-token { syntax: '<color>'; inherits: true; initial-value: #fff; }\n"
s += "\n.probe-at { color: var(--at-property-token); }\n"
open(p,'w').write(s)
PY
E=$(exitof)
[[ "$E" == "0" ]] && ok "@property declaration honoured, exit 0" || bad "@property" "exit=$E"
restore

echo "case 7 — comment stripping preserves RAW line numbers"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s += "\n/* a comment\n   spanning lines */\n.probe-line { color: var(--line-check); }\n"
open(p,'w').write(s)
PY
RAW=$(python3 - "$CSSF" <<'PY'
import sys
for i,l in enumerate(open(sys.argv[1]).read().splitlines(),1):
    if '--line-check' in l and 'var(' in l: print(i); break
PY
)
GOT=$(run | sed -n 's/^ *\([0-9]\{1,\}\)  --line-check$/\1/p' | head -1)
[[ -n "$GOT" && "$GOT" == "$RAW" ]] && ok "reported at raw line $RAW" || bad "line drift" "tool said '$GOT', raw says '$RAW' — positions would lie"
restore

echo "case 8 — NEGATIVE CONTROL: break the tool and require the harness to notice"
# Without this the seven cases above are only claims about the tool. Reinstating
# the membership-omission bug must make cases 1, 4, 5 and 6 go red.
python3 - "$WORK/tools/undefined-vars.py" <<'PY'
import sys
t=sys.argv[1]; s=open(t).read()
old='            elif name not in declared:'
assert old in s, "TOOL SHAPE CHANGED — this case patches a line the tool no longer has"
open(t,"w").write(s.replace(old,"            else:"))
PY
E=$(exitof); R=$(run | grep -c 'resolve to nothing')
[[ "$E" == "1" && "$R" -ge 1 ]] && ok "omitted membership test -> everything fails, exit 1" \
  || bad "negative control" "exit=$E — a mutation that did not apply reads exactly like one the tool survives"
cp "$TOOL" "$WORK/tools/undefined-vars.py"

echo
echo "$PASS passed, $FAIL failed"
if [[ "$FAIL" -ne 0 ]]; then exit 1; fi
exit 0
