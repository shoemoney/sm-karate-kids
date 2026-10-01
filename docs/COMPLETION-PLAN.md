# SM Karate Kids — completion plan

Written at round 134, after a hundred and thirty-four rounds of review. This is
the plan for *finishing*, as distinct from the loop that has been improving.

## Where the project actually stands

| | |
|---|---|
| Playable | yes — tournament + dojo, two sticks, point karate |
| Deployed | `https://arcade.shoemoney.ai/smkk/`, verified playing a real bout |
| Tests | 142 unit, 35 e2e, 5 skipped, green |
| Review loop | 130+ models, 22 review frames, mutation-tested fences |
| Commits | 245 |

The game is not a prototype. What remains is a short list of specific, named
gaps — every one of them is in this document, and nothing else is.

---

## Phase 1 — Close the gaps the loop has already found

### 1.1 Desktop keyboard legend �� `P1`
**Found:** r96, r98, r102, r132. Four reviewers, four rounds, never fixed.
**Why it matters:** the game supports WASD for stance and arrows/IJKL for
technique (`input/keyboard.ts`), and **nothing on screen says so.** A desktop
player — the audience for a twin-stick twin-stick fighter — is told nothing about
how to play and has to guess that a keyboard is even wired up.
**Do:** render the key glyphs beside the coach's direction labels, on wide
viewports only. Touch layout untouched.
**Accept:** the keys appear on desktop and are absent on a 390px phone.

### 1.2 Pre-fight card opens the sheet it points at — `P1`
**Found:** r125, r130. Round 118 put the notation on the card; the card says
"the sheet lists every combination" and **offers no way to get there.**
**Why it matters:** a dangling reference on the one screen every player reads.
**Do:** add a reference button to the pre-bout card beside FIGHT.
**Accept:** pressing it opens the techniques sheet and returns to the card.

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
**Blocked on:** someone who can look at the art and decide. Not on engineering.

### 2.2 The ceiling is the flattest region in the frame — `P3, needs a human`
**Measured** (r85, r106): the band above the shoji is mean luminance 42–48 with
a standard deviation of 8–19, against 47.6 on the mat. Two tint attempts both made
it **flatter** (sd 18.9 → 7.3), which proves the tint is not the lever — the
source art is low-contrast and no global multiply can fix it.
**Candidates:** different source art; per-pixel treatment of the eave.
**Blocked on:** the same decision.

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

- [ ] 1.1 keyboard legend on desktop
- [ ] 1.2 pre-bout card opens the sheet
- [ ] 1.3 coach labels on the sticks (playtested)
- [ ] 2.1 and 2.2 raised with a recommendation — a human decides, the loop has done its part
- [ ] 3.1 unattended driver in place, or a documented decision not to
- [ ] every phase gated, logged, committed, deployed

**Not "done" means:** every item above is either finished or blocked on a human
decision with the measurement attached.