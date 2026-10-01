#!/usr/bin/env bash
# Mutation harness for tools/verify-deploy.sh.
#
# A gate that has only ever returned 0 is a guess about a mechanism, not a fact
# about this code. This project has shipped three gates that could not fail (r110,
# r123, and the one whose absence let round 141's stale deploy pass as a green
# 200), so the evidence that verify-deploy.sh CAN fail is part of the deliverable
# and it is re-runnable rather than a claim in a log file.
#
# Six cases. Each builds a real directory, serves it over real HTTP with a real
# server, runs the real gate, and asserts BOTH the exit code AND that the failure
# names the right thing — a gate that goes red for the wrong reason is broken in
# the way that is hardest to notice, because it still looks red.
#
#   1  positive   a faithful copy of dist served as-is       -> exit 0
#   2  stale      served index.html names OLD hashed assets  -> exit 1, html branch
#   3  wrong      right asset NAME, different BYTES          -> exit 1, byte branch
#   4  missing    asset named by the html is not on the wire -> exit 1, fetch branch
#   5  dead       origin refuses the connection              -> exit 1
#   6  nodist     the gate is pointed at an absent build     -> exit 2
#
# Case 2 is round 141 reproduced exactly. Case 3 is the one that would still have
# passed on a names-only check.
#
# Every case runs in the SAME directory tree layout as production — index.html at
# the root, hashed assets under assets/ — so a gate that hardcodes an assumption
# about the layout is caught here rather than on the arcade.
set -uo pipefail

REPO="/Users/shoemoney/Projects/sm-karate-kids"
GATE="$REPO/tools/verify-deploy.sh"
DIST="$REPO/apps/game/dist"

[[ -x "$GATE" ]] || { echo "harness: gate is not executable" >&2; exit 2; }
[[ -d "$DIST" ]] || { echo "harness: no local dist — run pnpm build first" >&2; exit 2; }

WORK="$(mktemp -d)"
SERVER_PID=""
PORT=""
URL=""

stop_server() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    SERVER_PID=""
  fi
}
cleanup() { stop_server; rm -rf "$WORK"; }
trap cleanup EXIT

free_port() {
  python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()' 2>/dev/null
}

# Polls the socket rather than sleeping a fixed amount. A fixed sleep is a race
# that reports "connection refused" on a loaded box and gets filed as an
# environment failure instead of a real one — which is how three rounds of this
# loop lost a cycle to the costume rather than the cause.
wait_for_server() {
  local i
  for i in $(seq 1 80); do
    if curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:$PORT/index.html" 2>/dev/null; then
      return 0
    fi
    if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      return 1
    fi
    sleep 0.25
  done
  return 1
}

# Sets the globals PORT and URL; never runs in a subshell, or SERVER_PID would be
# set in the subshell and every server would leak for the life of the harness.
serve() {
  local dir="$1" i
  for i in 1 2 3 4 5; do
    PORT="$(free_port)"
    if [[ -z "$PORT" ]]; then echo "harness: could not pick a port" >&2; return 1; fi
    ( cd "$dir" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 ) \
      >/dev/null 2>&1 &
    SERVER_PID=$!
    URL="http://127.0.0.1:$PORT/"
    if wait_for_server; then return 0; fi
    stop_server
  done
  echo "harness: server never came up on 5 ports" >&2
  return 1
}

PASS=0
FAIL=0
CASE_N=0

# run_case <name> <expect_exit> <expect_grep|-> <dist_override>
run_case() {
  local name="$1" want_exit="$2" want_grep="$3" dist_override="$4"
  CASE_N=$((CASE_N + 1))
  local out st problems=""
  out="$(SMKK_DIST="$dist_override" "$GATE" "$URL" 2>&1)"
  st=$?

  [[ $st -eq $want_exit ]] || problems="$problems exit=$st want=$want_exit"
  if [[ "$want_grep" != "-" ]]; then
    printf '%s' "$out" | grep -q -- "$want_grep" \
      || problems="$problems message-missing:'$want_grep'"
  fi
  # The two ways a gate lies without looking broken: OK with nothing verified,
  # and OK printed on a run that failed. Both are asserted on EVERY case.
  if [[ $st -eq 0 ]] && ! printf '%s' "$out" | grep -q '^OK '; then
    problems="$problems ok-without-OK-line"
  fi
  if [[ $st -ne 0 ]] && printf '%s' "$out" | grep -q '^OK '; then
    problems="$problems printed-OK-while-failing"
  fi

  if [[ -z "$problems" ]]; then
    PASS=$((PASS + 1))
    printf '  ok    %-9s exit=%s\n' "$name" "$st"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  %-9s exit=%s (want %s) [%s]\n' "$name" "$st" "$want_exit" "$problems"
    printf '%s\n' "$out" | sed 's/^/          | /' | head -12
  fi
}

echo "deploy-gate mutation harness"
echo "  gate: $GATE"
echo "  dist: $DIST"
echo

# ---------------------------------------------------------------- 1 positive
echo "[1/6] positive control — a faithful copy of the real build"
D1="$WORK/good"; mkdir -p "$D1"; cp -R "$DIST"/. "$D1"/
serve "$D1" || exit 1
run_case "positive" 0 "-" "$DIST"
stop_server

# ---------------------------------------------------------------- 2 stale names
# Round 141 verbatim: the origin answers 200 with a coherent build from two hours
# ago. The names disagree with what was just built; nothing else is wrong with it.
echo "[2/6] stale deploy — served html names older hashed assets (the r141 shape)"
D2="$WORK/stale"; mkdir -p "$D2/assets"
OLD_JS="assets/index-STALEold1.js"
OLD_CSS="assets/index-STALEold1.css"
printf 'console.log("stale build");\n' >"$D2/$OLD_JS"
cp "$DIST"/assets/*.css "$D2/$OLD_CSS"
sed -e "s|assets/index-[A-Za-z0-9_-]*\.js|$OLD_JS|g" \
    -e "s|assets/index-[A-Za-z0-9_-]*\.css|$OLD_CSS|g" \
    "$DIST/index.html" >"$D2/index.html"
serve "$D2" || exit 1
run_case "stale" 1 "NOT the local build" "$DIST"
stop_server

# ---------------------------------------------------------------- 3 wrong bytes
# The shape a names-only gate cannot see: index.html landed, the asset it names
# did not. This is what a half-finished transfer leaves behind.
echo "[3/6] right name, wrong bytes — the case a names-only check would pass"
D3="$WORK/wrongbytes"; mkdir -p "$D3"; cp -R "$DIST"/. "$D3"/
for f in "$D3"/assets/*.js; do
  printf '\n/* one build out of date */\n' >>"$f"
done
serve "$D3" || exit 1
run_case "wrongbytes" 1 "DIFFERENT BYTES" "$DIST"
stop_server

# ---------------------------------------------------------------- 4 asset absent
# The html is byte-identical to the build and the name exists locally, so every
# check short of fetching the asset over the wire says yes. Only the wire can
# say no, and `curl -f` is what makes the 404 an error instead of a body.
echo "[4/6] asset named by the html is not on the wire"
D4="$WORK/missing"; mkdir -p "$D4"; cp -R "$DIST"/. "$D4"/
rm -f "$D4"/assets/*.js
serve "$D4" || exit 1
run_case "missing" 1 "curl exit" "$DIST"
stop_server

# ---------------------------------------------------------------- 5 dead origin
echo "[5/6] origin refuses the connection"
PORT="$(free_port)"
URL="http://127.0.0.1:$PORT/"
run_case "dead" 1 "curl exit" "$DIST"

# ---------------------------------------------------------------- 6 absent build
# The gate pointed at nothing must refuse. Without this branch the gate would
# compare a missing file to whatever came back and report a mismatch, which reads
# as a deploy problem instead of the operator problem it actually is.
echo "[6/6] the gate is pointed at a build that does not exist"
D6="$WORK/empty"; mkdir -p "$D6"
serve "$D1" || exit 1
run_case "nodist" 2 "no local build" "$D6"
stop_server

echo
echo "harness: $PASS passed, $FAIL failed, $CASE_N cases"
[[ $FAIL -eq 0 ]] || exit 1
echo "the gate can fail, for the right reasons, and says which reason"