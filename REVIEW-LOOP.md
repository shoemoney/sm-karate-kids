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
| 1 | `google/gemini-3.8-flash` | Google | landed `087be7a` |
| 2 | `z-ai/glm-5.3-flash` | Zhipu | landed `bc53eda` |
| 3 | `anthropic/claude-opus-5.5` | Anthropic | landed `e7762da`, `9e3bfe6` |
| 4 | `openai/gpt-5.2` | OpenAI | landed `fc8425e` |
| 5 | `x-ai/grok-4.20` | xAI | landed `b0197d6` |
| 6 | `moonshotai/kimi-k3` | Moonshot | landed `f1fd3cf` |
| 7 | `qwen/qwen3.8-omni-flash` | Alibaba | landed `dd37810` |
| 8 | `bytedance-seed/seed-2.0-code` | ByteDance | landed `d5336dd` |
| 9 | `deepseek/deepseek-v4.1-flash` | DeepSeek | pending |
| 10 | `mistralai/mistral-medium-3.1` | Mistral | pending |
| 11 | `meta-llama/llama-4-maverick` | Meta | pending |
| 12 | `cohere/command-a-plus` | Cohere | pending |
| 13 | `amazon/nova-premier-v1` | Amazon | pending |
| 14 | `inclusionai/ling-3.0-flash-vl` | InclusionAI | pending |
| 15 | `nex-agi/nex-n2.5-pro` | Nexa | pending |

## Log

Rounds, newest last. Full model output is kept in `reviews/`.

### Round 1 — google/gemini-3.8-flash — `087be7a`

Five items, all real, all verified before implementing:

- `landscape-controls-fighter-overlap` — `justify-self: center` in a 1fr column
  still crossed HasanAbi's shin at 1280px. Fixed to hard corners.
- `portrait-camera-tatami-dead-space` — a tall viewport is width-starved, so
  framing both fighters pushed the camera back until a quarter of the screen was
  empty mat. **First attempt overshot** (eye 2.05 cropped the fighters at the
  knees); 1.5 plus tighter portrait margins is the measured compromise.
- `controls-persisting-behind-modals` — sticks at full contrast behind sheets
  and the result card. Now 0.18 via `:has()`.
- `typography-inconsistency-overlays` — result score got the gold treatment.
- `loading-screen-asymmetry-contrast` — status centred, bar no longer a hairline.

### Round 2 — z-ai/glm-5.3-flash — `bc53eda`

- `blackout-hides-dojo-on-boot-and-result` — **two corrections.** Easing the
  result veil alone made the detail line unreadable against a white gi; the fix
  is a blurred plate under the text column only, dojo readable elsewhere.
- `boot-progress-bar-invisible` — the 0% is *correct* (first unit is a bundle
  fetch) but reads as broken. Number now ships in the markup, not just the
  first update, so first paint carries a reading.
- `crowd-silhouettes-read-as-cutouts` — `MeshBasicMaterial` takes no light, so
  the row had to be repainted warm rather than lit.
- `webgpu-tag-in-scoreboard` — moved to a dimmed corner tab. First put it
  bottom-right, which collided with the settings gear; bottom-left.
- `portrait-fight-framing-too-loose` — vignette 0.38 → 0.28.

### Patterns worth keeping

- **Vision models overstate in the "too dark / too small" direction.** Twice now
  the honest read was "the art direction is intentional, the fix is smaller than
  you think". Round 1's first camera attempt proved it: applying the full
  suggestion cropped the fighters at the knees.
- **Two of ten items needed a second correction after the first fix.** Capture
  after every round, not just at the end — the overshoot is invisible in code.
- **A real finding is not always a code finding.** The boot bar and the WEBGPU
  slot were both correct behaviour in a bad position.

### Round 3 — anthropic/claude-opus-5.5 — `e7762da`, `9e3bfe6`

The most productive round so far, and the only one that found a *missing feature*
rather than a misplaced one.

- `teach-sticks-in-context` — **there was no onboarding at all.** Grepped for
  `coach|tutorial|onboard|first-run` across `apps/game/src` and `index.html`:
  zero hits. The grammar lived only in the Techniques sheet, which a new player
  has no reason to open. Added `coach.ts` — one-time captions inside each stick
  ring, real touch devices only, dismissed by the first committed technique.
  Non-blocking by design: never pauses the clock, never takes focus, never traps
  a tap. Note the gate caught this one — the first draft called `readFlag`/
  `writeFlag`, which do not exist; the real API is `loadValue`/`saveValue`.
- `fix-moves-sheet-readability` — every row spelled out "stance + technique" in
  full, restating the group heading above it and squeezing names until "Crouching
  Reverse Punch" wrapped to two lines. Two lit glyph pips now; the spelled-out
  form survives as the accessible name. Every name is one line.
- `keep-faces-clear-on-cards` — **first attempt failed silently.** `margin-block-start:
  auto` went into a new rule, and a later `.result-rematch { margin-top }` maps
  to the same property and won. The button stayed across both fighters' faces
  and the screenshot was the only thing that noticed. Fixed by editing the
  existing rule rather than adding a competing one.
- `clean-hud-chrome` — the renderer badge now rides the "Show performance HUD"
  setting, which already prints the backend. Separately, the portrait header's
  second row collapsed into a floating pair: ~90px of chrome holding two
  controls, handed back to the viewport.
- `tighten-portrait-framing` — **partially rejected.** Opus asked for heads at
  ~35% and feet at ~85% of the viewport. Rounds 1 and 2 already took the camera
  in twice, and round 1's full-suggestion attempt cropped the fighters at the
  knees. The honest reading is that the remaining dead space above the fighters
  is mostly *ceiling*, not framing error. Attacking it by reclaiming the header
  strip instead is a real gain that does not risk the crop; the camera is left
  alone this round.

### Round 4 — openai/gpt-5.2 — `fc8425e`

- `sprite-grounding-shadows` — the most precise claim any model has made: "no
  contact shadow **directly under the soles**". A crop of the mat confirmed it
  and also corrected it — a shadow *did* exist, but at 0.44 alpha with a soft
  22%-radius falloff it read as a smudge behind the feet. Fixed by separating
  two things that had been drawn as one: a hard dark core under the sole, and a
  wide soft cast shadow around it. Worth noting the model was right about the
  symptom and wrong about the cause.
- `overlay-tap-targets-clarity` — settings checkboxes were a **22px** target.
  The box keeps its optical size; a 44px white square in a settings list looks
  like a bug, so the hit area is extended by pseudo-element instead.
- `prefight-hierarchy-bloat` — the round card spent the top third of a phone
  and pushed both fighters into the mat. Fixed with a scoped `data-phase`, not
  by shrinking the result headline, which is the payoff and earns its size.
- `controls-too-dim` / `loading-state-legibility` — contrast lifts on the coach
  legend, the stick labels, and the boot percent.
- **A regression from the previous round, caught by screenshot.** Round 3's
  floating MOVES and gear buttons landed across the round name. The e2e suite
  stayed green throughout — nothing asserts about visual overlap. This is now
  the second time in three rounds that only a screenshot caught a fault, and the
  second time the fault was introduced by an earlier round's own fix. **Rounds
  are not independent, and a fix's real cost shows up in the next round's
  capture.**

### Round 5 — x-ai/grok-4.20 — `b0197d6`

- `loading-progress-stuck` — **the deepest find of the loop, and I nearly
  rejected it.** Grok's screenshot said the bar "shows 0% indefinitely", and my
  first instinct was that this was a still-frame artifact of a screenshot taken
  at 600ms. Instrumenting it against the production bundle on a throttled link
  said otherwise:

      0.0s  MEASURING  "Downloading the game"
      4.0s  determinate  7%  Lacing the fighters — 1/6 pages
      4.3s  determinate 20%  Lacing the fighters — 3/6 pages
      4.5s  determinate 67%  Starting the renderer
      5.8s  determinate 100% Ready

  **The app cannot report anything for the first four seconds, because the
  module that would report it has not finished downloading.** The reporter is
  inside the thing being measured. Every resource check agreed — in dev the
  first app resource lands at 4.0s and `three_webgpu.js` at 9.1s. The card now
  opens in an honest indeterminate state and the first advance that actually
  moves the bar flips it to determinate.

  The lesson is about method, not about Grok: a still frame cannot show you the
  absence of motion, and I nearly dismissed a real bug because the evidence
  "looked like" a capture artifact. **Probe the thing; do not reason about the
  picture of the thing.**

  Also: the first attempt at the fix flipped the state on *any* `advance()`
  call, and the atlas reports 0/6 pages before it starts — so the shimmer
  became the exact dead 0% bar it replaced. Only a second measurement caught it.
- `score-timer-unreadable` — a dark stroke on the clock digits. Gold on warm
  bloom was separating by luminance alone.
- `control-labels-too-small` — coach legend up from 0.58rem to 0.66rem.
- `technique-stick-visual-feedback-weak` — the pressed knob now scales 1.09×.
  A 1px state change is not readable by a thumb that is already moving.
- `fighters-too-low-in-frame` — **rejected.** This is the third model to
  comment on vertical distribution and the second to ask for a camera change
  in the opposite direction from the first two. The frame is full; there is no
  version of this where the fighters are simultaneously larger, higher, and
  fully visible with a pad below them. Rounds 1 and 2 already took the camera in
  twice and once cropped the fighters at the knees.

**Queue hygiene:** `x-ai/grok-4-vision` is not a real model ID and returns 400.
The rest of the queue has now been validated against the live catalogue.





### Round 6 — moonshotai/kimi-k3 — `f1fd3cf`

- `crowd-cardboard-cutouts` — the **fourth** model to flag this row. Round 2's
  warmth fix helped the hue and not the depth, which is the useful shape of that
  correction: right symptom, wrong lever. Distance is sold by size, height and
  opacity, not by tint. The row is now smaller, lower, fainter and further back.
- `intro-card-duplicate-round-info` — the HUD read "Round 1/5 · Qualifier", the
  headline read "QUALIFIER", and a kicker read "ROUND 1 OF 5". Three statements
  of two facts. The kicker is gone.
- `stick-legend-microtype` — accepted, but for a reason the model did not give.
  It flagged that the legend "vanishes after first touch". That was round 3's
  design: retire on the first committed technique. But a player who has learned
  to step and has never touched the technique stick has not finished the lesson.
  The marks now retire once **both** sticks have been used, which needed an
  `onEngage` hook on `TouchInput` — the stance stick has no simulation event of
  its own, because moving is not a move.
- `loading-no-progress-feedback` — **rejected.** This is round 5's fix being
  photographed: the card is in its MEASURING state, which is an animated sweep,
  and a still frame cannot show motion. The missing percentage is the point —
  during the first four seconds the reporter has not downloaded. A number there
  would be a lie.
- `portrait-action-squeezed` — **rejected after measuring.** Pad is 228px of an
  844px screen (27.0%), each zone 179px wide. That is thumb reach. Shrinking it
  is an accessibility regression wearing a layout win.

**Two rounds, two rejections, and both rejections were the same mistake I nearly
made in round 5**: reading a still frame as a statement about behaviour. A
screenshot cannot show that something is not moving, and it cannot show that a
number is deliberately absent.

### Round 7 — qwen/qwen3.8-omni-flash — `dd37810`

The highest-value round for a single line, and a lesson about the loop itself.

- `portrait-sticks-have-no-knob-or-chevrons` — **a regression I introduced in
  round 3 and did not see for four rounds.** While the first-run coach mark is
  up, the knob and chevrons were hidden outright, so the sticks were two empty
  rings with text floating in them — on a first run, the exact moment a player
  most needs to know these are sticks, they stopped looking like sticks. The
  stick now recedes (knob 0.72, chevrons retained) instead of vanishing.
- `crowd-silhouettes-flat-gray-collide-with-fighters` — **rejected on
  measurement.** The claim was "#8a8a8a-ish light gray, intersecting the
  fighters' thighs". The row is `#4a3320` at 0.3 alpha, 8.2 units behind the
  fighting plane; it only *appears* to overlap because a billboard at that depth
  projects to the fighters' hip line. Third fix to this row. Refusing a fourth
  on a misread is the point — the loop's own failure mode is overcorrection.
- `boot-logo-black-extrusion-misregistered` — **rejected on policy, verified on
  pixels.** The model is right that the black shield reads as a misregistered
  extrusion. It is also the shipped artwork: the source PNG carries ~141k
  near-black opaque pixels, so the black is in the asset and not in my pipeline.
  AGENTS.md forbids recolouring, restyling or distorting the ShoeMoney mark.
  A correct observation about an asset we are not allowed to touch is still not
  a task.
- `loading-bar-shows-zero-progress` — **third round to photograph the MEASURING
  state as a dead bar.** Rounds 5 and 6 rejected this; the same rejection stands
  and is now on the record three times, which is the point of keeping the log.
- `portrait-fight-framing-dead-top` — fifth framing complaint.

**The loop's blind spot, named:** rounds 3 through 7 all had the same
screenshots available, and the round-3 regression sat in every one of them. A
model looking at a *new* composition notices what changed since the last round.
Nothing in the loop was looking at a *given* screen across time. The re-capture
each round is what surfaced it — not because a reviewer got better, but because
the previous round's fix put the marks in front of the sticks for the first
time and someone finally looked at that combination.

### Round 8 — bytedance-seed/seed-2.0-code — `d5336dd`

- `pre-fight-controls-unlabeled-hidden` — **a round-1 regression, found eight
  rounds later.** The rule that stands the sticks down behind a dialog was also
  matching the pre-fight round card, so during the countdown that *ends* in the
  fight the pad sat at 18% and the STANCE and TECHNIQUE labels were barely
  legible. The round card is not a dialog you dismiss to return to gameplay; it
  is the thing that hands you the controls. Dimming it is the exact opposite of
  the rule's intent. Now scoped to real sheets and the post-fight result, using
  the `data-phase` attribute round 4 added.
- `countdown-button-number-ambiguous` — "FIGHT · 3" put a bare numeral on a
  gold pill next to a scoreboard, where a bare numeral reads as a point total.
  The digit now sits in its own dark chip, with an aria-label for voice.
- `settings-toggle-state-unclear` — **rejected: the evidence cannot show it.**
  The capture has all six toggles OFF. Asserting an active/inactive problem
  from six unchecked boxes is not evidence of anything.
- `loading-progress-bar-empty` — fourth round to photograph the MEASURING
  state as an empty bar.

**Two regressions, both mine, both from "a rule that was right in one place".**
Round 1's dim-behind-modals rule and round 3's hide-the-knob-while-coaching
rule were each correct where they were written and wrong one context away. The
loop only found them because each round re-captured the whole product, and a
model looking at a composition that a *previous* round had just created is
looking at something no reviewer had seen before.
