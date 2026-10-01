import { describe, expect, test } from 'vitest';
import {
  MIN_RATIO,
  SCALE_DOWN_MS,
  SCALE_STREAK,
  SCALE_UP_MS,
  WINDOW,
  RenderScaleController,
  initialScaleState,
  nextScale,
  ratioFor,
  renderScaleLadder,
} from '../../src/renderScale.js';

/**
 * Discrimination tests for adaptive render resolution.
 *
 * Every rule below was added because the naive version of it was wrong in a way
 * that only showed up on a slow machine:
 *
 *   - one slow frame dropped resolution. On a phone that is a shader compile,
 *     and the picture got permanently worse for a reason that had already
 *     passed. Hence SCALE_STREAK.
 *   - mean frame time let a single 20-second frame outvote thirty good ones.
 *     Hence median. This is the same defect the hold floors in
 *     `holdFloors.ts` were rewritten to stop making.
 *   - walking below a ratio of 1 bought nothing — the frame was already at the
 *     refresh cap — and cost sharpness. Hence MIN_RATIO.
 *
 * The ladder is built from measured numbers, not invented ones: the median
 * frame times behind these thresholds are in `tools/renderer-sweep.mjs`, and
 * the failure this exists to fix is CI's 50–53 second actionability wait.
 */

describe('renderScaleLadder', () => {
  test('starts at the device ratio, capped at 2', () => {
    expect(renderScaleLadder(3)[0]).toBe(2);
    expect(renderScaleLadder(1.5)[0]).toBe(1.5);
  });

  test('never offers a rung sharper than the device has', () => {
    // A 1x display cannot be given a 2x rung: there are no pixels to fill, and
    // three.js would only be told to supersample into nothing.
    expect(renderScaleLadder(1)).toEqual([1, MIN_RATIO]);
  });

  test('a device with no GPU of its own still gets a ladder', () => {
    expect(renderScaleLadder(undefined).length).toBeGreaterThan(1);
  });

  test('rungs are ordered sharpest to softest and never duplicated', () => {
    const ladder = renderScaleLadder(2);
    expect([...ladder].sort((a, b) => b - a)).toEqual([...ladder]);
    expect(new Set(ladder).size).toBe(ladder.length);
  });

  test('stops at MIN_RATIO, because below 1 it is all blur and no faster', () => {
    // Measured: pixelRatio 0.5 and pixelRatio 1 both land at ~16.6ms, which is
    // the refresh cap. The ladder must not offer a rung the measurement says
    // cannot pay for itself.
    expect(Math.min(...renderScaleLadder(2))).toBe(MIN_RATIO);
    expect(renderScaleLadder(2)).not.toContain(0.5);
  });
});

describe('nextScale', () => {
  const ladder = renderScaleLadder(2);

  /** Feeds `count` windows of the same median and returns the settled state. */
  const drive = (medianFrameMs: number, count: number) => {
    let state = initialScaleState();
    for (let i = 0; i < count; i += 1) state = nextScale(ladder, state, medianFrameMs);
    return state;
  };

  test('one slow window does NOT change resolution', () => {
    // THE regression. A single slow frame is a shader compile or a GC pause.
    // Stepping on it makes the picture permanently worse for a condition that
    // has already passed.
    const state = drive(SCALE_DOWN_MS + 30, 1);
    expect(ratioFor(ladder, state)).toBe(2);
  });

  test('sustained slow frames walk the ladder down', () => {
    const state = drive(SCALE_DOWN_MS + 30, 8);
    expect(ratioFor(ladder, state)).toBe(MIN_RATIO);
  });

  test('headroom walks it back up, and never past the device ratio', () => {
    let state = drive(SCALE_DOWN_MS + 30, 8);
    for (let i = 0; i < 40; i += 1) state = nextScale(ladder, state, 8);
    expect(ratioFor(ladder, state)).toBe(2);
  });

  test('a borderline window does not move it either way', () => {
    // The dead band between SCALE_UP_MS and SCALE_DOWN_MS. Without it a frame
    // landing near the threshold flips the scale on every window, and the
    // picture pulses for as long as the player watches.
    const borderline = (SCALE_UP_MS + SCALE_DOWN_MS) / 2;
    const state = drive(borderline, 20);
    expect(ratioFor(ladder, state)).toBe(2);
  });

  test('a streak cannot cross the dead band', () => {
    // Three fast windows build momentum, then one borderline window arrives.
    // If the streak survived the crossing, the next slow window would move the
    // scale on one sample rather than SCALE_STREAK — which is precisely the
    // one-slow-frame rule, reached by a longer route.
    let state = initialScaleState();
    for (let i = 0; i < SCALE_STREAK + 4; i += 1) state = nextScale(ladder, state, 8);
    state = nextScale(ladder, state, (SCALE_UP_MS + SCALE_DOWN_MS) / 2);
    expect(state.streak).toBe(0);
    expect(ratioFor(ladder, state)).toBe(2);
  });

  test('alternating fast and slow frames never move it', () => {
    // The oscillation shape. If this moves, the controller is not stable, and
    // an unstable controller is worse than no controller because it is
    // continuously reallocating the drawing buffer.
    let state = initialScaleState();
    for (let i = 0; i < 40; i += 1) state = nextScale(ladder, state, i % 2 === 0 ? 8 : SCALE_DOWN_MS + 30);
    expect(ratioFor(ladder, state)).toBe(2);
  });

  test('a one-rung device is never asked to change', () => {
    const flat = renderScaleLadder(0.75);
    const state = nextScale(flat, initialScaleState(), SCALE_DOWN_MS + 100);
    expect(ratioFor(flat, state)).toBe(0.75);
  });
});

describe('RenderScaleController', () => {
  const frames = (ms: number, count: number) => Array.from({ length: count }, () => ms);

  test('reports nothing until a full window has been sampled', () => {
    const controller = new RenderScaleController(2);
    for (const frame of frames(200, WINDOW - 1)) expect(controller.sample(frame)).toBeNull();
  });

  test('returns the new ratio only when it changes', () => {
    const controller = new RenderScaleController(2);
    // Derived, not counted: every rung below the first costs SCALE_STREAK
    // windows to reach, so the frames needed to see the whole ladder descend is
    // (rungs - 1) * SCALE_STREAK windows. Hand-counting this is how it drifts —
    // a version of this test fed 3 windows, expected 3 reports, and only got
    // one, because 3 rungs at a streak of 2 needs 6.
    const windows = (renderScaleLadder(2).length - 1) * SCALE_STREAK;
    const reported = frames(200, WINDOW * windows).map((f) => controller.sample(f));
    // Every non-null report must be a genuine rung, and repeats are suppressed.
    expect(reported.filter((r) => r !== null)).toEqual([1.5, 1, MIN_RATIO]);
  });

  test('an outlier frame cannot outvote the window', () => {
    // THE mean-vs-median regression, in the shape that motivated it. One
    // catastrophic frame inside an otherwise healthy window changes nothing.
    const controller = new RenderScaleController(2);
    const healthy = frames(12, WINDOW - 1);
    expect(controller.sample(20_000)).toBeNull();
    for (const frame of healthy) expect(controller.sample(frame)).toBeNull();
    expect(controller.ratio).toBe(2);
  });

  test('reports the ladder it was given, for diagnostics', () => {
    expect(new RenderScaleController(2).rungs).toEqual(renderScaleLadder(2));
  });

  test('survives a ratio it has already applied without reapplying it', () => {
    // `setPixelRatio` reallocates the drawing buffer, so reporting the same
    // value every frame would be a real cost, not a tidy abstraction.
    const controller = new RenderScaleController(2);
    const first = new Set(frames(200, WINDOW * 12).map((f) => controller.sample(f)).filter((r) => r !== null));
    expect(first.size).toBe(3);
    for (const ratio of first) expect(ladder_has(ratio)).toBe(true);
  });
});

const ladder_has = (ratio: number): boolean => renderScaleLadder(2).includes(ratio);