#!/usr/bin/env bash
# Proves the sweep guard can FAIL. Five cases over the real tools/sweep.mjs and
# real vite builds — never a stub, because the defect being guarded is precisely
# that dist and source can disagree. Each case rebuilds (≈14s), so this is a
# ~90s harness by design; a stubbed build would not reproduce the disagreement
# at all.
#
# Run after touching tools/sweep.mjs, tools/renderer-sweep.mjs,
# tools/throttle-cliff.mjs, or anything that patches a source file and builds.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

pass=0; fail=0
ok()   { echo "  ok    $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1: $2"; fail=$((fail+1)); }

echo "sweep guard mutation harness"

# 1. baseline: an honest sweep ends with dist describing the source again.
#    This is the property r153 had to add by hand and r154 made shared.
node --input-type=module -e '
import { createSweep, buildGame, GAME } from "./tools/sweep.mjs";
import { resolve } from "node:path";
const sweep = createSweep({
  label: "mutation-baseline",
  files: { renderer: resolve(GAME, "src/renderer.ts") },
});
const anchor = "renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));";
sweep.applyEdits([["renderer", anchor, "renderer.setPixelRatio(1);"]]);
buildGame();
sweep.finish();
console.log("HONEST_ENDED_HONEST");
' > /tmp/sweep-m1.out 2>&1
st=$?
if grep -q HONEST_ENDED_HONEST /tmp/sweep-m1.out && [[ $st -eq 0 ]]; then
  ok "an honest sweep leaves dist describing the source"
else
  bad "honest sweep" "exit $st: $(grep -m1 -E 'Error|lying' /tmp/sweep-m1.out)"
fi

# 2. THE DEFECT: restore the source, never rebuild. This is r153's harness and
#    r154's two sweep tools. dist now holds a build of a tree that is gone, and
#    the guard has to say so.
node --input-type=module -e '
import { createSweep, buildGame, GAME } from "./tools/sweep.mjs";
import { resolve } from "node:path";
const sweep = createSweep({
  label: "mutation-stale-dist",
  files: { renderer: resolve(GAME, "src/renderer.ts") },
});
const anchor = "renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));";
sweep.applyEdits([["renderer", anchor, "renderer.setPixelRatio(1);"]]);
buildGame();
sweep.restoreSource();          // <- the whole defect. No rebuild.
const complaint = sweep.assertHonest();
console.log("COMPLAINT:" + complaint);
sweep.emergencyRestore();       // put the tree back for the next case
console.log("RECOVERED:" + (sweep.assertHonest() ?? "clean"));
' > /tmp/sweep-m2.out 2>&1
st=$?
if grep -q 'COMPLAINT:dist does not describe the source' /tmp/sweep-m2.out && grep -q 'RECOVERED:clean' /tmp/sweep-m2.out && [[ $st -eq 0 ]]; then
  ok "a stale dist is DETECTED (and emergencyRestore recovers it)"
else
  bad "stale dist detection" "exit $st: $(grep -m1 -E 'COMPLAINT|RECOVERED' /tmp/sweep-m2.out)"
fi

# 3. THE INVERSE: source never restored, dist rebuilt. A guard that only checks
#    the build would pass this happily, so the guard checks both.
node --input-type=module -e '
import { createSweep, buildGame, GAME } from "./tools/sweep.mjs";
import { resolve } from "node:path";
const sweep = createSweep({
  label: "mutation-dirty-source",
  files: { renderer: resolve(GAME, "src/renderer.ts") },
});
const anchor = "renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));";
sweep.applyEdits([["renderer", anchor, "renderer.setPixelRatio(1);"]]);
console.log("COMPLAINT:" + sweep.assertHonest());
sweep.emergencyRestore();
console.log("RECOVERED:" + (sweep.assertHonest() ?? "clean"));
' > /tmp/sweep-m3.out 2>&1
st=$?
if grep -q 'COMPLAINT:source not restored' /tmp/sweep-m3.out && grep -q 'RECOVERED:clean' /tmp/sweep-m3.out && [[ $st -eq 0 ]]; then
  ok "an unrestored source is DETECTED (a build-only guard would miss it)"
else
  bad "dirty source detection" "exit $st: $(grep -m1 -E 'COMPLAINT|RECOVERED' /tmp/sweep-m3.out)"
fi

# 4. a moved anchor must be loud. A sweep that patches nothing measures the
#    baseline while believing it measured the lever.
node --input-type=module -e '
import { createSweep, buildGame, GAME } from "./tools/sweep.mjs";
import { resolve } from "node:path";
const sweep = createSweep({
  label: "mutation-moved-anchor",
  files: { renderer: resolve(GAME, "src/renderer.ts") },
});
try {
  sweep.applyEdits([["renderer", "THIS ANCHOR MOVED", "x"]]);
  console.log("NO_THROW");
} catch (e) {
  console.log("THREW:" + e.message);
}
sweep.emergencyRestore();
' > /tmp/sweep-m4.out 2>&1
if grep -q 'THREW:.*anchor absent' /tmp/sweep-m4.out; then
  ok "a moved anchor throws instead of silently measuring nothing"
else
  bad "moved anchor" "$(grep -m1 -E 'NO_THROW|THREW' /tmp/sweep-m4.out)"
fi

# 5. and the tree is honest after this harness, which is the assertion r153's
#    had to be taught and this one gets for free.
node --input-type=module -e '
import { buildGame, distDigest, GAME } from "./tools/sweep.mjs";
buildGame();
console.log("DIGEST:" + distDigest());
' > /tmp/sweep-m5.out 2>&1
st=$?
digest=$(grep -m1 '^DIGEST:' /tmp/sweep-m5.out | cut -d: -f2)
git_dirty=$(git status --porcelain apps/game/src)
if [[ $st -eq 0 && -n "$digest" && -z "$git_dirty" ]]; then
  ok "harness ends with a clean tree and a real build ($digest)"
else
  bad "harness cleanliness" "exit $st, digest=$digest, dirty=[$git_dirty]"
fi

echo
echo "  $pass passed, $fail failed"
[[ $fail -eq 0 ]]