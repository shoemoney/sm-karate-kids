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
# Reproduces the ACTUAL r160 production condition, offline: the served markup is
# this build's with the two .key-hint spans removed, which is byte-for-byte the
# markup that has been live since before r135 (verified against the real origin).
# It keeps its asset tags, so arm 4's pin is reached instead of the exit-2 branch.
stale_markup()  { cp -R "$SRC/." "$WORK/build/"; cp -R "$SRC/." "$WORK/served/"
                  grep -v 'class="key-hint"' "$WORK/served/index.html" > "$WORK/i.$$" \
                    && mv "$WORK/i.$$" "$WORK/served/index.html"; }
no_build()      { cp -R "$SRC/." "$WORK/served/"; }

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
run_case "stale markup is pinned to a revision" 1 "pinned" stale_markup
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

echo
if [ "$FAIL" -eq 0 ]; then echo "=== $PASS passed, 0 failed ==="; exit 0; fi
echo "=== $PASS passed, $FAIL FAILED ==="; exit 1
