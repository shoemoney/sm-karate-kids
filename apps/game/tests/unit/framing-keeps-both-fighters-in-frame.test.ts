import { describe, expect, test } from 'vitest';
import { framingSolve } from '../../src/stage.js';

/* r171. `stage.frame()` sized its distance by the gap between the fighters and
 * a body half-width, and then placed the camera at `midpointX * 0.7` rather
 * than at the fighters' midpoint. The half-width it solved for is centred on
 * the CAMERA, so the camera's own offset from the pair was never in the budget
 * — and that offset grows with how far the bout has drifted from the middle of
 * the mat.
 *
 * Measured off `17-phone-scored-result`, before the fix: a bout that drifted to
 * the mat's right edge left one fighter sliced in half by the frame edge and
 * the other almost entirely outside the arena. `reach` had been added at r39 for
 * exactly this class and the family was declared closed; the framing family was
 * not closed, because one term was missing from the solve.
 *
 * So these are not "does it return a number" tests. Each one asserts the r39
 * contract — **both fighters fully inside the frustum** — over the whole legal
 * position space rather than at one hand-picked pose, which is what a
 * screenshot cannot do. */

/** The horizontal half-extent the camera covers at the fighters' plane. */
function coverage(solve: ReturnType<typeof framingSolve>, aspect: number): number {
  return solve.distance * aspect * Math.tan((34 * Math.PI) / 360);
}

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 800 };
/** `packages/content/data/arenas.json` — the only arena. */
const BOUNDS = 5.0;

describe('framingSolve: both fighters stay inside the frame', () => {
  for (const [name, vp] of [
    ['phone', PHONE],
    ['desktop', DESK],
  ] as const) {
    test(`${name}: every legal midpoint frames the pair`, () => {
      const aspect = vp.width / vp.height;

      // Walk the whole mat rather than sampling it. A gap of zero is the
      // clinch the sim allows (`MIN_VISUAL_GAP` keeps them from overlapping),
      // and BOUNDS is the arena's own limit, so the sweep is the entire set of
      // positions two fighters can legally be in.
      for (let midpoint = -BOUNDS; midpoint <= BOUNDS; midpoint += 0.05) {
        for (const gap of [0, 0.25, 0.5, 1, 1.5, 2, 3]) {
          const solve = framingSolve(vp.width, vp.height, midpoint, gap);
          const half = coverage(solve, aspect);

          // How far the outermost fighter's body edge sits from the camera.
          // The fighters straddle their midpoint by half the gap, and each is
          // framed by their body half-width — which is the `tight` scaling
          // `frame()` applies.
          const body = aspect < 0.85 ? 0.42 * 0.8 : 0.42;
          const outermost = Math.abs(midpoint - solve.cameraX) + gap / 2 + body;

          expect(
            outermost,
            `${name} m=${midpoint.toFixed(2)} gap=${gap}: a fighter sits ${outermost.toFixed(3)} from the camera axis and the frame only covers ${half.toFixed(3)}`,
          ).toBeLessThanOrEqual(half);
        }
      }
    });
  }

  test('an extended limb is still framed, at any midpoint', () => {
    // The r39 term. `reach` is how far past its own centre the out-extended
    // limb goes, and it is at its largest on a back kick at the moment the
    // point is awarded — so this is the case the original burst found.
    const aspect = PHONE.width / PHONE.height;
    for (let midpoint = -BOUNDS; midpoint <= BOUNDS; midpoint += 0.05) {
      const solve = framingSolve(PHONE.width, PHONE.height, midpoint, 0.5, 1.4);
      expect(Math.abs(midpoint - solve.cameraX) + 0.25 + 1.4).toBeLessThanOrEqual(
        coverage(solve, aspect),
      );
    }
  });

  test('the camera does not bias away from the pair', () => {
    // The fix itself. `* 0.7` pulled the camera toward the middle of the mat
    // while the fighters kept going, and the `0.12` lerp in `frame()` already
    // supplies the smoothing a follow needs. With this red the framing sweep
    // above goes red too, because a camera off the pair by `0.3 * midpoint`
    // cannot cover them at `bounds` — the two tests are one property, asserted
    // from both ends.
    expect(framingSolve(PHONE.width, PHONE.height, 4, 0.5).cameraX).toBe(4);
  });

  test('distance tracks the gap alone, never the position on the mat', () => {
    // The cost ceiling, and the reason the fix is `CAMERA_FOLLOW = 1` rather
    // than `0.7` plus a term budgeting for the offset.
    //
    // My first attempt kept the bias and widened `halfWidth` by the camera's
    // distance from the pair. That also restores the invariant — and it makes
    // the camera dolly from 9.2 to 20.2 world units at the mat's edge, a
    // little over half size, to pay for a softness nothing asked for. The
    // function's own docstring says the distance is the fighters' distance.
    //
    // So this is a hard fence on that trade: if anyone re-introduces a
    // position term, the fighters shrink as the bout drifts and this goes red.
    for (const vp of [PHONE, DESK]) {
      for (const gap of [0, 0.5, 1, 2, 3]) {
        const atCentre = framingSolve(vp.width, vp.height, 0, gap).distance;
        for (let midpoint = -BOUNDS; midpoint <= BOUNDS; midpoint += 0.25) {
          expect(
            framingSolve(vp.width, vp.height, midpoint, gap).distance,
            `distance changed at midpoint ${midpoint} for gap ${gap}: the frame is now sized by where the fight is, not by how far apart they are`,
          ).toBeCloseTo(atCentre, 9);
        }
      }
    }
  });

  test('a centred exchange frames exactly as it did before the fix', () => {
    // The regression fence, and written as the PRE-FIX closed form rather than
    // as a magic number — a constant can always be adjusted to pass, but this
    // cannot: it pins `MIN_HALF_WIDTH`, `FRAME_HALF_HEIGHT`, `FOV` and the
    // viewport all at once.
    //
    // The pre-fix arithmetic at ANY midpoint is this, because it never
    // referenced the camera: the gap terms reach `0.25 + 0.42 + 0.336 = 1.006`,
    // which is under `MIN_HALF_WIDTH`, so the half-width is pinned at 1.25 and
    // the phone's width is the binding constraint.
    const tan = Math.tan((34 * Math.PI) / 360);
    const preFix = (vp: { width: number; height: number }, gap: number): number => {
      const aspect = vp.width / vp.height;
      const half = Math.max(1.25, gap / 2 + (aspect < 0.85 ? 0.42 : 0.6) + (aspect < 0.85 ? 0.336 : 0.42));
      return Math.max(1.3 / tan, half / (aspect * tan)) * 1.04;
    };

    for (const gap of [0, 0.5, 1, 2, 3]) {
      for (const vp of [PHONE, DESK]) {
        // Every midpoint, because the fix must be inert on the distance solve
        // at all of them — only the camera's placement changed.
        for (const midpoint of [0, 1, -2.5, BOUNDS]) {
          expect(
            framingSolve(vp.width, vp.height, midpoint, gap).distance,
            `${vp === PHONE ? 'phone' : 'desktop'} m=${midpoint} gap=${gap}`,
          ).toBeCloseTo(preFix(vp, gap), 9);
        }
      }
    }
    // And the phone really is width-bound here, so this fence is not vacuous:
    // if the vertical floor ever won, both halves would collapse to the same
    // number and the test would pass while asserting nothing.
    expect(1.25 / ((PHONE.width / PHONE.height) * tan)).toBeGreaterThan(1.3 / tan);
  });
});