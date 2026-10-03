#!/usr/bin/env bash
# Proves tools/production-freshness.py can fail, over a real local HTTP server.
#
# WHY THIS HARNESS EXISTS. The gate found at r160 is the simplest kind: compare
# what the origin serves against what this tree built. The way such a tool goes
# wrong is not by being complicated, it is by being unable to reach its own
# verdict — and this repo has now been bitten by that three separate ways:
#
#   * r155  verify_shots.py returned "motion 12.08" on a set with no gameplay
#   * r159  a keyboard-journey assertion was true of the resting state
#   * r160  this tool's own first draft FILTERED served asset names down to the
#           ones present locally, so on a stale deploy — the one case it exists
#           for — it found no names at all and printed "run the build first"
#
# So every case here asserts an exit code AND greps the diagnosis, and the
# baseline runs FIRST: a harness whose fixture is wrong measures a broken probe
# and reports it as 6 tidy passes.
#
# Never touches the network. Serves fixtures on a throwaway port and tears the
# server down whether or not a case fails.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="$ROOT/tools/production-freshness.py"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/smkk-fresh-XXXXXX")"
PORT=$(( 20000 + RANDOM % 20000 ))
PASS=0; FAIL=0
SERVER_PID=""

cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

note() { printf '  %-6s %s\n' "$1" "$2"; }
ok()   { PASS=$((PASS+1)); note "ok" "$1"; }
bad()  { FAIL=$((FAIL+1)); note "FAIL" "$1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; }

start_server() {
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WORK/served" >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    curl -fsS "http://127.0.0.1:$PORT/index.html" -o /dev/null 2>/dev/null && return 0
    sleep 0.1
  done
  echo "harness: fixture server never came up on $PORT" >&2; exit 2
}
stop_server() { [ -n "$SERVER_PID" ] && { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; }; SERVER_PID=""; }

# run <case> <expect-rc> <grep-pattern|-> <fixture-fn>
run_case() {
  local name="$1" want_rc="$2" want_grep="$3" fixture="$4"
  rm -rf "$WORK/served" "$WORK/build"; mkdir -p "$WORK/served" "$WORK/build"
  "$fixture"
  start_server
  local out rc
  out="$(python3 "$PROBE" --origin "http://127.0.0.1:$PORT/" --build "$WORK/build" \
          --repo "$ROOT" 2>&1)"; rc=$?
  stop_server
  if [ "$rc" != "$want_rc" ]; then
    bad "$name" "exit $rc, wanted $want_rc"; printf '%s\n' "$out" | sed 's/^/         | /'; return
  fi
  if [ "$want_grep" != "-" ] && ! printf '%s' "$out" | grep -qF -- "$want_grep"; then
    bad "$name" "missing diagnosis: $want_grep"; printf '%s\n' "$out" | sed 's/^/         | /'; return
  fi
  ok "$name"
}

# ---- fixtures -----------------------------------------------------------------
SRC="$ROOT/apps/game/dist"
need_src() { [ -f "$SRC/index.html" ] || { echo "harness: run pnpm build first ($SRC/index.html absent)" >&2; exit 2; }; }
need_src

faithful()      { cp -R "$SRC/." "$WORK/build/"; cp -R "$SRC/." "$WORK/served/"; }
stale_html()    { cp -R "$SRC/." "$WORK/build/"; cp -R "$SRC/." "$WORK/served/"
                  sed -i '' 's/SM Karate Kids: Asmongold vs HasanAbi/SM Karate Kids: stale build/' \
                      "$WORK/served/index.html"; }
stale_asset()   { cp -R "$SRC/." "$WORK/build/"; cp -R "$SRC/." "$WORK/served/"
                  for f in "$WORK"/served/assets/*.js "$WORK"/served/assets/*.css; do
                    [ -f "$f" ] && printf '\n/* an older body */\n' >> "$f"
                  done; }
no_assets()     { cp -R "$SRC/." "$WORK/build/"; cp -R "$SRC/." "$WORK/served/"
                  python3 - "$WORK/served/index.html" <<'PY'
import re, sys
p = sys.argv[1]
text = open(p, encoding='utf-8').read()
open(p, 'w', encoding='utf-8').write(
    re.sub(r'^\s*<(script|link)\b.*?\b(module|stylesheet)\b.*?>\s*$', '', text, flags=re.M))
PY
                }
# Reproduces a REAL historical revision BY CONSTRUCTION.
#
# This fixture used to delete the .key-hint spans from the CURRENT markup and
# assume the remainder was the revision that predated them. That was true while
# the newest revision of apps/game/index.html was the one that introduced
# .key-hint. r163 then added a focus-pause block on top of it, so "current minus
# .key-hint" stopped being any revision that ever existed, and arm 4 correctly
# reported "matches NO revision" — a true statement about a fixture that had
# gone stale, not about the probe. Found at r164, still red on the pristine
# probe from HEAD, which is how it was attributed rather than guessed at.
#
# The delta is now read out of git instead of assumed, so the next revision of
# index.html cannot break it. The asset tags are carried over from the built
# html so arm 3 still has names to fetch (a page naming no assets exits 2).
stale_markup()  { cp -R "$SRC/." "$WORK/build/"; cp -R "$SRC/." "$WORK/served/"
                  python3 - "$WORK/served/index.html" "$ROOT" <<'PY'
import re, subprocess, sys
served, repo = sys.argv[1], sys.argv[2]
def git(*a):
    return subprocess.run(['git', '-C', repo, *a], capture_output=True, text=True).stdout
old = None
for sha in git('log', '--format=%H', '--', 'apps/game/index.html').split():
    text = git('show', f'{sha}:apps/game/index.html')
    if text and 'class="key-hint"' not in text:
        old = text
        break
if old is None:
    sys.exit('harness: no pre-key-hint revision of apps/game/index.html exists')
current = open(served, encoding='utf-8').read()
injected = [l for l in current.splitlines()
            if re.match(r'^\s*<(script|link)\b.*\b(module|stylesheet)\b.*>\s*$', l)]
open(served, 'w', encoding='utf-8').write(old.rstrip('\n') + '\n' + '\n'.join(injected) + '\n')
PY
                }

no_build()      { cp -R "$SRC/." "$WORK/served/"; }

# r164's shape: a bundle that names a source map the origin does not serve. The
# pointer is appended to BOTH sides so the bytes stay identical — that is the
# whole point. Byte-identity is green here, which is exactly why this defect
# needed its own arm instead of being left to arms 2 and 3.
dangling_ref()  { cp -R "$SRC/." "$WORK/build/"; cp -R "$SRC/." "$WORK/served/"
                  local rel
                  rel="$(cd "$WORK/served" && ls assets/*.js | head -1)"
                  printf '\n//# sourceMappingURL=index-GONE.js.map\n' >> "$WORK/served/$rel"
                  printf '\n//# sourceMappingURL=index-GONE.js.map\n' >> "$WORK/build/$rel"
                }
# The negative control for the same arm: the pointer resolves, so there is
# nothing to report. Without this the arm would pass by flagging every bundle
# that has a sourceMappingURL, which is a working configuration.
resolvable_ref() { dangling_ref
                  printf '{"version":3,"sources":[],"mappings":""}\n' \
                    > "$WORK/served/assets/index-GONE.js.map"
                  cp "$WORK/served/assets/index-GONE.js.map" "$WORK/build/assets/index-GONE.js.map"
                }

echo "production-freshness mutation harness"
echo "  port $PORT, fixtures under $WORK"
echo

# 1. baseline — must pass, or every case below measures a broken probe
run_case "baseline: served == built" 0 "OK  the served bytes are the built bytes" faithful

# 2. right names, right html, wrong asset bytes — the r141 case: index.html landed,
#    the bundle it names is the old one. Only arm 3 can catch this.
run_case "asset body differs under a correct html" 1 "MISMATCH" stale_asset

# 3. markup from another revision — must PIN it and print a commit distance, not
#    merely say "differs". This is the positive control for arm 4: a probe that
#    can only report "differs" has not measured how far behind.
#    The grep used to be the single word "pinned", which appears in BOTH the
#    success and the failure line — arm 4 prints "pinned  served markup matches
#    NO revision ..." too, so this assertion passed on a probe that had pinned
#    NOTHING. It is now the success line specifically. That weakness is why the
#    stale fixture above went unnoticed for a round.
run_case "stale markup is pinned to a revision" 1 "matches apps/game/index.html at" stale_markup

# arm 4 must produce a NUMBER, not just a verdict — assert the distance is printed
rm -rf "$WORK/served" "$WORK/build"; mkdir -p "$WORK/served" "$WORK/build"; stale_markup
start_server
pin_out="$(python3 "$PROBE" --origin "http://127.0.0.1:$PORT/" --build "$WORK/build" --repo "$ROOT" 2>&1)"
stop_server
if printf '%s' "$pin_out" | grep -qE '[0-9]+ commit\(s\) behind HEAD'; then ok "pin reports a commit distance"
else bad "pin reports a commit distance" "no 'N commit(s) behind' line"; printf '%s\n' "$pin_out" | sed 's/^/         | /'; fi
if printf '%s' "$pin_out" | grep -qF "UPPER BOUND"; then ok "pin labels itself an upper bound"
else bad "pin labels itself an upper bound" "no UPPER BOUND caveat"; fi

# 4. a page that names no assets is not a deploy
run_case "served html names no assets" 2 "names no assets at all" no_assets

# 5. dead origin -> INCONCLUSIVE, never STALE (standing rule 4)
rm -rf "$WORK/served" "$WORK/build"; mkdir -p "$WORK/served" "$WORK/build"; faithful
out="$(python3 "$PROBE" --origin "http://127.0.0.1:$((PORT+1))/" --build "$WORK/build" --repo "$ROOT" 2>&1)"; rc=$?
if [ "$rc" = 2 ] && printf '%s' "$out" | grep -qF "INCONCLUSIVE"; then ok "dead origin is INCONCLUSIVE, not STALE"
else bad "dead origin is INCONCLUSIVE, not STALE" "exit $rc"; printf '%s\n' "$out" | sed 's/^/         | /'; fi

# 6. no local build -> INCONCLUSIVE. A gate pointed at an absent dist must not
#    report the origin as stale.
run_case "absent local build" 2 "no local build" no_build

# 7. a served bundle pointing at a file the origin does not serve (r164). The
#    exit code stays 0 on purpose: the bytes ARE the built bytes, and "STALE"
#    means the origin disagrees with the build, which is false. What must not
#    happen is silence.
run_case "dangling sourceMappingURL is reported" 0 "DANGLING" dangling_ref

# 8. the negative control for arm 6 — the arm must not fire on a pointer that
#    resolves, or it is just "bundle has a sourceMappingURL" wearing a costume.
rm -rf "$WORK/served" "$WORK/build"; mkdir -p "$WORK/served" "$WORK/build"; resolvable_ref
start_server
res_out="$(python3 "$PROBE" --origin "http://127.0.0.1:$PORT/" --build "$WORK/build" --repo "$ROOT" 2>&1)"
stop_server
if printf '%s' "$res_out" | grep -q "OK  the served bytes"; then
  ok "resolvable sourceMappingURL stays silent"
else bad "resolvable sourceMappingURL stays silent" "not OK on a byte-identical origin"; printf '%s\n' "$res_out" | sed 's/^/         | /'; fi
if printf '%s' "$res_out" | grep -q "DANGLING"; then
  bad "arm 6 ignores a pointer that resolves" "reported DANGLING for a served map"; printf '%s\n' "$res_out" | sed 's/^/         | /'
else ok "arm 6 ignores a pointer that resolves"; fi

# 8b. THE REGRESSION THIS ROUND SHIPPED. Arm 6's first draft only inspected a
#     served bundle that MATCHED the local build, so it printed nothing on a
#     stale origin — which is exactly when the old, sourcemap-emitting build is
#     still live and the reference is dangling. Twelve green fixtures missed it
#     because every fixture that carried a pointer was byte-equal by
#     construction. Found by running the probe against the real origin, where a
#     plain curl showed the pointer and a 404 while the arm said nothing.
#     So: the pointer is on the SERVED side only, so the bundle MISMATCHES.
mismatched_dangling() { cp -R "$SRC/." "$WORK/build/"; cp -R "$SRC/." "$WORK/served/"
                  local rel
                  rel="$(cd "$WORK/served" && ls assets/*.js | head -1)"
                  printf '\n//# sourceMappingURL=index-GONE.js.map\n/* an older body */\n' >> "$WORK/served/$rel"
                }
run_case "a dangling pointer is reported on a MISMATCHING bundle" 1 "DANGLING" mismatched_dangling
# ...and the arm is still not just "the bundle differs": same mismatch, resolvable.
mismatched_resolvable() { mismatched_dangling
                  printf '{"version":3,"sources":[],"mappings":""}\n' \
                    > "$WORK/served/assets/index-GONE.js.map"
                }
rm -rf "$WORK/served" "$WORK/build"; mkdir -p "$WORK/served" "$WORK/build"; mismatched_resolvable
start_server
mres_out="$(python3 "$PROBE" --origin "http://127.0.0.1:$PORT/" --build "$WORK/build" --repo "$ROOT" 2>&1)"
stop_server
if printf '%s' "$mres_out" | grep -q "MISMATCH" && ! printf '%s' "$mres_out" | grep -q "DANGLING"; then
  ok "a mismatched bundle with a resolvable pointer is not flagged"
else bad "a mismatched bundle with a resolvable pointer is not flagged" "arm 6 flagged a resolvable reference"; printf '%s\n' "$mres_out" | sed 's/^/         | /'; fi

# 9. and the other direction: a healthy build must produce NO dangling line at
#    all, so the arm is not reporting something on every single run.
rm -rf "$WORK/served" "$WORK/build"; mkdir -p "$WORK/served" "$WORK/build"; faithful
start_server
base_out="$(python3 "$PROBE" --origin "http://127.0.0.1:$PORT/" --build "$WORK/build" --repo "$ROOT" 2>&1)"
stop_server
if printf '%s' "$base_out" | grep -q "DANGLING"; then
  bad "a faithful build reports nothing dangling" "DANGLING on an untouched build"; printf '%s\n' "$base_out" | sed 's/^/         | /'
else ok "a faithful build reports nothing dangling"; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "=== $PASS passed, 0 failed ==="; exit 0; fi
echo "=== $PASS passed, $FAIL FAILED ==="; exit 1
