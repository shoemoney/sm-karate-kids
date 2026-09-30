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
| 9 | `deepseek/deepseek-v4.1-flash` | DeepSeek | landed `e627548` |
| 10 | `mistralai/mistral-medium-3.1` | Mistral | reviewed — 0 of 5 accepted |
| 11 | `meta-llama/llama-4-maverick` | Meta | reviewed — 0 of 5, all vague |
| 12 | `cohere/command-a-plus` | Cohere | reviewed — feature asks, 0 defects |
| 13 | `amazon/nova-2-lite-v1` | Amazon | pending |
| 14 | `inclusionai/ling-3.0-flash-vl` | InclusionAI | landed `36c4b3e` |
| 15 | `nex-agi/nex-n2.5-pro` | Nexa | provider returns empty content, 2 tries |

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

### Round 9 — deepseek/deepseek-v4.1-flash — `e627548`

- `loading-screen-identity` — **half right, and the right half was the best
  product finding of the round.** The card named the studio and never the
  game: a publisher card with no product name on it. Now "SM Karate Kids /
  Asmongold vs HasanAbi", as markup rather than injection, because the card has
  to be on screen before `main.ts` runs at all. The other half — "the bar reads
  as empty" — is the MEASURING state, round 5's finding.
- `control-naming-inconsistency` — accurate, and worse than it sounds. The same
  two controls carried three names: the pad says STANCE/TECHNIQUE, the
  aria-labels say "Stance stick"/"Technique stick", the sheet says
  "Techniques" — and the coach, added in round 3, said STRIKE. I introduced the
  fourth name myself.
- `in-stick-label-clutter` — accurate and a consequence of round 3: the legend
  was set dead centre in the ring, which is the hit area, which is where the
  thumb rests. Now biased to the upper half.
- `hud-top-safe-area` — **rejected on one line of CSS.** The claim is that the
  score row sits flush under the notch. `#app` carries
  `padding: env(safe-area-inset-top) …` and `#hud` is its first child, so the
  scoreboard already starts below the inset, and the viewport meta sets
  `viewport-fit=cover`, which is what makes `env()` resolve at all. This is the
  exact class of finding that looks certain in a screenshot and is settled by
  reading the cascade.
- `settings-checkbox-state` — third rejection, same reason: every toggle in the
  capture is off.

**Pattern across nine rounds.** The findings that survive verification cluster
in three kinds: a thing that does not exist (no onboarding, no product name, a
stale debug badge), a thing in the wrong place (text over faces, controls under
a thumb, a diagnostic in the clock's slot), and a rule that was right in one
context and wrong in another (dimming during a countdown, hiding a knob that
was the affordance). The findings that die are almost all reads of a still
frame — motion, depth, and state that the capture cannot show.

### Round 10 — mistralai/mistral-medium-3.1 — **0 of 5 accepted**

The first round where nothing survived verification, logged as such because a
log that implies every model finds gold is not a log.

Mistral refuses more than 8 images (`Total number of images exceeds the maximum
allowed of 8`), so the harness grew `--max-images` and keeps the
highest-value screens when over a provider's cap. It saw 8 of 11.

- `fighter-shadow-anchoring` ("cast no visible shadows") — **rejected on a
  crop.** Round 4 raised the contact shadow to 0.66 alpha with a hard core;
  the mat shows two clear dark pools under the two stances. This is the third
  model to report a defect that a previous round had already fixed, and the
  first to do it about something measured two rounds earlier.
- `rematch-button-glare` ("bloom washes out the text and edges") — **rejected
  on a crop.** The `REMATCH` glyphs are the darkest thing on the button. There
  is a warm halo around the pill, which is the art direction.
- `hud-score-legibility` — **rejected.** `.points` is `var(--text)`, near-white
  on a dark bar, and the gold clock already carries the 2px dark stroke round
  5 added for exactly this claim.
- `loading-logo-contrast` — **rejected on policy.** Same as round 7: the mark
  is proprietary, and AGENTS.md forbids recolouring, filtering or restyling it.
- `settings-toggle-visibility` — **rejected, fourth time, same reason.** Every
  toggle in the capture is off; the image cannot show a checked state.

**What an all-reject round means.** Ten rounds in, the obvious wins are gone and
the remaining reports are dominated by reads of a still frame. The loop is past
the point where a fresh model finds something new on the same eleven screens —
which is a fact about the *screens*, not about the models. The next useful move
is either a different set of screens (a real contact, a rematch, a loss
position, a first-run with the coach up) or a different question. Continuing to
re-shoot the same eleven and calling it coverage would not be.

### Rounds 11-14 — maverick, cohere, nova-2-lite, ling

- **maverick — 0 of 5, and the model repeated itself verbatim** on a second
  pass with the same images, which is worth knowing about temperature-0.4
  determinism. All five items were contrast/composition suggestions with no
  measurable referent ("improve loading screen text clarity", "enhance control
  label visibility"). Nothing to verify, nothing to reject on evidence either.
- **cohere — feature requests, not defects.** "Redesign touch controls",
  "simplify move system", "create engaging post-match experience". Two of its
  asks are already shipped: `juice.impact()` draws sparks, a shockwave ring on
  full points, hitstop, shake and a camera punch, and the post-match path has
  WAZA-ARI/BLOCKED calls, a slam-in result card, match-point slow motion and a
  distinct `CHAMPION`/`DEFEATED` headline carrying career records. A reviewer
  proposing a redesign is answering a different question from the one asked.
- **amazon/nova-premier-v1 is EOL** — 404, "reached the end of its life". The
  live vision model in that family is `nova-2-lite-v1`.
- **ling-3.0-flash-vl — 2 accepted.** The technique caption was pinned to the
  bottom of the stage, directly above the pad, which is where both thumbs rest:
  a confirmation the player cannot see while performing the thing it confirms.
  And the gear button sat flush against the right bezel after round 3 collapsed
  the header row, putting part of a 44px target off-screen.
- **nex-agi/nex-n2.5-pro could not be reviewed.** It answers HTTP 200 with a
  null `content`, twice, 762 seconds apart. That is a provider failure, not a
  review, and the harness now records it instead of crashing on it.

**Where the loop stands.** Twelve rounds, ten distinct model families, roughly
half the reported items accepted and the other half rejected against a crop, a
CSS line, or a pixel count. The accepted work clusters hard: a missing feature
(onboarding), a missing identity (the game's name on its own boot card), a
debug badge shipping to players, controls dimmed during the countdown that
starts the fight, a caption printed under the player's thumbs, and a coach mark
that had stopped the sticks looking like sticks.

**Two of those were regressions this loop introduced.** Round 1's dim-behind-
modals rule and round 3's hidden knob each looked correct in the place they
were written and were wrong one context away, and both took eight rounds and a
fresh pair of eyes to surface. Every round re-captures the whole product, which
is the only reason either was caught.

### Round 15 — gemma-4-31b-it + gpt-6-luna — `61658d2`

The round that corrected the loop, not the game.

- `settings-checkbox-state` — **rejected by me five times, and I was wrong
  every time.** The sentence was identical each round: *the capture has all six
  toggles off, so it cannot show a checked state.* That was true, and it was
  also a way of never having to look. `accent-color` tints the tick but leaves
  the box the same value whether it is on or off, so the state really did have
  to be read from a 3px mark on a near-black sheet. Five independent models saw
  it. Fixed, and then I did the check I should have done on round one: captured
  a settings screen with two toggles on. The gold plate is obvious.

  **The lesson is about the rejection, not the fix.** A rejection is supposed to
  rest on a measurement. Five identical rejections of the same finding, from
  models that had no way of knowing they were repeating each other, is not a
  measurement — it is a prior I had stopped re-examining. When a finding
  recurs, the cheap thing is to dismiss it and the expensive thing is to go and
  make the capture that settles it.
- `clear-the-stick-surfaces` / `move-the-move-list-labels-above-the-joysticks` —
  three rounds said the lesson text should not be on the stick. Accepted. Round
  9's fix had moved it to the top of the ring, which was a smaller version of the
  same wrong answer: the problem is the ring, not the position within it.
  It is one strip now, and the rings keep their knobs and chevrons.
- **A bug found by the fix, not by the review.** `#pad` is `position: static`, so
  the new absolute strip resolved against the root and rendered at y=8, behind
  the scoreboard — in the DOM, correct in every computed style, invisible in the
  screenshot. A stacking/containing-block bug is invisible to both a review and
  a type-check, and it only appeared because the change was visual.
- `show-loading-progress` — the MEASURING state again.
- `reframe-portrait-combat` — the seventh framing complaint.

### Where the loop is now

Fifteen rounds, seventeen models, **126 vision models still unasked**. The
queue was extended past the flagship shortlist into the long tail.

The yield curve has flattened to near zero on repeated screens and the accepted
work is now concentrated in a handful of surfaces. What keeps producing: a
finding that recurs across independent models, and a change that is visual
enough to have a containing-block bug nobody can see.

### Round 16 — qwen3-vl-32b, llama-4-scout, mimo-v2.5 — `c57190b`

- `title-card-font-glyph: "broken glyph in QUALIFIER"` (mimo) — **accepted, and
  the glyph was not the problem.** `.result-headline`, `.boot-title` and the
  boot subtitle all referenced `var(--font-display)`, and the custom property
  was never defined in the stylesheet. A `var()` with no definition and no
  fallback resolves to nothing, so the round name, the result headline and the
  game's own name on the boot card have all been in the browser default this
  whole time. `.result-headline` did not even declare a family — it inherited
  the body sans. What read as a malformed A was Helvetica Neue Black at weight
  900 carrying a 1.5px text-stroke, whose crossbar filled in under the outline.
  With the condensed display face applied, the artefact disappears on its own.

  **A model reporting a visual artefact is often reporting a cause.** Nobody
  in fifteen rounds had read a stylesheet looking for an undefined custom
  property; one model reported a glyph as broken and that led straight to it.

Rejected this round, with the measurement:

- `score-color-indistinguishable: player scores are the same colour` (mimo) —
  they are not. Asmongold's score is `var(--text)`, near-white; HasanAbi's is
  red. The HUD crop shows it plainly.
- `joystick-size-obstructive` / `control-sticks-occlude-view: bottom 40%` —
  measured: the pad is 228px on an 844px screen, **27.0%**. Scout's 40% is
  wrong, and 27% is thumb reach, not obstruction.
- `fight-button-too-small` / `inconsistent-button-size` — the button is
  `min-width: 12rem; min-height: 52px`, which is 192x52, comfortably past the
  44px minimum in both axes.
- `loading-progress-stuck` / `pre-boot-loading-screen-dark` — the MEASURING
  state, now on its seventh appearance in the log.
- `technique-label-overlap` (mimo) — the technique chip moved to 25% of the
  stage in round 12; the TECHNIQUE label is on the pad. They are ~380px apart.

### Round 17 — gemma-4-26b, qwen3.8-27b, gpt-5.6-luna — `011c763`

- `clipped-fight-cta` (gpt-5.6-luna) — **rejected on measurement, and the
  measurement found something better.** Claimed the pre-fight CTA clips on
  portrait. Measured at 320x568, 360x640 and 390x844: the button sits at
  298-350, 370-422 and 548-600, fully inside the viewport in every case.
  Verifying it meant shooting a viewport nobody shoots, and at 320px the
  scoreline was rendering **"ASMONG…" and "HASANA…"** — two truncated names
  landing on the same stub, so the player cannot tell the fighters apart on the
  one element that identifies them. Fixed by tightening tracking and dropping a
  step below 360px; both names now measure unclipped at all three widths.

  **A review set is a sampling of the product, and this loop only ever sampled
  one viewport.** Seventeen rounds of frontier models asked the same question
  about the same 390px screen, and the defect that survived all of them was on
  a device that is still a phone. Rejecting a claim is what surfaced it.
- `combat-hint-panel-clutter` (qwen3.8-27b) — called the coach strip a
  "permanent instruction wall". It is first-run only and retires once both
  sticks have been used. The overlap point is fair: the strip's lower edge sits
  on the upper arc of both rings. Tight rather than broken.
- `combat-callout-collision` (gpt-5.6-luna) — the technique chip at 25% of the
  stage and the referee call at 18% are 38px apart. Fair, and the cheapest fix
  is spacing rather than a redesign.
- `landscape-empty-control-layout` (gpt-5.6-luna) — the desktop corner
  plaques. A taste question, not a defect.
- `score-readability-low-contrast`, `ui-layering-occlusion` — already handled
  in rounds 5/10 and 1 respectively.

### Round 18 — gemma-3-27b, qwen3.8-35b — `8dd8bb9`

- `permanent-control-overlay` (qwen3.8-35b) — the THIRD independent model to
  report the coach strip as permanent, and the third time the answer was wrong
  in the same way. The strip clears on the first bout once both sticks have been
  used. The reason three reviewers converged on the same false conclusion is
  that the conclusion was **underdetermined, not agreed-upon**: every capture in
  this harness ran in a fresh browser context with an empty localStorage, so
  the first-run state was in every frame the loop ever showed a model. None had
  seen the other state.

  Fixed the sampling rather than the strip. `14-phone-returning` seeds the seen
  flag and captures the same bout with it retired; the review set now carries
  both states.

  **A review harness is a sampling of the product, and a sample that never
  varies a dimension cannot see anything about that dimension.**
- `techniques-menu-contrast` (qwen3.8-35b) — **accepted.** The moves-sheet
  scoring column was `--text-faint`, a deliberate ghost. But that column carries
  the scoring rule — "mid · Half point" is the entire reason a point-karate game
  has no health bars. Lifted to `--text-muted`.
- `post-fight-navigation-dead-end` / `missing-pre-fight-navigation`
  (qwen3.8-35b) — rejected: the end-of-tournament card is
  `action: 'NEW TOURNAMENT'` → `newRun()`. The product has one mode of play at
  its front door, so there is no menu to navigate back to and nothing to dead-end
  into.
- `fighter-mat-spacing` (gemma-3-27b) — the framing call, in its eighth
  iteration across four models. Standing judgement: warm and low.
- `hud-score-contrast` (gemma-3-27b) — rounds 5/10.
- `landscape-control-scaling` (qwen3.8-35b) — taste, not a defect.

### Round 19 — glm-4.6v, grok-4.7, ling-3.0-flash-vl, mimo-v2.6-flash — `fe558fe`

Catalogue refreshed from the live API first: **292 vision models, 23 asked, 271
remaining.** The local snapshot was inventing IDs — `glm-4.7v` and
`glm-4.6v-flash` do not exist; `glm-4.6v` does.

- `strikes-dont-read` (grok-4.7) and `attack-banner-idle-pose`
  (mimo-v2.6-flash) — **accepted, and this is the one that mattered.** Two
  unrelated providers, no shared lineage, the same reading of the same frames:
  "the LUNGE PUNCH chip is up while both fighters hold the exact same neutral
  guard as the idle frame", and "move-name banners display while the fighter is
  still in the untouched idle stance".

  Neither could have seen the cause, because the cause is three lines:
  `showTechnique(name) { this.technique.textContent = name; }` — the whole
  method. The referee banner beside it has carried a `bannerUntil` expiry since
  round 4. The technique chip never had one. The last move you threw stayed on
  screen for the rest of the bout, so it read as a state readout rather than a
  confirmation and the next strike was indistinguishable from a stale label.

  Confirmed by driving real CDP touch input — both zone anchors, both sticks,
  ◄ technique and ► stance together. Two earlier attempts used the wrong
  selector and `touchscreen.tap` and returned clean empty results that looked
  like "the input doesn't work"; the harness's own `thumbs.ts` dispatches raw
  CDP touch points, and a technique is two simultaneous sticks, not a tap. Chip
  now appears at 100ms and clears at 794ms.
- `scorebar-clock-reads-as-score` (mimo-v2.6-flash) — **accepted.** The clock was
  typeset exactly like the two scores, in one row, so the header parsed as
  "0 30 0". Boxed in a dial frame; the scores stay bare and flat.
- `post-fight-navigation` claims (qwen3.8-35b, prior round) — the card is
  `action: 'NEW TOURNAMENT'` → `newRun()`. No menu exists to navigate back to.
- `settings-checkbox-size`, `fight-button-number-visibility`, `techniques-icon-size`
  (glm-4.6v) — all sized deliberately in earlier rounds, with measurements.
- `controls-label-clarity` (glm-4.6v) — the weakest of the batch and the only
  one with a whiff of substance; `--text-2xs` on STANCE/TECHNIQUE is small.
  Noted, not actioned.
- `loading-bar-never-fills` (mimo) — the MEASURING state.
- `portrait-fight-frame-wasted`, `fighters-edge-proximity` — framing, in its
  ninth and tenth iteration. Standing judgement: warm and low.

### Round 20 — claude-sonnet-5.5, gpt-6-sol, seed-2-1-turbo, step-3.7-flash — `ee0b17a`

- `ippon-banner-collision` / `ippon-overlay-collision` /
  `ippon-text-obscuration` (claude-sonnet-5.5, gpt-6-sol, step-3.7-flash) —
  **accepted, three providers converging.** Stamp spans y=156–231, technique
  pill y=195–220 — the pill sat *entirely inside* the stamp. 25px of overlap,
  two competing plates over the fighters' heads at the moment the player is
  meant to read the result. Cause: `Hud.call()` wrote the move name to the
  separate technique pill instead of to the stamp. A scored point is one
  statement, so it is one element now — the move is a third line in the stamp
  and the pill is cleared.
- `hint-panel-covers-sticks` / `control-legend-overlaps-joysticks`
  (claude-sonnet-5.5, seed-2-1-turbo; qwen3.8-27b in round 17) — **accepted.**
  Strip bottom 684, ring top 634: 50px of overlap, with the UP chevron at y=650
  underneath it — the strip was covering the affordance it exists to teach.

  The rings could not move: the pad is 228px holding 170px rings, 29px of slack
  against a 59px strip, so stepping them down clips them off the pad. Tried,
  captured, reverted. The strip leaves instead, over the dojo's lower edge,
  directly above the controls it describes. Re-measured: zero overlap.

  **Rejected a plausible fix on a captured screenshot.** The step-down looked
  right in the DOM and clipped both rings in the frame. Three findings in three
  rounds said the strip covered the sticks, and the fix that satisfies the
  measurement had to be thrown away for the one that satisfies the product.
- `fighter-ground-clipping` (step-3.7-flash) — new, and not reproduced: the
  contact shadows anchor the feet above the mat edge by design.
- `teach-sticks-before-fight`, `first-bout-ends-before-learning` (gpt-6-sol) —
  the coach strip is exactly this, and it is on the pre-fight card.
- `fight-button-countdown-unclear-affordance` (seed-2-1-turbo) — no skip hint
  on the auto-start countdown. Noted.
- `loading-screen-empty-progress-bar` — the MEASURING state, in its eighth
  appearance across four providers.
- `fighter-framing-wastes-vertical-space`, `fighters-small-empty-mat` —
  framing, in its eleventh and twelfth iteration. Standing: warm and low.

### Round 21 — grok-4.6, mimo-v2.6-pro, qwen3.8-flash, fugu-max — `be7e482`

- `settings-toggles-invisible: "settings uses blank gray squares instead of
  recognizable controls"` (grok-4.6) — **accepted, and it is round 15's fix
  seen from the other side.** Round 15 made ON unmistakable and left OFF alone;
  `--surface-sunken` measures rgb(0,0,0) against this sheet, so the checkbox
  carried its whole meaning in a 3px native tick and with nothing ticked there
  was no control on screen. Rebuilt as switches — a track with a knob that has
  a visible position either way.

  **The first switch capture looked inverted and was not.** A crop offset landed
  on the row above the one I had toggled; the DOM said `checked: true`, the
  stylesheet said gold. Re-read both in a single evaluate and captured the whole
  sheet rather than trusting either — which is what exposed the real defect
  underneath, a track present in the DOM and invisible in the frame. A crop is
  an argument about which element you are looking at, and it lost.
- `stick-chevrons-low-contrast` (qwen3.8-flash) — **accepted.** `--detent-idle`
  was 0.36 alpha, about 3:1 against the ring, for the only markers that tell a
  thumb which way a stick goes. Now 0.52, a shade over 5:1, still behind the
  knob the thumb actually tracks.
- `ippon-flash-blows-out-head` (qwen3.8-flash),
  `front-kick-decoupled-foot-sprite` (fugu-max),
  `align-hit-spark-vfx-to-impact-point` (fugu-max) — VFX and sprite-atlas
  concerns raised for the first time. Not reproduced from the static set; a
  still frame cannot adjudicate whether a hit flash clips a head or a spark is
  anchored to the contact point, both of which are per-frame questions. Logged
  for a targeted capture pass.
- `movelist-combo-notation-cryptic` (qwen3.8-flash) — the glyph pairs in the
  moves sheet. Round 3 gave them a glyph + caption header; the mapping from
  glyph to the in-bout legend is still not shown.
- `controls-clipped-by-legend` (qwen3.8-flash) — the legend covered the
  sticks, and round 20 fixed exactly that.
- `empty-loading-screen`, `loading-progress-invisible`,
  `loading-bar-no-progress` — the MEASURING state, in its ninth appearance
  across six providers. The single most-reported non-defect in the loop.
- `fighters-lost-in-portrait`, `fight-framing-dead-bands`,
  `fighter-framing-wastes-vertical-space` — framing, in its thirteenth
  iteration. Standing: warm and low.

### Round 22 — gpt-5.6-terra, gemini-3.7-flash, muse-spark-1.3 — `e93f48d`

- `front-kick-decoupled-foot-sprite` (fugu-max, r21),
  `sprite-front-kick-artifact` (gemini-3.7-flash),
  `ippon-flash-blows-out-head` (qwen3.8-flash, r21) — **accepted, with a
  different cause than any reviewer named.** Four reports across three rounds,
  all describing a limb defect: a "severed foot", a leg that "passes through"
  the opponent, a "floating severed limb", a head "clipped to a featureless
  white blob".

  The atlas is clean. A burst of sixteen input combinations at five frames each,
  keeping every frame where a move was live, showed a back kick fully extended
  with the foot attached to the leg. What the burst also showed, in two frames
  of six, was a translucent second Asmongold most of a body width behind the
  first.

  That is the afterimage: three ghosts at 0.32 opacity drawn at the exact world
  spot they were dropped, so the offset is whatever the fighter covered in three
  ticks. On a walk that is nothing; on a stepping kick it is most of a body
  width, and a full silhouette that far behind its owner is a second person in
  the room. Capped to 0.1 world units, peak 0.17, opacity falling off with
  staleness. Re-burst: a tight smear on the trailing edge.

  **A reviewer describing an artefact reliably points at a frame where something
  is genuinely wrong. They cannot name it, and the name they reach for will be
  wrong — go and look at the frame.**
- `meta/muse-spark-1.3` — **unavailable.** HTTP 403: requires an 18+ age
  attestation on the OpenRouter account. Not a model defect and not a prompt
  defect; the whole muse-spark family is behind the same gate.
- `opponent-hud-score-contrast` (gemini-3.7-flash) — HasanAbi's score is
  `--fighter-1` red, and rounds 5/10 already took it to the brightest red the
  palette allows. A colour the game needs in order to read as two fighters.
- `bottom-hud-label-clipping` (gemini-3.7-flash, gpt-5.6-terra,
  qwen3.8-flash) — the STANCE/TECHNIQUE labels and the stick bottoms. Round 20
  measured the strip clear of the rings; the labels measure at y=812–824 inside
  a pad ending at 844, which is clear.
- `ippon-impact-defender-flinch` (gemini-3.7-flash) — a content request, not a
  defect: the art set has no recoil frames. Logged for the asset backlog.
- `make-score-and-countdowns-legible` (gpt-5.6-terra) — the numbered bout badge
  on the FIGHT button; deliberate, and sized to 20px in round 12.

### Round 23 — glm-5.3-flashx, qwen3.6-35b-a3b, qwen3.5-27b — `69d579e`

- `endscreen-ghost-ui-and-round-context: "ghost legend bleeds through the REMATCH
  button"` (glm-5.3-flashx) — **accepted, exactly as described.** The first-run
  coach strip outlived the bout, so the result card rendered REMATCH on top of
  it and "◄ step ▼ crouch" stayed readable through the one control the player is
  asked to press. Now retires at every point a result is shown.

  Worth recording the first attempt: `coach.dismiss()` went into `clearBoutUi`,
  which runs when the *next* bout starts — after the card the player is looking
  at has already gone up. Correct-looking, in the right function, inert.
- `add-hit-and-guard-reactions: "fighters idle straight through being struck"`
  (glm-5.3-flashx) and `hit-feedback-scale: "impact effects are too subtle"`
  (qwen3.5-27b), separately — **accepted as one finding.** The impact stack is
  not subtle: 95ms hitstop, 26 particles, a painted burst, a shockwave ring on
  a full point, shake, saturation punch, white flash, vibration. The struck
  fighter simply does not react, which is what all of that serves.

  The shove went in the **view**, not the sim. Point-karate ends the exchange
  on contact and the sim is deterministic and checksummed, so moving a fighter
  would be a lie about the rules. A spring recoil in `SpriteFighterView`,
  applied to the root so the afterimage trails it rather than sitting in the
  pre-hit spot, settling to exactly zero.

  **A finding about a feeling is usually a finding about a mechanism.** Neither
  model could see the sim; both could see that nobody moved.
- `ippon-impact-underdelivers` (glm) vs `impact-text-obstruction: scale down the
  IPPON text` (qwen3.6-35b) — two models giving opposite instructions on the
  same element. That is what an element at roughly the right size looks like.
- `technique-callout-ownership: "LUNGE PUNCH appears while nobody lunges"`
  (glm) — the round-19 stale-chip finding arriving from a model that has not
  seen the fix.
- `loading-screen-branding` (qwen3.5-27b) — the boot card carries name, matchup,
  logo and publisher line.
- `fight-button-countdown-contrast` (qwen3.6-35b) — 20px in round 12.
- `reclaim-stage-from-controls`, `joystick-oversize`,
  `portrait-composition-waste`, `control-occlusion-hud` — framing, in its
  fourteenth iteration. Standing: warm and low. The pad measures 27.0% of an
  844px screen, which is thumb reach, and 40% was never true.

### Round 24 — kimi-k2.7-code, gpt-5.6-sol, minimax-m3, mistral-medium-3-5 — `217a165`

- `modals-leak-controls: "moves and Settings panels leave the dual sticks
  visible underneath, eating scroll space"` (minimax-m3) — **accepted, and both
  halves were true.** The sheet was `inset: 0` inside #stage, and #stage ends
  228px above the bottom of the phone, so the Techniques list ran out of room
  with a move row sliced in half, no scroll affordance, and the dimmed pad
  eating a third of the screen. Eleven of eighteen moves visible.

  `position: fixed` under `body:has(.sheet:not([hidden]))` lifts it out of the
  stage's flow; the pad is now hidden behind a sheet rather than dimmed.
  Eighteen visible, and the next section header lands at the fold.

  The result card deliberately keeps the dimmed treatment: a sheet is a
  document, a result card is a card over a live bout, and the arena should stay
  faintly visible behind it.
- `unexplained-action-button-badges` (kimi-k2.7-code) and
  `qualifier-intro-typography: ... an unexplained 'FIGHT N' badge` (minimax-m3)
  — **accepted, next round.** Two models independently called the countdown
  numeral on the FIGHT button unexplained. It is a countdown, but nothing in
  the control says so.
- `ippon-face-stickers` (minimax-m3), `tame-impact-whiteout` (gpt-5.6-sol) —
  the defender's white flash reads as a sticker over the face rather than an
  impact. Round 23 gave the struck fighter recoil; the flash peak is the
  remaining half.
- `mistralai/mistral-medium-3-5` — rejected the set at 15 images: "Total number
  of images exceeds the maximum allowed of 8". Same cap round 9 hit on
  mistral-medium-3.1; the review set has outgrown Mistral twice now and the
  retry passes `--max-images 8`.
- `sharpen-loading-brand` (gpt-5.6-sol), `loading-screen-void` (minimax-m3) —
  the MEASURING state, in its tenth appearance across seven providers.
- `ground-fighter-sprites: add contact shadows` (gpt-5.6-sol) — round 3 added
  them and they are visible under both fighters in every bout frame.
- `controls-obscure-fighters`, `control-panel-dominates-screen`,
  `virtual-stick-knobs-too-small`, `portrait-camera-wastes-frame`,
  `tighten-portrait-fight-framing`, `repair-landscape-layout` — framing, in its
  fifteenth iteration. Standing: warm and low.

### Round 25 — mistral-medium-3-5 — `fb40131`

- `settings-toggle-clarity: "settings toggles lack visual state feedback"` —
  **rejected, and the rejection is the finding.** The toggles have had a legible
  state in both directions since round 21, when they were rebuilt as switches
  with a knob that holds a position either way.

  They are also all-off in every settings frame this harness has ever produced,
  because the harness never clicked one. A reviewer looking at six identical
  dark tracks was reasoning correctly from a one-sided sample and reached a
  false conclusion — the same failure as the returning-player pad in round 18,
  and the same one five models produced in round 15 before I finally made the
  mixed-state capture that existed only in a verification screenshot and never
  in the review set.

  `15-phone-settings-mixed` fixes it: two on, four off.

  **A fix that is only ever verified in a screenshot you looked at alone is not
  in the loop. It has to be in the set the next reviewer sees.** Round 15 made
  this exact capture and then did not ship it, and four models paid for it.
- `hud-score-legibility: "score text is hard to read mid-fight"` — the scoreline
  plate is opaque and the scores are `--text` and `--fighter-1`, the two
  brightest values in the palette, on top of it. Rounds 5 and 10 took both as
  far as the art direction allows.
- `rematch-button-visibility: "rematch button blends into the background"` — it
  is a gold plate with a bright ring and a glow, on a stage the round-20 veil
  deliberately darkened. It is the loudest control in the result card.
- `loading-logo-contrast` — the ShoeMoney mark is proprietary and may not be
  recoloured, filtered or restyled. A plate behind it is the only available
  lever and is not yet warranted; the boot card measured at 8.4:1.
- `fighter-vertical-placement` — framing, in its sixteenth iteration. Standing:
  warm and low.

### Round 26 — perceptron-mk1.5, grok-4.5, gpt-5.5, qwen3.8-max-0902 — `5f775bc`

- **The hit flash was deleting the fighter it was supposed to sell.** Five
  models across three rounds, none able to name it:
  perceptron-mk1.5 "a bright white glow completely obscures the fighter in
  white"; gpt-5.6-sol "preserve fighter readability during scoring hits";
  gpt-5.5 "reduce hit flash clipping"; qwen3.8-max-0902 "the receiver clips to
  a featureless white blob on IPPON"; minimax-m3 "reads as face paint, not
  impact".

  The captured impact frame shows exactly what they saw — face, gi, arms and
  chest emblem all clipped to one flat white silhouette, for 140ms, at the
  moment the player is trying to see that the hit landed.

  One line of arithmetic: `flash()` was `color.setScalar(1 + amount * 2.4)` and
  a full point passes `amount: 1`. A 3.4x multiplier on an already-lit texture.
  No mask, no post-pass, no bloom to blame — the sprite was told to render at
  three and a half times its own light. Now 1.75, and 95ms instead of 140ms.
  Re-captured: bright, obviously struck, completely readable.

  Round 23 fixed the half of this that was motion and left the half that was
  light, and it took two more rounds before the light was reported loudly
  enough to act on. **Five reviewers agreeing is not the signal. Five reviewers
  pointing at the same frame is.**
- `kick-sprite-crop-artifacts: "floating limb fragment and a kick foot that
  vanishes into the torso"` (qwen3.8-max-0902) — **rejected against the burst.**
  The four-frame back-kick sequence shows a clean wind-up, a fully extended kick
  with the foot attached to the leg and the standing leg planted, and a return
  to guard. The foot is *near* the torso in frame 1 because that is the tucked
  wind-up, and at a glance a tucked foot reads as a swallowed one.
- `technique-callout-attribution: "anchor technique callouts to the acting
  fighter and mark who performed them"` (qwen3.8-max-0902) — the chip is only
  ever written for `event.player === 0`, so it is always the player's own move.
  There is nothing to attribute.
- `pre-fight-countdown-occlusion` (grok-4.5), `crop-empty-wall-enlarge-fighters`
  (gpt-5.5), `portrait-camera-dead-headroom` (qwen3.8-max-0902),
  `fighter-scale-framing` (grok-4.5) — framing, in its seventeenth iteration.
  Standing: warm and low.
- `handle-landscape-or-lock-portrait` (gpt-5.5) — landscape is a real, supported
  second target; the ADR makes portrait the baseline and desktop the scaled
  secondary, not the only one.
- `make-loading-progress-readable`, `loading-bar-no-progress` — the MEASURING
  state, in its eleventh appearance across eight providers. The single most
  reported non-defect in the loop; it is the honest state of a bundle still
  downloading, and every model that has ever called it a bug has been wrong.

### Round 27 — gpt-5.4, deepseek-v4-flash-vision-exp, qwen3.6-plus, reka-edge — `6d45283`

- `countdown-button-affordance` / `unexplained-action-button-badges` /
  `countdown-button-ambiguity` (deepseek-v4-flash, kimi-k2.7-code r24,
  minimax-m3 r24, qwen3.6-plus) — **accepted after two failed answers.** The
  button read "FIGHT ③". A bare numeral in a circle on a gold pill beside a
  score reads as a point total, because that is what a numeral in a circle
  beside a score means everywhere else in this HUD.

  The first fix gave the number its own badge and marked the two apart for
  screen readers — that fixed the accessibility and not the picture, which is
  why the finding came back twice. It now says what it is: "FIGHT IN 2", a
  small rectangular label in the sans face, circle removed. The aria-label was
  always correct and nobody reads it while looking at the picture.
- `browser-focus-ring: "ugly browser focus outline on Settings toggle"`
  (qwen3.6-plus) — **accepted.** The native outline drew a second, squarer box
  around a control that is already a pill, on every keyboard pass through the
  sheet. Own `:focus-visible` ring; the default is suppressed.
- `rekaai/reka-edge` — **cannot take this set.** 16,384-token context ceiling
  against 35,603 requested, 23,120 of it image. Not a prompt defect.
- `score-fraction-readability: "2 1/2" is hard to parse` (qwen3.6-plus) —
  `points()` emits `2½`; the glyph and its lack of a space are the complaint,
  and the moves sheet spells the rule out in full beside it.
- `stick-arrow-contrast` (deepseek-v4-flash) — `--detent-idle` went 0.36 → 0.52
  in round 21, a shade over 5:1 against the ring.
- `top-right-touch-targets: "MOVES and settings buttons are too small"`
  (deepseek-v4-flash) — 60px plaques with a 56px minimum hit area, raised to
  the bezel edge in round 3.
- `fighters-too-small-on-phone`, `controls-dominating-lower-half`,
  `top-hud-crowded-and-uneven`, `fight-scene-composition`,
  `landscape-camera-zoom` — framing, in its eighteenth iteration. Standing:
  warm and low.

### Round 28 — claude-opus-5.5, gpt-5.4-pro, seed-2.0-lite, qwen3.5-122b-a10b

- **`floating-fist-sprite-artifact` / `floating-hand-animation-bug` /
  `floating limb fragment` / `severed foot` — CONFIRMED, five models, and the
  round-22 refutation was scoped to the wrong move.** Enumerated the full input
  grammar to find the move none of the bursts had reached — Front Kick is
  `neutral+up` — and burst-captured it. A **detached foot, complete with toes,
  floats in mid-air at the left of the figure** through the extension frames.

  Round 22 refuted this on the *back* kick, correctly, and I let a correct
  refutation of one move dismiss a finding about a different one. The models
  kept saying fist, hand, foot and limb because the fragment is small and
  skin-coloured; nobody could name it because it is not a limb, it is a limb
  that is not attached to anything.

  **Open.** The artifact is in the shipped atlas (`apps/game/public/fighters/
  shiro-1.webp`, `front_kick` frames 61–66), so the fix is in
  `build-fighter-atlas.py` against a regenerated contact sheet, and the source
  sheets are gitignored. Not attempted blind: a half-verified edit to a keyed
  alpha atlas is how you get a worse bug than the one you were fixing.
- `control-legend-contradicts-moves` (claude-opus-5.5) — **accepted.** The coach
  legend taught the technique stick as ◀ reverse / ▶ forward / ▲ high / ▼ down
  while the Moves sheet groups the same four directions under RIGHT STICK
  FORWARD / BACK / UP / DOWN. Two vocabularies for one control. The coach now
  follows the sheet, because the sheet is what a player opens to look a move up.
- `hide-dead-controls-on-overlays` (gpt-5.4-pro) — the pre-fight card is
  excluded from the modal dimming on purpose, and the comment says why: it is a
  countdown that ends in the fight, not a dialog, and dimming its pad meant the
  controls were at 18% seconds before the player had to use them.
- `loading-bar-*` (gpt-5.4-pro, seed-2.0-lite, qwen3.5-122b) — the MEASURING
  state, in its twelfth appearance across nine providers.
- `unskippable-rematch-countdown` (seed-2.0-lite) — the whole button is the skip
  affordance, which is what "FIGHT IN 2" now says on the first line of it.
- `half-point-score-hard-to-parse` / `fraction-score-ambiguity` (gpt-5.4-pro,
  seed-2.0-lite) — third and fourth report of the same thing across two rounds.
  Real, and the fix is glyph choice, not layout: see next round.
- `fighters-too-small-on-phone`, `fighter-vertical-cramping`,
  `portrait-combat-framing-too-wide`, `control-legend-too-small` — framing, in
  its nineteenth iteration. Standing: warm and low.

### Round 29 — the detached fragments, `a47ad7b`

Round 28's open item is closed, and it is the largest single defect the loop has
found.

Connected-component analysis over both fighters' atlases — six pages, 44 cells
each — found **14 detached fragments**. They are not confined to one frame: the
back hand is drawn as its own island because the keyer separated it from the
sleeve, and in several frames the figure already has both fists up in guard, so
the island is a duplicate of a hand that is already there.

`tools/despeckle-fighters.py` erases them. One rule: within each cell keep the
largest connected component of opaque pixels, drop the rest. Bodies run
14000–26000px, the largest fragment is 550px — a factor of 25, no per-frame
tuning. `--check` reports and exits non-zero.

**The lesson, which is the whole loop in one line:** a reviewer describing an
artefact reliably points at a frame where something is wrong, and cannot name
it. Five reviewers naming five different body parts is one artefact seen five
times, and every name was wrong, because it is not a body part — it is a body
part attached to nothing.

And the process failure that let it live nine rounds: in round 22 I bursted the
*back* kick, found it clean, and refuted a finding that was about a *different
move*. A correct refutation scoped to the wrong thing is worse than no
refutation, because it looks like diligence.

### Round 30 — grok-4.3, gpt-5.3-codex, qwen3.5-plus-02-15 — `3149f0a`

- `settings-toggle-contrast: "poor off-state visibility"` (grok-4.3) — lifted
  the off track again, #2a2019 → #352a20. Round 21 moved it off pure black and
  round 25 put the state system into the review set, but the value was still a
  guess rather than a measured one.
- `low-contrast-stick-affordance: "default virtual sticks are too dim to read
  at a glance"` (gpt-5.3-codex), following deepseek-v4-flash r27,
  qwen3.8-flash r21 and glm-5.3-flashx r20 — **four reports over four rounds.**
  `--detent-idle` 0.36 → 0.52 helped and did not close it; 0.68 now. Verified
  at 1:1 on a re-captured stick.
- `technique-popup-size` (grok-4.3) and `micro-text-under-pressure`
  (gpt-5.3-codex) — the move callout, one step under body size and a full step
  down in colour. Now body size on `--text-muted`.
- `stick-input-feedback-mismatch: "stick visualizer shows raw touch position,
  not snapped input"` (qwen3.5-plus-02-15) — worth a look, not yet checked.
- `loading-progress-bar`, `loading-progress-visibility` — the MEASURING state,
  in its thirteenth appearance across ten providers.
- `controls-visible-during-countdown` (grok-4.3) — the pre-fight card is
  deliberately excluded from modal dimming; documented in the stylesheet.
- `fighters-look-pasted-over-the-mat` (gpt-5.3-codex),
  `sprites-not-graded-into-scene` (claude-opus-5.5) — two models, independently,
  saying the fighters are not graded into the warm tungsten scene. Real art
  direction note, and the opposite of the standing "make it brighter" rejection:
  this asks for the sprites to match the room, not the room to match them.
- `mistralai/mistral-small-2603` — 429, upstream shared pool rate-limited. Not a
  model defect; retry later.

**Process note.** The callout edit was a `str.replace(pattern, 1)` over a
file-wide pattern. It reported success, changed a different rule 400 lines
earlier, and left `.technique` untouched. All three edits are now whole-rule
matches with an `assert count == 1`, so a miss is loud.

### Round 31 — glm-5v-turbo, qwen3-vl-30b-a3b, ernie-4.5-vl-424b-a47b — `9d1e4b6`

- **A sampling bug I introduced one round ago, caught by the models disagreeing
  with the thing they were shown.** qwen3-vl-30b and ernie-4.5-vl both reported
  "the settings menu lacks sufficient contrast". Round 25's mixed-state capture
  toggled rows 1 and 3 — High contrast and Left-handed — so every reviewer saw
  the sheet in its *best-case theme* and could not judge the default one at all.

  **Toggling a state must not change the conditions under which the state is
  being reviewed.** It now toggles Mute sound and Show performance HUD, which
  have no effect on how the sheet paints. Re-captured: the default theme with a
  genuine mix, and the labels read white on near-black. The finding was a true
  observation of a frame that was not the product's default.

  This is the loop's recurring lesson arriving from a new direction. Rounds 17,
  18 and 25 were all "the sample never varied a dimension". This one is "the
  sample varied a dimension *too much*, and in doing so hid the thing".
- `vignette-overkill: "excessive vignette darkens the center of the screen"`
  (qwen3-vl-30b) — **rejected on measurement.** Centre 10% mean luminance 81.7,
  centre 20% 89.1, centre 35% 77.8, outer ring 31.6, corners 16.5. The centre
  is the brightest region on screen and the corners are the darkest, which is
  precisely what a vignette is for. The claim describes the inverse of the
  effect.
- `settings-contrast` / `settings-menu-contrast` — see above. Default theme
  re-captured and legible.
- `fight-result-screen-delay` (ernie) — the 8s auto-start, skipped by tapping
  the button, which is the whole button.
- `prefight-text-obstruction: "opaque pre-fight text box hides character models"`
  (glm-5v-turbo) — the pre-fight card is deliberately translucent over a live
  arena, and it is a countdown that ends in the fight, not a dialog.
- `hud-clutter` (ernie), `move-list-clutter` / `moves-list-cognitive-load`
  (qwen3-vl-30b, qwen3.5-plus r30), `controls-overlap` /
  `control-overlap: "control stick overlap"` (qwen3-vl-30b, ernie),
  `portrait-vertical-waste`, `control-legend-clutter` — framing and density, in
  its twentieth iteration. Standing: warm and low, and the pad is 27.0% of an
  844px screen.

### Round 32 — mistral-small-3.2-24b, gemma-3-12b-it — `9486ffa`

The largest single explanation in the loop's history, and it took a real
finding to surface it.

- `loading-screen-text-contrast` (mistral-small-3.2) and `loading-text-contrast`
  (gemma-3-12b) — **two parts, and the second is the one that matters.**

  *The design:* the boot card's quiet lines were on `--text-muted` at 3.9:1,
  below the 4.5:1 floor. They now sit on `--boot-quiet` at a measured 4.94:1.
  Not `--text` — that is 7.3:1 and made the publisher credit the brightest
  thing on the card, inverting the hierarchy the boot screen exists to build.

  *The capture:* every screenshot of this card the loop has ever taken was
  photographed at **0.67 opacity**. A nominally correct colour measured 2.7:1,
  because 0.67 × rgb(133,127,119) = rgb(89,85,80) — the exact peak pixel the
  capture reported, to the digit. The true contrast has always been 4.94:1.

  **That is the source of "loading screen empty", "black screen", "low
  contrast", "no progress" and "too subtle" — twelve providers, fourteen
  reports, one screenshot taken inside a fade.**

  The reason it stayed hidden: `getComputedStyle(card).opacity` reports 1 the
  entire time, so polling it fixed nothing. `.boot-card` is
  `animation: boot-enter ... both`, and `both` is a *backwards* fill — the card
  holds the from-state of its keyframes, which is where the 0.67 lives. The
  property reads settled while the pixels are not. The harness now removes the
  animation for the capture.

  Two dead ends are on the record because they are the interesting part:
  raising the token from `--text-muted` barely moved the screenshot (2.66:1
  either way, because the capture was never showing the real colour), and
  raising the font size from 10px to 12px moved it by exactly nothing — which is
  what finally proved the attenuation was multiplicative and not typographic.
  Both were reverted; the token lift was kept because it is independently
  correct.

  **A measurement taken at the wrong moment is not a weak measurement. It is a
  measurement of a different thing** — and twelve reviewers agreeing with it is
  what agreement looks like when everyone is looking at the same picture of the
  wrong thing.
- `countdown-timer-visibility` (mistral-small-3.2), `score-display-legibility`
  (mistral-small-3.2), `move-indicator-clarity` — the round clock, the scores
  and the move callout, all lifted in rounds 26 and 30.
- `technique-list-readability` (gemma-3-12b) — the Techniques sheet is
  full-screen since round 24 and shows all 18 moves with a header per group.
- `hud-performance-toggle: "clarify the 'Show performance HUD' toggle"**
  (gemma-3-12b) — worth a look: the name does not say what it does.
- `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` — 404, no endpoints.

### Round 33 — gemini-3.6-flash, gpt-5.1, qwen3.5-397b-a17b — `2fc48a9`

The boot-card fix moved the noise off the loading screen and onto the HUD, which
is what a corrected sample does.

- `countdown-button-affordance: "countdown timer looks like a clickable button"`
  (qwen3.5-397b-a17b) — **accepted, and it is the second half of the round-27
  finding.** The label became "FIGHT IN 3" and that fixed the ambiguity; the
  count was then a bordered, filled pill *inside* a gold button, which reads as
  a second control nested in the first. The wording was right and the frame was
  wrong. Fill, border and radius removed; it is quiet text now.
- `low-contrast-score-hud` (gemini-3.6-flash) and `low-contrast-top-hud-text`
  (gpt-5.1) — **rejected on measurement, off the live DOM.** Against the
  scoreline's own plate: Asmongold 17.66:1, round clock 15.05:1, **HasanAbi's
  red 5.44:1**, fighter names 8.07:1 and 5.43:1. The red is the lowest of the
  five and clears the 4.5:1 floor for *normal* text at a size that qualifies as
  large. There is nothing to increase.
- `cyan-logo-palette-mismatch: "recolor the cyan diamond emblem to match the
  warm tungsten aesthetic"` (gemini-3.6-flash) — **hard no.** The ShoeMoney
  emblem is proprietary, carved out of this repo's MIT grant, and may not be
  recoloured. A standing constraint, not a judgement call. This is the third
  round a model has asked to restyle a protected brand mark.
- `fighter-contrast-issue: "white gi fighter blends with background"`
  (qwen3.5-397b-a17b) — the white gi is the brightest thing in a dim room by
  design; it is the point of the silhouette. Grading the fighters *into* the
  room was logged in round 30 as a legitimate opposite request and has not been
  actioned, because it is an art decision and not a legibility fix.
- `control-legend-accuracy: "in-game control legend is misleading"`
  (qwen3.5-397b-a17b), `control-legend-overlay-clutter` (gemini-3.6-flash) —
  the coach, third appearance in three rounds and the reason the returning-
  player capture exists. It is first-run only.
- `moves-list-density-on-phone` (gpt-5.1),
  `techniques-list-legibility` (qwen3.5-397b-a17b) — the Techniques sheet, now
  full-screen and showing all 18 moves grouped by stick direction.
- `landscape-viewport-pillarboxing` (gemini-3.6-flash),
  `landscape-camera-framing` (qwen3.5-397b-a17b) — landscape, second
  appearance in two rounds and the only framing request with a fresh argument.

### Round 34 — gpt-5.5-pro, mimo-v2.6-pro-ultraspeed, gemini-3.5-flash-lite — `7a8446d`

- `countdown-cta-ambiguity: "stop making countdowns look like inactive buttons"`
  (gpt-5.5-pro) and `countdown-reads-as-button` (mimo-v2.6-pro-ultraspeed) —
  **accepted, and the finding is the disagreement, not either claim.**

  Three rounds, three readings of one element: a bare numeral in a circle read
  as a point total (r24–r27, four reviewers); "FIGHT IN 3" in a bordered pill
  read as a second clickable control nested in the first (r33); the flattened
  version reads as a disabled button (r34). Each is a fair reading of whatever
  the previous version looked like, and *that* is the finding. An element
  carrying two kinds of information inside one control will be read as whichever
  kind the reader brings to it. Redesigning it a fourth time would have produced
  a fifth reading.

  Split instead. The button is `FIGHT` and does one thing; the countdown is a
  caption — "STARTING IN 3" — under it in gold, readable, never pressable.
  The aria-label has carried the countdown since r24 and was always right.

  **Three rounds of a review loop arguing with itself about one button is a
  signal that the button was carrying too much, not that the button was wrong.**
- `matchup-screen-cramped-text: "text overlap and low contrast"`
  (gemini-3.5-flash-lite) — re-captured and read: QUALIFIER in condensed gold,
  "vs HasanAbi" in white over the shoji, the tip on its own dark plate. No
  overlap; the tip measures well clear of its plate.
- `settings-menu-orphan-career-stats` (gemini-3.5-flash-lite) — real, and a
  consequence of round 24. The settings sheet is now full-screen and its
  content is short, so the career line sits with a large void beneath it. The
  sheet was made full-screen to give the *Techniques* list room; the settings
  list did not need it and now looks unanchored.
- `tiny-first-fight-legend` (gpt-5.5-pro),
  `control-legend-typography: "make the always-on STANCE/TECHNIQUE legend
  readable"` (mimo-v2.6-pro-ultraspeed) — third appearance. It is first-run
  only; `14-phone-returning` exists precisely to show that and is in the set.
- `hit-fx-and-ippon-overlay: "anchor impact sparks to the contact point and
  clear the IPPON text"` (mimo-v2.6-pro-ultraspeed) — the sparks are emitted at
  the contact point from `impact({x, y})`; the IPPON text moved out of the
  technique pill in round 20 but the stamp is still 75px tall.
- `portrait-crop-loses-dojo`, `combat-hud-dead-center-empty-void`,
  `combat-floating-move-text-placement` — framing, in its twenty-first
  iteration, and the one family of request that has never once produced a
  change. Standing: warm and low.

### Round 35 — gpt-5.4-mini, qwen3.7-plus, glm-5.3-flash — `c7c3acf`

- `loader-bar-reads-stuck: "boot screen's progress bar sits at 100% while still
  saying 'Downloading the game'"` (glm-5.3-flash) — **OPEN, and the most
  specific finding the loop has produced.** The capture confirms it exactly. The
  intended design is an empty track plus a 38% travelling sheen, and
  `data-measuring="true"` is set when the shot is taken, so the CSS ought to be
  drawing something else.

  **RESOLVED — and it was never a defect.** With the stylesheet loaded and the
  page measured properly: `data-measuring="true"`, `fill` at `inline-size: 0px`
  and `opacity: 0`, the track at `rgba(56,41,28,0.95)`, and the line reading
  "Downloading the game". The bar is empty, correctly, exactly as designed.

  What the loop has been looking at for 35 rounds is the harness's *unstyled*
  screenshot, where `.boot-fill` is a plain block-level div — full width, no
  gradient, opacity 1. A 100% bar. Under a line that says it is downloading.

  Round 35's fix is what made this measurable, and the open question it left
  closed itself on the first properly-instrumented attempt. Nothing in the
  product needed changing.

- **The boot capture never waited for the stylesheet.** 600ms after `commit`
  under throttle, `document.styleSheets` enumerates **zero** style rules. So
  every boot screenshot in the loop's history has been a page with no CSS on it
  unless the load happened to beat the timer. Fixed, on top of round 32's
  animation wait. Two waits, one underlying lesson.

  **Chasing the contrast of one card has now cost two rounds and produced one
  real fix, one measurement artefact and one open question.** That ratio is the
  finding as much as anything else this round.
- `settings-sheet-uses-too-much-empty-space` (gpt-5.4-mini) — **already fixed,
  in the same round it was reported.** The career line is now a pinned footer.
  A model reporting a regression of mine that I had already found and fixed two
  rounds earlier.
- `repeated-sticks-confuse-controls: "remove the duplicate stick labels below
  the joysticks"` (gpt-5.4-mini), `redundant-control-legend` (qwen3.7-plus),
  `input-legend-always-on` (glm-5.3-flash) — the fourth appearance, and the
  conflation is now explicit: these models are reading the always-visible
  STANCE/TECHNIQUE labels and the first-run-only coach as one thing. They are
  not. The labels name the two sticks; the coach teaches the grammar and
  retires once both have been used. `14-phone-returning` exists to show the
  difference and is in the set.
- `low-contrast-round-pill` (qwen3.7-plus) — worth measuring next round.
- `moves-notation-cryptic: "two unlabeled icons plus a bare '+' with no key"**
  (glm-5.3-flash) — the moves rows do carry a per-group header naming the stick
  direction. The icons themselves are still an unexplained glyph pair.
- `oversized-default-controls`, `distant-fighter-framing`,
  `portrait-fighter-scale`, `match-ui-occupies-combat`,
  `battlefield-cropped-by-control-dock` — framing, twenty-second iteration.
  Standing: warm and low, pad at 27.0% of an 844px screen.

### Round 36 — gpt-5.2-pro, qwen3.6-27b — `35187f7`

- `score-fraction-display` / `fraction-score-ambiguity` /
  `score-fraction-notation` / `score-fraction-readability` /
  `half-point-score-hard-to-parse` / `victory-screen-score-fraction-rendering`
  — **six models, six rounds, FIXED.** The most persistent finding in the loop,
  and it survived that long because every single report read as a small
  legibility nit and none of them was persuasive on its own.

  Two formatters. The in-match score is `points()` — `2½`. The result card, the
  run total and the career best were all `toLocaleString()` — `2.5`. The product
  taught one notation for the whole bout and switched the instant it ended, in
  the place a score is read most carefully. And `2.5` is a decimal: two and a
  half, or a tally of two and a bit?

  **Six rounds of the same request, none individually persuasive, and the only
  reason it got fixed is counting them.** That is the entire argument for
  running a review loop instead of reading one review.
- `sprite-edge-grounding: "fix cutout halos"` (gpt-5.2-pro) — the keying, and
  possibly a consequence of round 29's re-encode at quality 82. Needs a zoomed
  look at a fighter silhouette against the dojo before anything is touched.
- `landscape-mode-bug: "game renders in landscape orientation"` (qwen3.6-27b) —
  and now gemini-3.6-flash, qwen3.5-397b-a17b, gpt-5.1 and gpt-5.4-pro all in
  on some version of it. **The most repeated unresolved request in the loop.**
  The ADR makes portrait the baseline and desktop the scaled secondary, which
  is a decision about what to optimise, not a claim that landscape is finished.
  It is not finished, and five models have now said so.
- `controls-contrast-and-feedback` (gpt-5.2-pro) — the detents were 0.36 → 0.52
  → 0.68 across rounds 21, 30 and 33.
- `mistralai/mistral-medium-3-5` — 8-image cap hit again, third time.

### Round 37 — landscape, the most repeated open request — `90152ff`

- `landscape-mode-bug` / `landscape-viewport-pillarboxing` /
  `landscape-camera-framing` / `landscape-layout-letterboxed` /
  `repair-landscape-layout` (qwen3.6-27b, gemini-3.6-flash,
  qwen3.5-397b-a17b, gpt-5.4-pro, gpt-5.1) — **five models, three rounds, and
  they were right about the part that is a defect.**

  The room is one plane carrying `dojo-backdrop.webp` at 34×15 world units,
  sized for a tall phone. Portrait covers it. Landscape does not — the
  horizontal frustum at that depth is much wider, so the plane's own left and
  right edges land *inside* the viewport as two hard vertical seams with flat
  background either side. That is the pillarboxing, and it is now covered: the
  panel scales to the frustum on every resize, taking the larger ratio so it
  crops rather than letterboxes. Portrait is unchanged, because the cover factor
  there is below 1 and the room reads identically.

  What is deliberately NOT fixed, and will be raised again: the black band
  above the stage and the black pad the sticks sit in are the stage/pad split.
  That is architecture. The ADR makes landscape a *scaled* secondary target, and
  scaling means the room fills the frame — not that the frame is re-authored.
  Anyone asking for that is asking for a second product, which is a decision to
  make deliberately rather than a bug to close.
- `sprite-edge-grounding: "fix cutout halos"` (gpt-5.2-pro) — **refuted at 2×
  zoom.** Hair, gi edges and belt cut clean against the dojo, no fringing.
  Round 29's re-encode at quality 82 with `alpha_quality: 100` did not introduce
  halos — which needed checking precisely because it was my own work and I had
  no prior right to assume it was clean.
- `hud-instruction-boxes-block-legs` (qwen3.6-27b),
  `ippon-text-overlap` (qwen3.6-27b) — the coach and the IPPON stamp, both of
  which have been through a full round each.
- `results-hud-state: "cleanly switch HUD states on the win/results screen"**
  (gpt-5.2-pro) — the modal-only dimming in round 1, extended to the result
  card in round 20.
- `prefight-layout-hierarchy` (gpt-5.2-pro),
  `techniques-menu-density` (qwen3.6-27b) — density and framing, twenty-third
  iteration. Standing: warm and low.

### Round 38 — grok-4.20-multi-agent, gpt-5.6-sol-pro — `f1c4e88`

- `placeholder-career-text: "unfinished career stats in Settings"`
  (grok-4.20-multi-agent) — **accepted.** "Career — played 0 · won 0 · best
  time —" is three values, two of them zero and one a dash standing in for a
  number that does not exist. It reads as an unfinished string rather than an
  empty record, and it is the first thing a new player sees of a feature they
  have not used. A sentence now; a real row once there is a record; "no win yet"
  rather than a dash for a player who has not won.

  **An em-dash is a good way to say "no number yet" inside a row of numbers,
  and a bad way to say the row does not exist yet.**
- `keep-hits-in-frame: "keep both fighters fully visible during scoring hits"`
  (gpt-5.6-sol-pro) — new, and a gameplay concern rather than a look: a strike
  that carries a fighter out of frame hides the outcome of the only verb in the
  game. Not checked yet.
- `fix-landscape-layout: "replace the broken landscape control composition"*
  (gpt-5.6-sol-pro) — the backdrop seam is closed as of `90152ff`; the stranded
  bottom pad is the architecture, and the reasoning for leaving it is written
  down there.
- `ground-fighter-sprites` (gpt-5.6-sol-pro) — contact shadows, present under
  both fighters in every bout frame since round 3.
- `loading-progress-indicator: "static unfilled loading bar"*
  (grok-4.20-multi-agent) — the loop's fifteenth appearance of this family, and
  the answer has not changed since round 35: the harness was photographing an
  unstyled page. The bar is correct and the capture is now correct.
- `anthropic/claude-sonnet-5.5:free` — 404, the free tier of that slug is gone.
  The paid one has been asked.

### Round 39 — the out-of-frame strike, `7c6c748`

- `keep-hits-in-frame: "keep both fighters fully visible during scoring hits"`
  (gpt-5.6-sol-pro, r36) — **ACCEPTED, and it was the most consequential
  framing finding in the loop because it was not a taste question.**

  A burst of 140 real frames of live strikes found 15 with fighter pixels
  against the stage edge. The sampled one is a **scored back kick with the foot
  cut off by the frame** — IPPON on screen, the point awarded, and the player
  unable to see the limb that scored it.

  `frame()` sizes the shot by the gap plus a body half-width, which covers a
  punch and nothing longer. A back kick extends most of a body length past the
  fighter's origin. The camera takes a `reach` term while a long limb is out.

  Re-burst, same 140 frames: **15 → 7**, of which one is a fighter legitimately
  near the boundary with the foot now visible and six are the bright shoji
  panels matching the detection filter. The re-run is the measurement.

  Presentation only, on purpose. The sim reports its own separation and never
  learns about this — the same rule as the round-23 recoil. **The view is
  allowed to lie about where the camera is; the simulation is not allowed to
  lie about the rules.**

  This closes the framing family with something that was never about framing.
  Twenty-three iterations of "the fighters are too small" were taste; this was
  the only verb in the game leaving the screen, and it took a model to name it
  and a burst of frames to prove it.

### Round 40 — gpt-5.6-terra-pro, qwen3.5-9b, deepseek-v4.1-flash — no product change

- `remove-pre-fight-countdown-conflict: "do not auto-start while presenting a
  FIGHT button and control tutorial"` — **rejected against the code and the
  capture.** There is no control tutorial on the pre-fight card. `coach.show()`
  fires on `state.phase === 'fight'` — a comment in `main.ts` says why, and it
  is right: a hint sitting over the round card teaches nothing about the sticks.
  The card carries the round name, the tip, the FIGHT button and the countdown
  caption, and the coach appears the instant the bout is live.
- `make-combat-controls-self-explanatory: "label the two virtual sticks at the
  point of use"` (gpt-5.6-terra-pro) — **already done, and visible in the same
  frame.** STANCE and TECHNIQUE are labelled directly beneath their own sticks,
  at the point of use, in the pre-fight capture. This is the fifth distinct
  model to describe the sticks as unlabelled or self-explanatory-needing.
- `lock-or-reflow-landscape: "prevent the visibly broken landscape combat
  layout"` (gpt-5.6-terra-pro) — the sixth model on landscape. The backdrop
  seam is closed (`90152ff`); what remains is the stage/pad split, and the
  reasoning for leaving it is written down there. **This one is now the standing
  noise of the loop** — the framing family's remaining requests, this, and the
  loading family, between them account for most of every report since round 32.
- `simplify-moves-reference` (gpt-5.6-terra-pro),
  `fight-camera-scale` (deepseek-v4.1-flash) — density and framing.
- `make-loading-progress-legible` (gpt-5.6-terra-pro) — the sixteenth
  appearance, and unchanged since round 35 established the harness was
  photographing an unstyled page.
- `qwen/qwen3.5-9b` — provider returned no content. `deepseek-v4.1-flash`
  returned prose around its JSON; the harness recovered it and the raw is on
  disk.

**A round with no product change is a real result.** It means the loop asked
three models and the product had nothing left to answer on the things they
raised, which is a different and more useful signal than a fix.

### Round 41 — seed-1.6, grok-build-0.1 — `cae0c92`

- `post-fight-controls-unnecessary-visibility: "hide control sticks on
  post-fight result screens"` (seed-1.6) — **accepted, and the fix already
  existed nine rounds ago applied to the wrong element.** Round 24 established
  that a sheet gets the whole screen because a sheet is a full-screen document,
  and hid the pad behind one for exactly that reason. The same argument applies
  to the result card: it is a card about a fight that has already happened, and
  there is nothing on that pad to control.

  Dimming was right for the *pre-fight* card — a countdown that ends in a fight
  — and the stylesheet says so at length because the distinction is load-bearing.
  It was never right for the result. Two dead rings under a REMATCH button read
  as a control the player has been invited to use and cannot.

  **Round 24's reasoning was right and its scope was too narrow.** A principle
  that lands once tends to look like a special case, and the next element it
  applies to has to be argued for from scratch.
- `techniques-menu-no-selected-move-highlight: "add a selected move highlight"`
  (seed-1.6) — a real gap and a good idea: during a bout there is no way to see
  which entry of the reference you just performed. Not actioned; it needs a
  decision about whether the sheet is a reference or a log.
- `pre-fight-controls-no-inactivation-cue` (seed-1.6),
  `small-touch-sticks` (grok-build-0.1) — the sticks are 170px on a 390px
  viewport, labelled, with bright detents since round 33.
- `left-handed-layout-description-low-visibility` (seed-1.6) — the hint under
  that row, `--text-2xs` on the sheet.
- `invisible-loading-progress` (grok-build-0.1),
  `loading-bar-no-progress-indicator` (seed-1.6) — the seventeenth and
  eighteenth appearances, unchanged since round 35.
- `excessive-headroom-arena`, `callout-obscures-fighters` (grok-build-0.1) —
  framing, twenty-fourth iteration.
- `google/gemma-3-4b-it` — 429, DeepInfra overloaded.

### Round 42 — gpt-5.4, claude-opus-4.8, grok-4.3 — `cc99701`

- `settings-toggle-focus: "settings row has stray yellow border"` (grok-4.3) —
  **the product is right and the photograph was not.** Measured directly: a
  touch tap leaves `:focus-visible` **false** and the element unfocused; a Tab
  leaves it true with a 2px ring. Exactly right for a touch-first product, and
  the ring was worth adding in round 27. But a programmatic Playwright click
  leaves the row focused, so every mixed-state capture since round 31 has shown
  a ring no thumb would have left, and a reviewer read it as a defect. The
  capture now blurs first.

  **Third instance of this shape, after round 32's half-faded boot card and
  round 35's unstyled one: the product was fine and the instrument was lying.**
  A harness that photographs a state no user can reach will produce confident,
  specific, wrong findings indefinitely, and each one costs a round to disprove.
- `fighters-float-above-mat: "both fighters cast no contact shadow and appear to
  hover above the tatami"` (claude-opus-4.8) — **partly wrong, partly fair.**
  Cropped the feet at 3x: the contact shadows are there under both fighters,
  tight and correct, and the airborne foot in that frame is airborne because
  it is a back kick mid-strike.

  Fair part: they are soft enough that the strongest model in the set did not
  register them. Not actioned, because the code records a prior round that
  *raised* the peak and found 0.44 read as a smudge behind the soles with both
  fighters looking pasted on — the current stops are a considered answer to a
  measured failure, and pushing past them without new evidence would undo it.
  Worth revisiting with a target: a shadow legible at 1x on a phone.
- `sprite-cutout-halation: "reduce the visible glow/fringe around fighter
  cutouts"` (gpt-5.4) — re-checked at 2x in round 37 and again here: hair, gi
  edges and belt cut clean, no fringing. Two models and two zooms.
- `idle-static-fighters: "fighters appear frozen in identical stance poses —
  no idle life"` (claude-opus-4.8) — the atlas has a distinct idle pose and the
  rig resolves per-phase cells; a still frame cannot show whether a loop plays.
- `result-screen-empty-middle` (gpt-5.4),
  `landscape-controls-corner-exile` (claude-opus-4.8) — layout, twenty-fifth
  iteration, and the standing landscape argument.
- `ippon-hit-clarity: "the scoring hit reads as pale spark scribbles"*
  (claude-opus-4.8) — worth a look against the real impact frame.

### Round 43 — grok-4.5, and a capture attempt that failed and was removed

- `scoreboard-half-point-crowding: "half-point scores collide with name plates
  at the top edge"` (grok-4.5) — **accepted, and it is the fourth one-sided
  sample in the loop, through a new door.** Measured across the scoreline:
  `2½` fits, **`10½` is clipped**, as are `125½` and `1250½`. `.points` is
  `flex: 0 0 auto` now; verified unclipped at 390px and 320px through `1250½`.

  Twenty-three rounds of review never saw it because **every frame the loop has
  ever reviewed shows the score at 0–0.** Every bout in the capture set is
  photographed seconds after it starts. A tournament that has not reached ten
  points has nothing wrong with it, and that is exactly the problem with a set
  that only ever shows the start.

  Same failure as the returning-player pad (r18), the all-off toggles (r25) and
  the 320px phone (r17). **A capture set that only ever shows the beginning of
  a game will never find the bugs in the middle of one.**

- **A capture was attempted to fix that and has been removed.** Forcing the
  score onto the live HUD failed three ways: a one-shot assignment is gone
  before the screenshot, an interval at 8ms is overwritten by the next rAF, and
  pinning `textContent` with a getter/setter still lost, because the HUD writes
  somewhere below the element. Every attempt photographed a scoreline reading
  0–0.

  Removed rather than shipped. **A capture that silently shows the wrong state
  is worse than no capture**, because it looks exactly like evidence and it will
  be read as evidence — that is the whole failure mode of rounds 32, 35 and 42
  in one more shape. The fix itself is verified by direct DOM measurement, and
  that is what it rests on.

- `move-list-truncated-bottom` (grok-4.5) — the Techniques sheet is full-screen
  and shows all 18 moves with a section header at the fold.
- `ippon-result-obscures-action: "IPPON calligraphy covers the decisive impact
  pose"` (grok-4.5) — fifth report on the stamp; it is at 18% of the stage and
  the fighters' heads are below it since round 20.
- `twin-stick-labels-too-small` (grok-4.5) — `--text-2xs` beneath each stick,
  raised to `--text-sm` in round 30 for the coach legend but not these.
- `openai/gpt-5.6-sol-pro-ultra` and `qwen/qwen3.8-flash:free` — invalid and
  retired slugs respectively.

### Round 44 — gpt-5.6-terra — `4fa8c45`

- `settings-screen-empty-misgrouped-record: "remove the orphaned record message
  from Settings"` — **ACCEPTED, and it is round 34's complaint arriving ten rounds
  late.** gemini-3.5-flash-lite called the same thing "orphaned career stats" in
  round 34. Round 35 tried to fix it and failed, by pinning the career line to
  the bottom of a mostly-blank screen — and gpt-5.6-terra came back describing
  the same emptiness in a new position.

  Both fixes treated the symptom. The cause is round 24, which made every sheet
  full-screen because the *Techniques* list needed the whole height. Six rows do
  not. The settings sheet is a panel now: sized to its content, anchored under
  its header, ending where its content ends — which also leaves the dojo
  visible beneath it, so the player can see they are in a game with a panel open
  over it. 469px of an 844px screen; the X still closes it.

  **The emptiness was never the problem. The full-screen sheet was, and two
  rounds of tidying inside it could not fix it because they were tidying the
  wrong container.**

  Third appearance of the same shape as the strip in round 15: a fix applied to
  the right principle and the wrong scope, re-raised every few rounds until
  somebody goes back and asks *why the container is that shape at all*.
- `landscape-control-dead-zone` (gpt-5.6-terra) — landscape, seventh model.
  Backdrop closed at `90152ff`; the control composition is the architecture
  argument, unchanged.
- `control-legend-obscures-arena` (gpt-5.6-terra) — the coach, fifth
  appearance, first-run only, and `14-phone-returning` is in the set.
- `technique-list-input-legibility: "make the move-list input recipes readable at
  phone size"` (gpt-5.6-terra) — the glyph pairs in the moves rows. Real and
  unchanged: they carry a per-group header naming the stick direction, but the
  glyph itself is still an unexplained arrow.
- `loading-progress-invisible` (gpt-5.6-terra) — the nineteenth appearance.
  Unchanged since round 35 established the cause.
- `qwen/qwen3.5-27b-instruct` — not a valid slug; the catalogue entry has an
  `-instruct` suffix the API does not accept.
  `mistralai/mistral-large-2512` — 429, Mistral's shared pool again.

### Round 45 — the moves-sheet key, `d0a91c4`

- `technique-list-input-legibility: "make the move-list input recipes readable
  at phone size"` (gpt-5.6-terra) and
  `moves-notation-cryptic: "two unlabeled icons plus a bare '+' with no key"`
  (glm-5.3-flash, first raised round 28 and carried every round since) —
  **accepted, and neither model named the cause. Both were right about the
  symptom.**

  The size was fine. The glyphs were fine. There was no key. Every row reads
  `[stance] + [technique]`; the group heading explains the second pip by where
  you are, and nothing on the sheet ever explained the first.

  One line under a rule at the top: `· STANCE + · TECHNIQUE`. Eighteen moves
  still fit, the rows are unchanged, and the compact notation stays — it is the
  right notation for a phone, it just needed saying out loud once.

  **A compact notation is not a cryptic one. A compact notation with no key
  is.** Seventeen rounds carried this one because each report described the
  symptom, and the symptom is what a reviewer can see.

### Round 46 — gpt-5.6-terra-pro, qwen3.8-max-prime, seed-2.0-mini — `c8f21a4`

- `impact-fx-read-as-confetti: "scoring impacts emit flat opaque rectangle
  dashes instead of sparks"` (qwen3.8-max-prime) — **accepted, and a 3x crop
  showed exactly why.** The particle pool is `PlaneGeometry(1, 1)` with a
  `MeshBasicMaterial` and **no map**: a solid colour on a quad. Rotated, scaled
  and additively blended, that is a hard-edged rectangle, every spark the same
  width, none of them tapering. Nothing about it reads as a spark, which is a
  thing that tapers and is brightest where it leaves the metal.

  They carry a streak map now, built once for the pool: bright at the leading
  edge, nothing at the trailing one, long edges softened so the quad's outline
  never shows. Before and after in the same frame: uniform bars in a radial
  pattern became tapered streaks of varying length radiating from the contact
  point.

  **This is the one layer of the hit feedback that had never been looked at
  closely**, because at 1x on a phone a spark is eight pixels of motion and
  nobody — including thirty-eight rounds of review — had reason to look twice.
  The zoom that found the detached foot found this too. **Zoom is a review
  instrument.**
- `kick-sprite-missing-foot: "extended kick frames end in an empty gi cuff with
  no foot"` (qwen3.8-max-prime) — the back kick was checked frame by frame in
  round 22 and its foot is attached. This is the front-kick family that round 28
  found real, so it is not dismissed: the front kick's extension frames want the
  same treatment.
- `connect-score-to-combat-feedback: "explain points where the player sees the
  hit"` (gpt-5.6-terra-pro) — a real design idea and the first in a while that
  is not a framing request. The technique chip names the move; nothing names
  what it was worth. Logged for a decision, not actioned.
- `fix-fight-countdown-cta` (gpt-5.6-terra-pro),
  `clarify-dual-stick-inputs` (gpt-5.6-terra-pro) — both refuted in round 40
  against the code and the capture.
- `loading-*` (all three) — the twentieth appearance, unchanged since round 35.
- `settings-modal-obscures-fight` (seed-2.0-mini) — the pad is hidden behind a
  sheet as of round 24; the stage is deliberately still visible behind it.

### Round 47 — verifying the round-28 lesson was actually learned

- `kick-sprite-missing-foot: "extended kick frames end in an empty gi cuff with
  no foot"` (qwen3.8-max-prime) — **refuted, from the atlas.** Pulled
  `front_kick` frames 61–66 out of `shiro-1.webp` and looked at all six: guard,
  knee lifting, knee up, extending, **fully extended with the foot on the end
  of the leg**, retracting. The foot is there.

  And frame 65 — the fully extended one, bottom-middle above — is the exact
  frame that carried a detached foot floating beside the fighter until round 29
  erased it. It now reads clean.

  Worth noting how this one was checked, because round 28 is the reason. That
  round refuted the same family on the *back* kick, correctly, and let a correct
  refutation of one move dismiss a finding about fourteen. This time the move
  named in the report was the move that was opened.

### Round 48 — gpt-5.6-sol-pro, mimo-v2.6-pro — `5b7c1d9`

- `fix-settings-overlay-edge: "stop the Settings panel from visibly slicing
  through the fight"` (gpt-5.6-sol-pro) — **accepted, and it is round 44's own
  fix described four rounds later.** Making the sheet content-height removed the
  void and put a hard edge across both fighters at chest height instead. The
  panel now carries a scrim, so the edge reads as a boundary and the fight reads
  as being behind it.

  **Removing a void and creating a slice are the same mistake: changing a
  container's shape without giving it a boundary.** That is the fifth time in
  this loop a fix has been right about a principle and incomplete about the
  edge, and the pattern is stable enough to state as a rule: *when a container's
  shape changes, ask what its boundary now means, in the same commit.*
- `sync-move-label-with-pose: "move callout fires while the fighter is still
  standing in idle"` (mimo-v2.6-pro) — **the round-19 finding, reported again by
  a model that cannot have seen the fix.** The chip has a 700ms expiry; a live
  probe shows it appearing at 100ms and clearing at 794ms. Round 20 moved the
  call's move name into the stamp. This is now the third distinct stale-finding
  in the log, and the lesson is the same each time: **a reviewer reporting a
  finding fixed in an earlier round is not a contradiction, it is a lag.** The
  queue is long and the model has no way to know which rounds it is reading.
- `ground-fighter-sprites` / `ground-and-layer-fighter-sprites` (gpt-5.6-sol-pro,
  mimo-v2.6-pro) — contact shadows, checked at 3x in round 42 and present.
- `loading-progress-and-palette` (mimo-v2.6-pro) — the twenty-first appearance.
  The "wrong temperature" half of it is about the ShoeMoney mark, which is
  proprietary and may not be recoloured.
- `rebalance-landscape-controls` (gpt-5.6-sol-pro) — landscape, eighth model.
- `raise-fighters-in-frame` (mimo-v2.6-pro) — framing, twenty-seventh iteration.

### Round 49 — gpt-5.6-luna-pro, glm-4.5v — `750b83d`

- `sprite-environment-disconnect` (glm-4.5v) and its six predecessors —
  **ACCEPTED, at seven reports across five rounds.** Logged in round 30 as
  legitimate and not actioned, which was right at one report and wrong by five.
  The most-reported actionable item in the loop, sitting behind a framing family
  declined twenty-seven times.

  The fix is the *opposite* of the standing "make it brighter" rejection.
  Nobody is asking for the room to be neutralised; every one of them is asking
  for the fighters to belong to the room they are in. A warm multiply on the
  sprite material, no channel above unity, applied to the material rather than
  painted into the art.

  **Logged in round 30 as legitimate and not actioned was the right call at one
  report.** It is the fourth instance of that in this log, alongside the
  dismissal of the settings toggles in round 15, the coach strip in round 18 and
  the framing family throughout. *A repeated request is not yet a pattern; a
  request repeated five times in five rounds by models with no way to see each
  other is.*

- **A gate flake, investigated rather than dismissed.** This tripped
  `pnpm test:e2e` twice with "Target page, context or browser has been closed"
  on the full-length bout test. Bisected: the grade was the correlate, but a
  neutral (1,1,1) grade passed and a warm one failed, and a colour multiply
  cannot cost twenty percent of a software-rendered frame. The same test passes
  on a clean tree at 31.5s and on this one at 38s, varying only with how busy the
  machine was — it plays a full 1800-tick bout and sits near a cliff. Settled
  machine: 111 unit, 34 e2e passed, 4 skipped. **No test was touched**, and
  neither was the fix, which is verified by capture.

- `add-result-exit: "give the result screen a clear way out"` (gpt-5.6-luna-pro)
  — declined, with reasoning. The card is `action: 'NEW TOURNAMENT'` →
  `newRun()`; there is one mode of play, so the loop has no branch to exit from.
  A quit screen on a browser arcade game is a product decision, not a defect, and
  it would cost the player the one-tap path back into a fight. Worth revisiting
  if the game ever grows a second mode.
- `fix-wide-layout: "use the available browser width instead of leaving a dead
  black field"` (gpt-5.6-luna-pro) — landscape, ninth model. The backdrop seam
  is closed; the stage/pad split is the architecture argument.
- `score-typography-polish: "end-game score uses awkward fractions"*
  (glm-4.5v) — **stale**, fixed in round 36. `formatScore()` renders `2½`
  everywhere outside the HUD. Fourth distinct stale-finding in the log; the
  lesson is the same each time: **a reviewer reporting a finding fixed in an
  earlier round is not a contradiction, it is a lag.**
- `subtle-hit-feedback: "scoring events lack visual punch"` (glm-4.5v) — the
  flash was halved in round 26 and the sparks given tapers in round 46.
- `teach-first-attack` (gpt-5.6-luna-pro),
  `move-hint-vertical-bloat` (glm-4.5v) — the coach, sixth appearance.

### Round 51 — qwen3.5-397b-a17b — `9453de1`

- `incomplete-match-info: "missing match format details"` (qwen3.5-397b) —
  **ACCEPTED, and the only finding in that batch that was neither stale nor
  already fixed.**

  The first-run coach teaches the two sticks. The moves sheet teaches every
  technique and what it scores. **Nothing in the game says what the rules
  are** — that one clean contact ends the exchange, that IPPON is a full point,
  that first to two takes the round.

  That matters more than it sounds. This is point karate and most players have
  never watched it, so the one thing the sport is famous for — a single clean
  hit ends the exchange, no health bars — is invisible until they win one and
  do not know why.

  It lives on the moves sheet, not the round card. The card is four seconds
  long and already carries the round name, the opponent, their tell and a
  button. The sheet is the screen a player opens when they do not understand
  something, and until now nothing on it told them what they were looking at.

  **The loop has spent fifty rounds on how the controls look and never once on
  what the game is. That is what a model that reads the screen literally is for
  and it took a literal reading to surface.**

- Stale this round: `persistent-instruction-clutter` (coach, seventh appearance,
  first-run only), `redundant-prefight-interaction` (refuted round 40),
  `text-heavy-moves-list` (keyed in round 45). Three of four, which is now the
  normal yield and is worth reading as signal: the loop is close to exhausted on
  what a screenshot of the first fifteen seconds can show.
- `mistralai/mistral-medium-3-5` — 429 again; `openai/gpt-5.1-mini` — not a
  valid slug.

### ⚠ Known unstable gate — `boot.spec.ts` › "a result card never pulls focus away from someone typing"

Recorded because it is a red gate that is **not** caused by any recent change,
and the next person to hit it should not spend a round bisecting their own work.

It plays a full 1800-tick bout on a software renderer and intermittently dies
part-way with `Target page, context or browser has been closed`. Evidence:

- Fails on **clean `main`**, stashed, on one project; passes on the other.
- Passes at 31.5s on a settled machine; fails at 21–50s on a busy one.
- Alternates which project fails between runs.

Not touched. The test's own comment already says it exists to outlast a whole
bout and sets a 180s timeout for exactly this reason, so the assertion is not
the problem — the renderer is. It wants a real fix (probably a memory ceiling
or a shorter bout for that one test), and that is a separate piece of work from
anything the review loop has found.

### Round 52 — seed-2.0-code — `16a8af4`

- `moves-list-no-scroll-indicator: "moves list has no scroll indicator, hiding
  lower content"` (seed-2.0-code) — **accepted, and it is a regression caused by
  the previous round's own fix.**

  Round 24 left the Techniques sheet with an *accidental* affordance: the next
  section header happened to land at the fold, so the list visibly continued.
  It was never designed and it survived twenty-eight rounds because it happened
  to be doing the right thing. Round 51 put the key and the rules above the
  list — a genuine improvement in its own right — which pushed that header below
  the fold, and the list now ends on a clean row boundary that reads exactly
  like the end of the reference.

  A static, unconditional bottom fade now says it properly. An element that only
  appears when the scroll position is known needs JS, and "there is more below"
  is true from the first frame. Sixteen of the eighteen moves are under it.

  **A fix that improves one thing and silently removes another is two bugs, and
  the second one gets found by whoever happens to look at the screen next.**
- `win-screen-rematch-skippability-unclear` (seed-2.0-code) — the whole button is
  the skip, which round 34's "STARTING IN 8" caption now states.
- `control-terminology-inconsistent-hints-incomplete` (seed-2.0-code) — the coach
  legend was aligned to the moves sheet's vocabulary in round 28.
- `x-ai/grok-4.3:batch`, `openai/gpt-5.6-terra-pro:batch` — `:batch` slugs
  cannot be used against `/chat/completions`; they need the batch API. The whole
  `:batch` family in the catalogue is therefore **not reachable by this harness**,
  which is worth knowing: it is roughly a fifth of the entries the live API lists
  and none of them can be asked a question this way.

### Round 53 — mimo-v2.6-pro-ultraspeed, gpt-5.2 — `ed05146`

- `half-point-formatting: "fix half-point score rendering so it can't read as
  21/2"` (gpt-5.2) — **accepted, and it says round 36's fix made this worse.**

  Rendered the glyph in isolation at 4x: in this font stack, and in most system
  sans faces on every platform this ships to, U+00BD renders as a *slashed*
  fraction. `2½` is visually three characters and reads as three. It is 36px
  wide against a digit's 27px — which is the width that clipped `10½` in round
  43.

  Round 36 replaced a decimal `2.5` with that glyph because six models in six
  rounds called the decimal cluttered. It was less cluttered and not less
  ambiguous. **A notation chosen to be unambiguous turned out to be worse, and
  the only reason anyone noticed is that a model read the digits rather than the
  intent.** Two stacked numerals now, built in the DOM, with an aria-label for
  anything hearing it.

- `techniques-modal-touch-language: "uses console 'stick' language, cryptic
  glyphs, and a row sliced in half"` (mimo-v2.6-pro-ultraspeed) — **accepted,
  partly.** The group headings said "RIGHT STICK FORWARD/BACK/UP/DOWN" on a game
  with two thumb sticks on a touch pad and no gamepad input at all — and
  contradicted the key at the top of that same sheet, which has said
  "STANCE + TECHNIQUE" since round 45.

  **Round 28 fixed half of this by aligning the coach legend to the sheet, and
  the other half went unnoticed for twenty-five rounds because the two halves
  were consistent with each other and inconsistent with the game.** That is a
  failure mode with no external signal at all: two things agreeing with each
  other is not evidence that either is right.

  The sliced row is the fold, fixed in the previous round.
- `sprite-grounding-shadows: "add contact shadows"` (gpt-5.2) — present and
  verified at 3x in round 42.
- `fighter-sprite-matte-halo` (mimo-v2.6-pro-ultraspeed) — the warm grade landed
  in round 49; the halos were checked at 2x in rounds 37 and 42 and are not
  there. "Camera-flat lighting" is accurate and inherent: the fighters are
  unlit `MeshBasicMaterial` quads, which is what lets them key cleanly at all.

### Round 54 — qwen3.8-flash, grok-4.6, ling-3.0-flash-vl — no product change

- `ippon-callout-off-gaze: "IPPON and move-name callouts fire in the dead upper
  wall, away from the action"` (qwen3.8-flash) and
  `ippon-hides-the-hit: "IPPON lockup covers the scoring contact"` (grok-4.6) —
  **these two are the same finding pointing opposite ways, and the design is
  caught between them.** One says the stamp is too far from the action; the
  other says it is on top of it. It cannot be both, and the resolution is that
  at 18% of the stage it is *neither*: it is in the upper third, clear of the
  contact, which is where a stamp belongs.

  Round 20 moved it there, from a position where it overlapped the technique
  pill by 25px, on the report of three models. Moving it back onto the fighters
  to satisfy the first claim would re-create the defect the second claim is
  complaining about. **Declined, with the reason written down: the complaint is
  that the payoff is not adjacent to the hit, and the alternative is that it
  covers the hit.**

- Stale, and now the majority of every batch:
  `loader-progress-bar-no-fill` / `loading-progress-invisible` (qwen3.8-flash,
  ling-3.0-flash-vl) — the twenty-second and twenty-third appearances, unchanged
  since round 35 established the harness was photographing an unstyled page.
  `persistent-control-legend-clutter` / `persistent-moves-panel` /
  `countdown-live-sticks` — the coach, seventh appearance, first-run only, with
  `14-phone-returning` in the set. `fight-vs-countdown-conflict` /
  `intro-fight-button-overlap-sticks` / `countdown-live-sticks` — refuted
  against the code in round 40. `techniques-list-clipped: "no scroll
  affordance"` — the fade landed in round 52. `no-orientation-lock` — landscape,
  tenth model, architecture argued in `90152ff`.

### Where the loop actually is

Fifteen of the fifteen findings this round were stale, refuted, or a design
tension with a written-down reason. That is the first all-clear batch in
fifty-four rounds, and it is the signal this loop has been worth listening for.

The reason is structural and it is now measurable: **every frame in the review
set is the first fifteen seconds of a game.** Four real defects in the last
twenty rounds — the unstyled boot page, the Playwright focus artifact, the `10½`
clip, the tip contrast — were not found by looking harder at those frames. They
were found by asking what a frame *cannot* show. The set has been thoroughly
mined and it has nothing left, and the models are correctly reporting what they
can actually see, which is a set of screenshots of a game at 0–0.

### Round 55 — the instrument is extended, and it pays immediately — `83ae3f3`, `0f5b2a1`

Round 54 returned an all-clear — fifteen findings, fifteen stale or refused —
and the honest reading is that the *set* is exhausted, not the product. Every
frame in it is the first fifteen seconds of a game.

`16-phone-in-play` is now **played**, not posed: real CDP touch input on both
zone anchors, the same grammar the e2e suite drives, run until the referee
awards a point. Verified — 1–0, clock at 29. Round 43 tried this three times by
forcing the DOM text and removed all three, because each lost to the HUD's
per-frame write. *Posing a value the render loop owns cannot work.*

**The first model shown the new frame found a real defect in the previous
round's own fix.** gpt-5.6-terra-pro: "keep half-point scores on one readable
baseline" — the stacked fraction built in round 53 used
`vertical-align: baseline` on a column flex container, which aligns to the
*first* item's baseline, so it sat at cap height reading as a superscript.

Same reviewer, same review set, one round apart. The second found something the
first could not, **not because the model got smarter but because it was shown a
state that had never been photographed.** That is the entire argument for
extending the instrument, in one concrete instance.

### Known unstable gate — `boot.spec.ts` typing/focus pair

Two tests in that file flake in the full suite and pass in isolation, on this
tree and on clean `main`:

- "a result card never pulls focus away from someone typing" — dies part-way
  through a full 1800-tick bout with `Target page, context or browser has been
  closed`. Passes at 31.5s on a settled machine, fails at 21–50s on a busy one.
- "game keys still type into a text field" — failed once in 1.0s in a full run,
  passes every time in isolation.

Both are the typing/focus cases, and the pre-boot card's own rule is that it
must never call `focus()`. **The two tests that guard that rule are the two that
flake**, which is worth more than either failure: the rule is load-bearing and
its coverage is the least reliable in the suite. Fixing that is a real piece of
work and it is not something this review loop found.

### Round 56 — gpt-5.6-luna, qwen3.6-flash, grok-4.5 — `7d2a6f1`

- `label-round-timer: "explain the unlabeled gold number in the match HUD"`
  (gpt-5.6-luna) — **accepted, and it is the third instance of one class.**

  The bout countdown (r27/34), the half-point notation (r36/53) and now the
  round clock. A number in the middle of a scoreline that reads as another
  score until something says what it counts. Round 26 gave the clock a dial,
  which moved it from "a number" to "a number in a box" — better, and still
  unlabelled. A model looked again thirty rounds later and called it exactly
  what it was.

  One lowercase letter, small, baseline-aligned, inside the dial, with the
  accessible name spelling the word.

  **A first attempt at disambiguation is usually worth about half the distance
  and gets reported again later.** That is not a stale finding and it is not the
  loop failing — it is the loop doing the thing it is for, and the second
  report is the measurement that the first fix was insufficient.
- `qualifier-intro-buries-fighters` (grok-4.5) — the pre-fight card stacks
  round name, opponent, tell, FIGHT button and countdown. It is four seconds
  long, every element on it has been argued in this log, and the alternative is
  less information in the same four seconds. Declined.
- `top-right-ui-contrast: "low visibility for action buttons"` (qwen3.6-flash) —
  the MOVES and gear plaques sit on the scoreline's own surface at 60px.
- `fix-landscape-layout` (gpt-5.6-luna) — eleventh model. Architecture argued
  at `90152ff`.
- `control-hint-obstruction` (qwen3.6-flash), `clarify-control-language`
  (gpt-5.6-luna) — the coach, eighth appearance, first-run only.

### Round 57 — seed-2.0-lite, gpt-5.6-terra, claude-opus-5

- `twin-sticks-indistinguishable: "the two dials are visual twins; the only
  difference is a 6px dot, and the active-drag ring draws outside the pad"`
  (claude-opus-5) — **ACCEPTED IN PRINCIPLE, NOT LANDED, and the attempt is
  reverted.**

  Accurate. Two identical bronze pucks either side of the screen, told apart by
  a pip at 0.4 opacity, in a game where picking the wrong stick costs a point.

  The fix was to stop using two different *colours* — the hardest distinction to
  make at a glance — and use two different *marks*: the stance stick's filled,
  the technique stick's hollow. Shape survives colour blindness, survives a dim
  tungsten room, and survives being looked at for half a second mid-bout,
  which is how a thumb actually finds it. It also says something true: the
  stance stick is the root you stand on, the technique stick is the expression
  on top of it.

  **It did not work and has been reverted.** Both pips still render filled and
  the same size after the change, across a re-captured frame. Rather than ship
  a style change I could not see working, it is reverted and logged as open.

  Two candidate causes worth a look next round and neither was chased here: a
  later `--pip` redefinition at line 2299 that changes the value both rules
  read, and a `body.coach-active .knob::after` at line 1569 that outranks a
  plain class rule. The returning-player capture has no `coach-active`, so that
  one is unlikely, which leaves the redefinition — but confirming it needs a
  computed-style read, not another screenshot.

  **This is the second time in this loop that a change has been thrown away
  because a capture showed it was not doing what the DOM said** — round 20's
  rings stepping down off the pad, and this. Both times the code was right and
  the picture was not, and both times the picture won.
- `backwards-settings-toggle-state: "two settings toggles incorrectly show
  active state when they are disabled"` (seed-2.0-lite) — **open, and it is a
  state-correctness claim rather than a look**, which is the only kind in this
  round that is worth chasing. In `15-phone-settings-mixed` two switches are
  genuinely on, so the frame does not show a bug; what it needs is a
  state-versus-effect check — toggle Mute sound and confirm audio actually
  mutes, toggle the performance HUD and confirm it actually appears. Not done
  here.
- `sprites-not-graded-into-dojo` (claude-opus-5) — the warm grade landed in
  round 49 and is visible in the captures; this is the second report of it and
  the first to arrive after the fix.
- `no-impact-moment-on-ippon` (claude-opus-5) — the impact stack, rebuilt in
  rounds 23, 26 and 46.
- `non-interactive-pre-fight-button` (seed-2.0-lite) — the whole button is the
  skip, stated in the caption added in round 34.
- `make-loading-progress-legible` / `loading-bar-shows-no-progress`
  (gpt-5.6-terra, claude-opus-5) — the twenty-fourth and twenty-fifth
  appearances, unchanged since round 35.

### Round 58 — closing round 57's open item, against myself

- `twin-sticks-indistinguishable` (claude-opus-5) — **LANDED, and it corrects
  round 57, where this exact change was reverted as "not working".**

  It was working. Computed style, which is the check the round-57 entry asked
  for and I did not do at the time:

      left   9.5x9.5px   background rgb(158,195,205)  no shadow
      right  9.5x9.5px   background rgba(0,0,0,0)      inset 2.4px gold ring

  I judged it from a 0.62x screenshot in which a 9.5px mark is three pixels
  across.

  **This is the opposite failure to rounds 20 and 52, where a picture correctly
  overrode a DOM that said otherwise.** Here the picture was not wrong, it was
  *under-powered*. Those are different lessons and only one of them is about
  instruments — the other is that "I cannot see it working" and "it is not
  working" are different claims, and conflating them costs correct work.

  Three further crops at guessed coordinates failed to find the knobs at all.
  Guessed coordinates are not an instrument either. The computed read settled it
  in one call, and it is what should have been used first.

### Round 59 — closing the last open correctness claim

- `backwards-settings-toggle-state: "two settings toggles incorrectly show active
  state when they are disabled"` (seed-2.0-lite) — **REFUSED, by state-versus-
  effect rather than by looking.**

  The frame cannot settle it: in `15-phone-settings-mixed` the two gold switches
  are genuinely on, so a reviewer reading it sees two active toggles and calls
  them wrong. What settles it is toggling each one and asking whether the game
  changed:

      Left-handed layout   -> body gains `left-handed`
      Mute sound           -> checked, audio state internal (no body class)
      Show performance HUD -> body gains `show-perf`, #perf-hud un-hides

  All three wired. The switches are not backwards; the model read a true frame
  and drew a false conclusion from it.

  **This was the only state-correctness claim left in fifty-nine rounds, and it
  is now the fifth finding a model reported that turned out to be a correct
  reading of an incomplete picture.** The pattern is stable enough to be worth
  stating plainly: a model given one frame of a system that has more than one
  state will confidently infer the rule from the instance. That is not a defect
  in the reviewer. It is what happens when the instrument shows one state.

### Round 60 — gpt-5.6-sol — no product change, and that is now the norm

- `strengthen-hit-contact` — the impact stack, rebuilt in r23 (recoil), r26
  (flash peak halved, 140ms → 95ms) and r46 (sparks given tapers).
- `reduce-gameplay-instruction-clutter` — the coach, **ninth** appearance.
  First-run only; `14-phone-returning` is in the set and shows it retired.
- `add-post-bout-exit` — declined in r49 with reasoning: the card is
  `NEW TOURNAMENT` → `newRun()`, one mode means no branch to exit from, and a
  quit screen on a browser arcade game costs the one-tap path back to a fight.
- `fix-landscape-touch-layout` — **twelfth** model. The backdrop seam is closed
  (`90152ff`); the stage/pad split is architecture with the argument written
  down there.
- `x-ai/grok-4.3` — 502/403 Forbidden from xAI. `qwen/qwen3.8-27b:free` — 429.

### The honest read on saturation

Three rounds running, the product has taken one change: `75add44`, a stick
distinction that was reverted once before it was verified. Round 58's finding was
real, and it came from the one dimension added in round 55 — a frame with a score
on it.

**Twenty of the last thirty-five findings have been stale, refused, or a design
tension with a reason already written down.** The review set is seventeen frames
of one game at its first fifteen seconds, plus one played bout, and the models
have read all of it thoroughly.

What the loop has established, and it is not nothing:

- **Eight real defects** the frames *did* contain, the largest being fourteen
  detached limbs and a winning kick that left the screen.
- **Five confident, specific, wrong reports** that traced to the instrument
  rather than the product — a half-faded card, an unstyled page, a Playwright
  focus artifact, a 0–0 score, an all-off toggle row.
- **A pattern that generalises past this project**: a reviewer given one frame
  of a multi-state system will infer the rule from the instance, and the fix is
  never to argue with the reviewer but to go and vary the frame.

**The next dimension is not another model on these seventeen frames.** It is a
new frame: a bout in its last exchange, a jump, a block, a bout where the player
lost, the high-contrast theme, the large-controls theme. Each is a state the
review set has never shown anyone, and each is a place where a defect can hide
with the same confidence as the ones already found.

### Round 61 — the new dimensions, attempted and removed

Round 60's analysis said the next dimension is a frame, not a model. Two were
built — a bout in its last exchange (played to a clock under ten seconds) and a
mid-jump — and **both attempts have been removed.**

What went wrong, in order:

1. An unused `drive` helper was left in with a stray object key. Syntax error.
2. Removing it left an orphaned `};`. Syntax error again.
3. The jump capture probed `__smkk.state().fighters`, which is not the shape the
   debug state actually has. Replaced with fixed timing.
4. The run then died with `browserContext.newPage: Target page, context or
   browser has been closed` — the browser falling over part-way through, after
   thirteen frames.

`tools/review-shots.mjs` is reverted to `HEAD` and verified: syntax clean, 17
frames, `pnpm check` green.

**This is the third time a capture has been thrown away in this loop, and all
three times for the same reason: it would not verify.** Round 43's mid-bout
score, round 52's played bout before it worked, and this. The difference is that
the others were one attempt and this was four, and the fourth is the one that
broke the instrument.

**The instrument is the only thing in this loop that is load-bearing.** Every
real defect in fifty-nine rounds came from a frame, and every one of the five
false reports came from a bad frame. Trading a working instrument for an
unverified one to chase the next finding is a bad trade at any yield, and
"the loop is saturating" is not a reason to make it.

Logged rather than attempted again, because the honest state of this is: *the
next dimension is the right idea, the implementation is not working, and it needs
a session to do properly rather than the last few percent of one.*

### Round 62 — a low clock is not reachable, and a jump strip is not yet readable

**The "last exchange" dimension does not exist in this game.** Played for 40
strike attempts, the score reached 2-0 with the clock still at 28. A round ends
on points, not on time, and the bot's takedowns land fast enough that a single
30-second round finishes long before the clock becomes interesting. Any
"low clock" frame has to be posed, and round 43 established that a posed frame
of a live system gets overwritten by the render loop. The dimension is not
rejected — it is **structurally unreachable without a control the game does not
have.** Worth saying plainly rather than trying a fifth time.

**The jump is reachable, and it produced a strip I cannot currently read.**

Four frames at 180/230/280/330ms after holding UP. Two things are wrong with
what I got:

1. My crop took the upper body and the coach, not the legs, so the arc itself is
   not in the strip — the capture geometry was wrong before the content was.
2. **The prominent fighter alternates red, white, red, white across 50ms
   intervals.** A round transition cannot happen in 50ms. Either my crop is
   showing two different fighters at two different screen positions and I have
   misread which one is the player, or there is a real identity-flicker that
   would be a serious defect.

I am not guessing between those, and I am not shipping the capture.

**Status: two open questions, zero shipped changes, harness untouched at HEAD.**
If the alternation is real, it is the most severe thing this loop has ever
found — the player's fighter changing identity four times inside a third of a
second. If it is my crop, it is the sixth false alarm and costs nothing. The
difference is one careful look, and it needs a session that can afford it
rather than the last few percent of one.

### Round 63 — the flicker is not there, and one measurement settled it

Round 62 left two readings on the table for the jump strip: either a severe
identity flicker, or my crop showing two different fighters at two different
screen positions. The cost of being wrong was very high and the cost of
checking was one pixel band, so: check the pixel band.

Sampling a fixed 110x120 region over the player's torso from real screenshots,
because `getContext('webgl2')` returns null on this renderer and there was no
reason to fight the canvas to get the same number.

    IDLE  101,59,19  101,59,19  101,59,19  101,59,19  101,59,19  101,59,19
    JUMP  106,64,23  110,68,28  106,62,21  111,70,31  101,59,19  111,70,31
                                                        ^^^^^^^^

**Every sample is red-family. Not one is white.** A white gi reads around
230,230,230 and there is no value in either series within eighty of that. The
player never changes identity; the idle baseline reappearing mid-jump is the
sprite bobbing and the shadow passing under it, and the 101→111 spread is the
jump arc lifting the figure out of the darker floor tone.

**The red/white alternation in round 62's strip was my crop**, which spanned
the full viewport and so caught whichever fighter happened to be prominent —
confirming the benign half of the two readings, and killing the alarming half
before it cost anything.

### Why this is the sixth false alarm and the cheapest one

The other five each took a full instrument to disprove: a stylesheet, a
diagnostic build, a focus fix, a driven frame, a state-versus-effect probe.
This one took **six screenshots and a line of arithmetic**, because the claim
was falsifiable in a single number and I had already reduced it to "is this
pixel red."

That is the transferable lesson, and it is the last one this project has to
teach: **before building an instrument to settle a question, check whether the
question has a number in it.** A colour, a coordinate, a clock reading, a count.
When it does, the answer is cheaper than the argument.

### Round 64 — four models, twenty findings, two worth checking

`openai/gpt-6.1-sol`, `z-ai/glm-5.3-flash`, `sakana/fugu-max`,
`inclusionai/ling-3.0-flash-vl`. Eighteen of twenty are the standing repeats:
the coach (now 11 models), the boot-progress bar (the oldest false alarm in the
loop, still going), the portrait camera trade (refuted three times with numbers),
the impact stack, the settings scrim (fixed in `217a165`), the settings sheet
refuted twice at different zoom levels. The countdown/FIGHT conflict is the
`STARTING IN n` split that already landed.

Two were new enough to check, and **one of those was the most dangerous claim
this loop has received since the fourteen detached limbs**:

- `repair-front-kick-sprite: "restore the missing lower leg in the front-kick
  pose"` (gpt-6.1-sol) — every limb report so far has been *detached* fragments,
  which `a47ad7b` despeckled. This one says **absent**, and a despeckle that
  removes small connected components is exactly the kind of change that could
  take a real lower leg with it. It had to be checked properly.

  **Refused.** Both fighters have complete legs ending in full feet, with
  contact shadows under both. The atlas despeckle did not damage the sprite
  sheet. (The first crop I took appeared to show the red fighter's second leg
  sliced off at the right edge — that was my own crop boundary at 85% of the
  width, not the frame. Seventh crop-boundary artifact in this loop.)

  Worth recording that the sprite sheets came through a real verification
  afterwards: high-zoom edges, no detached fragments, contact shadows intact.

- `loading-screen-name-mismatch: "loading screen misspells fighter name"`
  (ling-3.0-flash-vl) — **refused by grep.** `Asmongold` and `HasanAbi` are
  spelled correctly in all four places: the meta description, the title, the
  boot subtitle, and the HUD name element. A pure hallucination, and the first
  this loop has received that asserts a text error rather than a visual one.

### A bookkeeping defect, found by making a mistake

This round I picked four models by typing IDs from memory. Three were invalid
slugs (`gemini-3.8-flash-lite-preview`, `glm-5.1v`, `kimi-k2-thinking-vision`),
and when I fell back to `ls reviews/` to work out what was left, the list came
back nonsense — `google/gemini-3.8-flash` showed as unasked, and it had been
reviewed in round 50.

**The review filenames do not encode the model ID.** Every JSON carries a
`model` field, so the asked-set was always derivable — I had been reading the
wrong field, in the same way I once read the wrong zoom on a crop. Derived
properly:

    models asked            87
    vision models on router 296
    reachable (no :batch)  227
    remaining              140

**The loop had been reporting ~112 asked and ~113 remaining all along. The true
figures are 87 and 140.** Fifty-three models were believed covered that were
never asked at all. A queue that cannot be derived from disk is a queue that
gets quietly wrong, and it was wrong in the flattering direction.

Fix: derive the remaining list from the `model` field in `reviews/*.json`, never
from filenames, and re-check it whenever a count is quoted.

### Round 65 — four models, twenty findings, one new claim, refused

`sakana/fugu-ultra`, `deepseek/deepseek-v4-flash-vision-exp`,
`anthropic/claude-opus-4.8`, `google/gemini-3.7-flash`.

- `tatami-hard-edge-planes: "hard-edged bright rectangle on the tatami breaks
  the photoreal floor"` (deepseek-v4-flash-vision-exp) — **the most specific
  new claim this round, and the only one worth an instrument.** Specific visual
  claims are cheap to test and this loop has been burned by vague ones.

  **Refused, by looking at the mat at 2.3x.** The tatami is a continuous woven
  texture under a smooth perspective gradient, darkening toward the camera. No
  rectangle, no seam, no hard edge. The only hard horizontal edges in that
  region belong to the coach card, which is a panel by design.

- While looking at the same crop I checked the coach card's own top edge, which
  reads as a near-straight line at this width. It is `--radius-md` on a 1px
  border with a blur and a shadow, sitting over the mat deliberately — the
  reason is written out in full at `styles.css:1496-1508` (it used to cover the
  up-chevron, the affordance it exists to teach). **Not changed.** A rounded
  panel is supposed to have an edge, and inventing a defect because a crop
  happened to frame one line is the exact failure mode this loop keeps
  catching in models and keeps nearly catching in itself.

- Confirmed working while I was there: the stance stick's centre pip is **blue
  and filled**, the technique stick's is **amber and hollow**. `75add44` reads
  correctly at a glance, which was the whole point of it.

### The rest

Fifteen more repeats. The boot-progress bar is now up to **four models** saying
it is invisible — the single most persistent false alarm in this loop, refuted
by contrast measurement (4.94:1 on the quiet token) and by the fact that the bar
tracks real weighted units. The coach strip reached **twelve models**. Portrait
scale is the camera trade, refused three times with numbers. The scrim behind
the drawers shipped in `217a165` and keeps being reported as missing, which
suggests the *review frames* still show the un-scrimmed variant rather than the
game being wrong — worth checking which frame each of those models was looking
at before the next round rather than answering it a fourteenth time.

New but not actionable yet: `ippon-attribution-clarity` (whose score it was),
`control-legend-microtext` (legend text size), `unify-splash-logo-color-palette`
(would recolour the protected brand mark — **refused on sight**, that logo is
carved out of the repo's MIT grant and is not ours to restyle).

### Round 66 — the scrim, measured; and the standing half-point finding, fifth time

**The scrim question, settled with a number.** `217a165` shipped a full-viewport
scrim behind the Settings and Techniques panels, and models have kept reporting
it missing. Rather than refuse it a fourteenth time, measure the same pixels in
the same coordinates with the sheet open and closed:

    02-phone-fight            (100, 67, 25)   lit mat
    06-phone-settings         ( 18, 13,  9)   sheet open
    15-phone-settings-mixed   ( 18, 13,  9)   sheet open

An **82% reduction on identical pixels.** The scrim is working, unambiguously.

And the reason fourteen models got it wrong is now obvious in hindsight, which
is the interesting part: **a scrim at 0.86 opacity looks identical to there
being nothing there.** The surround reads as flat near-black either way, so a
reviewer asked "is the background dimmed?" sees black and answers no. The scrim
is not too weak — it is doing its job so thoroughly that its effect is
indistinguishable from its absence. Only a before/after comparison on the same
pixels separates the two, which is why the number settles it and the eye never
could. This is the second time in this loop that the same coordinates answered a
question no amount of looking would have.

**`score-fraction-*` and `half-point-score-*`, fifth model in a row** (mimo-v2.6-flash,
step-3.7-flash, and now three others). The in-match HUD builds a DOM stacked
fraction, but **`main.ts` still renders result, run, earned and career scores as
a text string containing U+00BD**, and `16-phone-in-play` only ever captures a
whole point. So the models are reading the *text* path, not the DOM path, and
they are right that it reads as `21/2`.

This is the standing open item and it is now the most-repeated true finding in
the loop. It needs the text path finished, not another refusal.

- `floating-fighters: "fighters hover above the tatami without ground contact"`
  (step-3.7-flash) — **refused, contradicted by a crop taken this session.** Both
  fighters show a soft contact shadow anchored at the feet, verified at 2.3x in
  round 65. Also reported as "add sharp foot contact shadows" in the same round
  by gemini-3.7-flash, so the panel is split on it within one round.
- `animation-clipping: "fighter limbs clip through each other during kicks"` —
  plausible and untested; the review set has no two-fighter-contact frame, which
  is the exact gap round 61 could not close. Recorded as open rather than
  refused.
- `settings-sheet-hard-cut` (mimo) — this is the scrim finding above, plus the
  same "sticks disappear" observation, which is correct: the panel is modal.
- `prism-ml/ternary-bonsai-2-27b` — 429 from Darkbloom.

### Round 67 — the half-point notation, finally finished

Five models in five rounds had been reporting this. Round 66 identified why
none of my refusals had landed: **the round 53 fix only ever reached the HUD.**
`hud.ts` built a stacked fraction from DOM nodes; `main.ts` still built a
*string* for the result card, the round-earned headline, the run total and the
career best. So the models were not wrong and were not misreading anything —
they were reading a different mechanism from the one I had fixed, on a screen
I had never screenshotted.

**Fixed, by removing the second mechanism.**

- `scoreFragment(n)` is now exported from `hud.ts` and is the only way a score
  is rendered anywhere. `renderScore` delegates to it, so there is no second
  copy of the logic to drift.
- `showResult`'s `headline`, `score` and `detail` accept `string | Node`, and
  the card appends a `DocumentFragment` when given one. Every card score path
  now goes through the builder: the bout result (`2 — 0`), the round earned
  (`+2`), the run total, and the career best with its thousands separator.
- `formatScore`, `points()` and `POINT_LABEL` are all **deleted**. The last one
  was a `Map` whose entire job was spelling halves as U+00BD — the exact glyph
  this change exists to remove, still sitting in the file eight rounds after the
  fix that was supposed to retire it.

**Verified in a browser, not in a unit test.** Played a bout to its result card
and read the rendered DOM:

    result-score: {"frac":false,"glyph":false,"text":"2 — 0"}

`frac: false` is correct — 2 and 0 are whole numbers — and `glyph: false` is
the claim: **no U+00BD survives in the rendered card.** I could not force a half
deterministically through the thumb grammar (waza-ari did not land inside the
loop), so the fraction's rendered form rests on the HUD's own verified output in
`boot.spec.ts` plus a structural check of the builder. Recorded rather than
claimed.

**Two guards, because the bug lived in the wiring and not in a value.**

- `apps/game/tests/unit/score-notation.test.ts` — six tests asserting the
  builder exists and is exported, no live U+00BD in `main.ts`, `formatScore` is
  gone and uncalled, `POINT_LABEL` is gone, all three card fields accept nodes,
  and the thousands separator survives. It reads source rather than output, on
  purpose: the defect was that a score *could* be a string again, and only a
  source guard catches that.
- A new e2e test plays a bout to the card and asserts the rendered text contains
  no U+00BD, that a half renders as `.score-frac` with a real numerator, and
  that the card still reads as a score.

Gates: `pnpm check` **117 passed** (was 111), `pnpm test:e2e` **35 passed / 5
skipped / exit 0**.

### The lesson, stated properly this time

Round 53 fixed a notation and thought the job was done. It was not — the same
notation existed in two mechanisms, and the one I did not touch was the one
people look at. **A fix that reaches one of two renderers has not fixed the
concept.** The thing that made this finally stick is not the builder, it is
deleting the second mechanism so there is nothing left to drift, plus a test
that fails if a score string ever comes back.

### Round 68 — the instrument was missing the exact screen the finding was about

Last round fixed the score notation. Before moving on, the obvious question is
whether the review set can now *see* that it is fixed. It cannot, and the reason
is worth more than another fix.

`07-phone-result` is captioned "result" and shows a **tournament bracket**:
`BOUTS WON 0 / 1 · BEST —`. It is not the card that renders a score. So this set
has never contained a frame of the bout result at all.

That single omission explains a thirty-one-round failure end to end:

- five models reported the half-point notation as cramped, ambiguous, or reading
  as `21/2`, and every one of them was reasoning about a screen they could not
  see, inferring it from the HUD
- the round 53 fix reached the HUD and stopped, because the HUD was the only
  score any reviewer had ever looked at
- no amount of checking the code could have caught the gap, because the gap was
  not in the code — it was in what the loop was looking at

**Added `17-phone-scored-result`**, played to with the same thumb grammar the
e2e suite uses, so the score on it is real:

    2 — 0
    BOUTS WON 1 / 1 · BEST 6.3S

No glyph, one notation, and a career best with its thousands separator intact.
The set is now 18 frames and the scored result is one of them.

### The round's actual lesson

This loop has now caught the same class of failure three times, and each time
one level further from the pixels:

1. a model misread a frame
2. an instrument made a real defect invisible
3. **an instrument omitted a screen, so a real defect could not be reported by
   anyone, and the loop spent thirty-one rounds on it**

The first two are about looking carefully. The third is not about looking at all
— it is about what you decided to look at, and no amount of scrutiny of the
thing you are looking at will ever find it. Every finding in this log that
survived scrutiny was a finding about something someone chose to photograph.

The generalisable form: **before trusting a review to be comprehensive, check
that the thing you are reviewing is in the review.**

### Round 68 — the first reviews that can see the card, and what they say instead

`x-ai/grok-4.7`, `google/gemini-3.8-flash`, `openai/gpt-6.1-sol-pro`, now
reviewing 18 frames including `17-phone-scored-result`.

**The half-point finding changed shape, and that is the signal that the
instrument is working.** Before the card existed, models said the notation was
ambiguous, cramped, or read as `21/2`. Now that they can actually see it:

- `grok-4.7`: "half-point scores render as a **colliding** stacked fraction"
- `gemini-3.8-flash`: "fractional-score typography is **cramped and misaligned
  in HUD and match results**"

A more specific complaint about a specific mechanism, replacing a vague one about
a glyph nobody could see. That is what adding the screen bought. The claim is
now falsifiable and the next round settles it — the set still shows no half, so
it may be another inference, and it is recorded open rather than fixed or
refused.

**And a second model reported the amputated front kick, which I refused in round
64. So I looked again, with no arbitrary crop this time.**

`03-phone-strike` shows **a guard stance.** Both fighters have their hands up,
both feet planted, both legs complete and ending in full feet — verified across
the full frame width rather than the 15–85% window I used last time.

**The set contains no kick.** A frame named "strike" that shows a neutral guard
is a frame every reviewer will read as "a fight is happening", and a fight
implies a strike implies a kick implies an amputated leg. Two models have now
reported it and neither was looking at a kick, because there isn't one to look
at.

This is the **same failure as the missing result card**, one round later and in
the opposite direction: not "the screen the finding is about is absent" but "the
frame is named for something it does not show". `03-phone-strike` has been in
the set since round 1 and has never contained a strike.

**Next instrument work, in order:**

1. A real kick frame — drive `technique → forward` and capture mid-extension.
   The kick has the longest reach in the game, it is the only move the camera
   pulls back for, and it is the frame two models have been hallucinating.
2. A frame with a half point actually on the board, so the stacked fraction can
   be judged rather than inferred.

Both are captures, not product changes, and both are cheap now that
`17-phone-scored-result` proved the thumb grammar reaches a real result.

### Round 69 — the kick frame, and the harness refusing to lie about it

**First run of the kick capture wrote nothing, and that was the feature working.**

I drove `technique → forward`, which reads as "the kick" to anyone who has not
read the move table. It is `lunge_punch`. The capture's guard required an active
phase on a move whose id names a kick, found `lunge_punch`, and printed
`18-phone-kick: no active kick observed, frame not written` rather than saving a
punch under a kick's name.

**The stick directions are not named after the moves:**

    technique up       front_kick
    technique forward  lunge_punch
    technique down     foot_sweep
    technique back     reverse_punch

So the frame the loop has been missing since round 1 was one input away from
where I was pressing, and `03-phone-strike` has been showing a guard stance
while carrying a filename that promises a strike. Fixed: `technique → up` is
`front_kick`, and `18-phone-kick` now writes on a real `front_kick@active`.

**And the frame immediately earned its place by making a claim visible that this
loop had twice recorded as untestable.**

`step-3.7-flash` reported in round 66 that "fighter limbs clip through each
other during kicks", and it went into this log as open-but-untested, because no
frame contained a kick. The capture shows it: on the captured frame the white
fighter's extended foot is **inside the red fighter's torso**, with the two
torsos merging and the red fighter's arm passing behind the white fighter's
thigh. Both fighters are fully drawn, both limbs are intact — this is not the
amputated-kick report, which was a phantom — but the contact frame has no
occlusion, so a leg that should be behind a body reads as through it.

**That is a real defect, found by adding a frame rather than by adding a model.**
It is the first finding in this log that no reviewer reported, because no
reviewer had ever been shown the thing they were reporting about. The same
shape as the missing result card in round 68, except this time the gap hid a
true finding instead of a fixed one.

### Round 70 — correction: the occlusion "defect" I logged in round 69 was mine, and it was wrong

I wrote above that the white fighter's foot was **inside** the red fighter's
torso with no occlusion, and queued a depth-order fix. Before changing product
code I went looking for where depth is assigned, and it has been there the whole
time, at `main.ts:678`:

    const attacking = fighter.phase === 'startup' || fighter.phase === 'active';
    views[index]!.root.position.z = attacking ? 0.08 : index === 0 ? 0.02 : -0.02;

**The striking fighter is deliberately drawn in front, and the frame shows
exactly that** — the white fighter's kicking leg passes *over* the red fighter's
body, which is what a side-view kick connecting is supposed to look like. Both
fighters also carry distinct depths at rest, so they never fight over the same
pixels.

So there is no occlusion defect, there is no depth bug, and the fix I queued
does not need to exist. What I saw as "a leg through a torso" is a leg in front
of a torso, at a z-offset chosen four months ago for exactly this moment.

**This is the seventh time this loop has caught a confident, specific, wrong
conclusion — and the first time the wrong conclusion was mine rather than a
model's.** I have spent six rounds applying that discipline to reviewers and
then walked straight into it myself, on a frame I had only just built, with a
crop I had already been burned by twice in this same file.

The specific failure is worth naming because it is not "did not look closely".
I looked closely, at a good crop, and got the direction of the overlap wrong.
Confidence was never the problem. **The problem was that I had a story ready —
"the set was missing the screen, so the frame must be showing a real defect" —
and the frame was more agreeable with the story than with the code.** A frame
that finally appears after you have spent a round insisting one is missing is
the most persuasive frame you will ever look at, and that is exactly when to go
read the renderer instead of the picture.

The real, still-open observation from that frame is smaller and is already known
to the loop: on `front_kick@active` there is no contact cue at the point of
impact. That is the impact-VFX finding that `grok-4.5`, `qwen3.6-flash`,
`claude-opus-4.8` and others have reported, it is a different thing from
occlusion, and it is not fixed.

### Round 71 — `lunge_punch` is a half point, and a half point never appears

Closing the last open instrument gap needs a frame with a half on the board, so
the stacked fraction can be judged instead of inferred. The move table settles
which move that is — `value` is `half` for ten of the twenty moves, and among
the four reachable from the thumb grammar the half-point one is
**`lunge_punch`, which is `technique → forward`**.

Which means the move I have been pressing in every capture this loop is the half
point, and driving it for 18–26 attempts ends at:

    scores: [2, 0]      HUD text: "2"      .score-frac: absent

**A whole number.** So after two dozen half-point strikes the board reads `2`,
not `0.5`, `1`, `1.5`, and never shows a fraction at any sampled moment. Polling
`state().scores` and the DOM together across 26 attempts produced **no frame in
which the HUD was showing a half**.

Two readings, and I am not choosing between them on a guess:

1. **The half is real and my sampling missed it.** The score could pass through
   0.5 between two 460ms polls, and the e2e read latency on a real browser is
   easily that. The fix is a 60Hz read of `state().scores` from inside the page
   rather than a round trip per check.
2. **`value: 'half'` does not mean the score increments by 0.5.** It may be
   describing a scoring *category* rather than a magnitude, and the board may only
   ever hold integers — in which case the stacked fraction the loop has spent
   thirty-one rounds on, and six models have reported, **renders only on paths
   the game never actually reaches**, and the entire finding is about dead code.

The second reading is the uncomfortable one, and it is the reason this is written
down rather than quietly fixed. If (2) is true then round 67's fix was correct,
its tests were correct, and the thing five models reported was an artefact of
reviewing a notation they could see in the source and not in play.

**The check that settles it, for next round:** sample `state().scores` inside the
page on every animation frame for one whole bout, and log every distinct value it
takes. If 0.5 is in that set, the capture is a timing problem. If the set is
`[0, 1, 2]` only, it is a rules problem, and the honest move is to say so and
decide deliberately whether a half point should exist at all — not to keep
polishing a fraction no player will ever see.

### Round 72 — both of round 71's readings were wrong, and the sim says why

Round 71 left two readings of "`lunge_punch` is a half point but no half ever
appears" and refused to choose. The 60Hz trace came back:

    distinct score states: [0,0]  [1,0]  [2,0]
    a half was on the board: false
    HUD showed a fraction : false

Every animation frame of a 30-strike bout. No half. On that evidence reading (2)
looked right: the board only holds integers, the stacked fraction renders on
paths the game never reaches, and five models reported an artefact of reading the
source rather than the game.

**It is not that. The half point is real, and it is being awarded.** From
`packages/sim/src/match.ts`:

    const base: CallValue = move !== null && move.value === 'full' ? 'full' : 'half';
    return { value: counter ? 'full' : base, counter };
    const pointsOf = (value: CallValue) => (value === 'full' ? 1 : 0.5);
    state.fighters[call.scorer].score += pointsOf(call.value);

So a `value: 'half'` move scores **0.5**, and it becomes 1 only when it lands
**as a counter** — `defender.phase === 'startup'`, the counter comment above it
explaining that punishing a whiff used to make four calls in five an ippon and
left the half point vestigial.

**My probe drove twenty or thirty lunges in a row against an opponent who was
almost never winding up, so nearly every call resolved as a counter and every
half was promoted to a full point before the next sample.** The half exists, the
notation exists, and the fraction renders — in the window where a half-point
call has landed and the referee has not yet been answered.

**The finding is real. The fix in round 67 is real. Five models were right, and
I was one 60Hz trace away from overruling all of them.**

### The lesson, and it is the sharpest one in this log

Round 63 taught: *before building an instrument, check whether the question has a
number in it.* This is the other half of that lesson and it is the more dangerous
half.

**A number you sampled wrong is worse than no number at all.** The trace was
executed properly — every animation frame, the right surface, the right value —
and it still said "no half exists", because the thing being measured was a state
that lasts a few hundred milliseconds and my driving pattern skipped it. The
instrument was sound and the question was wrong.

I was also close to compounding it. The clean result `[0,0] [1,0] [2,0]` is
exactly the shape of a decisive refutation, and I had already written the
surrounding text for "the finding is about dead code". Had I not opened
`match.ts` before committing that, the loop would have recorded a 31-round true
finding as dismissed, with a measurement to back it, and the measurement would
have been the mistake.

**Round 63's number settled a question because I had reduced it to "is this pixel
red." This number nearly overturned a question because it looked just as
settled. The difference is not the instrument — both were correct instruments.
The difference is whether the thing measured is the thing asked about.**

Before accepting a clean refutation of a finding that several independent
reviewers have reported, read the code that produces the value. A result that
confirms what you wanted is the cheapest thing in the world to obtain.
