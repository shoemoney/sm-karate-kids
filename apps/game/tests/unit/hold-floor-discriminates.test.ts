import { describe, expect, test } from 'vitest';
import {
  MIN_HOLD_MS,
  MIN_SAMPLES,
  MAX_SAMPLE_GAP_RATIO,
  ROUND_INTRO_MS,
  evaluateHoldFloors,
} from '../e2e/holdFloors.js';

/**
 * The discrimination proof for the round-card hold floors.
 *
 * A floor is only worth having if it rejects the recordings it is meant to
 * reject AND accepts the ones that are merely unusual. The first version of
 * these floors was a bare sample count and it failed both halves at once: it
 * rejected a perfectly good 9-sample recording from a 2-core CI runner, and it
 * accepted 60 samples dumped into the last 50ms of a 9-second window — a
 * recorder that observed nothing at all.
 *
 * Every shape below is built from measured or CI-reported numbers, not
 * invented ones. The 9-sample case is lifted straight out of the CI log
 * (`Expected: >= 60, Received: 9`).
 */

const spread = (openedAt: number, spanMs: number, count: number, at = 'spread') => {
  const step = count > 1 ? spanMs / (count - 1) : 0;
  return {
    openedAt,
    closedAt: openedAt + spanMs,
    samples: Array.from({ length: count }, (_, i) => ({ t: openedAt + step * i })),
    // documented so the reader can see the shapes are deliberately different
    ...(at === 'spread' ? {} : {}),
  };
};

/** Samples crammed into the final slice of the window: the shape a count floor
 *  cannot see, because the count is large. */
const crammedAtEnd = (openedAt: number, spanMs: number, count: number, tailMs: number) => ({
  openedAt,
  closedAt: openedAt + spanMs,
  samples: Array.from({ length: count }, (_, i) => ({
    t: openedAt + spanMs - tailMs + (tailMs * i) / Math.max(1, count - 1),
  })),
});

describe('the round-card hold floors', () => {
  test('accepts the 9-sample recording a 2-core CI runner actually produced', () => {
    // Read out of the CI failure log, not estimated: the run collected 9 samples
    // across a hold of the real ROUND_INTRO_MS budget. The old count floor (60)
    // rejected this and called the recorder broken.
    const verdict = evaluateHoldFloors(spread(1_000, ROUND_INTRO_MS, 9));
    expect(verdict, 'a starved renderer is not a broken recorder').toEqual({ ok: true });
  });

  test('accepts a healthy full-rate recording', () => {
    // ~4ms sampling across the budget, which is what a 14-core dev machine gets.
    const verdict = evaluateHoldFloors(spread(0, ROUND_INTRO_MS, 2_250));
    expect(verdict).toEqual({ ok: true });
  });

  test('rejects a single sample', () => {
    const verdict = evaluateHoldFloors(spread(0, ROUND_INTRO_MS, 1));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.because).toMatch(/sampled the hold only 1 time/);
  });

  test('rejects a recorder that sampled only at the edges of the hold', () => {
    const hold = { openedAt: 0, closedAt: ROUND_INTRO_MS, samples: [{ t: 0 }, { t: 30 }, { t: ROUND_INTRO_MS }] };
    const verdict = evaluateHoldFloors(hold);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.because).toMatch(/not awake across the window/);
  });

  test('rejects 60 samples crammed into the last 50ms — the case the old count floor passed', () => {
    // This is the load-bearing case. The previous floor was `samples.length >=
    // 60`, which this recording satisfies with room to spare, and which proves
    // nothing about the 8.9 seconds before those samples. It must now fail.
    const hold = crammedAtEnd(0, ROUND_INTRO_MS, 60, 50);
    expect(hold.samples.length).toBeGreaterThanOrEqual(60);
    const verdict = evaluateHoldFloors(hold);
    expect(verdict.ok, 'a large sample count is not evidence of coverage').toBe(false);
    if (!verdict.ok) expect(verdict.because).toMatch(/not awake across the window/);
  });

  test('rejects a hold shorter than the floor, and names the drift', () => {
    // 4000ms is the budget these floors were originally written against. If
    // someone moves ROUND_INTRO_MS back to it, or the card starts dismissing
    // early, this must be loud and must say what to look at.
    const verdict = evaluateHoldFloors(spread(0, 4_000, 1_000));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.because).toMatch(/ROUND_INTRO_MS moved/);
  });

  test('rejects samples clustered in the middle of the hold — the head and tail count as gaps', () => {
    // The second hole, found by the test above failing. Consecutive-gap checking
    // cannot see this one: a cluster in the middle has no internal gap, so the
    // only unsampled stretches are the head and the tail, which have to be part
    // of the measurement.
    const hold = crammedAtEnd(0, ROUND_INTRO_MS, 60, 50);
    hold.samples = hold.samples.map((s) => ({ t: s.t + ROUND_INTRO_MS / 2 }));
    const verdict = evaluateHoldFloors(hold);
    expect(verdict.ok, 'a cluster in the middle observes almost nothing').toBe(false);
    if (!verdict.ok) expect(verdict.because).toMatch(/nothing sampled in it/);
  });

  test('leaves real headroom against the recording CI actually produced', () => {
    // 9 samples across 9s is the shape from the CI log. Its widest unsampled
    // stretch is ~1/8 of the window; the ceiling is a half. If this test ever
    // gets close, the ceiling and the runner have drifted together again.
    const hold = spread(0, ROUND_INTRO_MS, 9);
    const widest = Math.max(
      ...hold.samples.map((s, i) => (i === 0 ? s.t : s.t - hold.samples[i - 1]!.t)),
      hold.closedAt - hold.samples[hold.samples.length - 1]!.t,
    );
    const ratio = widest / ROUND_INTRO_MS;
    expect(ratio).toBeLessThan(MAX_SAMPLE_GAP_RATIO);
    // Headroom, stated so a change to either number is a visible decision.
    expect(ratio).toBeLessThan(MAX_SAMPLE_GAP_RATIO / 2);
  });

  test('the floors are pinned to the budget main.ts actually declares', () => {
    // A drift tripwire on the constants themselves. If ROUND_INTRO_MS is
    // re-derived without updating MIN_HOLD_MS, the relationship below is what
    // goes stale — which is the defect this whole file exists over.
    expect(MIN_HOLD_MS).toBeLessThan(ROUND_INTRO_MS);
    expect(MAX_SAMPLE_GAP_RATIO).toBeGreaterThan(0.25);
    expect(MIN_SAMPLES).toBeLessThanOrEqual(3);
  });
});
