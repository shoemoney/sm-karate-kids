import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * A guard on the *shape* of score rendering, not on its output.
 *
 * Round 36 replaced a decimal with U+00BD on the result card and made it worse.
 * Round 53 built the correct stacked fraction — in `hud.ts` only. The card kept
 * its string, five models reported the problem for five more rounds, and the
 * cause was always the same: two places rendering one concept by two different
 * mechanisms, and the mechanism that had regressed was the one nobody
 * screenshots.
 *
 * This test cannot prove the fraction looks right — that needs a browser, and
 * `boot.spec.ts` covers the rendered HUD. What it can do is fail the instant a
 * score string reappears anywhere outside the shared builder, which is the
 * actual defect. It is a source guard on purpose: the bug lived in the wiring,
 * not in a value.
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const main = read('../../src/main.ts');
const hud = read('../../src/hud.ts');

describe('scores are rendered by one builder, not by strings', () => {
  test('the shared builder exists and is exported', () => {
    expect(hud).toMatch(/export function scoreFragment\(n: number\): DocumentFragment/);
  });

  test('no score path in main.ts produces a string with a half-point glyph', () => {
    // The only U+00BD left in the file may appear in a comment explaining why.
    const live = main
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .filter((line) => line.includes('½'));
    expect(live).toEqual([]);
  });

  test('the old string formatter is gone, and nothing calls it', () => {
    expect(main).not.toMatch(/const formatScore\s*=/);
    expect(main).not.toMatch(/formatScore\(/);
  });

  test('the glyph lookup table that encoded slashed fractions is gone', () => {
    expect(hud).not.toMatch(/POINT_LABEL/);
  });

  test('every card field that can carry a score accepts nodes', () => {
    // `string | Node` on all three, or the builder cannot be used on a card.
    for (const field of ['headline', 'score', 'detail']) {
      expect(hud).toMatch(new RegExp(`${field}: string \\| Node;`));
    }
  });

  test('the builder keeps thousands separators on whole scores', () => {
    // A four-figure career total must still read as one number.
    expect(hud).toMatch(/whole\.toLocaleString\(\)/);
  });
});

/**
 * The stacked fraction has to be a *readable* fraction, not just an
 * unambiguous one.
 *
 * At 0.52em of a 22px score the numerator and denominator rendered at about
 * 11px, which is legible only if you already know what a fraction looks like.
 * Two reviewers called it "unreadable at HUD size" and "tiny" — and they could
 * only say so at all because round 73 finally put a half on the board, after
 * thirty-two rounds of the notation being invisible in every frame.
 *
 * The regression this guards is silent: shrinking the fraction back does not
 * throw, does not clip (`.points` is `flex: 0 0 auto`, so the scoreline grows
 * rather than truncates), and does not fail any behavioural test. It just
 * quietly becomes too small to read again.
 */
describe('the stacked fraction is sized to be read', () => {
  const css = read('../../src/styles.css');

  test('the fraction is at least two thirds of the score it sits beside', () => {
    const frac = css.match(/\.score-frac \{[\s\S]*?font-size:\s*([\d.]+)em;/);
    expect(frac, '.score-frac has no font-size').not.toBeNull();
    const em = Number(frac![1]);
    expect(
      em,
      `fraction is ${em}em of the score — below the 0.66em floor set after two reviewers reported it unreadable`,
    ).toBeGreaterThanOrEqual(0.66);
  });

  test('the score is 22px, so the floor is a real pixel floor', () => {
    expect(css).toMatch(/--text-xl:\s*1\.375rem/);
  });

  test('the bar is thick enough to survive at that size', () => {
    const bar = css.match(/\.score-frac-bar \{[\s\S]*?block-size:\s*([\d.]+)em;/);
    expect(bar).not.toBeNull();
    expect(Number(bar![1])).toBeGreaterThanOrEqual(0.12);
  });
});

/**
 * The referee's call has to be readable against the brightest thing in the game.
 *
 * This test is here because it was wrong once. Round 78 asserted the call word's
 * outline must be at least 0.07em, on the reasoning that a thin outline let the
 * shoji show through the letter counters. Round 79 showed that reasoning was
 * wrong: thickening the stroke darkens a letter's *edges* and leaves its
 * counters exactly as open, so the window frame kept coming through and
 * `claude-opus-5.5` reported the thick outline as "dark bars slicing through the
 * letterforms".
 *
 * The lattice was never about the stroke. It was about `--scrim-banner` sitting
 * at 0.68 opacity behind a high-contrast grid. The fix is an effectively opaque
 * pool, and the outline only has to be a hairline.
 *
 * So this asserts the actual properties, and specifically not the one I got
 * wrong: the pool behind the call must be effectively opaque, the stroke must be
 * drawn behind the fill, and the stroke must NOT be thick — because a thick one
 * is its own artifact.
 */
describe("the referee's call is legible over the shoji", () => {
  const css = read('../../src/styles.css');

  test('the pool behind the call is effectively opaque, not merely dimmed', () => {
    // The real defect. 0.68 over a window grid is a wireframe through the
    // counters; the call has to sit on something effectively solid.
    const scrim = css.match(/--scrim-call:\s*rgba?\([^)]*?\/\s*([\d.]+)\s*\)/);
    expect(scrim, 'no dedicated opaque scrim for the call').not.toBeNull();
    expect(Number(scrim![1]), 'the call pool leaves the shoji visible').toBeGreaterThanOrEqual(0.9);
  });

  test('the pool is actually used by the banner behind the call word', () => {
    expect(css).toMatch(/\.banner::before \{[\s\S]*?var\(--scrim-call\)/);
  });

  test('the stroke is drawn behind the fill, so counters stay solid', () => {
    expect(css).toMatch(/\.banner \.call-word \{[\s\S]*?paint-order:\s*stroke fill/);
  });

  test('the stroke stays a hairline — a thick one is its own artifact', () => {
    const stroke = css.match(/\.banner \.call-word \{[\s\S]*?-webkit-text-stroke:\s*([\d.]+)em/);
    expect(stroke, '.call-word has no em stroke').not.toBeNull();
    expect(
      Number(stroke![1]),
      'a stroke thick enough to eat the inside of a stem leaves a pale wedge in every counter',
    ).toBeLessThanOrEqual(0.03);
  });
});
