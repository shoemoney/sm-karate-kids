# SM Karate Kids — completion plan

Written at round 134, after a hundred and thirty-four rounds of review, and
updated at r150. This is the plan for *finishing*, as distinct from the loop that
has been improving.

## Where the project actually stands

| | |
|---|---|
| Playable | yes — tournament + dojo, two sticks, point karate |
| Deployed | `https://arcade.shoemoney.com/karate-kids/`, verified playing a real bout |
| Tests | 206 unit, 44 e2e, green locally |
| Review loop | 160 rounds, 20 review frames, mutation-tested fences |
| Commits | 300 |
| Production | ⚠️ **STALE — 63 commits behind, measured r160.** Was recorded here as "byte-identical to the local build" until then; that was true of the *retired* `.ai` host and was never true of the origin this game ships from. |

The game is not a prototype. What remains is a short list of specific, named
gaps — every one of them is in this document, and nothing else is.

---

## ⚠️ Read this first — the deploy is a real gap, and it was closed by accident

**Added at r160.** Item 3.3 below reads "SHIPPED at r149 … production is
byte-identical over the wire." **That was true of `arcade.shoemoney.ai/smkk/` and
is false of `arcade.shoemoney.com/karate-kids/`.** The gate built for this was
correct the whole time; it had simply never been run against the origin the game
ships from. r159 deployed to `.ai`, verified `.ai`, and then — in the same commit
— repointed the gate at `.com` and committed without running it once.

Measured at r160, off the wire, by `tools/production-freshness.py`:

    served markup pins to apps/game/index.html at 6b57a2b81 (2026-09-30)
    63 commit(s) behind HEAD — an UPPER BOUND on the drift
    served css: 154 tokens declared
    READ BUT NEVER DECLARED, no fallback: --coach-plate, --leading-relaxed

What a player on `arcade.shoemoney.com` is actually running:

| shipped | live? |
|---|---|
| r135 desktop keyboard legend (item 1.1) | **no** — no `.key-hint` markup, no `.key-hint` rule |
| r148 one-line `½` score fraction | **no** — still the pre-r148 stacked column, and `½` appears nowhere in the served bundle |
| r152 the sheet holds the pre-bout card open | **no** |
| r157 `--coach-plate` declared | **no** — `var(--coach-plate)` is read once and declared zero times, so the coach strip has **no background at all** |
| r157 `--leading-relaxed` declared | **no** — same class |
| r157 the first-run coach renders at all | **no** — the `retire()`-writes-the-flag bug is live, so a first run is never taught |
| r159 the sheet-pause fix, `postures` on `state()` | **no** |

**And 3.3's `Do:` line is false.** It says `tools/deploy.sh` is the deploy path.
r159 retired that script on purpose — it rsynced through a symlink an atomic flip
owns. The real path lives in `~/Projects/SMA-arcade`.

**Why nothing caught it:** `pnpm check` must stay runnable offline, so it cannot
call a network gate, and no round is *obliged* to run one. The gate was right and
never consulted. That is r141 one level up — r141 built the gate, r159 moved it,
and no round in between ever ran it against the truth.

**What is now in place:** `tools/production-freshness.py`, which reports the
distance and names what is missing, plus an 8-case mutation harness proving it
can fail. Both are outside `pnpm check` for the same reason.

> **Added at r161 — the consulting half, which is what r160 said was missing.**
> r160's own summary was that the repo had *"no automatic path from a local build
> to a verified production"* and had built *"the half that reports."* The gate
> existed and was correct; **no scheduled process was obliged to run it**, which
> is why 63 commits of drift could sit here while this document still said
> "byte-identical over the wire."
>
> `tools/loop-once.sh` now re-measures production **every iteration** and injects
> the verdict at the **top of the next round's prompt** — above the plan, so a
> reader has to look past it. `.loop/production-stale` is written when it is red.
> Proved able to go quiet in `tools/loop-freshness-mutation.sh` (12/12).
>
> The failure it guards is not a wrong number — it is **an inherited unverified
> claim**, and a fresh measurement is the only guard against that one.

**What is blocked, and on what.** The deploy itself. `ops/build-release.py` builds
**all eight** registered games from their local trees and `ops/deploy.py` then
ships the whole arcade behind an atomic flip. Four of the seven other trees have
uncommitted work — `shoeinator-web` (14 files), `shoeateka`, `survivaltd`, `Skat3`.
Running the only supported path unattended would publish another agent's
work-in-progress to a public host. That is a decision for a human, and it is the
one open item left.

> **Re-measured at r161, because that paragraph is inherited prose.** The blocker
> holds and the window is **widening**: `shoeateka` went from **1 dirty file at
> r160 to 22** now. `build-release.py` has no subset flag — it builds every
> registered game unconditionally — and `deploy.py` demands a privacy-gate
> clearance receipt before it uploads. Nothing in this repo can move it.

---

## Phase 1 — Close the gaps the loop has already found

### 1.1 Desktop keyboard legend — `P1`
**Found:** r96, r98, r102, r132. Four reviewers, four rounds, never fixed.
**Why it matters:** the game supports WASD for stance and arrows/IJKL for
technique (`input/keyboard.ts` — all eight keys are really bound, confirmed at
`keyboard.ts:5-19`), and **nothing on screen says so.** A desktop player — the
audience for a twin-stick fighter — is told nothing about how to play and has to
guess that a keyboard is even wired up.
**Do:** render the key glyphs in the pad footer, under each stick's caption, on
wide viewports only. Touch layout untouched.
**Accept:** the keys appear on desktop and are absent on a 390px phone.
**SHIPPED at r135.** r141 then measured the glyphs at **5.10:1** — `--text-2xs` in
`--text-faint`, the smallest and dimmest pairing the design system offers, applied
to the one label that exists to be read — and took them to **8.45:1** at 12px.
Both viewports verified in the same pass: `display:block` at 1280, `display:none`
at 390.

> **The `Do:` line above used to describe a design that was never built — the
> feature is fine, this note is about the record, and r153 corrected the sentence.**
> It said the glyphs go "beside the coach's direction labels". They do not, and
> they **cannot**: the two are gated on **mutually exclusive** media queries.
> `.coach-legend` is built only when `(hover: none) and (pointer: coarse)`
> matches (`coach.ts:97`); `.key-hint` is shown only under
> `(hover: hover) and (pointer: fine) and (min-width: 720px)`. On every viewport
> where the key hints are visible, the coach strip is never in the DOM.
>
> Where they actually are is the better place, and it is the same conclusion r138
> reached about the stick labels: the glyphs sit under the `STANCE` / `TECHNIQUE`
> captions in the pad footer, directly above the control they describe. That is
> what a legend is for.
>
> Two smaller notes from the same pass, neither a defect: `min-width: 720px` is
> the real cutoff rather than a stated desktop width, and the hint renders only
> `↑ ← ↓ →` while the CSS comment advertises "arrows (or IJKL)". The comment is
> **correct** — `KeyI/J/K/L` are all bound — and one glyph set is all that fits,
> so r153 checked `keyboard.ts` before "correcting" a non-problem.
>
> **The colour literal — FIXED at r153.** r152 closed this item and left the
> desktop rule's hardcoded `#b8a894` standing, with the blocker stated: it "needs a
> pixel measurement of the composited high-contrast backdrop, which is a paint-time
> value no static read can supply."
>
> The measurement was built (`tools/keyhint-contrast.mjs`) and it did **not** return
> the defect r152 expected. The hint was not failing legibility — at 9.07:1 in
> high-contrast it clears AA comfortably, because the pad goes black underneath.
> It was failing **intent**: high-contrast lifts the faint labels together, and this
> was the only one left behind.
>
> | painted pixels, 1280x800 | normal | high-contrast |
> |---|---|---|
> | `.key-hint` (W A S D) | `rgb(184,168,148)` **8.45:1** | `rgb(184,168,148)` **9.07:1** — did not move |
> | `.stick-label` (STANCE) | `rgb(177,162,144)` 7.90:1 | `rgb(232,232,232)` **17.14:1** — moved |
>
> The control is the neighbour, in the same stick-zone and the same frame, reading
> `--text-muted`. Freezing *it* makes the probe exit 2 rather than reach a verdict.
>
> `--key-hint-ink` now lives on `:root` and re-points to `var(--text-faint)` in
> `body.high-contrast` — what rule 3 of the stylesheet already demanded. Default
> mode is unchanged and that is measured, not assumed: the probe re-reads the same
> `rgb(184,168,148)` after the change. High-contrast 9.07:1 → **15.31:1**.
> Proved able to fail in `tools/keyhint-contrast-mutation.sh` (5 assertions).
>
> **Corrected at r153 — twice.** This note said the plan had "one unfixed colour
> literal." It had **eleven** outside `:root` and `body.high-contrast`, not 1.
> r153 fixed the one that was named, leaving **ten**:
>
> | kind | count | rule it breaks |
> |---|---|---|
> | translucent black scrims (sheet, boot, focus ring, gradient fade) | 6 | rule 4 — a decorative alpha should be a token so contrast mode can flatten it |
> | wood tones `#352a20`, `#3a2d22` | 2 | rule 3 |
> | `color: #cfc4b4` | 1 | rule 3 |
> | `text-shadow` alpha | 1 | rule 4 |
>
> Each is a look decision with a real backdrop to measure, so they are recorded
> rather than folded silently into a commit about one of them.
>
> **The second correction is the interesting one.** r153's first audit reported
> **13**, and its replacement reported **12** — both inflated by two lines that
> are prose *inside a comment*, quoting measured RGB from an older review frame.
> The filter skipped lines starting with `*` and missed the wrapped
> continuation lines. A comment-stripping parse gives **10**, which is what the
> table above says. The first two numbers were written into this plan and into
> `REVIEW-LOOP.md` before the mistake was caught — see r153's closing note.

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

> **CORRECTED at r152: the `Accept:` line's second half was never true.** "returns
> to the card" shipped and was recorded as done, and no gate in the repo could see
> it. The button opened the sheet; **the 9-second pre-bout deadline ran straight
> through underneath it.** Nothing in `main.ts` referenced sheet state when
> `act()` evaluated `now > pendingAt`, so `beginBout()` ran — `held = false` plus
> `hud.hideResult()` — and `.result { display: none }` took the card away while
> the player was still reading a scrollable list of every move in the game.
>
> **Measured** (`tools/sheet-pause-probe.mjs`, 390x844, load 7.4–9.7), by walking
> the journey rather than reading the code:
>
> | arm | taps TECHNIQUES | waits | card after closing | bout clock |
> |---|---|---|---|---|
> | early | yes | 3.0s | **shown** | 0 |
> | tap | yes | 11.0s | **gone** | running (259) |
> | control | no | 11.0s | **gone** | running (285) |
>
> The `early` arm is what makes that a measurement instead of a constant: the
> card **survives** the sheet when the budget has not expired and does not when it
> has. So the sheet was never what removed the card — the deadline was, and the
> deadline could not see the sheet. A player learning the moves was dropped into a
> **live fight** mid-read, with the sheet still open over it, and closing it landed
> them in a bout they never saw start.
>
> **Fixed at r152.** `heldDeadline()` in `preBoutBudget.ts` pushes the deadline out
> by exactly the time the sheet was up, and the frame loop extends it on every
> frame the sheet is open. The player gets the budget they had at the moment they
> tapped — verified **2/2** after the fix, with the control arm still losing the
> card, so the hold is not swallowing every round.
>
> This is the **fourth** box in three rounds where prose described a contract the
> code did not implement, and the first one where the prose was *actively wrong
> about the behaviour*, not merely stale about a constant.

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

> **CORRECTED at r157 — the count, and then the coach had no plate.**
> r156 made the number reproducible with `tools/css-literals.py` and it stands at
> **ten**, each transcribed into a token rather than deleted. But r157's
> `tools/contrast-reach.py` added the half that count could never show — *can
> `body.high-contrast` actually reach every one of them* — and the tenth one is
> worth naming:
>
> | the site | the finding |
> |---|---|
> | `.coach-strip { background: var(--coach-plate) }` | **`--coach-plate` is declared nowhere.** A `var()` with no definition and no fallback resolves to nothing: measured `rgba(0,0,0,0)`, `background-image: none`. The first-run coach's lesson text sat directly on the tatami with no plate at all. |
>
> That is round 16's `--font-display` bug verbatim — the game's own name, the
> round name and the result headline in the browser default for sixteen rounds —
> and `css-literals.py` cannot see it, because an undefined token has no literal
> to count. It is now declared, and **`tools/undefined-vars.py` is the gate for
> the class** (9/9 in its mutation harness, negative control included). The same
> gate immediately found two more latent no-ops: `--leading-relaxed` on
> `.tech-rules` and `--text-dim` on `.tech-key-item`, both pre-existing, both
> fixed by pointing at a token that already existed and rendered the same.
>
> `tools/pixel-identity.mjs` then verified the claim attached to the conversion —
> *default mode unchanged pixel for pixel* — with two arms and a noise floor. It
> is true for the seven transcription sites and **deliberately false for the
> coach plate**, which is the fix. First run of the pixel arm reported "same" for
> that site because the diff drew an already-cropped screenshot at a negative
> offset and measured nothing; see REVIEW-LOOP.md r157.

### 1.4 The first-run coach was dead for 133 rounds — `CLOSED, r157`
**Found:** r157, by picking up a killed round and walking a journey nobody had
walked. **Not** by a reviewer: no model has reported it in 156 rounds.
**Why it matters:** it is the answer to *there was no onboarding at all*, added
in round 3 and logged as the most productive round in the loop's history. It had
not rendered for a single player since round 23.
**Do:** `retire()` records the "already seen" flag only when the strip was
actually shown.
**Accept:** `tools/coach-probe.mjs` exits 1 while a first run is not taught, and
0 once it is. It has a positive arm (`?mode=dojo`, where the strip does render)
and a returning-player control, because a probe that answers "no strip" about
four different states has learned nothing.

| arm | flag at ready | strip | |
|---|---|---|---|
| first run `/` | true | **NO** | |
| first run `?mode=tournament` | true | **NO** | |
| first run `?mode=dojo` | null | yes, 2 halves | the positive control |
| CONTROL returning `?mode=dojo` | true | no | correct — must stay silent |

Mechanism: r23 added `coach.dismiss()` to `clearBoutUi` to stop the strip
bleeding through the result card; `clearBoutUi` is also called by `startRound`,
which runs at boot. `dismiss()` is `retire()`, and `retire()` writes the flag —
so boot marked the coach seen before it had ever appeared.

The e2e suite runs desktop, where `(hover: none) and (pointer: coarse)` never
matches, so the strip could not have appeared even if it worked. r18's
conclusion — *the first-run state was in every frame the loop ever showed a
model* — was the exact inverse of the truth, and `14-phone-returning` was built
to contrast two states that were identical because neither existed.

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

> **CORRECTED at r160 — this box's `Do:` line describes a tool that no longer
> deploys anything, and its closing sentence was never true of the origin the
> game ships from.**
>
> `tools/deploy.sh` was **retired at r159**. It rsynced to
> `shoemoney@192.168.1.10:/mnt/.../arcade/smkk`, and pointing it at the current
> host would be worse than leaving it: `current/public/` sits behind a symlink an
> atomic flip owns, so an rsync through it leaves a half-written game live under a
> release that still claims to be good, and skips both the SQLite backup and the
> privacy-gate clearance receipt. It now prints the real pipeline and exits 0.
> The path that actually deploys is `~/Projects/SMA-arcade` —
> `ops/build-release.py` + `ops/deploy.py` — which builds **all eight** games and
> ships them behind an atomic flip.
>
> The sentence below claimed `.com` "passes `tools/verify-deploy.sh` with 2 assets
> sha256-matched". It never did. The gate was repointed at `.com` in r159 and
> **first run against it at r160, where it failed**: production is 63 commits
> behind and the served stylesheet still carries two undefined `var()` reads. See
> the box at the top of this document.

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

> **Both of those paragraphs are history.** The script was retired at r159 and its
> mutation harness deleted with it; `verify-deploy-mutation.sh` independently
> proves the surviving gate can still fail.

> **Corrected at r160.** This paragraph read "`arcade.shoemoney.com/karate-kids/`
> now passes `tools/verify-deploy.sh` with 2 assets sha256-matched — the first time
> in the project's history that claim has been true." **It did not, and had never
> been run against that host.** What was true at r149 was the `.ai` host. When
> r160 finally ran the gate against `.com` it returned **rc=1**: served
> `index-DtpNUeIJ.js` against local `index-Bd4cT_Iw.js`, **63 commits behind**.

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
- [x] 1.2 pre-bout card opens the sheet — shipped r136, target size fixed r141 (143x46).
      **The `Accept:` line's "returns to the card" was FALSE until r152**: the 9s
      deadline ran underneath the sheet and dropped the player into a live fight
      mid-read. Measured 2/2, fixed with `heldDeadline()`, verified by
      `tools/sheet-pause-probe.mjs` (exit 1 before, 0 after).
- [x] 1.3 coach labels on the sticks — playtested at r138 and closed, with the reason
- [x] 2.1 and 2.2 raised with a recommendation — a human decides, the loop has done its part
- [x] 3.1 unattended driver in place — `tools/loop-once.sh` on a launchd schedule
- [x] 3.2 deploy verified against production bytes — `tools/verify-deploy.sh`, mutation-proved
- [ ] **3.3 the deploy can be performed** — **STILL BLOCKED at r161**, and the
      block was re-measured rather than inherited: `shoeateka` has gone from 1
      dirty file at r160 to **22**, so the only supported path would publish more
      another agent's work-in-progress than it would have an hour ago.
      `tools/deploy.sh` was retired at r159 and production is **65 commits stale**
      against the origin this game ships from. Blocked on a human: the only
      supported path rebuilds all eight arcade games. See the box at the top of
      this document.
- [ ] **3.3a nothing is obliged to look at production** — **CLOSED at r161.**
      r160 built the gate that reports; nothing ran it. `tools/loop-once.sh` now
      re-measures production every iteration and injects the verdict above the
      plan in the next round's prompt, with `.loop/production-stale` as a
      greppable marker. Proved able to go quiet in
      `tools/loop-freshness-mutation.sh` (12/12). Deliberately still outside
      `pnpm check`, which must stay offline.
- [ ] every phase gated, logged, committed, deployed
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
- [x] **the pre-bout card's read budget** — **FIXED at r151.**
      `schedule(beginBout, ROUND_INTRO_MS, nowMs)` was armed from
      `newRun(performance.now())` at **module eval**, which runs before the first
      `requestAnimationFrame`, so the nine seconds `ROUND_INTRO_MS` documents as
      reading time were being spent on boot. Measured at load 12.2, boot consumed
      **2700 / 4106 / 6250ms** — 30% / 46% / 69% of the player's reading time —
      and at the load that fails the suite it passed 9000ms, at which point the
      card was added to the DOM and removed inside a single frame: never painted,
      no error anywhere, and `result-card-fighters-clear` red 7 of 12. A player on
      that hardware meets a fight with no card, no opponent's tell and no notation
      line — the sentences r117-r122 put there, all spent compiling shaders. The
      budget is now anchored to the first presented frame, the only reading in
      which r119's measurement means anything, with the arithmetic extracted to
      `apps/game/src/preBoutBudget.ts` because a wall-clock deadline cannot be
      unit-tested by waiting for one. 4 mutations, all red.
- [x] **the first-run coach was dead for 133 rounds** — **FIXED at r157.**
      `coach.dismiss()` is `retire()`, which *writes* the "already seen" flag, and
      r23 added it to `clearBoutUi`, which `startRound` calls at boot. So boot
      marked the coach seen before it had ever appeared and `show()` returned
      early on every first run. The onboarding added in r3 — the answer to *there
      was no onboarding at all* — could not render for a tournament player on any
      run, ever. `retire()` now records the flag only `if (shown)`. Gated by
      `tools/coach-probe.mjs` (exit 1 before, 0 after) with a positive arm and a
      returning-player control, plus a unit fence run in both directions.
- [x] **an undefined `var()` is invisible to every gate in the repo** —
      **gated at r157** by `tools/undefined-vars.py`, 9/9 mutation cases with a
      negative control. `--coach-plate` (the coach's plate — the strip had **no
      background at all**), `--leading-relaxed` and `--text-dim` were all
      resolving to nothing. Round 16 found the same class with `--font-display`
      and nothing could see it then either.
- [x] **the first-run coach's plate was two legends stacked on one baseline grid** —
      **FIXED at r158.** `.coach-legend` is a 2-column grid filled row-major from
      the `pairs` array in `coach.ts`, and the two halves sit side by side, so
      the array order **is** the reading order of the plate. The stance half
      shipped `[back, jump, in, crouch]` (`◀▲`/`▶▼`) and the technique half
      `[back, forward, up, down]` (`◀▶`/`▲▼`) — so a player who learned the scan
      on one half mis-scanned the other, "back" appeared **twice on line one**
      with nothing marking which stick owned which, and the 4px difference
      between the inter-half and intra-half gutters was not a boundary. Fixed by
      reordering the stance array to `[back, in, jump, crouch]` (both halves now
      scan sideways-then-vertical) and adding a 1px `--edge-faint` rule between
      them. Gated by `tools/coach-legend-probe.mjs` (exit 1 before, 0 after,
      **6/6** in its mutation harness with both control arms red separately) and
      statically by `coach-legend-order.test.ts`.
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
decision with the measurement attached. **As of r153 every behaviour defect this
document knew about is closed**, including the two r152 left: item 1.2's "returns
to the card", which shipped broken and is now fixed and measured, and item 1.1's
colour literal, which shipped pinned out of high-contrast and is now fixed and
measured.

**r158 added the eleventh box, and it came from a different direction than the
other ten.** Those were a constant or a contract that drifted, or an instrument
reporting a value it never took. This one is: **a state that becomes reachable
is not a state that has been reviewed.** r157 made the first-run coach render
for the first time in 133 rounds; this round regenerated the review set, looked
at the plate, and found its two halves wrapping in different arrow orders — a
disagreement that had been in `coach.ts` since r3 and that four rounds had
already reported in four different words, none of them about the geometry.

Which is the honest summary of item 1.4: **fixing the onboarding did not mean
anyone had looked at it.** The review set is this loop's instrument, and it had
been pointed at the coach for twenty rounds while describing a plate it could
not see. An instrument extended to cover a new state is not extended until
someone has read what comes out of it.

What remains in 1.1 was corrected this round: the `Do:` line now describes what
actually shipped (the glyphs sit under the stick captions in the pad footer, and
they cannot be beside the coach legend — the two media queries are mutually
exclusive). The scoreboard's round and commit counts are current.

Two things are **recorded, not fixed**, and neither is a defect in the game:

- the remaining 10 colour literals outside `:root` / `body.high-contrast`
  (six translucent scrims, two wood tones, one `color`, one text-shadow alpha),
  counted and classified above. Each is a look decision with a real backdrop to
  measure, and they do not belong in a commit about the one that was named.
- r152's warning still stands as the standing instruction for anyone who reads
  this next: re-read the closed boxes against the code on suspicion, not on the
  hypothesis that they are now correct. r153 found the fifth drift — a **count**
  in prose, thirteen against one — and it was in the *open* item's description,
  not a closed contract. The suspicion applies to every number in this document.

**But read that as a claim to re-check, not a fact.** r149's own lesson was that
this document recorded a conclusion where a blocker had been, and r150 audited
the *closed* boxes on exactly that suspicion: two of them did not survive. The
provenance gate and the sheet's pip colours were both documented contracts the
code did not implement. **r151 found the third, and it is the same class again:**
`ROUND_INTRO_MS`'s documented nine seconds of reading time were being spent on
boot. So the pattern across three rounds is not that this document lies, it is
that **a constant or contract in prose drifts from the code that implements it**,
and the drift is invisible to every gate until something is measured against a
clock. Re-read the closed boxes against the code on that suspicion, not on the
hypothesis that they are now correct.

**r152 found the fourth, and it is the sharpest of the four.** Item 1.2's
`Accept:` line said "returns to the card" and the card **did not return** — the
deadline ran underneath the sheet and started a live fight underneath the player.
The first three were a contract the code failed to keep or a constant that meant
something else; this one is a sentence describing a *player journey* that had
never once been walked. Nothing in the repo could see it, because **the button
worked perfectly** — it opened the sheet, on the first tap, every time. The
defect was entirely in what happened next.

That generalises the pattern past constants and into **flows**: *a journey nobody
walks cannot be wrong, and it will be recorded as working.* The three preceding
drifts were all found by reading the code against a sentence. This one was found
by performing the sentence and watching what the game did — `tap`, `wait`,
`close`, `look`. Where a claim describes what a player does in sequence, the gate
that can settle it is a probe that does the sequence, and it needs a **positive
control** (the `early` arm) or it would have been a constant-false instrument
agreeing with itself.

**r154 found the seventh drift, and it is not in the game at all — it is in the
instruments this loop measures itself with.** Two of them had been reporting
values they never took, for nine rounds:

- **`tools/renderer-bench.mjs` read `load 0` on every row of every sweep.** A
  brace-strip parse left a leading space, `split(/\s+/)` took `""`, and
  `Number("")` is `0` — which is a number, so the `catch → null` safety net never
  fired and nothing looked broken. `0` reads as *an idle machine*, not *no
  reading*. So the one column r145 added after three rounds of comparing frame
  times taken under different contention was **disarmed and still drawn on the
  page**, and r151's standing instruction to print the load beside every result
  was satisfied by a constant. Fixed: `tools/host-load.mjs`, where an unreadable
  reading is `null` and stays `null`.
- **`renderer-sweep.mjs` and `throttle-cliff.mjs` restored the source and never
  the build.** r153 had already found this in
  `keyhint-contrast-mutation.sh` and fixed that one instance; these two carried
  it too, so what was left in `dist` after either was a build of its **last
  mutated config**. Reproduced on the real tool, and not on the tidy path — the
  run crashed (the bench's browser died mid-sweep), the `process.on('exit')`
  handler restored source over a mutated build, and `git status` was clean
  throughout:  before `dist cfa75442` → crash `dist f0b0a8ed` → rebuild
  `dist cfa75442`. Since `verify-deploy.sh` compares **dist** against the wire,
  that makes the next round read *"production is stale"* about a production that
  is correct — and redeploying pushes whichever mutation happened to be last.
  A gate that manufactures the failure it exists to detect, twice over.

The generalisable form, which is the sixth time this loop has hit it: **an
instrument that reports a plausible value it never measured is worse than one
that reports nothing**, because nothing is at least visibly nothing. Both fixes
are in `tools/`, so no game code and no bundle changed; production was already
byte-identical and stayed that way, re-verified.

**r155 found the eighth, and it was the instrument guarding standing rule 1.**
`tools/verify_shots.py` — the gate that decides whether a review set is worth
reviewing — computed "motion" as the mean luma delta over `sorted(glob())`
across the whole set. But every shot is a cold page load in its own browser
context, so **no two frames share a page and filename adjacency is not time**.
Fed eight real frames from this game's own output, every one a static menu and
none of them gameplay, it returned `motion 12.08` and **exit 0** — 4.6× its own
threshold, on a set where the game never runs in any frame. Its largest
contributors were a settings menu (32.32) and a bracket; the real gameplay pair
`fight -> strike` scored **0.67**.

Measured both arms of the fix off pixels, three runs: a **played** burst reads
**12.6%** mean per-pixel change with 6 of 8 distinct fighter positions, an
**unplayed** one reads **0.59%** with 1. A factor of 21. The harness also runs the
old algorithm verbatim on shaped data and gets a passing `motion 6.79` — the
defect reproduced, not merely its absence.

**The constant was never wrong.** `2.6` computed over a burst would have worked.
It was the right question asked about the wrong frames, which is the same shape
as the six before it and the reason this round audited instruments rather than
game code.

One more thing r151 established about this box, because it changes how every gate
here should be read: **it does not idle.** Load ~10-13 from other work at rest,
which is why the e2e suite is red at 14-16 and green at 8-10 on identical code.
A red e2e result on this machine is not a verdict until the load is printed next
to it, and `tools/card-no-probe.mjs` prints it on every row for that reason.
Everything in Phases 1 and 3 is closed, Phase 2 is blocked on a human by design
with the measurement attached to each item, and the scoreboard's half point is
measured rather than argued about.

> **Corrected at r160.** This paragraph ended "Production is serving the build
> this tree produces, and there is a command that both puts it there and proves
> it did." **Both halves were false.** Production was 63 commits stale, and the
> proving half existed only as a script no round was obliged to run — which is
> the whole of this round.

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
pre-existing **404** on the leaderboard API. It fails soft by design
(`leaderboard.ts` — "no board this run, never an error on screen") and fires no
page error. Wiring a game id into the arcade API is a different change from
anything in this document and belongs to whoever owns that contract.

> **Corrected at r156: the verb was wrong.** This said
> `GET /api/games/karate-kids/runs`. The code **POSTs** it —
> `leaderboard.ts:44` calls `post('runs', {})`, and `post()` is the only path
> that sets a method. So for every round this document was describing a
> request the game never makes.
>
> Measured, both environments, so the number is not inferred:
>
> | request | local (dev) | production |
> |---|---|---|
> | `POST /api/games/karate-kids/runs` | **502** | **404** |
> | `GET /api/games/karate-kids/scores` | — | **404** |
>
> The 502 is **not** a new defect and is not in any review frame: it is Vite's
> `/api` proxy pointing at `127.0.0.1:3784` (`vite.config.ts:5`), where the
> arcade API is not running on this machine. It fires only on `/` and
> `?mode=tournament` — the two routes that render the board — and never on
> `?mode=dojo`, which is why it shows up in three captures and looks like a
> game bug. **Nothing is listening on 3784.** Production is the honest number:
> 404 on all three endpoints, i.e. the whole leaderboard is absent, not merely
> its run token.
>
> The drift is small and harmless in itself — the endpoint is missing either
> way, and the failure is soft either way. It is recorded because the shape is
> the ninth instance of the pattern this document keeps hitting: a claim about
> the wire that the code contradicts, invisible to every gate here.