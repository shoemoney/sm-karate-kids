import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The two halves of the first-run coach plate must scan the same way.
 *
 * `.coach-legend` is a 2-column grid filled row-major from the `pairs` array in
 * coach.ts, and the two `.coach-half` blocks sit side by side on one baseline
 * grid. So the array order IS the reading order of the plate, and the two
 * arrays disagreeing is a real defect rather than a style preference: a player
 * who learns the scan on the stance half mis-scans the technique half.
 *
 * It shipped that way and nothing could see it, because the strip could not
 * render at all — `retire()` wrote the "already seen" flag at boot from r23
 * until r157, so no frame in 157 rounds of review ever contained the plate.
 * The same class as rounds 102-105 and 103/104, which this file's sibling
 * `glyph-vocabulary.test.ts` already fences for the WORDING: two surfaces
 * making one decision independently, each individually correct.
 *
 * This fence is the static half and `tools/coach-legend-probe.mjs` is the
 * measured half — the probe reads the order off a rendered page, this one runs
 * in `pnpm check` where a browser does not. The probe additionally checks the
 * rendered geometry, which a regex cannot see.
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const coach = read('../../src/coach.ts');
const css = read('../../src/styles.css');

/** The leading arrow glyph of every entry in a `pairs: [...]` list. */
const arrowsIn = (source: string, needSweep: boolean): string[] => {
  const m = source.match(
    needSweep ? /pairs:\s*\[([^\]]*sweep[^\]]*)\]/ : /pairs:\s*\[([^\]]*crouch[^\]]*)\]/,
  );
  expect(m, `could not read a pairs list containing ${needSweep ? 'sweep' : 'crouch'}`).not.toBeNull();
  const entries = (m?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0);
  expect(entries.length, `expected 4 entries, read ${entries.length}`).toBe(4);
  return entries.map((e) => e.slice(0, 1));
};

describe('the first-run coach plate', () => {
  test('both halves wrap in the same arrow order', () => {
    const stance = arrowsIn(coach, false);
    const technique = arrowsIn(coach, true);
    expect(
      stance.join(''),
      'the stance half reads ' +
        stance.join(' ') +
        ' while the technique half reads ' +
        technique.join(' ') +
        '. One plate, one baseline grid, two different scan patterns.',
    ).toBe(technique.join(''));
  });

  test('the halves are separated by a visible rule, not a gutter', () => {
    // Measured: the plate had a 12px gutter between halves against an 8px
    // gutter inside them. A 4px difference does not read as a boundary — the
    // plate was one four-column table with "back" appearing twice on the first
    // line and nothing marking which stick owned which.
    const rule = css.match(/\.coach-half \+ \.coach-half \{([^}]*)\}/);
    expect(rule, 'no .coach-half + .coach-half rule').not.toBeNull();
    expect(rule?.[1] ?? '').toMatch(/border-left:\s*1px solid/);
  });

  test('the plate is two content-sized halves, not two equal columns', () => {
    // The stance half carries no action gloss, so its cells are far narrower
    // than the technique half's. `1fr 1fr` reserves the wider column's width
    // for both and leaves a hole in the middle of the plate.
    const strip = css.match(/\.coach-strip \{([^}]*)\}/);
    expect(strip, 'no .coach-strip rule').not.toBeNull();
    expect(strip?.[1] ?? '').toMatch(/grid-template-columns:\s*repeat\(2, auto\)/);
  });
});