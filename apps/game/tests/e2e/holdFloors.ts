/**
 * The floors a recorded round-card hold has to clear before the clock-freeze
 * claims in `tournament.spec.ts` count as evidence.
 *
 * This is extracted, and unit-tested, because the first version of these floors
 * was a bare sample COUNT and it failed on CI repeatedly for a reason that was
 * only visible once the numbers were laid out:
 *
 *   a starved main thread and a broken recorder produce the same signal.
 *
 * `setInterval` cannot fire on a blocked main thread, so a slow runner yields
 * fewer samples over a window that is just as long. A count floor cannot tell
 * those two apart, so on a 2-core GitHub runner it read "this runner is two
 * cores" as "this recorder proved nothing" and failed at 9 samples. Its own
 * failure message named the wrong culprit, which is what made it expensive to
 * diagnose.
 *
 * The replacement asserts COVERAGE — the recorder's own timestamps must span
 * the hold — which is rate-independent by construction, and is strictly harder
 * to satisfy than a count, because many samples crammed into the last moment of
 * a window no longer pass.
 *
 * Kept dependency-free and pure so the discrimination can be proven against
 * real numbers in `tests/unit/hold-floor-discriminates.test.ts` instead of
 * being taken on trust.
 */

/** `ROUND_INTRO_MS` in `apps/game/src/main.ts`. Pinned deliberately: if the
 *  budget moves again, `MIN_HOLD_MS` below goes red and says so, rather than
 *  the floors quietly becoming numbers related to nothing. */
export const ROUND_INTRO_MS = 9_000;

/**
 * The hold must last at least this long, as *the recorder saw it*.
 *
 * This is NOT compared against ROUND_INTRO_MS, and the reason is the correction
 * this file exists to record. The card's hold is a wall-clock deadline
 * (`pendingAt = performance.now() + 9000`, fired against the rAF timestamp), so
 * a slow runner does not shorten it. What a slow runner *does* shorten is the
 * window the recorder manages to observe: a starved `setInterval` fires its
 * first sample some hundreds of ms after the card appears and its last sample
 * some hundreds of ms before the poll that notices the card left. CI measured
 * 6391 / 6799 / 6819 / 7350ms for a 9000ms card, and the ~2.6s difference is
 * almost exactly the lag at both ends.
 *
 * So the recorded span is a *lower bound* on the hold, and pairing it with the
 * nominal budget is comparing two different quantities. An earlier version of
 * this file did exactly that with an 8000ms floor and failed on CI four times
 * while the card was behaving exactly as designed.
 *
 * 5000ms is therefore empirical, and honestly so: it sits ~28% under the worst
 * legitimate observation (6391ms, CI, both viewports, two commits) and still
 * rejects a card that came and went in under five seconds, which is a real
 * defect rather than a slow machine.
 *
 * There is deliberately no upper bound. A starved thread delays a deadline, it
 * never advances one, so a long observed hold is always legitimate.
 */
export const MIN_HOLD_MS = 5_000;

/** The only thing a raw count can still honestly assert: the recorder ran
 *  repeatedly rather than once, or not at all. It asserts nothing about rate. */
export const MIN_SAMPLES = 3;

/**
 * The coverage criterion: no single gap between consecutive samples may exceed
 * this fraction of the hold.
 *
 * A first-to-last span check was the first attempt and it was wrong — three
 * samples at t=0, t=30 and t=9000 span the whole window while observing nothing
 * in between, so endpoint sampling satisfies a span check completely. The
 * largest gap is the criterion that cannot be fooled that way, and it is still
 * rate-independent: a starved timer produces evenly wide gaps, not one huge one
 * followed by dense ones.
 *
 * 0.5 separates the two populations cleanly. Sparse-but-honest recordings of 4
 * evenly spread samples leave gaps of a third of the window and pass; anything
 * that stopped observing, or observed only at the end, leaves a gap of ~99% and
 * fails. The CI runner that produced 9 samples across 9s left gaps of 12.5%.
 */
export const MAX_SAMPLE_GAP_RATIO = 0.5;

export type HoldSample = { t: number };
export type HoldWindow = { samples: HoldSample[]; openedAt: number; closedAt: number };

export type FloorVerdict = { ok: true } | { ok: false; because: string };

/**
 * Decides whether a recorded hold is solid enough to carry the per-sample
 * claims the e2e test then makes about it.
 *
 * Every rejection names the defect in words, because a floor that fires without
 * saying what was wrong with the recording costs more than it catches.
 */
export const evaluateHoldFloors = (hold: HoldWindow): FloorVerdict => {
  const spanMs = Math.round(hold.closedAt - hold.openedAt);

  if (hold.samples.length < MIN_SAMPLES) {
    return {
      ok: false,
      because:
        `the recorder sampled the hold only ${hold.samples.length} time(s), so the ` +
        'per-sample claims below are about a moment rather than a window',
    };
  }

  if (spanMs < MIN_HOLD_MS) {
    return {
      ok: false,
      because:
        `the recorder observed only ${spanMs}ms of the hold, under the ${MIN_HOLD_MS}ms floor. Note that ` +
        'this is a lower bound on the card\'s real lifetime, not the card\'s lifetime: a starved ' +
        'sampler loses time at both ends, so a slow runner reads short here even when the card is ' +
        'holding for exactly as long as it should. If this fires on a fast machine the hold really ' +
        'is too short.',
    };
  }

  // The coverage check: the recorder has to have been awake THROUGHOUT, not just
  // at the edges. Measured as the widest stretch of the hold with no sample in
  // it, which includes the head before the first sample and the tail after the
  // last one.
  //
  // Both of those ends are load-bearing, and each was caught by a failing test
  // rather than by reading the code. A first-to-last span check is satisfied by
  // samples at t=0 and t=9000 that observed nothing in between. A consecutive-gap
  // check alone is satisfied by sixty samples crammed into the last 50ms, which
  // contain no internal gap at all to measure. Only the head and the tail close
  // those two holes.
  const allowedGapMs = Math.round(spanMs * MAX_SAMPLE_GAP_RATIO);
  const gaps: Array<{ ms: number; at: number }> = [
    { ms: Math.round(hold.samples[0]!.t - hold.openedAt), at: hold.openedAt },
  ];
  for (let i = 1; i < hold.samples.length; i += 1) {
    gaps.push({
      ms: Math.round(hold.samples[i]!.t - hold.samples[i - 1]!.t),
      at: hold.samples[i - 1]!.t,
    });
  }
  gaps.push({ ms: Math.round(hold.closedAt - hold.samples[hold.samples.length - 1]!.t), at: 0 });

  const widest = gaps.reduce((worst, gap) => (gap.ms > worst.ms ? gap : worst));
  if (widest.ms > allowedGapMs) {
    return {
      ok: false,
      because:
        `the recorder left a ${widest.ms}ms stretch of a ${spanMs}ms hold with nothing sampled in ` +
        `it, over the ${allowedGapMs}ms ceiling, so it was not awake across the window it is being ` +
        'used to describe',
    };
  }

  return { ok: true };
};
