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
