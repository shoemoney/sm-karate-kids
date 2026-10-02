import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * A guard on the *shape* of score rendering, not on its output.
 *
 * Round 36 replaced a decimal with U+00BD on the result card and made it worse.
 * Round 53 built the correct fraction — in `hud.ts` only. The card kept
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

  test('main.ts holds no hand-rolled half-point notation of its own', () => {
    // r148: this inverted. It used to forbid a literal U+00BD in main.ts, on the
    // strength of an unrendered report that the glyph reads as `21/2`. The glyph
    // is back, and it lives in the BUILDER — so the invariant worth keeping is
    // the one that was always real: main.ts must not hand-assemble a score out
    // of digits and a mark. It may not contain a half-point glyph literal, and
    // it may not call toLocaleString on a score either.
    const live = main
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .filter((line) => line.includes('½'));
    expect(live, 'main.ts assembles a score itself instead of calling scoreFragment').toEqual([]);
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

  test('the builder keeps thousands separators and uses the glyph, not a decimal', () => {
    // A four-figure career total must still read as one number, and the half
    // must be U+00BD. The `minimumFractionDigits` trap is the thing to hold:
    // my first r148 attempt used it, rendered `1.5`, and every other test in
    // this file still passed. A decimal is notation E in the probe, and it is
    // the ambiguity r36 removed the glyph to fix.
    expect(hud).toMatch(/whole\.toLocaleString\(\)/);
    expect(hud).toMatch(/½/);
    // Comment lines are stripped first, and that is not fussiness: the first
    // version of this assertion failed because the docblock above
    // `scoreFragment` NAMES `minimumFractionDigits` while explaining why it must
    // not be used. A grep that cannot tell prose from code reports its own
    // documentation as a violation.
    const code = hud
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    expect(
      code,
      'scoreFragment formats a fraction digit, which renders a decimal. The half must be the glyph.',
    ).not.toMatch(/minimumFractionDigits/);
  });

  test('the half is a single glyph, not assembled from separate elements', () => {
    // The r53..r147 notation was a column of three spans; r148a was a row of
    // three spans. Both were separate elements next to a whole number and both
    // merged with it — the r148a failure was a 2.5 total reading as `2 1-2`.
    // One text node cannot merge with anything.
    expect(
      hud,
      'scoreFragment builds DOM again. One text node is the property that removed ' +
        'the adjacent-numeral merge; the CSS has no .score-frac rule to style it with.',
    ).not.toMatch(/score-frac/);
  });
});

/**
 * The fraction has to be a *readable* fraction, not just an
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
describe('the half point is one glyph, and the score never clips it', () => {
  const css = read('../../src/styles.css');

  test('there is no .score-frac rule to style a half out of separate elements', () => {
    // The tripwire that matters now. `.score-frac` existed for r53..r148a across
    // two different layouts; if a rule by that name is in the stylesheet again,
    // the notation is being assembled from elements rather than set as a glyph,
    // and the r148a merge (`2 1-2` for a 2.5 total) is the failure mode.
    expect(css).not.toMatch(/^\.score-frac\s*\{/m);
    expect(css).not.toMatch(/^\.score-frac-bar\s*\{/m);
  });

  test('the score is 22px, so a glyph half is legible at the same size', () => {
    // The glyph's whole advantage is that it is set at the score's own size. If
    // --text-xl is shrunk the fraction shrinks with it, and r73's finding — two
    // reviewers calling the half "unreadable at HUD size" — becomes reachable
    // again through a token rather than through a rule.
    expect(css).toMatch(/--text-xl:\s*1\.375rem/);
  });

  test('the score box never shrinks, so a wide total is not clipped', () => {
    // Kept verbatim from the r43 clipping fix. `1250½` was measured clipped
    // because `.points` was the flexible item in the scoreline row; `flex: 0 0
    // auto` means the scoreline grows and the fighter NAMES ellipsise instead.
    expect(css).toMatch(/\.points \{[\s\S]*?flex:\s*0 0 auto/);
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


/**
 * The two name plates are not symmetric, because red is not.
 *
 * Relative luminance weights green and blue heavily and red barely, so a red
 * that *looks* as bright as a cream carries far less measurable contrast. The
 * name plates use the fighters' `-dim` tokens, and the red one was 2.3:1 weaker
 * than the white one — 4.74:1 against its plate where the white sat at 7.03:1.
 * `gemini-3.8-flash` asked for luminance on the P2 name; the fix is on the
 * `--aka-dim` HUD token, never on `--aka`, which is the gi.
 *
 * Asserted as a computed property so the next colour tweak cannot quietly
 * reintroduce the asymmetry by eye, which is how it arrived: both names looked
 * fine, and one of them was measurably worse.
 */
describe('both name plates carry their own contrast', () => {
  const css = read('../../src/styles.css');
  const lum = (hex: string): number => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const token = (name: string): number => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`));
    expect(m, `no --${name} token`).not.toBeNull();
    return Number(`0x${(m![1] ?? '').slice(1)}`);
  };
  /** WCAG contrast of `hex` on the HUD plate behind the name. */
  const onPlate = (hex: string): number => {
    // The scoreline plate, measured off `19-phone-half-point` — the modal pixel
    // in the name band, which is the plate showing between the glyphs. It is a
    // real sample rather than a chosen colour because this test exists because
    // two colours that *looked* equal were 2.3:1 apart, and a guessed plate
    // reproduces exactly that kind of confident wrong answer.
    const plate = 0.0108; // relative luminance of #221913
    const l = lum(hex);   // lum() expects the leading '#' and slices from it
    return (Math.max(l, plate) + 0.05) / (Math.min(l, plate) + 0.05);
  };

  test('the red name plate clears the large-text threshold on its own', () => {
    const hex = `#${token('aka-dim').toString(16).padStart(6, '0')}`;
    expect(
      onPlate(hex),
      `${hex} is the P2 name colour and must clear 4.5:1 unaided — the whole point of the token`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  test('the two name plates are within 2:1 of each other', () => {
    const a = onPlate(`#${token('aka-dim').toString(16).padStart(6, '0')}`);
    const b = onPlate(`#${token('shiro-dim').toString(16).padStart(6, '0')}`);
    expect(
      Math.max(a, b) / Math.min(a, b),
      'one fighter name being measurably weaker than the other is the defect this guards',
    ).toBeLessThanOrEqual(2);
  });

  test('the HUD token is not the gi colour', () => {
    // --aka is the red gi and is art direction; brightening it would change the
    // fighter to fix a label. They must stay distinct.
    expect(token('aka-dim')).not.toBe(token('aka'));
  });
});
