#!/usr/bin/env bash
# Proves the load reader can FAIL, and specifically that the r145 parse cannot
# pass. That parse returned 0 on every row of every sweep for nine rounds, and
# a reader could not tell "idle machine" from "no reading" — so these cases
# assert the difference rather than the value.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

pass=0; fail=0
ok()  { echo "  ok    $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1: $2"; fail=$((fail+1)); }

echo "host-load mutation harness"

# 1. the real read agrees with the OS's own number, read independently.
read -r line < <(node --input-type=module -e '
import { hostLoad } from "./tools/host-load.mjs";
import { loadavg } from "node:os";
const mine = hostLoad();
const truth = Math.round(loadavg()[0] * 10) / 10;
console.log(`DELTA=${Math.abs((mine ?? -1) - truth).toFixed(2)}`);
')
delta="${line#*DELTA=}"
if awk "BEGIN{exit !($delta < 2.0)}"; then
  ok "the real read tracks the OS load (delta ${delta})"
else
  bad "real read" "delta from os.loadavg() is $delta"
fi

# 2. THE DEFECT. The r145 parse, verbatim, on the same live output. It must be
#    demonstrably wrong — and it is wrong to 0, not to a slightly bad number,
#    which is why nothing ever flagged it.
r145=$(node --input-type=module -e '
import { execFileSync } from "node:child_process";
const out = execFileSync("sysctl", ["-n","vm.loadavg"], { encoding: "utf8" });
const [m1] = out.trim().replace(/[{}]/g, "").split(/\s+/);
console.log(`R145=${Math.round(Number(m1) * 10) / 10}`);
')
echo "        (r145 parse on this machine: $r145)"
if [[ "$r145" == "R145=0" ]]; then
  ok "the r145 parse reproduces: it reads 0 while the machine is loaded"
else
  # A genuinely idle box would make the old parse look correct. Say so rather
  # than recording a pass that proves nothing.
  bad "r145 reproduction" "the old parse read $r145, not 0 — the box is idle, so this case cannot discriminate"
fi

# 3. a reading that cannot be taken is null, and null is not 0. This is the
#    whole point: 0 is a plausible answer and null is an honest one.
got=$(node --input-type=module -e '
import { parseLoadavg, hostLoad } from "./tools/host-load.mjs";
console.log(`GARBAGE=${parseLoadavg("no numbers here")}`);
console.log(`EMPTY=${parseLoadavg("")}`);
console.log(`NEG=${parseLoadavg("{ -3.0 1 1 }")}`);
console.log(`NOSYSCTL=${hostLoad()}`);
' 2>&1 | tr '\n' ' ')
echo "        ($got)"
if [[ "$got" == *"GARBAGE=null"* && "$got" == *"EMPTY=null"* && "$got" == *"NEG=null"* ]]; then
  ok "unreadable input is null, never 0"
else
  bad "null-not-zero" "$got"
fi

# 4. with sysctl off PATH entirely, the read fails — and must fail LOUDLY
#    enough that a row cannot silently claim load 0.
# `node` itself must stay reachable or the case measures the wrong thing — r154
# caught itself here first: PATH=/nonexistent gave exit 127 "node: command not
# found", which looks exactly like a red assertion but is the harness's fault.
NODE_BIN="$(command -v node)"
out=$(PATH=/nonexistent "$NODE_BIN" --input-type=module -e '
import { hostLoad } from "./tools/host-load.mjs";
const v = hostLoad();
console.log(`VALUE=${v}`);
process.exitCode = v === null ? 7 : 0;
' 2>&1)
st=$?
if [[ $st -eq 7 && "$out" == *"VALUE=null"* ]]; then
  ok "no sysctl on PATH is exit 7 / null, not a quiet 0"
else
  bad "sysctl missing" "exit $st, out $out"
fi

# 5. and the fixed parser reads the braced form correctly, which is the form
#    macOS actually emits.
parsed=$(node --input-type=module -e '
import { parseLoadavg } from "./tools/host-load.mjs";
console.log(parseLoadavg("{ 26.40 28.09 23.42 }"));
')
if [[ "$parsed" == "26.4" ]]; then
  ok "the braced macOS form parses to 26.4, not 0"
else
  bad "braced parse" "got $parsed"
fi

echo
echo "  $pass passed, $fail failed"
[[ $fail -eq 0 ]]