# Improvement loop — state

An unbounded loop: ask a state-of-the-art vision model what is wrong with the
game, act on the feedback, then ask a different one. Stop when told to.

## How a round works

1. **Capture** — `node tools/review-shots.mjs /tmp/smkk-review` (needs a dev
   server on :5173). Produces 11 screens: boot, title, fight, strike, controls
   engaged, technique ref, settings, result, desktop, high-contrast, tournament.
2. **Review** — `python3 tools/vision-review.py <model> /tmp/smkk-review
   --out reviews/<n>-<model>.json`. Each model returns exactly 5 items with
   `what` / `why` / `how`.
3. **Triage** — dedupe across reviews, discard anything already fixed or that
   the art direction deliberately rejects, and rank by player impact.
4. **Plan** — turn the survivors into milestones with a doneCommand each.
5. **Execute** — isolated worktree per item, suite green, land.
6. **Recapture and repeat with the next model.**

## Rules the loop obeys

- One model per round. Sequential — each model reviews the *result* of the last.
- A review is a hypothesis, not a verdict. A vision model can be confidently
  wrong about a screenshot. Verify a claim against the code before implementing.
- Never change a test to make a failing gate pass. If a review item conflicts
  with a test, the test is the contract and the review is wrong.
- Every landed change keeps `pnpm check`, `pnpm build` and the full e2e green.
- No AI attribution anywhere.

## Model queue

Rounds 1-3 use the frontier vision models. The full candidate list is 292
vision models on OpenRouter; this queue is the state-of-the-art shortlist
(flagship/reasoning tiers, excluding nano/mini/lite/free/batch variants),
ordered by review independence — deliberately mixing model families so
successive rounds are not five variants of the same opinion.

| # | Model | Family | Status |
|---|-------|--------|--------|
| 1 | `google/gemini-3.8-flash` | Google | reviewed |
| 2 | `z-ai/glm-5.3-flash` | Zhipu | pending |
| 3 | `anthropic/claude-opus-5.5` | Anthropic | pending |
| 4 | `openai/gpt-5.2` | OpenAI | pending |
| 5 | `x-ai/grok-4-vision` | xAI | pending |
| 6 | `moonshotai/kimi-k3` | Moonshot | pending |
| 7 | `qwen/qwen3.8-omni-flash` | Alibaba | pending |
| 8 | `bytedance-seed/seed-2.0-code` | ByteDance | pending |
| 9 | `deepseek/deepseek-v4.1-flash` | DeepSeek | pending |
| 10 | `mistralai/mistral-medium-3.1` | Mistral | pending |
| 11 | `meta-llama/llama-4-maverick` | Meta | pending |
| 12 | `cohere/command-a-plus` | Cohere | pending |
| 13 | `amazon/nova-premier-v1` | Amazon | pending |
| 14 | `inclusionai/ling-3.0-flash-vl` | InclusionAI | pending |
| 15 | `nex-agi/nex-n2.5-pro` | Nexa | pending |

## Log

Rounds, newest last. Full model output is kept in `reviews/`.
