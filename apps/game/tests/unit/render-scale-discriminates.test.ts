import { describe, expect, test } from 'vitest';
import {
  MIN_RATIO,
  SCALE_DOWN_MS,
  SCALE_STREAK,
  SCALE_UP_MS,
  WINDOW,
  WINDOW_MS,
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

  test('a window closes on frame count OR wall clock, whichever comes first', () => {
    const controller = new RenderScaleController(2);

    // Fast frames: the frame count is the binding constraint, so a window is
    // still WINDOW frames and not one fewer. 10ms x 30 = 300ms, inside
    // WINDOW_MS, so only the count can close it.
    //
    // Note what is NOT asserted here: a move. At 10ms the controller is below
    // SCALE_UP_MS, so it wants to walk UP — and it is already on the sharpest
    // rung, so there is nowhere to go and it correctly reports nothing. The
    // ladder is counted in frames by the *slow* case below; this case only has
    // to show the window does not close early, and the only observable
    // consequence of closing early would be a decision inside a partial window.
    const fast = new RenderScaleController(2);
    for (const frame of frames(10, WINDOW - 1)) expect(fast.sample(frame)).toBeNull();
    expect(fast.sample(10)).toBeNull();
    expect(fast.ratio).toBe(2);

    // A frame time just over budget is the case where an early close would
    // show: 30 frames of 25ms is 750ms, so the clock bound fires first, and a
    // 25ms median is inside the dead band, so no move either way. If the window
    // had closed early — say after 16 frames — the same median would have been
    // read sooner, and the streak would have completed inside 30 frames.
    const banded = new RenderScaleController(2);
    for (const frame of frames(25, WINDOW * SCALE_STREAK * 2)) {
      expect(banded.sample(frame)).toBeNull();
    }
    expect(banded.ratio).toBe(2);

    // Slow frames: the clock is the binding constraint. At 200ms a window
    // closes on WINDOW_MS after 2 frames instead of waiting for 30.
    //
    // THIS IS THE REGRESSION. A frame-count-only window measured 41.8 seconds
    // on the phone-portrait profile that needs the help, against a 9 second
    // card and a 27 second click. The controller was correct and arrived after
    // the thing it was built to save.
    const slow = new RenderScaleController(2);
    expect(slow.sample(200)).toBeNull(); // 200ms, window open
    expect(slow.sample(200)).toBeNull(); // 400ms — window closed, streak 1 of 2
    // Second window's worth of time, so the streak completes and the ladder moves.
    expect(slow.sample(200)).toBeNull();
    const reports: (number | null)[] = [];
    for (const frame of frames(200, 6)) reports.push(controller.sample(frame));

    // And the reported step is a real rung, not an arbitrary number.
    const changed = [slow.sample(200), ...reports].filter((r) => r !== null);
    for (const ratio of changed) expect(ladder_has(ratio)).toBe(true);
  });

  test('the whole ladder is walked in bounded WALL CLOCK, not a bounded frame count', () => {
    // The claim the fix exists to support, stated as a test: on a device slow
    // enough to need the controller, the relief arrives in seconds. If a future
    // change makes the window frame-only again, this is what goes red — and the
    // unit it fails in is the unit that matters, which is not frames.
    const SLOW_FRAME = 200;
    const controller = new RenderScaleController(2);
    let elapsed = 0;
    let firstMoveMs = null;
    let floorMs = null;

    for (let i = 0; i < 400; i += 1) {
      const report = controller.sample(SLOW_FRAME);
      elapsed += SLOW_FRAME;
      if (report !== null) {
        firstMoveMs ??= elapsed;
        if (controller.ratio === MIN_RATIO) floorMs = elapsed;
      }
      if (floorMs !== null) break;
    }

    expect(firstMoveMs).not.toBeNull();
    // Two windows to move once, each capped at WINDOW_MS.
    expect(firstMoveMs!).toBeLessThanOrEqual(WINDOW_MS * 2);
    // The full descent is 3 rungs x SCALE_STREAK windows.
    expect(floorMs).not.toBeNull();
    expect(floorMs!).toBeLessThanOrEqual(WINDOW_MS * 2 * 3);
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