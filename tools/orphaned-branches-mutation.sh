#!/usr/bin/env bash
# Prove tools/orphaned-branches.py can FAIL.
#
# r170 built that gate after finding four `body.no-backdrop-filter` branches no
# source file could take — a fallback for renderers without `backdrop-filter`
# that therefore fired on no renderer at all. The gate is only worth having if
# it goes red on exactly that, and stays green when it should.
#
# A gate that cannot fail is worse than no gate, because it is a gate that
# looks like it is looking. r151: `verify_shots.py` returned a passing `motion
# 12.08` over eight frames of a game that never ran. So every branch here is
# asserted, including the ones that must stay GREEN.
#
# The instrument trap this harness exists to rule out: `pixel-identity.mjs` used
# to APPLY `no-backdrop-filter` to <body> by hand so it could measure the branch.
# A probe built that way manufactures the state it measures, so it reported a
# verified fallback for a fallback no player could reach. This gate reads source
# instead, and case 4 below is the direct counter-example.
#
# Each case mutates a THROWAWAY COPY of the stylesheet and points the tool at
# it. Real repo files are never touched.
set -uo pipefail
# Self-locating, so a MUTATED COPY of this harness still exercises the copy of
# the tool sitting next to it — the css-literals harness's r157 lesson, where the
# harness reached past the mutation and copied the pristine tool out of the repo.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TOOL="$HERE/orphaned-branches.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The tool resolves the stylesheet as ROOT/apps/game/src/styles.css, where ROOT
# is the tool's own parent.parent, so the copy has to sit at tools/ inside the
# fixture root.
mkdir -p "$WORK/apps/game/src" "$WORK/tools"
cp "$REPO/apps/game/src/styles.css" "$WORK/apps/game/src/styles.css"
cp "$TOOL"                          "$WORK/tools/orphaned-branches.py"
# The app source has to come along, and this harness's first version left it
# behind: the fixture held only styles.css and index.html, so NO class had a
# source that could set it and the tool reported all six unreachable. Baseline
# first caught it — six red cases where the subject was fine and the fixture was
# wrong, which is the r155 lesson arriving on schedule. The tool was right; the
# harness was measuring a tree that does not exist.
for f in "$REPO"/apps/game/src/*.ts; do cp "$f" "$WORK/apps/game/src/"; done
cp "$REPO/apps/game/index.html"      "$WORK/apps/game/index.html"

PASS=0; FAIL=0
ok()  { echo "  ok   $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; echo "       $2"; FAIL=$((FAIL+1)); }
run()    { (cd "$WORK" && python3 tools/orphaned-branches.py 2>&1); }
exitof() { (cd "$WORK" && python3 tools/orphaned-branches.py >/dev/null 2>&1); echo $?; }
names()  { run | sed -n 's/^  body\.\([A-Za-z][A-Za-z0-9_-]*\) .*NEVER SET.*/\1/p'; }
linesof(){ run | sed -n "s/^  body\.$1  (styles.css line(s) \([0-9,]*\)).*/\1/p"; }
restore(){ cp "$REPO/apps/game/src/styles.css" "$WORK/apps/game/src/styles.css"; }

CSSF="$WORK/apps/game/src/styles.css"
FAILS=0

echo "case 1 — honest baseline: every body branch reachable (runs FIRST)"
E=$(exitof); OUT=$(run)
REACH=$(printf '%s\n' "$OUT" | sed -n 's/^  \([0-9]*\)\/\([0-9]*\) body branches are reachable.*/\1/p' | tail -1)
[[ "$E" == "0" && "$REACH" == "6" ]] \
  && ok "exit 0, 6/6 reachable" \
  || bad "baseline" "exit=$E reachable=$REACH (expected exit 0 and 6)"

echo "case 2 — the r170 defect: body.no-backdrop-filter restored"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
needle='@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {\n    .hud-actions .icon-btn {'
assert needle in s, "fixture anchor missing — the @supports block moved; retune this harness"
s=s.replace(needle,'body.no-backdrop-filter .hud-actions .icon-btn {')
open(p,'w').write(s)
PY
E=$(exitof); N=$(names)
[[ "$E" == "1" && "$N" == "no-backdrop-filter" ]] \
  && ok "flagged by name, exit 1" \
  || bad "dead branch not caught" "exit=$E names='$N' (expected exit 1 naming no-backdrop-filter)"
restore

echo "case 3 — an ARBITRARY class no source sets must also be flagged"
printf '\nbody.probe-never-set .thing {\n  color: var(--text);\n}\n' >> "$CSSF"
E=$(exitof); N=$(names)
[[ "$E" == "1" && "$N" == "probe-never-set" ]] \
  && ok "not hardcoded to the known class, exit 1" \
  || bad "arbitrary dead branch" "exit=$E names='$N'"
restore

echo "case 4 — a class named only inside a COMMENT must NOT be flagged"
# The r153 shape: a comment-blind scanner counts prose. The r170 stylesheet
# names body.no-backdrop-filter in THREE comments describing the fix, so a tool
# that did not strip comments would report the fix as the defect — which is
# also why strip_comments() must preserve line numbers, asserted in case 5.
cat >> "$CSSF" <<'EOF'

/* Historical note: body.probe-in-comment used to gate a fallback plate, and
 * body.probe-in-comment-2 was the other half of it. Neither can happen. */
EOF
E=$(exitof); N=$(names)
[[ "$E" == "0" && -z "$N" ]] \
  && ok "comment prose ignored, exit 0" \
  || bad "comment counted as a branch" "exit=$E names='$N' (the r153 comment bug)"
restore

echo "case 5 — comment stripping must not move a line number"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
# A five-line comment immediately ABOVE a dead branch, so the branch's raw line
# and its post-strip line differ by five unless the strip preserves numbering.
s += "\n/* one\n * two\n * three\n * four\n */\nbody.probe-lines .x {\n  color: var(--text);\n}\n"
open(p,'w').write(s)
PY
E=$(exitof); GOT=$(linesof "probe-lines")
RAW=$(python3 - "$CSSF" <<'PY'
import sys
for i,l in enumerate(open(sys.argv[1]).read().splitlines(),1):
    if 'body.probe-lines' in l: print(i); break
PY
)
[[ -n "$GOT" && "$GOT" == "$RAW" && "$E" == "1" ]] \
  && ok "reported at raw line $RAW after a 5-line comment" \
  || bad "line drift" "tool said '$GOT', raw file says '$RAW', exit=$E"
restore

echo "case 6 — a class set from source must stay reachable (control, must be GREEN)"
# Without this the harness cannot distinguish 'detects dead branches' from
# 'always exits 1'. An instrument that flags everything is not a gate.
printf '\nbody.probe-set-by-source .x {\n  color: var(--text);\n}\n' >> "$CSSF"
python3 - "$WORK/apps/game/index.html" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace('<body','<body data-x="probe-set-by-source"',1) if '<body' in s else s
open(p,'w').write(s)
PY
E=$(exitof); OUT=$(run)
REACH=$(printf '%s\n' "$OUT" | sed -n 's/^  \([0-9]*\)\/\([0-9]*\) body branches are reachable.*/\1/p' | tail -1)
[[ "$E" == "0" && "$REACH" == "7" ]] \
  && ok "7/7 reachable, exit 0 — the gate is not constant-red" \
  || bad "reachable class flagged" "exit=$E reachable=$REACH (expected exit 0 and 7)"
restore

echo "case 7 — a bare (unquoted) mention in source must NOT count as setting it"
# `classList.add('x')` is a quoted literal; `// someday: probe-set-by-source` is
# prose. Accepting the unquoted form is how a dead branch would survive the gate.
# The quoted literal from case 6 must be gone BEFORE this case, or the class is
# still legitimately settable and the case measures its own leftover. First run:
# index.html was restored after case 7 instead of before it, so this passed for
# the wrong reason — exit 0 with the class reachable from case 6's fixture.
cp "$REPO/apps/game/index.html" "$WORK/apps/game/index.html"
printf '\nbody.probe-set-by-source .x {\n  color: var(--text);\n}\n' >> "$CSSF"
printf '\n<!-- TODO: wire up probe-set-by-source someday -->\n' >> "$WORK/apps/game/index.html"
E=$(exitof); N=$(names)
[[ "$E" == "1" && "$N" == "probe-set-by-source" ]] \
  && ok "unquoted mention rejected, exit 1" \
  || bad "unquoted mention accepted" "exit=$E names='$N'"
restore

echo "case 8 — a MISSING stylesheet is INCONCLUSIVE (exit 2), never a failure"
# Operator error must not read as a defect, or the gate gets deleted after the
# first time someone moved a file — the verify-deploy r141 lesson.
mv "$CSSF" "$CSSF.hidden"
E=$(exitof)
[[ "$E" == "2" ]] \
  && ok "exit 2, not 1" \
  || bad "missing file verdict" "exit=$E (expected 2 — INCONCLUSIVE)"
mv "$CSSF.hidden" "$CSSF"

echo "case 9 — a stylesheet with NO body branch is INCONCLUSIVE (exit 2)"
# The wrong file, or a refactor that removed every branch. Reporting "0 dead"
# would be a confident answer to a question nobody asked.
printf '.result {\n  color: var(--text);\n}\n' > "$CSSF"
E=$(exitof)
[[ "$E" == "2" ]] \
  && ok "exit 2, not a clean 0" \
  || bad "empty-census verdict" "exit=$E (expected 2)"
restore

echo
echo "harness self-check — the tool copy is the one next to this harness"
CMP=$(cmp -s "$TOOL" "$WORK/tools/orphaned-branches.py" && echo same || echo differs)
[[ "$CMP" == "same" ]] && ok "fixture holds the tool beside the harness" || bad "tool copy" "the fixture's tool $CMP from the harness's"

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" == "0" ]] || exit 1