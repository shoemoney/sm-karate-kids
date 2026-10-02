/**
 * Adaptive render resolution.
 *
 * WHY THIS EXISTS. The game's cost is almost entirely fragment work: the same
 * scene at a quarter of the pixels costs a quarter of the frame. On a GPU that
 * is never a question. On a device with no GPU, where every fragment is
 * rasterized by the CPU, the frame budget is blown by a factor of eight and the
 * game drops to single-digit FPS — which is a real defect for a phone, and not
 * only a test artifact.
 *
 * WHY ONLY PIXELS. Three levers were measured (round 145, `tools/renderer-sweep.mjs`):
 *
 *   | change            | median frame | vs baseline |
 *   |-------------------|--------------|-------------|
 *   | baseline          | 60.9ms       | 100%        |
 *   | antialias: false  | 53.7ms       | 88%         |
 *   | post chain bypass | 46.3ms       | 76%         |
 *   | pixelRatio 1      | 16.5ms       | 27%         |
 *   | pixelRatio 0.5    | 16.7ms       | 27%         |
 *
 * Three things fall out of that table.
 *
 * `antialias: false` is not a lever. It measured 88% in one sweep and 115% in
 * another — it is inside the noise, and in the second sweep it was *slower*.
 * It is not the 4x MSAA cost it looks like, so nobody turns it off.
 *
 * The post chain is real but secondary, and it is not free to remove: bloom,
 * grade, grain and vignette are the difference between a correct frame and a
 * photographed one. Removing it is an art decision, not a performance fix.
 *
 * Pixel ratio is the only lever with a hard bound. Fragment work is
 * proportional to pixel count, so dropping the ratio to 1 removes three quarters
 * of it *by construction* rather than by taste. And the last row is the one
 * that sets the floor: 0.5 is no faster than 1, because at 1 the frame is
 * already at the display's refresh cap. Sharpness spent below that buys
 * nothing, so the ladder stops at 0.75 and not lower.
 *
 * So: one lever, bounded, and no art changes.
 */

/** Frame times above this (ms) mean the frame is over budget. 28ms ≈ 36fps. */
export const SCALE_DOWN_MS = 28;

/** Frame times below this (ms) mean there is headroom to sharpen back up. */
export const SCALE_UP_MS = 19;

/**
 * Consecutive windows that must agree before the scale moves.
 *
 * One slow frame is a shader compile, a GC pause, or the tab being backgrounded.
 * Stepping resolution on that would make the picture worse for a reason that has
 * already passed. Two is enough to see a trend and cheap enough to react inside
 * the second budget.
 */
export const SCALE_STREAK = 2;

/** Frames sampled per decision window. */
export const WINDOW = 30;

/**
 * Wall-clock ceiling on a decision window, in ms.
 *
 * WHY A WINDOW NEEDS A STOPWATCH. `WINDOW` alone is a unit error waiting to
 * happen, and the machine that needs this controller most is the one it fails.
 * The decision is about whether frames are too slow, so counting SLOW FRAMES to
 * decide that they are slow is circular: the worse the device, the longer it
 * takes to notice. Measured on a phone-portrait context under software
 * rasterization, one window of 30 frames cost **41.8 seconds**, so the two
 * windows a single step needs cost ~83s — against a failure the controller
 * exists to remove that arrives in 9s. At a fixed ratio the same device is fine
 * (click 27003ms -> 2171ms at the cliff), so the lever is right and the timing
 * was not.
 *
 * So a window also closes on elapsed time, whichever comes first. On a fast
 * machine the frame count still wins and the median still rests on 30 samples.
 * On a device rendering at 1fps the window closes after a few frames and the
 * controller reacts in seconds, which is the entire point of having it.
 */
export const WINDOW_MS = 400;

/** The lowest ratio the ladder will use. Below this it is all blur. */
export const MIN_RATIO = 0.75;

/**
 * The ladder of pixel ratios to walk, from sharpest to softest.
 *
 * Always includes the device's own ratio (capped at 2) and never exceeds it, so
 * a machine that can afford full sharpness starts and stays there.
 */
export function renderScaleLadder(devicePixelRatio: number | undefined): readonly number[] {
  const start = Math.min(devicePixelRatio ?? 1, 2);
  const steps = [start, 1.5, 1, MIN_RATIO].filter(
    (ratio, index, all) => ratio <= start && all.indexOf(ratio) === index,
  );
  return steps.sort((a, b) => b - a);
}

export interface ScaleState {
  /** Index into the ladder. 0 is sharpest. */
  readonly index: number;
  /** Consecutive windows agreeing on a move, up or down. */
  readonly streak: number;
  /** Which way the streak is counting: 1 down, -1 up, 0 undecided. */
  readonly direction: 1 | -1 | 0;
}

export const initialScaleState = (): ScaleState => ({ index: 0, streak: 0, direction: 0 });

/**
 * Folds one window of frame times into the scale decision.
 *
 * Pure, and deliberately so: every claim this module makes about when to change
 * resolution is a claim about this function, and a claim about a function is
 * something a test can hold. The renderer, the device and the browser all stay
 * on the other side of this line.
 *
 * `median` rather than mean, because one 20-second frame should not be allowed
 * to outvote thirty good ones — that is the same mistake the hold floors in
 * `holdFloors.ts` were rewritten to stop making.
 */
export function nextScale(
  ladder: readonly number[],
  state: ScaleState,
  medianFrameMs: number,
): ScaleState {
  if (ladder.length <= 1) return state;

  // Out of budget: walk down the ladder. Never past the last rung.
  if (medianFrameMs > SCALE_DOWN_MS) {
    if (state.direction === 1) {
      const streak = state.streak + 1;
      if (streak >= SCALE_STREAK && state.index < ladder.length - 1) {
        return { index: state.index + 1, streak: 0, direction: 0 };
      }
      return { index: state.index, streak, direction: 1 };
    }
    return { index: state.index, streak: 1, direction: 1 };
  }

  // Headroom: walk back up, but never past the device's own ratio.
  if (medianFrameMs < SCALE_UP_MS) {
    if (state.direction === -1) {
      const streak = state.streak + 1;
      if (streak >= SCALE_STREAK && state.index > 0) {
        return { index: state.index - 1, streak: 0, direction: 0 };
      }
      return { index: state.index, streak, direction: -1 };
    }
    return { index: state.index, streak: 1, direction: -1 };
  }

  // Inside the dead band. Any streak is stale the moment the band is crossed,
  // so a run of fast windows followed by one borderline one does not carry the
  // old run's momentum into the next move.
  return { index: state.index, streak: 0, direction: 0 };
}

/** The ratio a state currently means. */
export const ratioFor = (ladder: readonly number[], state: ScaleState): number =>
  ladder[Math.min(state.index, ladder.length - 1)] ?? 1;

/**
 * Samples frame times and reports when the ratio should change.
 *
 * Holds no renderer reference on purpose. It is fed frame times and asked for a
 * ratio, so it can be driven by a test with a synthetic frame-time history and
 * no canvas at all.
 */
export class RenderScaleController {
  private readonly ladder: readonly number[];
  private state: ScaleState = initialScaleState();
  private samples: number[] = [];
  /** Set when the caller has applied a change, so it is not re-applied. */
  private applied: number | null = null;
  /** Every frame ever handed in, including those inside an open window. */
  private fed = 0;
  /**
   * Wall-clock milliseconds held by the open window.
   *
   * Reset with the window, and it is the reason this controller can help the
   * device it was written for. Counting frames alone meant a device rendering
   * one frame per second needed 41.8s to accumulate a single window.
   */
  private windowMs = 0;

  constructor(devicePixelRatio: number | undefined) {
    this.ladder = renderScaleLadder(devicePixelRatio);
  }

  /** The ratio in force right now. */
  get ratio(): number {
    return ratioFor(this.ladder, this.state);
  }

  /** The full ladder, for diagnostics and for the read-only test surface. */
  get rungs(): readonly number[] {
    return this.ladder;
  }

  /**
   * How many frames have been handed to `sample`, in total.
   *
   * This exists because the invariants above are all *quiet*: a controller
   * that is never called still reports a legal ratio, a legal ladder and a
   * ratio that is a rung of it. Every assertion those properties can support is
   * therefore also satisfied by a controller wired to nothing, which is the one
   * failure a test here must be able to catch. A count of frames proves the
   * render loop is actually feeding it — delete the `sample` call and this
   * stays zero.
   */
  get framesSampled(): number {
    return this.fed;
  }

  /**
   * Feeds one frame. Returns the new ratio only when it has actually changed.
   *
   * Returning the same value every frame would be cheaper to read but would
   * make the caller re-apply a scale on every frame, and `setPixelRatio` is not
   * free — it reallocates the drawing buffer.
   *
   * A window closes on whichever comes first: `WINDOW` frames, or `WINDOW_MS`
   * of wall clock. The second bound is what makes this work on the hardware
   * that needs it — see `WINDOW_MS`.
   */
  sample(frameMs: number): number | null {
    this.fed += 1;
    this.samples.push(frameMs);
    this.windowMs += frameMs;
    if (this.samples.length < WINDOW && this.windowMs < WINDOW_MS) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    this.samples = [];
    this.windowMs = 0;

    const next = nextScale(this.ladder, this.state, median);
    if (next.index === this.state.index) {
      this.state = next;
      return null;
    }
    this.state = next;
    const ratio = ratioFor(this.ladder, next);
    if (ratio === this.applied) return null;
    this.applied = ratio;
    return ratio;
  }
}