#!/usr/bin/env bash
# Turn tools/production-freshness.py's exit code into a short note the next
# unattended review round reads BEFORE it reads the plan.
#
# WHY THIS EXISTS (r161)
# ----------------------
# r159 deployed to arcade.shoemoney.ai/smkk, verified .ai green, and in the same
# commit repointed the gate at arcade.shoemoney.com/karate-kids -- then committed
# without running it once. r160 found production 65 commits stale, with two
# undefined var() reads live on the wire, and correctly wrote that the repo has
# "no automatic path from a local build to a verified production" and had built
# only "the half that reports".
#
# That is this file. The failure was never a wrong number. It was an
# UNVERIFIED CLAIM BEING INHERITED: a reader assuming a previous reader had
# checked. The only durable guard against inheritance is to re-measure every
# iteration and put the measurement where the next round cannot miss it.
#
# It is deliberately NOT in pnpm check, which must stay runnable offline. The
# unattended driver is the right place: it already needs the network.
#
#   ./tools/prod-freshness-note.sh          note to stdout, exit = freshness rc
#
# EXIT CODES (passed through from production-freshness.py, never invented here)
#   0  EQUAL        -- served bytes are the built bytes
#   1  STALE        -- origin answers and disagrees
#   2  INCONCLUSIVE -- origin unreadable, or no local build to compare against
#   3  BROKEN       -- production-freshness.py is missing or unrunnable, so the
#                      gate never ran. Deliberately distinct from 2: an
#                      unreachable origin is a fact about the world, a missing
#                      gate is a fact about this tree, and r160's whole lesson is
#                      that those two must never be reported as the same thing.
#
# A note that cannot distinguish "equal" from "never measured" is worse than no
# note, so exit 3 exists rather than letting a failure fall through to 0.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# SMKK_PROD_GATE injects the gate so tools/loop-freshness-mutation.sh can
# exercise THIS script instead of a copy of it. See that harness: an
# earlier draft copied the tools into a throwaway tree, and every fixture
# it built was misnamed -- which is how half an hour went into blaming the
# machine for a path that never existed. Running the real tools and
# stubbing only the network boundary makes the harness strictly stronger:
# what is under test is what ships.
TOOL="${SMKK_PROD_GATE:-$HERE/production-freshness.py}"
REPORT="${SMKK_PROD_REPORT:-$(cd "$HERE/.." && pwd)/.loop/production-freshness.txt}"

if [[ ! -f "$TOOL" ]]; then
  echo "production freshness: NOT MEASURED -- $TOOL is missing from this tree."
  echo "  A missing gate reports nothing; it never reports 'equal'."
  exit 3
fi

mkdir -p "$(dirname "$REPORT")" 2>/dev/null || true
python3 "$TOOL" >"$REPORT" 2>&1
rc=$?

# Read the tool's own verdict rather than re-deriving it: r160's log has three
# separate incidents of a scratch script disagreeing with the real gate.
verdict="$(grep -E '^(EQUAL|STALE|INCONCLUSIVE)' "$REPORT" | tail -1)"
[[ -n "$verdict" ]] || verdict="(the tool produced no verdict line)"

case "$rc" in
  0)
    echo "production freshness: EQUAL -- the origin is serving this tree's build."
    ;;
  1)
    echo "production freshness: STALE -- $verdict"
    ;;
  2)
    echo "production freshness: INCONCLUSIVE -- $verdict"
    echo "  Not a deploy verdict. An unreachable origin and an absent local build"
    echo "  are both this, and neither is evidence the deploy is stale."
    ;;
  *)
    echo "production freshness: NOT MEASURED -- the gate exited $rc, which is not a"
    echo "  code tools/production-freshness.py documents. Treat the gate as broken:"
    echo "  $REPORT"
    exit 3
    ;;
esac

# The commit distance is the actionable half of a STALE, and it carries its own
# limit on its face because the number is tempting.
drift="$(grep -oE '[0-9]+ commit\(s\) behind HEAD' "$REPORT" | tail -1)"
[[ -n "$drift" ]] && echo "  $drift -- an UPPER BOUND; index.html is unchanged across stretches of commits."

# Served-artifact defects. These used to be printed only when there was drift to
# print alongside them, which meant a live defect on a byte-identical origin
# reached nobody -- the r161 shape exactly, one level in: this script is the
# thing that makes a measurement visible, and it was making half of them
# invisible. Guarded on rc 0/1 rather than on drift, because the tool returns
# early on INCONCLUSIVE and never emits these lines at all, so on a real gate the
# guard and the report agree.
if [[ "$rc" -eq 0 || "$rc" -eq 1 ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && echo "  live no-op: ${line#READ BUT NEVER DECLARED, no fallback: }"
  done < <(grep -oE 'READ BUT NEVER DECLARED.*' "$REPORT")
  while IFS= read -r line; do
    [[ -n "$line" ]] && echo "  live dangling reference: ${line#assets/}"
  done < <(grep -oE 'DANGLING assets/.*' "$REPORT")
fi

echo "  full report: $REPORT"
exit "$rc"