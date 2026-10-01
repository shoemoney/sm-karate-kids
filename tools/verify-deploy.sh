#!/usr/bin/env bash
# Fail-closed deploy gate: "is production actually serving the bytes I just built?"
#
# WHY THIS EXISTS. Round 141 found the live site returning 200 for hours while
# serving a build two hours stale. The failure was not subtle — the served bundle
# was a *different file* — and it survived because the only evidence anyone had
# was the HTTP status:
#
#   200 OK                          -> "the deploy worked"
#   the bundle I pushed is served   -> "the deploy worked"
#
# Those are different claims and only the second one matters. A green status over
# stale bytes is exactly the shape of gate that reports success by construction.
#
# WHERE THE BYTES COME FROM, recorded because finding it cost four probes:
#
#   dig arcade.shoemoney.ai  -> 68.185.216.69
#   deploy root              -> /mnt/.ix-apps/app_mounts/nginx-proxy-manager/data/arcade/smkk
#
# It is NOT under /mnt/tank, NOT /mnt/tank/apps/arcade, and NOT the arcade-api
# container's ./data. `rsync` over ssh is refused (no root key), so a transfer is
# tar + scp + remote extract — and the remote assets/ must be pruned to only the
# files the new index.html names, because an nginx root happily serves every
# stale hash left behind forever.
#
# WHAT IT CHECKS, in order, each one fail-closed:
#
#   1. the URL answers 200 and the body is non-empty
#   2. a LOCAL BUILD EXISTS and its mtime is reported — a gate pointed at an
#      absent dist must fail rather than quietly verify nothing
#   3. served index.html == local dist/index.html, byte for byte
#   4. every asset the SERVED html names is fetched over the wire, and its sha256
#      equals the sha256 of the local file of the same name
#   5. the served asset names are a subset of the local assets dir, so a name the
#      server invents cannot pass
#
# Step 4 is the one that earns the script. Checking names alone passes a
# half-finished deploy where index.html landed but the asset it names is the old
# one; checking content alone is impossible without first trusting a name. Both,
# in that order.
#
# WHY NO "IS MY FIX LIVE?" MARKER STRINGS. The obvious alternative is a list of
# substrings that must appear in the served bundle — `100dvh`, `rematch in`, etc.
# It is refused on purpose. Vite rewrites CSS custom properties and mangles
# literals on any refactor, so every marker is a future false alarm, and a gate
# that cries wolf is a gate whose next fix is deletion. A sha256 comparison is
# exact and cannot rot: if the served bytes equal the local bytes, every fix in
# them is live, and no list of strings can say more than that.
#
# TRAPS ENCODED, all measured or observed in this project:
#   * `curl -f`, so an HTTP error is a failure and not a body to hash
#   * no `|| true` anywhere on a command whose exit code carries a verdict. A
#     `|| true` on the fetch is how a 404 hashes as an empty string and compares
#     unequal to everything except another 404.
#   * every sub-step's status is captured and checked; there is no path that
#     reaches the OK line without having proved each claim
#   * bash 3.2 compatible (macOS /bin/bash): no mapfile, no assoc arrays, no
#     ${var^^} — a `Bad substitution` in a gate is a gate nobody runs
#   * the fetched temp files are deleted on a PASS and KEPT on any failure, so a
#     red run can be inspected instead of re-fetched. This is done in one place,
#     in the EXIT trap, because when it was done per-branch the html-mismatch
#     branch — the stale-deploy shape, the one this script exists for — fell
#     through to the trap and deleted its own evidence while the asset branches
#     kept theirs. A gate that discards the only copy of what it saw is a gate
#     that has to be re-run to be believed.
#
# USAGE
#   tools/verify-deploy.sh                       # production
#   tools/verify-deploy.sh http://127.0.0.1:8xxx # any origin (mutation harness)
#   KEEP_TMP=1 tools/verify-deploy.sh            # leave the fetched bytes on disk
#   SMKK_DIST=/some/other/dist tools/verify-deploy.sh
#     Overrides the local build it compares against. Exists so the mutation
#     harness can test the "pointed at an absent build" branch without moving the
#     real dist — a guard for an untestable branch is a guess, not a guard.
#
# EXIT
#   0  served bytes == local build bytes, verified over the wire
#   1  a claim failed; the reason is on stderr and, on asset failures, the
#      fetched bytes are left in the tmpdir printed in the message
#   2  usage / environment error (no local dist, no shasum)
set -uo pipefail

REPO="/Users/shoemoney/Projects/sm-karate-kids"
DIST="${SMKK_DIST:-$REPO/apps/game/dist}"
BASE="${1:-https://arcade.shoemoney.ai/smkk/}"
CURL_MAX="${CURL_MAX:-30}"

# STATUS is the single source of truth for "was this a pass", read by the EXIT
# trap. Every failure path goes through fail()/die() so it cannot be bypassed by
# a branch that forgets to set it — which is exactly how the evidence-loss bug
# above happened.
STATUS=0

die() { echo "FAIL: $*" >&2; STATUS=1; exit 1; }
note() { echo "  $*"; }

# ---------------------------------------------------------------- environment
# Resolved, not assumed. `sha256sum` is absent on macOS and `shasum` is absent
# on most Linux images, and a gate that silently falls back to comparing file
# *sizes* is a gate that passes a 14-byte difference.
if command -v shasum >/dev/null 2>&1; then
  sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha_of() { sha256sum "$1" | cut -d' ' -f1; }
else
  echo "FAIL: no shasum or sha256sum — refusing to fall back to comparing sizes" >&2
  exit 2
fi

[[ -d "$DIST" ]] || { echo "FAIL: no local build at $DIST — run pnpm build first" >&2; exit 2; }
# A dist directory that exists but has no index.html is the SAME operator error as
# no dist at all: there is nothing to compare against, so no verdict about the
# deploy can be reached. The mutation harness caught this returning 1, which
# reads as "the deploy disagrees with the build" and sends an operator hunting a
# deploy problem they do not have.
[[ -f "$DIST/index.html" ]] || { echo "FAIL: no local build at $DIST — run pnpm build first" >&2; exit 2; }

LOCAL_HTML_SHA="$(sha_of "$DIST/index.html")"
# Read off the filesystem, not asserted: a gate that cannot say how old the
# thing it verified cannot tell you whether it verified anything recent.
if stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$DIST/index.html" >/dev/null 2>&1; then
  LOCAL_BUILT="$(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$DIST/index.html")"
else
  LOCAL_BUILT="$(stat -c '%y' "$DIST/index.html" 2>/dev/null | cut -d. -f1)"
fi

TMP="$(mktemp -d)"
# One place decides what happens to the fetched bytes. Pass -> delete. Any failure
# -> keep, and say where, on stderr, so it lands in the same stream as the reason.
cleanup() {
  if [[ $STATUS -eq 0 && "${KEEP_TMP:-0}" != "1" ]]; then
    rm -rf "$TMP"
    return
  fi
  if [[ $STATUS -eq 0 ]]; then
    echo "  kept (KEEP_TMP=1): $TMP" >&2
    return
  fi
  if mv "$TMP" "${TMP}.failed" 2>/dev/null; then
    echo "  kept (failed run): ${TMP}.failed" >&2
  fi
}
trap cleanup EXIT

echo "deploy gate: $BASE"
note "local build  $DIST"
note "built at     $LOCAL_BUILT"
note "local html   sha256:$LOCAL_HTML_SHA"

# ---------------------------------------------------------------- 1. reachable
# -f makes any HTTP error a failure. Without it a 502 body hashes happily and
# gets compared against index.html like a real answer.
HTTP_CODE="$(curl -fsSL --max-time "$CURL_MAX" -o "$TMP/live.html" \
  -w '%{http_code}' "$BASE")"
curl_status=$?
[[ $curl_status -eq 0 ]] || die "fetch of $BASE failed (curl exit $curl_status) — no verdict"
[[ "$HTTP_CODE" == "200" ]] || die "HTTP $HTTP_CODE from $BASE"
[[ -s "$TMP/live.html" ]] || die "200 from $BASE but the body is empty"
note "http         200, $(wc -c <"$TMP/live.html" | tr -d ' ') bytes"

# ---------------------------------------------------------------- 3. html identity
# cmp, not a name comparison. The last round's drift changed the asset NAMES, so
# a name check would have caught it — but a build that changes index.html
# without changing a name (a preload hint, a meta tag, an inline script) is
# equally a stale deploy and names alone cannot see it.
if cmp -s "$TMP/live.html" "$DIST/index.html"; then
  note "html         identical to local build"
else
  echo "FAIL: served index.html is NOT the local build's index.html" >&2
  echo "  served names: $(grep -oE 'assets/[A-Za-z0-9_.-]+\.(js|css)' "$TMP/live.html" | sort -u | tr '\n' ' ')" >&2
  echo "  local  names: $(grep -oE 'assets/[A-Za-z0-9_.-]+\.(js|css)' "$DIST/index.html" | sort -u | tr '\n' ' ')" >&2
  echo "  served sha256:$(sha_of "$TMP/live.html")  local sha256:$LOCAL_HTML_SHA" >&2
  die "served html is a different build from the local one"
fi

# ---------------------------------------------------------------- 4/5. assets
# Names come from the SERVED html, deliberately: the deploy target is whatever
# the server is actually pointing a player at, so that is the list that must
# resolve. Each is then checked against the local file of the same name.
NAMES="$(grep -oE 'assets/[A-Za-z0-9_.-]+\.(js|css)' "$TMP/live.html" | sort -u)"
[[ -n "$NAMES" ]] || die "the served index.html names no assets — nothing was verified"

ASSET_COUNT=0
ASSET_FAIL=0
for rel in $NAMES; do
  ASSET_COUNT=$((ASSET_COUNT + 1))
  base_rel="${rel##*/}"
  local_file="$DIST/$rel"

  # 5. a name the server invents cannot pass
  [[ -f "$local_file" ]] || {
    echo "FAIL: served html names $rel, which is not in the local build" >&2
    ASSET_FAIL=$((ASSET_FAIL + 1))
    continue
  }

  asset_code="$(curl -fsSL --max-time "$CURL_MAX" -o "$TMP/$base_rel" \
    -w '%{http_code}' "$BASE$rel")"
  st=$?
  if [[ $st -ne 0 || "$asset_code" != "200" ]]; then
    echo "FAIL: $rel -> HTTP ${asset_code:-000} (curl exit $st)" >&2
    ASSET_FAIL=$((ASSET_FAIL + 1))
    continue
  fi

  live_sha="$(sha_of "$TMP/$base_rel")"
  local_sha="$(sha_of "$local_file")"
  if [[ "$live_sha" != "$local_sha" ]]; then
    # The shape that fooled the round: right name, wrong bytes. A half-synced
    # assets dir produces exactly this.
    echo "FAIL: $rel is served with DIFFERENT BYTES from the same name locally" >&2
    echo "  served $(wc -c <"$TMP/$base_rel" | tr -d ' ') bytes sha256:$live_sha" >&2
    echo "  local  $(wc -c <"$local_file" | tr -d ' ') bytes sha256:$local_sha" >&2
    ASSET_FAIL=$((ASSET_FAIL + 1))
    continue
  fi
  note "$rel $(wc -c <"$TMP/$base_rel" | tr -d ' ') bytes  sha256:${live_sha:0:12}"
done

if [[ $ASSET_FAIL -gt 0 ]]; then
  die "$ASSET_FAIL of $ASSET_COUNT assets are not what was built"
fi

[[ $ASSET_COUNT -gt 0 ]] || die "no assets were checked — a gate that verified nothing is not a pass"

echo "OK  $ASSET_COUNT assets served, byte-identical to the local build"
echo "    $BASE"
echo "    built $LOCAL_BUILT"