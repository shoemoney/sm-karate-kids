#!/usr/bin/env bash
# Proves tools/validate-assets.ts can FAIL in the way that matters, before
# anyone relies on its exit code.
#
# WHY. Provenance is the gate that stands between generated art and shipping.
# A gate that cannot go red on the interesting case is not a gate. The case that
# matters here is PRECEDENCE: docs/asset-provenance.md states, twice, that the
# governing manifest is the NEAREST ANCESTOR and that "a directory's own record
# wins over the root one". The implementation resolved the entry by "first
# manifest that happens to carry the key" — which is readdirSync order, neither
# alphabetical nor guaranteed.
#
# Concretely, before the fix: brand/PROVENANCE.json and a nearer
# fighters/PROVENANCE.json both carrying `fighters/shiro-0.webp`, brand saying
# approved:true and fighters saying approved:false, exited 0 and printed
# "provenance OK". The nearer manifest was never read. `brand` sorts before
# `fighters`, so the alphabetically-earlier sibling won.
#
# Case 2 is the regression. Case 3 is the same rule pointing the other way,
# without which "nearest wins" and "the fixture is just broken" look identical.
# Case 7 pins order-independence, which was the original defect.
#
# THESE CASES RUN AGAINST THROWAWAY FIXTURE TREES, NEVER THE REAL ONE. Each
# builds a synthetic repo (its own tools/, apps/game/public/, src/) and runs the
# REAL validator over it, so the code under test is the code that ships and the
# assets under test are one-byte stubs.
#
# USAGE  bash tools/validate-assets-mutation.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="$REPO/tools/validate-assets.ts"
TSX="$REPO/node_modules/.bin/tsx"
WORK="$(mktemp -d)"
PASS=0
FAIL=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
ok()  { say "  PASS  $1"; PASS=$((PASS+1)); }
bad() { say "  FAIL  $1"; say "        expected: $2"; say "        got:      $3"; FAIL=$((FAIL+1)); }

[ -x "$TSX" ] || { say "cannot find tsx at $TSX"; exit 2; }

# A minimal but faithful repo: one generated asset (so the art-manifest checks
# have something real to agree with) plus the brand/fighters arrangement the real
# tree uses, where brand/PROVENANCE.json carries the fighters/ keys.
fixture() {
  local d="$1"
  mkdir -p "$d/tools" "$d/apps/game/src" \
           "$d/apps/game/public/brand" \
           "$d/apps/game/public/fighters" \
           "$d/apps/game/public/generated"
  cp "$VALIDATOR" "$d/tools/validate-assets.ts"

  printf 'x' > "$d/apps/game/public/generated/dojo-floor.webp"
  cat > "$d/apps/game/public/generated/PROVENANCE.json" <<'JSON'
{
  "generated/dojo-floor.webp": {
    "source": "fixture", "license": "fixture", "holder": "fixture", "approved": true
  }
}
JSON
  # art-manifest.tsv has no column-name row: comments are `#`-prefixed and every
  # other line is a data row.
  printf '# fixture\ndojo-floor\t64\tno\ta dojo floor\n' > "$d/tools/art-manifest.tsv"
  printf '// dojo-floor.webp\n' > "$d/apps/game/src/room.ts"

  printf 'x' > "$d/apps/game/public/fighters/shiro-0.webp"
  printf 'x' > "$d/apps/game/public/brand/mark.png"
  cat > "$d/apps/game/public/brand/PROVENANCE.json" <<'JSON'
{
  "brand/mark.png": {
    "source": "fixture brand manifest", "license": "fixture", "holder": "fixture", "approved": true
  },
  "fighters/shiro-0.webp": {
    "source": "fixture brand manifest", "license": "fixture", "holder": "fixture", "approved": true
  }
}
JSON
}

# Run the real validator over a fixture and print its exit code.
run() {
  ( cd "$1" && "$TSX" tools/validate-assets.ts >/dev/null 2>&1 )
  echo $?
}

# Flip one key's approved flag inside a manifest, in place.
set_approved() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3] == "true"
d = json.load(open(path))
d[key]["approved"] = val
json.dump(d, open(path, "w"), indent=2)
PY
}

# --- 1. baseline: a faithful fixture passes ---------------------------------
T="$WORK/t1"; fixture "$T"
rc="$(run "$T")"
if [ "$rc" = 0 ]; then ok "1. faithful fixture passes (exit 0)"
else bad "1. faithful fixture passes" "exit 0" "exit $rc"; fi

# --- 2. THE REGRESSION: a nearer manifest saying approved:false must win ----
# Pre-fix this exited 0: brand sorts first and its approved:true was read.
T="$WORK/t2"; fixture "$T"
cat > "$T/apps/game/public/fighters/PROVENANCE.json" <<'JSON'
{
  "fighters/shiro-0.webp": {
    "source": "fixture fighters manifest", "license": "fixture", "holder": "fixture", "approved": false
  }
}
JSON
rc="$(run "$T")"
if [ "$rc" != 0 ]; then ok "2. nearer manifest's approved:false overrides the fallback's true (exit $rc)"
else bad "2. nearer manifest wins over a non-ancestor" "non-zero exit" "exit 0 — nearest manifest ignored"; fi

# --- 3. the same rule pointing the other way --------------------------------
# Without this, case 2 could pass because the fixture is simply broken rather
# than because the nearer manifest is the one being read.
T="$WORK/t3"; fixture "$T"
set_approved "$T/apps/game/public/brand/PROVENANCE.json" "fighters/shiro-0.webp" false
cat > "$T/apps/game/public/fighters/PROVENANCE.json" <<'JSON'
{
  "fighters/shiro-0.webp": {
    "source": "fixture fighters manifest", "license": "fixture", "holder": "fixture", "approved": true
  }
}
JSON
rc="$(run "$T")"
if [ "$rc" = 0 ]; then ok "3. nearer manifest's approved:true overrides the fallback's false (exit 0)"
else bad "3. nearer manifest can approve over a fallback" "exit 0" "exit $rc"; fi

# --- 4. a manifest at the public root governs a nested asset ----------------
# HONEST LIMIT ON THIS CASE: it pins that a root manifest is *consulted*, not
# that it is classed as an ancestor. Making the root a fallback instead of an
# ancestor leaves every case here at the same exit code, because the fallback
# pass finds the key anyway. Root-vs-ancestor is not observable through the exit
# code, so this case does not claim it. It is here because the tree has no root
# manifest today and the next one added should be covered.
T="$WORK/t4"; fixture "$T"
cat > "$T/apps/game/public/PROVENANCE.json" <<'JSON'
{
  "fighters/shiro-0.webp": {
    "source": "root manifest", "license": "fixture", "holder": "fixture", "approved": false
  }
}
JSON
rc="$(run "$T")"
if [ "$rc" != 0 ]; then ok "4. a root manifest is consulted for a nested asset (exit $rc)"
else bad "4. root manifest is consulted" "non-zero exit" "exit 0 — root manifest ignored"; fi

# --- 5. the fallback still works (the real brand/ -> fighters/ arrangement) ---
T="$WORK/t5"; fixture "$T"
rc="$(run "$T")"
if [ "$rc" = 0 ]; then ok "5. brand/ still covers fighters/ with no nearer manifest (exit 0)"
else bad "5. non-ancestor fallback still covers" "exit 0" "exit $rc"; fi

# --- 6. an asset with no entry anywhere is still red -------------------------
T="$WORK/t6"; fixture "$T"
printf 'x' > "$T/apps/game/public/fighters/aka-9.webp"
rc="$(run "$T")"
if [ "$rc" != 0 ]; then ok "6. asset with no entry in any manifest is red (exit $rc)"
else bad "6. missing provenance entry" "non-zero exit" "exit 0"; fi

# --- 7. depth decides when two ANCESTORS both carry the key -----------------
# Case 4 has a single ancestor, so it cannot tell "nearest wins" from "any
# ancestor wins". This has two: the public root says approved:true and
# fighters/ says approved:false. The deepest must win, or a root entry could
# re-approve an asset a nearer manifest is withholding.
T="$WORK/t7d"; fixture "$T"
cat > "$T/apps/game/public/PROVENANCE.json" <<'JSON'
{
  "fighters/shiro-0.webp": {
    "source": "root manifest", "license": "fixture", "holder": "fixture", "approved": true
  }
}
JSON
cat > "$T/apps/game/public/fighters/PROVENANCE.json" <<'JSON'
{
  "fighters/shiro-0.webp": {
    "source": "fixture fighters manifest", "license": "fixture", "holder": "fixture", "approved": false
  }
}
JSON
rc="$(run "$T")"
if [ "$rc" != 0 ]; then ok "7. deepest ancestor wins when two ancestors carry the key (exit $rc)"
else bad "7. depth decides between ancestors" "non-zero exit" "exit 0 — shallower ancestor won"; fi

# --- 8. the verdict is a property of the tree, not of creation order ---------
# The original defect resolved by readdir order, so two identical trees built in
# opposite orders could disagree. Both must exit non-zero here, and identically:
# aaa/ is the nearest ancestor of aaa/a.webp and says approved:false.
build_ordered() {
  local d="$1" rev="$2"
  mkdir -p "$d/tools" "$d/apps/game/src"
  cp "$VALIDATOR" "$d/tools/validate-assets.ts"
  if [ "$rev" = 0 ]; then
    mkdir -p "$d/apps/game/public/aaa" "$d/apps/game/public/zzz" \
             "$d/apps/game/public/generated"
  else
    mkdir -p "$d/apps/game/public/generated" \
             "$d/apps/game/public/zzz" "$d/apps/game/public/aaa"
  fi
  printf 'x' > "$d/apps/game/public/aaa/a.webp"
  printf 'x' > "$d/apps/game/public/zzz/z.webp"
  printf '{"aaa/a.webp":{"source":"f","license":"f","holder":"f","approved":false}}\n' \
    > "$d/apps/game/public/aaa/PROVENANCE.json"
  printf '{"zzz/z.webp":{"source":"f","license":"f","holder":"f","approved":true}}\n' \
    > "$d/apps/game/public/zzz/PROVENANCE.json"
  printf 'x' > "$d/apps/game/public/generated/dojo-floor.webp"
  printf '{"generated/dojo-floor.webp":{"source":"f","license":"f","holder":"f","approved":true}}\n' \
    > "$d/apps/game/public/generated/PROVENANCE.json"
  printf '# fixture\ndojo-floor\t64\tno\ta floor\n' > "$d/tools/art-manifest.tsv"
  printf '// dojo-floor.webp\n' > "$d/apps/game/src/room.ts"
}
A="$WORK/t8a"; B="$WORK/t8b"
build_ordered "$A" 0
build_ordered "$B" 1
ra="$(run "$A")"; rb="$(run "$B")"
if [ "$ra" != 0 ] && [ "$ra" = "$rb" ]; then
  ok "8. opposite creation order, identical verdict (both exit $ra)"
else bad "8. order-independent, ancestor-honouring resolution" \
       "both non-zero and equal" "exit $ra vs $rb"; fi

say ""
say "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1