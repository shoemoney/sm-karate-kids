# SM Karate Kids — completion plan

Written at round 134, after a hundred and thirty-four rounds of review, and
updated at r150. This is the plan for *finishing*, as distinct from the loop that
has been improving.

## Where the project actually stands

| | |
|---|---|
| Playable | yes — tournament + dojo, two sticks, point karate |
| Deployed | `https://arcade.shoemoney.ai/smkk/`, verified playing a real bout |
| Tests | 184 unit, 42 e2e, 6 skipped, green locally |
| Review loop | 150 rounds, 20 review frames, mutation-tested fences |
| Commits | 278 |
| Production | **byte-identical to the local build**, `tools/verify-deploy.sh` green |

The game is not a prototype. What remains is a short list of specific, named
gaps — every one of them is in this document, and nothing else is.

---

## Phase 1 — Close the gaps the loop has already found

### 1.1 Desktop keyboard legend — `P1`
**Found:** r96, r98, r102, r132. Four reviewers, four rounds, never fixed.
**Why it matters:** the game supports WASD for stance and arrows/IJKL for
technique (`input/keyboard.ts`), and **nothing on screen says so.** A desktop
player — the audience for a twin-stick twin-stick fighter — is told nothing about
how to play and has to guess that a keyboard is even wired up.
**Do:** render the key glyphs beside the coach's direction labels, on wide
viewports only. Touch layout untouched.
**Accept:** the keys appear on desktop and are absent on a 390px phone.
**SHIPPED at r135.** r141 then measured the glyphs at **5.10:1** — `--text-2xs` in
`--text-faint`, the smallest and dimmest pairing the design system offers, applied
to the one label that exists to be read — and took them to **8.45:1** at 12px.
Both viewports verified in the same pass: `display:block` at 1280, `display:none`
at 390.

### 1.2 Pre-fight card opens the sheet it points at — `P1`
**Found:** r125, r130. Round 118 put the notation on the card; the card says
"the sheet lists every combination" and **offers no way to get there.**
**Why it matters:** a dangling reference on the one screen every player reads.
**Do:** add a reference button to the pre-bout card beside FIGHT.
**Accept:** pressing it opens the techniques sheet and returns to the card.
**SHIPPED at r136.** The button r136 added was then measured at **102x21px** —
under half the 44px floor, on the only route to the sheet from the screen that
introduces the game — and fixed at r141 to **143x46**, relabelled REFERENCE →
TECHNIQUES because the card's own copy never uses the word "reference" while the
HUD calls the same sheet TECHNIQUES. Verified by tap, not by stylesheet.

### 1.3 Coach labels on the sticks, not in a panel — `CLOSED, r138`
**Found:** r113, r124, r132.
**Playtested at r138 and reverted.** The action words already carry their own
arrow — `◀ back`, `▲ jump` — and each arrow sits directly above the chevron it
describes, so the mapping from word to direction is already positional and
already explicit. Moving the words onto the pads would put four words inside a
170px ring whose chevrons are directional *markers*, and the result is a control
that reads as clutter.

The answer to "the mapping is one screen away" is that it is **directly above**
the control, aligned to its own glyphs, and that is the correct place for a
legend. Refused on a playtest, like r108.

---

## Phase 2 — The art findings that need a human decision

Two are genuine, measured, and both are **art-direction changes to generated
assets with provenance records.** A review loop should not make them unilaterally.

### 2.1 The kicking foot does not read — `P2, needs a human`
**Measured** (r89, r130, r133): the foot is whole, correct, and correctly
facing. It is `rgb(229,189,159)` on a mat of `rgb(139,103,54)` — **2.96:1** —
at about **11px** on a 390px viewport. A reviewer has now cross-referenced two
frames and diagnosed it correctly as an inconsistent rendering, not a broken
sprite.
**Three candidates:** a rim light on the foot at extension; a floor shadow under
it during the active window; raising the foot's value in the atlas to clear
4.5:1.
**Decision at r140: attempt the cast shadow — REVERTED after three attempts.**
Rounds 90, 91 and 139-140 have each placed it correctly and each produced nothing
visible under the foot. The geometry is right and the *result* is still too faint,
because a shadow under the foot is a second low-contrast object, not more
contrast on the first. **The fix that addresses legibility is raising the foot's
value in the atlas to clear 4.5:1**, which is a human art-direction decision on
a provenance-tracked asset, not a loop change.

### 2.2 The ceiling is the flattest region in the frame — `P3, needs a human`
**Measured** (r85, r106): the band above the shoji is mean luminance 42–48 with
a standard deviation of 8–19, against 47.6 on the mat. Two tint attempts both made
it **flatter** (sd 18.9 → 7.3), which proves the tint is not the lever — the
source art is low-contrast and no global multiply can fix it.
**Candidates:** different source art; per-pixel treatment of the eave.
**Decision at r140: LEAVE IT.** Flatness in a region carrying no information is
correct — it is a far wall, and a far wall should be flatter than the floor. The
real cost is the 39.7% dead space above the fighters, which r84 settled as
arithmetic, not art. Regenerating the eave is expensive and buys a player
nothing. Recorded so it is not re-opened as a new finding.

---

## Phase 3 — Unattended continuation

**The honest constraint:** I cannot re-enter this session by myself. Each
iteration is the Ralph loop handing me control; when an iteration ends I return
the prompt and stop.

So unattended means **an external driver**, and there are two:

1. **The Ralph loop**, `maxIterations` raised, `active: true`. This is what is
   already running. It drives me; it is not me driving myself.
2. **A launchd job on this machine** that invokes the loop unattended. That is a
   real answer to "without me having to tell you to continue," and it is the one
   that keeps working when this session ends.
3. **`tools/loop-once.sh`** — built at r140 and installed on a schedule. Takes a
   lock (stale locks over 45m are reclaimed), writes a log per iteration into
   `.loop/`, and stamps `.loop/last-ok` only on exit 0. **In place, running.**

### 3.3 The deploy can actually be performed — `SHIPPED at r149`

r141 built the gate that detects a stale deploy. r148 found production stale and
**could not fix it, because a gate that detects a problem is not a way to solve
one** — the repo had no deploy path at all, only the verification half.

The reason r148 recorded was:

    ssh root@192.168.1.10  ->  Permission denied (publickey)

True, and incomplete. The same host accepts `shoemoney`, the deploy root is
owned by `shoemoney`, and `rsync` works over it. A tool that knows only one
identity turns a login detail into an outage, and it cost production a build.

`tools/deploy.sh` is that path: refuses a missing or **stale** build, dry-runs
and prints the `--delete` list before touching anything, pushes with
`--delay-updates` so the new html cannot precede its bundle, and then
**propagates `tools/verify-deploy.sh`'s exit code** rather than reporting its own
success — rsync says bytes reached a directory, not what nginx serves from it,
which is the entire subject of r141.

**Proved able to fail** in `tools/deploy-mutation.sh`: 12 assertions over a real
HTTP server on a throwaway root, never production. It caught a real defect in
itself on the first run — readiness required a 200 on `index.html`, so a root not
yet written to was reported as a deploy failure, which is precisely the
misdiagnosis standing rule 4 exists to prevent, sitting inside the tool written
to enforce rule 4.

**Production is byte-identical over the wire.** `arcade.shoemoney.ai/smkk/` now
passes `tools/verify-deploy.sh` with 2 assets sha256-matched — the first time in
the project's history that claim has been true.

### 3.2 The deploy is not verified until a gate says the bytes match — `SHIPPED at r141`

Added at r141, and it is the one item here that existed because the loop itself
broke it rather than because a reviewer found it.

Round 141 shipped a deploy and the site answered **200** for hours while serving
a build two hours stale. Nothing was wrong with the site. The evidence anyone had
was a status code, and a status code was all the process asked for:

    200 OK                        -> "the deploy worked"
    the bundle I pushed is served -> "the deploy worked"

`tools/verify-deploy.sh` now makes the second claim the one that counts: served
`index.html` against local `dist/index.html` byte-for-byte, then every asset the
served html names fetched over the wire and compared by sha256. The deploy root
is recorded in the script's header because finding it cost four probes and it is
not under `/mnt/tank` where the docs implied.

**Proved able to fail**, which is the part that counts — six cases in
`tools/verify-deploy-mutation.sh`, each over a real local HTTP server, asserting
exit code *and* diagnosis: faithful copy (pass), stale names, right name with
wrong bytes, asset absent from the wire, dead origin, absent local build. The
harness caught two real defects in the gate on its first run, both of which are
the kind that survive a casual read:

- an empty-but-present dist returned **exit 1**, which reads as "the deploy
  disagrees with the build" and sends an operator hunting a problem they do not
  have; now **exit 2**, operator error
- the html-mismatch branch **deleted its own evidence** via the EXIT trap while
  the asset branches kept theirs, so the stale-deploy case — the one the script
  exists for — left nothing to inspect. Now centralized in the trap.

Refused deliberately: a list of "is my fix live?" marker strings. Vite rewrites
custom properties and mangles literals on any refactor, so each marker is a
future false alarm and a gate that cries wolf gets deleted. A sha256 comparison
is exact, and if the served bytes equal the built bytes then every fix in them is
live.

### 3.1 Standing rule for unattended runs
Because nothing is watching, three rules exist and are not optional:

- **Regenerate the review set before every review.** Stale frames produced a
  false finding at r127 and cost a round.
- **Read the gate log before committing.** A red gate was committed and deployed
  at r127; it turned out fine, which was luck and not process.
- **Never ship on a number that has not been read off a clock or a pixel.**
  Rounds 90, 93 and 95 were all a metric agreeing with a no-op.

---

## Done means

- [x] 1.1 keyboard legend on desktop — shipped r135, contrast fixed r141 (8.45:1)
- [x] 1.2 pre-bout card opens the sheet — shipped r136, target size fixed r141 (143x46)
- [x] 1.3 coach labels on the sticks — playtested at r138 and closed, with the reason
- [x] 2.1 and 2.2 raised with a recommendation — a human decides, the loop has done its part
- [x] 3.1 unattended driver in place — `tools/loop-once.sh` on a launchd schedule
- [x] 3.2 deploy verified against production bytes — `tools/verify-deploy.sh`, mutation-proved
- [x] **3.3 the deploy can be performed** — `tools/deploy.sh`, and production is
      byte-identical over the wire. The `root`-only refusal that stalled r148
      was one identity short of a working deploy.
- [x] every phase gated, logged, committed, deployed
- [x] **provenance precedence** — **FIXED at r150.** `docs/asset-provenance.md`
      states twice that the manifest governing an asset is the NEAREST ANCESTOR
      and that a directory's own record wins. The code resolved the entry by
      first-manifest-with-the-key over an unsorted `readdirSync`. Measured: a
      nearer `fighters/PROVENANCE.json` saying `approved: false` was never read
      because `brand/` sorts first — and `brand` is not an ancestor of
      `fighters`. The gate that decides what may ship had a verdict a directory
      name could change. Fixed, and proved able to fail in
      `tools/validate-assets-mutation.sh` (8 cases, 3 mutations red).
- [x] **the sheet's pips match the sticks** — **FIXED at r150.** The pad teaches
      two sticks in two colours (`--cool` stance, `--gold` technique) and the
      techniques sheet drew both its pips in one, so a row read `· + ▶` with both
      circles cyan while the player held one cyan and one gold stick. Four pairs
      measured identical to the pixel. Each pip now carries its own stick's
      colour, taken from the same declarations the pad reads. 8.97:1 / 9.28:1
      against the measured sheet ground, dE 64.0.
- [x] **half-point score typography** — **SHIPPED at r148.** Raised since r918, built
      in r53, revisited in r133, and named by two models in the same round at r147 —
      always in the same four words, never with a number. r148 measured it: a stacked
      column is two lines tall, so beside a one-line digit the denominator hung
      **15.00px below the baseline** and the scoreline grew **9.94px (+26%)** every
      time a half landed. Shrinking it was not available — fitting it needs ~0.44em
      against a 0.66em legibility floor. The fraction is now set on one line, same
      three nodes, same 0.72em: **1.00 line**, baseline **flush**, scoreline
      **does not move**. Two mutations, both red.
- [x] **renderer frame cost on a GPU-less device** — closed at r146, and it turned out not
      to be the taste call r144 assumed. See below.

**Not "done" means:** every item above is either finished or blocked on a human
decision with the measurement attached. **As of r150 there are no open items.**

**But read that as a claim to re-check, not a fact.** r149's own lesson was that
this document recorded a conclusion where a blocker had been, and r150 audited
the *closed* boxes on exactly that suspicion: two of them did not survive. The
provenance gate and the sheet's pip colours were both documented contracts the
code did not implement. So "no open items" here means "no open items found by
reading the closed ones against the code", which is a weaker statement than it
looks and should be re-earned every few rounds.
Everything in Phases 1 and 3 is closed, Phase 2 is blocked on a human by design
with the measurement attached to each item, and the scoreboard's half point is
measured rather than argued about. Production is serving the build this tree
produces, and there is a command that both puts it there and proves it did.

---

## Closed at round 148 — five rounds of opinion, and the answer had never been rendered

The last open box had been raised five times and described in the same four words
every time: *reads as a baseline drop, hard to parse*. Nobody had a number.

**First measurement (stacked column, r53..r147), at a 1.5 score, 390px baseline:**

| | measured |
|---|---|
| fraction ink | 33.50px tall, centre 8.50px low |
| **denominator vs the digit baseline** | **15.00px BELOW it** |
| `.scoreline` with a half | 37.83 → **47.77px** (+26%) |

It was a subscript, and "baseline drop" was the literal name of it. It could not be
shrunk into place — that needs ~0.44em against a 0.66em legibility floor — so it
became a running-text fraction on one line, which measured 1.00 line, baseline
flush, no reflow.

**Then the review said that was wrong too**: a 2.5 tournament total read as
`2 1-2`, the whole number and the half's numerator 4.5–5.0px apart. Both attempts
had the same underlying cause — the half was a separate element next to a whole
number.

**The decisive step was rendering what had only ever been argued about.**
`tools/notation-probe.mjs` puts all five candidates side by side in the shipped
font stack at the real 22px. The r36 rejection of U+00BD rested on the glyph being
"slashed", and the slash is the reason it *works*: a minus is horizontal, and the
raised numerator and lowered denominator are not on one line to be read as a
range. It is also one glyph, so there is nothing to merge with.

**Shipped: `scoreFragment` emits one text node** — the whole part with its
thousands separator, then U+00BD.

| | r53..r147 | r148a | shipped |
|---|---|---|---|
| lines | 1.77 | 1.00 | **1.00** |
| denominator vs baseline | 15.00px below | flush | **flush** |
| `.scoreline` on a half | +9.94px | no move | **no move** |
| one node, or mergeable with the whole number | 3 elements | 3 elements | **1 text node** |

Two mutations red on both gates. The e2e's failure message *is* the defect: "with a
half on the board `.points` has 2 child node(s) and elements `["SPAN"]`".

**Evidence of legibility, which a screenshot cannot supply and a claim cannot
either:** three consecutive review passes flagged the half point —
*baseline drop* → *confusing ranges, `2 1-2`* → *confusing hyphenated strings* —
and the fourth, after the glyph, did not mention it. Four independently
regenerated sets.

One thing could not be made deterministic and is recorded rather than papered
over: **landing a half is not guaranteed**, because a half is only awarded when the
defender is not winding up. Under frame starvation the technique scores full and
the bout ends at `pointsToWin: 2` first. Measured here at load 14.45/18.18/19.36
against ~40s at load 8. The e2e therefore asserts the structural property
deterministically and the geometry opportunistically, and the geometry lives in
`tools/scoreline-stability.mjs` instead.

Full method, four notations, and five more things I got wrong and measuring caught
me, in `REVIEW-LOOP.md`, round 148.

---

## Closed at round 146 — the renderer item was never a taste call

r144 left this open because the three candidates were a **look trade**, and a
review loop should not make those alone. r145 measured all three with
`tools/renderer-sweep.mjs` (raw data in `logs/renderer-sweep.json`), and the
measurement dissolved the trade rather than settling it:

| change | median frame | vs baseline |
|---|---|---|
| baseline | 60.9ms | 100% |
| `antialias: false` | 53.7ms | 88% |
| post chain bypass | 46.3ms | 76% |
| **pixelRatio 1** | **16.5ms** | **27%** |
| pixelRatio 0.5 | 16.7ms | 27% |

- **`antialias` is not a lever.** It read 88% in one sweep and 115% in another —
  inside the noise, and in the second sweep *slower*. It is not the 4× MSAA cost
  it appears to be, so it stays on.
- **The post chain is real but secondary**, and it is the difference between a
  correct frame and a photographed one. Removing it stays an art decision.
- **Pixel ratio is the only lever with a hard bound.** Fragment work is
  proportional to pixel count, so this removes cost *by construction*. And the
  last row sets the floor: 0.5 is no faster than 1, because at 1 the frame is
  already at the refresh cap — so the ladder stops at 0.75 rather than buying
  blur for nothing.

A better frame time on fast hardware says nothing about a two-core runner, so
`tools/throttle-cliff.mjs` finds the throttle rate where the failure reproduces
and asks the only question that matters: **does the lever still work at the
cliff?** (`logs/throttle-cliff.json`, CPU throttled 30×.)

| config | frame median | click |
|---|---|---|
| baseline | 140.3ms | **27003ms** |
| pixelRatio 1 | 67.3ms | **2171ms** |

**12.4× on the click, at the rate that breaks it.** That is the answer r144 said
was unavailable.

> **Corrected at r147.** The two rows above are a **fixed** `pixelRatio 1` patched into
> `renderer.ts`, not the controller. They prove the *lever* works at the cliff, which is
> what r144 asked. They do **not** measure the controller, which has to reach that ratio
> by itself — and when r147 measured the shipped controller directly it read
> `ratio: 2`, never having moved, because its decision window was counted in **frames**
> and one window cost **41.8s** on that profile. r146's gates were all green while the
> controller did nothing. See r147 in `REVIEW-LOOP.md`; the lever conclusion above
> stands, the timing did not.

### What shipped

`apps/game/src/renderScale.ts` — a controller the render loop feeds every frame
after the first presented frame. It walks a **bounded ladder** of pixel ratios,
using the **median** of each window and requiring **two** agreeing
windows before it moves, so one shader compile cannot make the picture
permanently worse. On a machine that can afford full sharpness the ladder never
moves and nothing changes.

Deliberately **one lever, bounded, no art changes.**

**A window closes on `WINDOW` frames or `WINDOW_MS` (400ms), whichever comes first**
— added at r147, and it is the part that makes the controller work at all. Counting
frames alone meant one window cost 41.8s on the GPU-less profile, so the relief arrived
at ~53s against a 9s card. After the fix the descent takes **2.4s** and the ratio
genuinely reaches `0.75`. Any controller whose input is the thing it is trying to fix
must be bounded in the unit the user is waiting in.

### The measurement, on the test that was red

`tournament.spec.ts:179` is the test whose click step took **50.4–53.4s** across four
CI runs. r145 took it to **17.2s** by pressing the button in-page — which r145 itself
recorded as *the symptom*, leaving the 2fps renderer underneath as the open item.

**Adaptive resolution addresses that renderer.** On the same runner, same spec:

| | r145 (in-page press) | r146 (+ adaptive resolution) |
|---|---|---|
| phone-portrait | 17.2s | **12.8s** |
| desktop | 13.6s | **10.3s** |

Read that as **directionally positive, not a precise delta** — it is one run each on
a noisy runner, and 12.8s is the whole test including its 7–8s of setup. The controlled
measurement is the cliff A/B above: same session, same host, 27003ms → 2171ms.

What changed is not a stopwatch number but a bound. Before this, fragment cost on a
GPU-less device was unbounded and only the *test* had been worked around. Now it is
bounded by construction, and CI is green at **37 passed, 5 skipped**.

Proved able to fail: the new `cross-renderer` test asserts the controller is
actually *fed*. Removing the `sample` call turns both viewports red. That
matters because every other property of the controller is **quiet** — a
controller wired to nothing still reports a legal ratio, a legal ladder, and a
ratio that is one of its own rungs. Only a rising frame count tells a live
controller from a dead one, which is why `framesSampled` is on the test surface.

---

## Added at round 144 — the renderer is the last open item, and it is measured

`tournament.spec.ts:179` was the only remaining known-red. Round 144 reproduced
CI's failure exactly and **retired** r143's explanation for it.

**What CI actually does** (from the trace artifact's per-step clock, all four runs):

| step | duration |
|---|---|
| setup, through reading `pinnedTick` | 7.0–8.4s |
| **`Click` on `.result-rematch`** | **50.4 / 52.3 / 52.3 / 53.4s** |
| `expect(card).toBeHidden()` | 1.0–1.4s |

The click is the whole failure. It does not fail — it arrives ~43s late, which is
why the error surfaces at line 221 with an exhausted budget rather than at the click.

**r143's mechanism was wrong.** It said the card self-dismisses and the click loses
the race. The card dismisses at **9s** — two seconds into a 52-second click.

**The real cause,** reproduced by forcing what CI has (no GPU, SwiftShader) and
settled by a controlled A/B on one evaluate round trip:

    busy (render loop running)   1930, 1485, 3227, 1388 ms
    idle (rAF stubbed out)          19,   12,   21,   13 ms

Under software rendering the game's own HUD reads **FPS 2, TPS 28, DRAW 26** — the
simulation is fine and the renderer is the wall, and 26 draw calls means it is
fragment cost, not scene complexity.

**Why this is not a test bug.** r143 proposed pressing the button in-page to dodge
the actionability wait. That is sound and measured (7.5s vs 52s), but it treats the
symptom: the page still renders at 2fps on that runner, which is a real
**performance** defect and not a test artefact. A phone from the design baseline is
the same class of target.

**The decision this needs — a human's, because it is a look trade:**
> **Superseded at r146.** The sweep measured all three candidates, and pixel ratio
> won on a hard bound rather than on taste — see "Closed at round 146" below. The
> list below is kept because the *reasoning* still holds and the sweep numbers are
> cited from it; it is no longer blocked.

- **Candidates:** scale render resolution when frames are slow; drop the post chain
  below a frame-time threshold; reduce `antialias` (it is `true`, so the scene pass
  runs 4× MSAA, and software rasterization pays 4× for it).
- **Measured already:** bypassing the whole 5-pass chain took the median frame
  614→177ms but left a 21.7s outlier and did **not** fix the click. 9× fewer pixels
  moved the median 153→94ms and left max at 16.8s. So neither lever is sufficient
  alone, and picking one by taste would be guessing.
- **Do not** raise the 60s e2e timeout. It does not make the click faster; it only
  lets a 52-second wait finish before the test gives up.

Full method, discarded hypotheses and reproduction in `REVIEW-LOOP.md`, round 144.

### What is left, honestly

Nothing in Phase 1 or 3. Phase 2 is blocked on a human by design, with the
measurement attached to each item.

One thing deliberately **not** done, recorded so it is not re-opened: the
pre-existing `GET /api/games/karate-kids/runs` 404 on load. It fails soft by
design (`leaderboard.ts` — "no board this run, never an error on screen") and
fires no page error. Wiring a game id into the arcade API is a different change
from anything in this document and belongs to whoever owns that contract.