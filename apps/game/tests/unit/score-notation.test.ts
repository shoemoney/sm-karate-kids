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
 * The call word is set at `--text-display` with a 1.5px outline, over a pool
 * that faded to transparent almost immediately. On a shoji backdrop that
 * combination let the window frame show through the letter counters, which a
 * reviewer read as "polygonal tessellation artifacts inside the WAZA-ARI
 * banner" — and it was the backdrop, not a broken font.
 *
 * Both values are asserted here because both fail silently: a thinner stroke or
 * an earlier fade does not throw, does not shift layout, and does not fail a
 * behavioural test. It just quietly makes the biggest word in the game harder to
 * read, on the one frame the set only learned to capture in round 75.
 */
describe("the referee's call is legible over the shoji", () => {
  const css = read('../../src/styles.css');

  test('the outline scales with the glyph, not with body text', () => {
    const stroke = css.match(/\.banner \.call-word \{[\s\S]*?-webkit-text-stroke:\s*([\d.]+)(em|px)/);
    expect(stroke, '.call-word has no text-stroke').not.toBeNull();
    const [, value, unit] = stroke!;
    if (unit === 'em') {
      expect(Number(value), 'an em stroke keeps the outline proportional').toBeGreaterThanOrEqual(0.07);
    } else {
      expect(Number(value), 'a px stroke below 3px lets the backdrop through the counters').toBeGreaterThanOrEqual(3);
    }
  });

  test('the pool behind the call is opaque across the width of the word', () => {
    const pool = css.match(/\.banner::before \{[\s\S]*?radial-gradient\([^;]*;/);
    expect(pool).not.toBeNull();
    const stops = [...pool![0].matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
    const opaque = stops.filter((v) => v > 0);
    expect(
      Math.max(...opaque),
      'the scrim reaches transparent before the word does, so the outer letters sit on bare backdrop',
    ).toBeGreaterThanOrEqual(55);
  });
});
