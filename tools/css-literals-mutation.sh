#!/usr/bin/env bash
# Prove tools/css-literals.py can FAIL.
#
# r155's standing lesson, applied: an instrument that reports a plausible
# number it never measured is worse than one that reports nothing. This tool
# exists to put a reproducible number behind the plan's "ten colour literals",
# so it has to be shown to go red — on every branch that can silently pass.
#
# Each case mutates a THROWAWAY COPY of the stylesheet and points the tool at
# it. Real repo file is never touched.
#
# r157 retuned this harness, because the code it tested against moved: the
# baseline went 10 -> 0, and case 5's fixture anchor
# (`body.high-contrast .setting-row input[...]{ background: #3a2d22 }`) was
# DELETED by the very fix it was written for. It asserted a hardcoded line, 2033,
# for a literal that is now a token on :root. A harness pinned to a line number
# is a harness pinned to a moment — which is the drift this plan keeps finding in
# prose, reproduced in the thing built to check the prose.
#
# The BRANCHES are unchanged and are still the ones that matter. Only the fixture
# shapes and the baseline number moved: case 5 now injects into a high-contrast
# descendant that still exists, and asserts the RAW line of the injected literal
# instead of a hardcoded one.
#
# Branches covered, and what each one is the r15x shape of:
#   1  honest baseline                    -> exit 0, 0
#   2  a literal added outside the tokens -> count goes UP, exit 1
#   3  a literal inside :root             -> excused, count UNCHANGED, exit 0
#      (rule 3 permits :root; a tool that flagged it would be wrong)
#   4  a literal inside a bare body.high-contrast -> excused, unchanged
#   5  a DESCENDANT of body.high-contrast  -> FLAGGED. This is the case the
#      first two drafts of the tool got wrong: both matched the allowance as a
#      whitespace token, and `body.high-contrast` IS the first token of the
#      descendant selector, so the hardcoded #3a2d22 was excused and the tool
#      reported 9 where the plan says 10.
#   6  a colour literal inside a COMMENT   -> NOT flagged. r153's own audit
#      counted 13 then 12 for exactly this, because the filter skipped lines
#      beginning with `*` and missed wrapped continuations.
#   7  comment stripping keeps line numbers -> a literal before and after a
#      multi-line comment must both be reported at their RAW file lines
set -uo pipefail
# Self-locating, so a MUTATED COPY of this harness still exercises the copy of
# the tool sitting next to it.
#
# The first version hardcoded REPO to the absolute repo path and then copied
# `$REPO/tools/css-literals.py` into the fixture. That made the harness
# untestable against its own subject: reverting the token-match bug in a
# scratch copy of the repo left all 8 cases GREEN, because the harness reached
# past the mutation and copied the pristine tool out of /Users/... . A mutation
# harness that cannot see the mutation it is meant to be testing is the
# fail-closed rule's whole subject, reproduced in the harness itself.
#
# So: REPO is derived from this script's own location, and the tool copied is
# the one sitting beside this script.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TOOL="$HERE/css-literals.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The tool resolves the stylesheet as ROOT/apps/game/src/styles.css, where ROOT
# is the tool's own parent.parent. So the copy has to sit at tools/ inside the
# fixture root — copying it to the root put it one level too high and every
# case died on FileNotFoundError with an EMPTY count, which is how the first
# run of this harness printed "0 passed, 8 failed" for a reason that had
# nothing to do with the branches it was testing.
mkdir -p "$WORK/apps/game/src" "$WORK/tools"
cp "$REPO/apps/game/src/styles.css" "$WORK/apps/game/src/styles.css"
cp "$TOOL" "$WORK/tools/css-literals.py"

PASS=0; FAIL=0
ok()   { echo "  ok   $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL $1"; echo "       $2"; FAIL=$((FAIL+1)); }
run()  { (cd "$WORK" && python3 tools/css-literals.py 2>&1); }
# BSD grep has no -P (no PCRE on macOS). Extract with sed instead.
count()  { run | sed -n 's/.*this run says \([0-9]*\).*/\1/p'; }
exitof() { (cd "$WORK" && python3 tools/css-literals.py >/dev/null 2>&1); echo $?; }
lineof() { (cd "$WORK" && python3 tools/css-literals.py 2>/dev/null) | grep -F "$1" | sed -n 's/^ *\([0-9][0-9]*\).*/\1/p' | head -1; }

CSSF="$WORK/apps/game/src/styles.css"

echo "case 1 — honest baseline"
C=$(count); E=$(exitof)
[[ "$C" == "0" && "$E" == "0" ]] && ok "0 literals, exit 0" || bad "baseline" "count=$C exit=$E (expected the ratchet 0)"

echo "case 2 — a NEW literal outside the token blocks must be flagged"
printf '\n.probe-outside { color: #123456; }\n' >> "$CSSF"
C=$(count); E=$(exitof)
[[ "$C" == "1" && "$E" == "1" ]] && ok "count 0 -> 1, exit 1" || bad "added literal" "count=$C exit=$E"
# undo
sed -i '' '/\.probe-outside/d' "$CSSF"

echo "case 3 — a literal INSIDE :root is permitted by rule 3"
python3 - "$CSSF" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read()
s=s.replace(":root {\n  color-scheme: dark;", ":root {\n  color-scheme: dark;\n  --probe-token: #123456;")
open(p,'w').write(s)
PY
C=$(count); E=$(exitof)
[[ "$C" == "0" && "$E" == "0" ]] && ok ":root literal excused, exit 0" || bad ":root allowance" "count=$C exit=$E"
cp "$REPO/apps/game/src/styles.css" "$CSSF"

echo "case 4 — a literal INSIDE bare body.high-contrast is permitted"
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("body.high-contrast {\n", "body.high-contrast {\n  --probe-hc: #abcdef;\n", 1)
open(p,'w').write(s)
PY
C=$(count); E=$(exitof)
[[ "$C" == "0" && "$E" == "0" ]] && ok "high-contrast literal excused, exit 0" || bad "hc allowance" "count=$C exit=$E"
cp "$REPO/apps/game/src/styles.css" "$CSSF"

echo "case 5 — a DESCENDANT of body.high-contrast must be FLAGGED (the r156 defect)"
# Inject a literal into a high-contrast DESCENDANT selector that still exists.
# `body.high-contrast` is the first whitespace token of that selector, so both
# early drafts of the tool excused it — by matching the allowance as a substring,
# then as a whitespace token — which is how `#3a2d22` went uncounted until r156.
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
needle='body.high-contrast .setting-row input[type="checkbox"] {\n  border-color: var(--text-ghost);'
assert needle in s, "fixture anchor missing — the real file changed again"
s=s.replace(needle, 'body.high-contrast .setting-row input[type="checkbox"] {\n  color: #ff00ff;\n  border-color: var(--text-ghost);')
open(p,'w').write(s)
PY
C=$(count); E=$(exitof)
[[ "$C" == "1" && "$E" == "1" ]] && ok "descendant literal flagged, exit 1" || bad "descendant not flagged" "count=$C exit=$E (the token-match bug)"
# The injected literal must land at its RAW line. This case used to assert a
# hardcoded 2033, which the r157 fix made impossible — see the header.
RAW=$(python3 - "$CSSF" <<'PY'
import sys
for i,l in enumerate(open(sys.argv[1]).read().splitlines(),1):
    if '#ff00ff' in l: print(i); break
PY
)
GOT=$(lineof '#ff00ff')
[[ -n "$GOT" && "$GOT" == "$RAW" ]] && ok "descendant literal at raw line $RAW" || bad "line position" "tool said '$GOT', raw file says '$RAW'"
cp "$REPO/apps/game/src/styles.css" "$CSSF"

echo "case 6 — a colour literal inside a COMMENT must NOT be counted"
cat >> "$CSSF" <<'EOF'

/* Measured off a review frame, quoted here as history:
   .thing { color: #ddeeff; }   <- prose, not code */
EOF
C=$(count); E=$(exitof)
[[ "$C" == "0" && "$E" == "0" ]] && ok "comment literal ignored, exit 0" || bad "comment counted" "count=$C exit=$E (r153's 13-vs-10 bug)"
cp "$REPO/apps/game/src/styles.css" "$CSSF"

echo "case 7 — comment stripping preserves RAW line numbers"
# Probe literals before and after a multi-line comment; both must be reported
# at their line in the real file.
python3 - "$CSSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s = s + "\n/* a\n multi\n line\n comment\n right here */\n.probe-after { color: #0abcde; }\n"
open(p,'w').write(s)
PY
RAW=$(python3 - "$CSSF" <<'PY'
import sys
for i,l in enumerate(open(sys.argv[1]).read().splitlines(),1):
    if '#0abcde' in l: print(i); break
PY
)
GOT=$(lineof '#0abcde')
[[ -n "$GOT" && "$GOT" == "$RAW" ]] && ok "post-comment literal at raw line $RAW" || bad "line drift" "tool said $GOT, raw file says $RAW"
cp "$REPO/apps/game/src/styles.css" "$CSSF"

echo
echo "$PASS passed, $FAIL failed"
# The FIRST version of this harness printed "0 passed, 8 failed" and STILL
# EXITED 0, because every assertion was `[[ ... ]] && ok || bad` and nothing
# turned the tally into a status. That is the worst possible shape for a
# mutation harness — it prints failures and reports success. The tally is now
# the exit code, and there is no path that reaches the end without it.
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
exit 0