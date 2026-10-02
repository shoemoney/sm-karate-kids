#!/usr/bin/env bash
# Proves tools/deploy.sh can FAIL, before anyone relies on its exit code.
#
# WHY. tools/verify-deploy.sh got a mutation harness at r141 and it immediately
# caught two real defects in the gate (an empty-but-present dist returning the
# wrong exit code, and the failure branch deleting its own evidence). The same
# standard applies here: a deploy script nobody has seen go red is a script whose
# green is an assumption.
#
# A deploy tool has a nastier failure surface than a verification gate, because
# it takes `--delete` to a live web root. The cases below are chosen for the ways
# this script could report success while doing nothing, or while removing
# something it should not have.
#
# IT NEVER TOUCHES PRODUCTION. Every case points DEPLOY_HOST/DEPLOY_PATH at a
# throwaway directory on the local machine, served by a real HTTP server on a
# free port, so the chain under test is the real one: rsync, nginx-shaped static
# serving, verify-deploy.sh over the wire. A harness that mocks the deploy target
# would not exercise the thing that is actually risky.
#
# USAGE  bash tools/deploy-mutation.sh
set -uo pipefail

REPO="/Users/shoemoney/Projects/sm-karate-kids"
DEPLOY="$REPO/tools/deploy.sh"
WORK="$(mktemp -d)"
PASS=0
FAIL=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
ok()   { say "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { say "  FAIL  $1"; say "        expected: $2"; say "        got:      $3"; FAIL=$((FAIL+1)); }

# A port the OS says is free, then confirmed free by binding it. Playwright's
# 4173 squatter problem applies to any fixed port on a busy machine.
PORT="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"

# A faithful copy of the real build, so the baseline case is a genuine pass and
# not a pass caused by an empty tree comparing equal to nothing.
SEED="$WORK/seed"
mkdir -p "$SEED"
cp -R "$REPO/apps/game/dist/." "$SEED/"

# A second, DIFFERENT build — same shape, different hashed names — because the
# interesting cases are all about a name changing, which is what real deploys do.
OTHER="$WORK/other"
mkdir -p "$OTHER"
cp -R "$SEED/." "$OTHER/"
( cd "$OTHER" && \
  mv assets/index-Ccf9hihb.js assets/index-MUTATION01.js && \
  mv assets/index-CHYzz0ub.css assets/index-MUTATION02.css && \
  perl -pi -e 's/index-Ccf9hihb\.js/index-MUTATION01.js/g; s/index-CHYzz0ub\.css/index-MUTATION02.css/g' index.html )

serve() {
  # python3 -m http.server rooted at $1, quiet, killed via its recorded pid.
  #
  # Readiness is "the port answers with SOME http status", not "index.html is
  # 200". Several cases below start the server on an empty root and only deploy
  # afterwards, so requiring a 200 makes the harness unable to tell a dead server
  # from a root that has not been written to yet — and it reported that as a
  # deploy failure, which is the one misdiagnosis rule 4 exists to prevent.
  ( cd "$1" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 ) \
    >"$WORK/http.log" 2>&1 &
  SRV_PID=$!
  local i code
  for i in $(seq 1 50); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 \
      "http://127.0.0.1:$PORT/index.html" 2>/dev/null || true)"
    case "$code" in
      2*|3*|4*) return 0 ;;   # the server is up and serving this root
    esac
    kill -0 "$SRV_PID" 2>/dev/null || return 1
    sleep 0.1
  done
  return 1
}
stop_serve() { kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; SRV_PID=""; }

run_deploy() {
  # Runs the deploy against the throwaway root. $1 = dist, $2 = extra args.
  bash "$DEPLOY" "$@" >"$WORK/out.txt" 2>&1
  echo $?
}

say "deploy mutation harness — root $WORK, port $PORT"
say ""

# ---------------------------------------------------------------- 1 dry run
ROOT="$WORK/t1"; mkdir -p "$ROOT"
DEPLOY_HOST=localhost DEPLOY_PATH="$ROOT" DEPLOY_BASE="http://127.0.0.1:$PORT/" \
  SMKK_DIST="$SEED" bash "$DEPLOY" >"$WORK/out.txt" 2>&1
st=$?
if serve "$ROOT" 2>/dev/null; then
  if [[ $st -eq 0 ]]; then ok "1. dry run exits 0"; else bad "1. dry run exits 0" "exit 0" "exit $st"; fi
  if [[ ! -f "$ROOT/index.html" ]]; then
    ok "1b. dry run sent nothing (no index.html on the target)"
  else
    bad "1b. dry run sent nothing" "target empty" "target has files"
  fi
  stop_serve
else
  bad "1. dry run" "http server starts" "server never answered"
fi

# ---------------------------------------------------------------- 2 real deploy
ROOT="$WORK/t2"; mkdir -p "$ROOT"
serve "$ROOT" 2>/dev/null || { say "  SKIP  2 — server would not start"; }
st=$(DEPLOY_HOST=localhost DEPLOY_PATH="$ROOT" DEPLOY_BASE="http://127.0.0.1:$PORT/" \
  SMKK_DIST="$SEED" run_deploy --yes)
if [[ $st -eq 0 ]]; then ok "2. faithful deploy exits 0 and its gate agrees"; else bad "2. faithful deploy" "exit 0" "exit $st"; fi
if [[ -f "$ROOT/assets/index-Ccf9hihb.js" ]]; then ok "2b. bytes arrived"; else bad "2b. bytes arrived" "js present" "missing"; fi
stop_serve

# ---------------------------------------------------------------- 3 second build
ROOT="$WORK/t3"; mkdir -p "$ROOT"
cp -R "$SEED/." "$ROOT/"
serve "$ROOT" 2>/dev/null
st=$(DEPLOY_HOST=localhost DEPLOY_PATH="$ROOT" DEPLOY_BASE="http://127.0.0.1:$PORT/" \
  SMKK_DIST="$OTHER" run_deploy --yes)
if [[ $st -eq 0 ]]; then ok "3. deploy of a changed build exits 0"; else bad "3. changed build" "exit 0" "exit $st"; fi
if [[ -f "$ROOT/assets/index-MUTATION01.js" ]]; then ok "3b. new bundle is on the target"; else bad "3b. new bundle" "present" "missing"; fi
if [[ ! -f "$ROOT/assets/index-Ccf9hihb.js" ]]; then
  ok "3c. the superseded hashed asset was pruned (nginx would serve it forever)"
else
  bad "3c. stale asset pruned" "index-Ccf9hihb.js absent" "still present"
fi
stop_serve

# ---------------------------------------------------------------- 4 gate refuses a stale target
# The gate is asked to bless a target that was NOT updated. If this passes, the
# deploy's own verification is decorative and every green above is worthless.
ROOT="$WORK/t4"; mkdir -p "$ROOT"
cp -R "$SEED/." "$ROOT/"
rm -f "$ROOT/assets/index-Ccf9hihb.js"   # right name, file gone
serve "$ROOT" 2>/dev/null
st=$(DEPLOY_HOST=localhost DEPLOY_PATH="$ROOT" DEPLOY_BASE="http://127.0.0.1:$PORT/" \
  SMKK_DIST="$SEED" bash "$REPO/tools/verify-deploy.sh" "http://127.0.0.1:$PORT/" >"$WORK/out.txt" 2>&1; echo $?)
if [[ $st -eq 1 ]]; then
  ok "4. gate is red when the served bundle is absent (exit 1)"
else
  bad "4. gate red on absent asset" "exit 1" "exit $st"
fi
stop_serve

# ---------------------------------------------------------------- 5 stale bytes, right name
ROOT="$WORK/t5"; mkdir -p "$ROOT"
cp -R "$SEED/." "$ROOT/"
printf '/* tampered */\n' >> "$ROOT/assets/index-Ccf9hihb.js"
serve "$ROOT" 2>/dev/null
st=$(DEPLOY_HOST=localhost DEPLOY_PATH="$ROOT" DEPLOY_BASE="http://127.0.0.1:$PORT/" \
  SMKK_DIST="$SEED" bash "$REPO/tools/verify-deploy.sh" "http://127.0.0.1:$PORT/" >"$WORK/out.txt" 2>&1; echo $?)
if [[ $st -eq 1 ]]; then
  ok "5. gate is red on right-name/wrong-bytes (the r141 shape)"
else
  bad "5. gate red on tampered bytes" "exit 1" "exit $st"
fi
stop_serve

# ---------------------------------------------------------------- 6 absent build is exit 2
st=$(SMKK_DIST="$WORK/does-not-exist" bash "$DEPLOY" --yes >"$WORK/out.txt" 2>&1; echo $?)
if [[ $st -eq 2 ]]; then
  ok "6. deploy refuses with no local build (exit 2, operator error not a deploy failure)"
else
  bad "6. absent build" "exit 2" "exit $st"
fi

# ---------------------------------------------------------------- 7 stale build refused
# A dist older than the source it claims to represent is a deploy of history.
# This is the r141 shape arriving from the build side.
STALE="$WORK/stale"
mkdir -p "$STALE/assets"
printf '<!doctype html><html><head></head><body></body></html>\n' >"$STALE/index.html"
touch -t 202001010000 "$STALE/index.html"
st=$(SMKK_DIST="$STALE" DEPLOY_HOST=localhost DEPLOY_PATH="$WORK/t7" bash "$DEPLOY" --yes >"$WORK/out.txt" 2>&1; echo $?)
if [[ $st -eq 1 ]]; then
  if grep -q 'older than' "$WORK/out.txt"; then
    ok "7. deploy refuses a build older than the source tree, and says why"
  else
    bad "7. stale build" "message naming the newer source" "$(head -2 "$WORK/out.txt" | tr '\n' ' ')"
  fi
else
  bad "7. stale build" "exit 1" "exit $st"
fi

# ---------------------------------------------------------------- 7b build output is not staleness
# `pnpm check` runs `tsc -b`, which rewrites `packages/*/dist/**` — compiled .js
# and a .tsbuildinfo — AFTER the vite build. The mtime guard then read a fresh
# build as stale and refused to deploy it. Two cycles to find, because the first
# fix pruned only `*.tsbuildinfo` and the compiled test .js tripped it next.
#
# Every case below touches BUILD OUTPUT and must be allowed; the last touches
# real source and must be refused. A guard that is always red is worse than no
# guard: it teaches the next round to reach for the override.
BUILD_OUTPUT_PROBE=0
for probe in \
  "$REPO/packages/content/dist/tsconfig.tsbuildinfo" \
  "$REPO/packages/content/dist/tests/replay.test.js" \
  "$REPO/packages/sim/dist/index.js"
do
  [[ -f "$probe" ]] || continue
  touch "$probe"
  BUILD_OUTPUT_PROBE=1
done

if [[ $BUILD_OUTPUT_PROBE -eq 1 ]]; then
  st=$(SMKK_DIST="$SEED" DEPLOY_HOST=localhost DEPLOY_PATH="$WORK/t7b" bash "$DEPLOY" >"$WORK/out.txt" 2>&1; echo $?)
  if [[ $st -eq 0 ]]; then
    ok "7b. touched packages/*/dist output does NOT count as a stale build"
  else
    bad "7b. dist output ignored" "exit 0 (dry run proceeds)" "exit $st: $(grep -m1 FAIL "$WORK/out.txt")"
  fi
else
  say "  SKIP  7b — no compiled dist present to touch"
fi

SRC_PROBE="$REPO/apps/game/src/.deploy-mutation-probe.ts"
printf '// touched by tools/deploy-mutation.sh\n' >"$SRC_PROBE"
st=$(SMKK_DIST="$SEED" DEPLOY_HOST=localhost DEPLOY_PATH="$WORK/t7c" bash "$DEPLOY" >"$WORK/out.txt" 2>&1; echo $?)
rm -f "$SRC_PROBE"
if [[ $st -eq 1 ]] && grep -q 'deploy-mutation-probe' "$WORK/out.txt"; then
  ok "7c. a touched real source file IS reported as a stale build, by name"
else
  bad "7c. source edit detected" "exit 1 naming the file" "exit $st"
fi

# ---------------------------------------------------------------- 8 unreachable host
st=$(DEPLOY_HOST=localhost DEPLOY_PATH="$WORK/t8" DEPLOY_BASE="http://127.0.0.1:$PORT/" \
  SMKK_DIST="$SEED" run_deploy --yes)
if [[ $st -eq 1 ]]; then
  ok "8. deploy to an unreachable host is exit 1, not a silent success"
else
  bad "8. unreachable host" "exit 1" "exit $st"
fi

say ""
say "passed $PASS, failed $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
say "deploy.sh can go red on all of the above."
