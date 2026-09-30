#!/usr/bin/env bash
# Advisory reviewer via the codex CLI on gpt-6.1-sol, with computer use.
#
# Standing instruction (Jeremy, round 85): from here on, the loop's advisory
# reviewer is codex running gpt-6.1-sol, and it may use computer use to drive the
# running game rather than only reading stills.
#
# This script exists so that instruction takes effect on the first iteration
# after the account cap lifts, without anyone having to remember it. Until then it
# exits non-zero with the reason and the loop falls back, loudly.
#
# Traps encoded here, all measured (see the codex-exec-harness-traps skill):
#   * call /opt/homebrew/bin/codex — the `codex` on PATH is a cmux shim that
#     drops --skip-git-repo-check, -C and -m
#   * terminate the -i list with `--` or the prompt is swallowed as an image path
#   * redirect </dev/null or a non-TTY harness hangs on stdin forever
#   * use >| (noclobber-safe) so a retry does not silently re-read the old log
set -uo pipefail

REPO="/Users/shoemoney/Projects/sm-karate-kids"
SHOTS="${1:-/tmp/smkk-loop}"
OUT="${2:-$REPO/reviews/codex-advisory.json}"
CODEX="/opt/homebrew/bin/codex"
# OpenRouter's own slug for this model. Codex resolves `-m` through whichever
# provider is selected, so this is the OpenRouter name, not the bare one.
MODEL="openai/gpt-6.1-sol"

# Codex forces a ChatGPT account unless a provider is configured, and that
# account is capped until 2026-10-04. Point it at OpenRouter instead, using a
# custom model_provider with the Responses wire API (OpenRouter's /responses
# endpoint serves gpt-6.1-sol; `wire_api = "chat"` is rejected by this codex
# build). The key comes from the environment, NOT ~/.openrouter — that file is
# stale and 401s "User not found" on both endpoints.
#
#   wire_api       = "chat"      -> codex errors, telling you to use "responses"
#   base_url env   OPENAI_BASE_URL alone -> ignored; codex still uses ChatGPT auth
#   env_key        OPENROUTER_API_KEY    -> the only thing that actually routes
PROVIDER_ARGS=(
  -c 'model_provider="openrouter"'
  -c 'model_providers.openrouter.name="OpenRouter"'
  -c 'model_providers.openrouter.base_url="https://openrouter.ai/api/v1"'
  -c 'model_providers.openrouter.env_key="OPENROUTER_API_KEY"'
  -c 'model_providers.openrouter.wire_api="responses"'
)

[[ -x "$CODEX" ]] || { echo "codex: real binary missing at $CODEX" >&2; exit 3; }

# Fail closed. An empty bearer produces a 401 that reads exactly like a routing
# failure, and the trap is spending a round diagnosing the wrong layer.
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "codex: OPENROUTER_API_KEY is not set — refusing to run with an empty bearer" >&2
  exit 2
fi

PROMPT=$(cat <<'EOF'
You are the advisory reviewer for a browser point-karate game. You are looking at
21 frames of the SAME game, captured at 390x844 unless the name says otherwise.

Give exactly five findings. For each:
  - title: short kebab-case slug
  - claim: one sentence, concrete and checkable
  - reason: why it matters to a player
  - suggest: the specific change you would make

Rules you must follow:
  - Every claim must be about something VISIBLE in a frame you were shown. Do not
    report a screen that is not in the set, and do not infer behaviour from a
    filename.
  - If two elements in one frame should agree with each other (a foot and the
    spark where it lands, two name plates, a fraction and its baseline), compare
    them and say so if they disagree.
  - Prefer one specific measurable claim over five general ones. "The bar is
    1.9px" beats "the HUD could be clearer".
  - Do not report a defect you cannot see evidence for. "I could not tell" is a
    useful finding; "it looks wrong" is not.

You have computer use available. You may drive the running game to check whether
something you see is real before you report it. If you do, say which frame you
doubted and what you found.

Return the five findings as a JSON array and nothing else.
EOF
)

# -i is variadic, so the image list is terminated explicitly before the prompt.
IMAGES=()
while IFS= read -r f; do IMAGES+=(-i "$f"); done < <(ls -1 "$SHOTS"/*.png 2>/dev/null | head -24)

if [[ ${#IMAGES[@]} -eq 0 ]]; then echo "codex: no frames in $SHOTS" >&2; exit 4; fi

echo "codex: ${#IMAGES[@]} frames, model $MODEL" >&2
RAW=$(mktemp)
trap 'rm -f "$RAW"' EXIT

# --json is not optional: without it codex writes only the final text to
# stdout and NO event stream, and the extractor reads the event stream. This is
# why the first version of this script reported an empty answer on a run that
# had produced one.
"$CODEX" exec --json \
  "${PROVIDER_ARGS[@]}" \
  -m "$MODEL" \
  -C "$REPO" \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  "${IMAGES[@]}" \
  -- "$PROMPT" \
  </dev/null >"$RAW" 2>"$RAW.err"
status=$?

# Trap: an instant exit with a usage-limit error is not a review. Distinguish it
# from a real run so the loop cannot mistake a failure for findings.
if grep -q "usage limit" "$RAW.err" 2>/dev/null; then
  echo "codex: account usage limit, resets 2026-10-04 08:57" >&2
  exit 75   # EX_TEMPFAIL — try again later
fi
if [[ $status -ne 0 ]]; then
  echo "codex: exit $status" >&2
  tail -3 "$RAW.err" >&2
  exit $status
fi

# The agent's own words, not the hook chatter and not the rollout events.
ANSWER=$(python3 - "$RAW" <<'PYEOF'
import json, sys
# The measured event shape for this build:
#   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
#   {"type":"turn.completed","usage":{...}}
# An earlier version of this script looked for a top-level `agent_message` or
# `last_agent_message`, found neither, and reported "no agent message" on a run
# that had actually answered — the exact failure mode this loop has hit three
# times now, where a correct run is reported as a broken one.
best = ""
for line in open(sys.argv[1]):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        ev = json.loads(line)
    except Exception:
        continue
    item = ev.get("item")
    if isinstance(item, dict) and item.get("type") == "agent_message":
        best = item.get("text") or best
    if ev.get("type") == "turn.completed" and ev.get("last_agent_message"):
        best = ev["last_agent_message"]
print(best)
PYEOF
)

if [[ -z "$ANSWER" ]]; then
  echo "codex: run succeeded but produced no agent message (empty gate)" >&2
  exit 5
fi

python3 - "$OUT" "$MODEL" "$ANSWER" <<'PY'
import json, sys, datetime
out, model, text = sys.argv[1], sys.argv[2], sys.argv[3]
raw = text
try:
    start = text.index("[")
    items = json.loads(text[start:])
except Exception:
    items = [{"title": "unparsed", "claim": text[:400], "reason": "", "suggest": ""}]
json.dump({
    "model": model, "harness": "codex-cli", "computer_use": True,
    "reviewed_at": datetime.datetime.now().isoformat(timespec="seconds"),
    "items": items, "raw": raw,
}, open(out, "w"), indent=1)
print(f"codex: {len(items)} findings -> {out}")
for it in items[:5]:
    print("  -", it.get("title"))
PY
