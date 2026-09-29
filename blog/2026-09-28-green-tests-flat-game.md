# Green tests, flat game

*SM Karate Kids: Asmongold vs HasanAbi. Build log, 2026-09-27 → 2026-09-28.*

In about nineteen hours this went from an empty repo to a live arcade game. The shipping isn't
the interesting part. The interesting part is the three times the plan was wrong and a number
said so, and the one time the numbers were all fine and the game still wasn't.

## 1. CI was red on a green tree, and CI was right

The first slice went up at 18:28 on the 27th. Every test passed locally, and the browser bout
test failed on CI again and again. The easy story was "flaky runner", so the first fix made the
test more forgiving: pick whatever technique suited the current gap instead of walking to one
exact distance. It went green, and it was the wrong conclusion.

The trace showed a 30-second bout still going after three and a half minutes. `FixedClock` would
drain at most **5 ticks per frame**, but it accepted frame deltas up to **250 ms, which is 15
ticks**. Those two numbers disagree. Any device below about 12 fps fell behind real time and kept
falling. It didn't drop frames. It went into **slow motion**, about 4× slow on a
software-rendered runner. A phone that stutters would have played the same way. The runner was
reporting a real defect in the game. The fix raised the cap to 15 so it covers the clamp. The
test that would have caught it: a 10 fps and a 4 fps renderer must each buy one full second of
simulation per second of wall time.

Pulling that thread turned up the second bug. Input was sampled once per tick, but ticks drain in
bursts at frame boundaries. So **a flick of the stick that started and ended between two frames
never happened**. It bit hardest on a struggling device, which is exactly when a swallowed input
is least forgivable. A small `PressLatch` now holds an unconsumed press for exactly one read.

The third problem was in the test itself. The touch controller read state about **125 ticks
apart** over a loaded runner (roughly two seconds of game time per round trip). The fighter walks
about 3 m/s, so each read-act cycle carried it ~1.5 m, farther than the whole strike band is
wide. It oscillated past the window and shoved the training partner into the wall. It never once
landed in range. No amount of retrying fixes a control loop whose latency exceeds the thing it
controls. The fix was to release the stick before reading, tap strikes instead of holding them,
and add a drill mode that opens at a chosen spacing. That mode is a training feature first. It
also happens to delete the part latency made untestable.

**Wrong turn kept in:** the first "fix" (c318ee1) made the test tolerant of a bug instead of
finding it. It passed for the wrong reason.

## 2. The atlas: floating fighters and a compression win that looked like a loss

The art sheets came in and got packed into a WebP atlas. Two surprises:

- **Whole rows floated off the mat, up to 86 px** on the crouching sweep. The segmenter measured
  each row from where the figure started, not from where the cell did. A per-pose median shift
  then preserved the sheet's frame-to-frame drift as if it were motion. The fix: every frame
  anchors its own lowest pixel to the floor, and the simulation owns real jump height. Across
  254 frames, the worst offset went **from 86 px to 1 px**.
- Recompressing (WebP method 6, quality 62, checked side by side against 82 at phone scale) first
  looked like it **barely helped**. It had helped. The measurement was counting orphans: a
  rebuild that needed fewer pages left the old page files behind, still in the bundle and still
  carrying provenance entries, so nothing flagged them. Once stale pages were pruned it was
  **3.29 MB → 2.14 MB, ten pages to six**.

Also found: some move sheets came out up to ~9% darker than idle, so Asmongold dimmed every
time he threw a reverse punch. The atlas now matches exposure to the idle pose: reverse punch
went from 205 to 222 against idle's 220.

The provenance file shipped to the live site with tool names and local filesystem paths in it.
It was caught after the deploy, not before. It now names the owner and nothing else.

## 3. The turn: every check passed and it wasn't fun

By the evening of the 27th: 90-odd unit tests, a dozen browser tests, a cross-renderer
checksum proving WebGPU and WebGL 2 produce byte-identical fights, content validators, a
balance-report harness, CI, CodeQL. And the fighters were boxes. After a first round of feedback
("those karate people look very square") they were rounded boxes.

The honest diagnosis: the spec was a long engineering-and-compliance document, and "done" had
been defined as things a shell command can check. *Is it fun* can't be a shell command, so it got
optimized away. Hours went into harnesses while nobody owned the feel.

So the order flipped. First came a one-page feel brief (`docs/feel.md`): what a hit feels like,
what the win moment looks like, why you'd play again. The rule: **a change is done when a bout on
a phone makes you want another one, not when the tests pass.** Then the juice pass got built
against it:

- **~95 ms hit-stop on an ippon** and ~65 ms on a waza-ari, frozen on the full-extension
  frame. It's implemented by asking the clock for *less time*, so every tick that runs is
  the tick it would have been. The cross-renderer checksum still passes, so determinism survived
  the juice.
- Sparks along the strike line, dust on sweeps, defender flash, camera punch-in, haptics,
  synthesized whoosh, crack and thump (still no audio files), and an IPPON stamp that slams,
  overshoots and settles. Slow-mo on match point.
- **The strikes visibly reach now.** Measured over all 18 strikes, the art reaches a median
  **0.50** of the simulation's distances, so a kick that scored stopped a metre short on screen.
  The rules stayed put. The gap between fighters is *drawn* at that ratio. It's presentation
  only.

The rigor stayed. It just stopped being the definition of done.

## 4. "Harder every round" was a claim until it was measured

Progression was the next thing missing: a tournament where the opponent actually improves. It's
five rounds, each a fighting style at a higher difficulty, and a loss ends the run.

The first ordering had a **dip**. The counter-puncher style is the weakest at low difficulty, so
a counter-puncher quarter-final was *easier* than the regional before it. It looked obviously
right on paper. A fixed reference fighter's win rate, averaged over three styles, caught it.
Reordered, the ladder reads **89% → 55% → 29% → 21% → 16%**. A test now holds it strictly
monotonic. It was mutation-tested: swap any two rounds and it fails.

## 5. The leaderboard name box that couldn't type "s"

It shipped with an arcade leaderboard, and the first real submission found the bug. The keyboard
controls listen to the whole page and swallow W A S D, I J K L and the arrows. They never
checked whether a text field had focus. **"Swag Kid wasd ijkl" came out as "g   !".** Fixed, and
a test now types every game key into a field.

Then CI found its second face. On a slow runner a bout ended *mid-typing*, the result card
focused its own button, and every key after that went to the button. Cards no longer steal
focus from a text field.

## Numbers

- 99 unit tests, 28 browser tests, CI green at `f8f8760`
- Atlas 3.29 MB → ~2.3 MB after the regenerated sheets (6 WebP pages); floor error 86 px → 1 px
- Tournament win-rate ladder 89 / 55 / 29 / 21 / 16 %
- Live at [arcade.shoemoney.com/karate-kids](https://arcade.shoemoney.com/karate-kids/). The
  board is empty. Go be first.
