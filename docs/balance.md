# ⚔️ Balance Report

Measured, not guessed. This document reports what `tools/balance-report.ts` actually found when
it threw the three CPU archetypes at each other, 300 bouts per pairing, on the real 20-technique
content table in `packages/content/data/moves.json` and the current `packages/sim/src/cpu.ts` /
`packages/sim/src/match.ts`. This is the second pass — see "What changed since the first pass"
below for exactly what moved and why. Nothing in the move table itself has been touched in either
pass; this measures and documents, it does not tune content.

**Headline: dramatically healthier, and two real weak spots remain.** All three of the first
pass's findings are resolved or downgraded — mirror matchups fight now, 18 of 20 techniques land,
and cross-archetype matchups are far less lopsided. But `pressure-vs-pressure` still times out
almost half the time, and `counter-vs-counter` is scored almost entirely in full points, both well
outside the range every other pairing sits in. Neither is "fixed," and this document says so
plainly rather than treating the overall improvement as the end of the story.

## 🔬 How to re-run it

```bash
pnpm tsx tools/balance-report.ts                    # 300 matches/pairing, seed 1 (defaults)
pnpm tsx tools/balance-report.ts --matches 1000 --seed 42
```

It runs every unordered pairing of `ARCHETYPES` (`sensei`, `pressure`, `counter` — six pairings,
including each archetype against itself), prints a per-pairing and overall report to stdout, and
writes the same data as JSON to `docs/balance-data.json`. Everything is driven off `Rng` instances
seeded via a deterministic integer mix (`deriveSeed`) — no `Math.random` anywhere — so the same
`--seed` reproduces byte-identical JSON on every run; verified again for this pass by diffing two
consecutive runs of the default invocation.

The guard rails in `packages/content/tests/balance.test.ts` rerun the identical seeded batch
(seed 1, 300 matches/pairing) as part of `pnpm vitest run`, so a future content or CPU-tuning
change that breaks these numbers fails the suite instead of silently shipping.

## 🔧 What changed since the first pass

Three fixes landed in `packages/sim/src` between the two measurement passes. None of them touched
move data.

1. **`CpuController`'s spacing dead zone is closed** (`packages/sim/src/cpu.ts`). The old code had
   two thresholds — `gap > spacing + 0.2` to approach, `gap <= spacing` to roll an attack — that
   didn't meet, leaving a 0.2m band where a fighter did nothing at all: not far enough to keep
   closing, not close enough to swing. Every identical-archetype mirror matchup landed in that band
   deterministically and froze for the rest of the clock. The fix collapses it to one `pocket =
   spacing + 0.2` band: outside it, approach; inside it, the attack roll is live, and the back-off
   check only runs after the roll.
2. **The opener table went from 6 techniques to all 20** (`packages/sim/src/cpu.ts`). `OPENERS` (6
   ground-only, high/low-neutral-biased entries) is now `GROUND_OPENERS` (14 pairs) plus a new
   `AIR_OPENERS` (4 pairs), reached via a new `jumpChance` that sometimes opens a commitment with a
   jump. A new `blockChance` also lets the controller answer a telegraphed strike with a block
   instead of always trading blows.
3. **`scoreFor`'s counter rule narrowed** (`packages/sim/src/match.ts`). A counter used to be
   "defender is anywhere in startup, active, or recovery" — in practice that meant landing on
   someone who was already mid-swing or on their way out of one, not just beating them to the
   punch. It's now `defender.phase === 'startup'` only. This is why full/half and counter shares
   below look completely different from the first pass: roughly 4 in 5 calls used to auto-upgrade
   to a full point; now a counter specifically means "hit them before they finished winding up,"
   and a clean hit on a spent attacker scores at the landing move's own base value.

## 📊 The numbers (seed 1, 300 matches/pairing, 1,800 bouts total)

| Pairing | P0 win | P1 win | Draw | Timeout | Mean ticks to win | Calls | Full / Half | Counters | Mean contact dist. |
|---|---|---|---|---|---|---|---|---|---|
| sensei vs sensei | 52.3% | 47.7% | 0.0% | 1.0% | 885 | 945 | 73.9% / 26.1% | 63.8% | 1.49m |
| sensei vs pressure | 37.7% | 60.7% | 1.7% | 4.0% | 862 | 981 | 70.4% / 29.6% | 67.8% | 1.31m |
| sensei vs counter | 67.7% | 31.3% | 1.0% | 2.0% | 975 | 923 | 74.9% / 25.1% | 59.5% | 1.58m |
| pressure vs pressure | 40.7% | 43.0% | **16.3%** | **45.7%** | 996 | 697 | 64.8% / 35.1% | 62.7% | 1.24m |
| pressure vs counter | 77.3% | 22.0% | 0.7% | 2.0% | 825 | 989 | 63.1% / 36.9% | 48.6% | 1.51m |
| counter vs counter | 44.7% | 47.3% | 8.0% | 23.3% | 1,234 | 731 | **89.1%** / 10.9% | 64.2% | 1.65m |
| **Overall** | — | — | 4.6% | 13.0% | 949 | 5,266 | 72.3% / 27.7% | 60.8% | 1.46m |

Raw data: `docs/balance-data.json`. Compare against the first pass: overall draw was 50.6% (now
4.6%), overall timeout was 51.6% (now 13.0%), and every mirror pairing was exactly 100%/100%/0-calls
before this pass's fixes.

## ✅ What's now healthy

- **Mirror matchups fight.** `sensei-sensei` is close to an even split with essentially no
  timeouts (1.0%) — the CPU-controller fix worked cleanly for that archetype.
- **18 of 20 techniques land** (up from 5 of 20). The only two that never score are **High Block**
  and **Low Block** — and that's not a bug: `connects()` in `match.ts` only ever credits a hit to
  an attacker whose active move has `kind: 'strike'`, so a block can structurally never register as
  a scoring call. 2 dead techniques is the floor, not a gap to close.
- **Stepping Lunge Punch lands now** (13 calls, 0.25% of all calls) — the first pass's open
  question about whether it was a genuinely bad technique or a victim of the CPU's old approach math
  is answered: it was the latter. It's still the second-rarest technique, tied with Jumping Front
  Kick, which may be worth a closer look in a future tuning pass, but it is no longer unreachable.
- **No cross-archetype pairing is close to a wipeout.** Even the widest cross-archetype spread —
  pressure vs counter at 77.3%/22.0% — is lopsided but real: a working dominance hierarchy, not a
  coin that never lands on one side.
- **Cross-archetype timeouts are rare**: 2.0-4.0% across all three cross pairings, down from
  0-9.3% before (the upper end specifically improved).
- **Technique usage is genuinely spread out** now that the opener table covers all 20: the top
  technique (Crouching Punch) accounts for 17.7% of all calls, versus 29.6% for the top technique
  (Lunge Punch) in the first pass, even though the first pass only had 6 techniques to draw from at
  all.

## ⚠️ What's still genuinely bad

**`pressure-vs-pressure` times out 45.7% of the time** — nearly every other bout fails to reach 2
points before the 30-second clock runs out, and 16.3% of all bouts are outright draws. That's an
order of magnitude worse than any cross-archetype pairing (worst there: 4.0%) and meaningfully
worse than the other two mirror pairings. Pressure's own numbers (`spacing: 1.45`, `patience: 14`,
the tightest and most trigger-happy of the three archetypes) mean two pressure fighters are
constantly stepping on each other's spacing without a natural equilibrium the way sensei's wider
spacing or counter's patience provides — the fight measurably fights, but resolves less often than
it should. This is exactly the kind of thing the `pressure-pressure` guard rail in
`balance.test.ts` now watches for a further slide on.

**`counter-vs-counter` scores 89.1% full points** — half points are nearly extinct in that specific
matchup, which works against the PRD's explicit half/full point design. The mechanism is
straightforward: two counter archetypes (`aggression: 0.02`, `patience: 34`, `blockChance: 0.45`)
mostly wait each other out and land startup counters when the other finally commits — and a counter
is *always* scored `full` under the current `scoreFor` rule (`match.ts`), regardless of the landing
move's own base value. The archetype design and the scoring rule are individually reasonable; their
interaction in this one matchup produces a genuinely unbalanced call distribution. Locked with a
ceiling in `balance.test.ts` so it can't quietly get any more extreme without notice.

Neither of these is presented as fixed. Both are named, measured, and guarded — see the thresholds
table below.

## 🥋 Are the archetypes still distinguishable?

**Yes — but the dominance hierarchy flipped.** Re-measured directly against `CpuController`
(`packages/sim/tests/cpu.test.ts`) holding a fixed in-range gap for 5,000 ticks: commit counts were
**pressure 158 > sensei 82 > counter 57**, the same ordering as before and consistent with their
`aggression`/`patience` values — the archetypes are still clearly distinguishable at the controller
level.

But the fight outcomes flipped: **pressure now beats both sensei (60.7/37.7) and counter
(77.3/22.0), and sensei beats counter (67.7/31.3)** — a clean pressure > sensei > counter hierarchy.
Before this pass, counter was dominant (beating both other archetypes convincingly) and pressure was
the weakest. That makes sense given the `scoreFor` narrowing: counter's whole design leans on
patience and a high `blockChance` (0.45) to land counters, but a counter now only pays off in the
narrow startup window instead of anywhere across the opponent's startup/active/recovery, so
counter's main edge shrank considerably. Pressure's aggression (and its access to jumps) became
comparatively more valuable once trading blows stopped being an automatic full-point gift to
whoever was more patient. This is a real, coherent shift, not noise — but it's worth knowing the
hierarchy is now the mirror image of the first pass's, since anyone who internalized "counter is the
strong one" from that report needs to update that belief.

## 🧪 What the test suite locks in

`packages/sim/tests/cpu.test.ts` — behavioural unit tests on `CpuController` against a hand-built,
now-complete 20-move content bundle (no dependency on `@smkk/content`):

- same seed + same match state ⇒ identical stick output, every tick
- the right stick always passes back through neutral before firing again (no machine-gunning)
- closes distance when out of range, backs off when too close, per its own archetype's `spacing`
- pressure commits more than sensei, sensei more than counter, over a long run
- emits nothing but neutral outside the `fight` phase

`packages/content/tests/match.test.ts` — the counter-hit contract, updated for the narrowed rule:

- a hit on a defender still in `startup` upgrades to a full call (unchanged: still the one phase
  that counts)
- **new**: a hit on a defender already in `recovery` — proven via an explicit crouch-then-attack
  sequence, with a sanity assertion that the defender really is in `recovery` at the moment of
  contact — is a clean hit at the base value, not a counter. Before this pass's `scoreFor` change,
  this exact scenario would have scored `counter: true, value: 'full'`.

`packages/content/tests/balance.test.ts` — guard rails on the real content table and CPU tuning,
all thresholds re-derived against the numbers above (nothing carried forward from the first pass):

| Guard | Threshold | Measured value it guards | Headroom |
|---|---|---|---|
| No technique dominates all calls | ≤ 30% of all scoring calls | Crouching Punch, 17.7% (933/5,266) | ~12 points |
| Never-landing techniques don't grow | ≤ 2 of 20 | 2 of 20 (both blocks — structural floor) | none — a ceiling at the floor |
| No cross-archetype wipeout (per pairing) | underdog ≥ 10%, favourite ≤ 90% | underdog min 22.0%, favourite max 77.3% | ~12-20 points |
| Cross-archetype bouts resolve in time | timeout ≤ 15% | worst case 4.0% (sensei vs pressure) | ~11 points |
| Mirror pairings fight at all | calls > 0, timeout < 90% (per pairing) | worst case 45.7% timeout (pressure-pressure) | change-detector for the old 100% freeze |
| **Weak spot, locked**: pressure-mirror timeout | ≤ 60% | 45.7% | ~14 points |
| **Weak spot, locked**: counter-mirror timeout | ≤ 40% | 23.3% | ~17 points |
| **Weak spot, locked**: counter-mirror full share | ≤ 97% | 89.1% | ~8 points |

The three "weak spot, locked" rows are deliberately tight — they exist to catch these two known
problems getting *worse*, not to imply they're fine as measured. See the section above.

## 🔩 Engineering note: a wall-bounds bug this pass exposed (not fixed here)

Running the existing `packages/content/tests/soak.test.ts` after these fixes landed turns up a new
failure at seed 9: a fighter ends up at `x = 5.002` against a `bounds = 5` arena, tripping the
soak test's bounds check. Traced to `clampToArena` in `match.ts`: it clamps both fighters to
`[-bounds, bounds]` first, then pushes them apart if they're closer than `minGap` — and that push
is applied *after* the clamp, with no re-clamp afterward. A fighter already pinned at the wall gets
pushed straight through it by the anti-overlap logic. This almost certainly wasn't reachable before
this pass: mirror matchups used to freeze in place rather than fight all the way to a wall, and
`match.ts`/`match.test.ts`/`soak.test.ts` are outside this pass's edit scope, so it's reported here
and to the coordinator directly rather than patched.

## 🔧 What I'd change next (not done in this pass — measurement only)

1. **Give `pressure` a bit more room or a bit more patience.** Its own spacing/patience combination
   is the reason two pressure fighters clash without settling into a resolvable fight as reliably as
   the other archetypes. This is an archetype-tuning question, not a content question.
2. **Reconsider whether a counter should always be a flat `full`**, or whether it should still
   respect the landing move's own value with some smaller bonus. The current rule is exactly what
   makes counter-vs-counter's call distribution so lopsided — two archetypes that are *good* at
   getting counters end up with almost no half points at all.
3. **Fix `clampToArena`'s clamp-then-push ordering** (see above) — either re-clamp after the
   anti-overlap push, or compute the push before the bounds clamp so the final position is never
   checked against only one of the two constraints.
4. Once (1)-(3) land, re-run this harness and rewrite this document again against the new
   measurement — don't patch it.
