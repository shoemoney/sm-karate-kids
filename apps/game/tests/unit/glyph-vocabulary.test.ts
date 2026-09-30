import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const hud = read('../../src/hud.ts');
const coach = read('../../src/coach.ts');

/**
 * Two surfaces name the same five glyphs, and they are on screens a player
 * swipes between: the coach strip under the sticks, and the techniques sheet's
 * legend. Round 102's legend named the technique glyphs by their effect
 * (`punch`, `kick`) while the stick named them by their input (`forward`, `up`)
 * — so `▲` meant two different things. Round 103 removed the effect to fix it
 * and made the legend a copy of the stick instead. Round 104 found the honest
 * answer: name both, in one entry.
 *
 * That took three rounds, and the reason it took three rounds is the point of
 * this file. The defect was never a missing value or a typo — it was a *decision*
 * made in one place and realised differently in another, and no gate in this
 * repo reads two files and compares what they decided. A reviewer reading the
 * sheet and the stick *together* found all three instances. So this does.
 *
 * What it cannot do is catch the next disagreement that is not about a glyph.
 * It is a specific fence around a specific three-round failure, not a general
 * consistency checker, and pretending otherwise would be the same over-claiming
 * that produced rounds 78 and 90.
 */
describe('the glyph vocabulary is decided once', () => {
  test('the technique legend carries the direction and the action together', () => {
    // Both halves, in one word. Direction-only was round 103 and it was a copy
    // of the stick; action-only was round 102 and it contradicted the stick.
    expect(hud).toMatch(/TECHNIQUE_ACTION: Record<AttackFamily, string>/);
    expect(hud).toMatch(/`\$\{f\} · \$\{TECHNIQUE_ACTION\[f\]\}`/);
  });

  test('the technique legend is not a bare copy of the stick directions', () => {
    // The exact shape round 103 shipped. If this ever comes back, the legend has
    // stopped earning the nine lines it costs.
    expect(hud).not.toMatch(/TECHNIQUE_WORD: Record<AttackFamily, string> = \{\s*forward: 'forward'/);
  });

  test('the stance words are distinct', () => {
    // Round 100 shipped `up: 'step back'` and `back: 'step back'` — the same
    // word under two glyphs, in a legend whose only job is to tell them apart.
    const block = hud.match(/STANCE_WORD: Record<Qualifier, string> = \{([\s\S]*?)\};/);
    expect(block, 'no STANCE_WORD map').not.toBeNull();
    const words = [...((block?.[1] ?? '').matchAll(/:\s*'([^']+)'/g) ?? [])].map((m) => m[1]);
    expect(words.length).toBe(5);
    expect(new Set(words).size, `duplicate stance word in: ${words.join(', ')}`).toBe(words.length);
  });

  test('both legend halves are laid out in two columns, not stacked', () => {
    // Round 104: nine stacked rows pushed the first move name off a phone
    // screen, to fix a glyph nobody could read. The fix for an unexplained
    // symbol must not cost more than the symbol.
    const css = read('../../src/styles.css');
    const key = css.match(/\.tech-key \{([\s\S]*?)\}/);
    expect(key, 'no .tech-key rule').not.toBeNull();
    expect(key?.[1] ?? "").toMatch(/grid-template-columns/);
  });

  test('the coach strip labels the same four technique directions the glyph map uses', () => {
    // The other half of the round-102 defect. The coach is the surface the
    // player's thumb is actually on, so it is the one that gets to be right
    // about what a direction is called.
    for (const word of ['back', 'forward', 'up', 'down']) {
      expect(coach, `coach does not label the ${word} technique`).toContain(word);
    }
  });

  test('the two horizontal stance directions are named differently', () => {
    // r109: the coach said `◀ step` and `▶ step` while the technique stick said
    // `back` and `forward`, so the sheet taught a distinction the coach did not
    // make and a player could not tell which way "step" went.
    //
    // The first version of this assertion compared the two *alphabetically
    // first* caption words, which differ on healthy code AND on the broken code
    // — it passed on `['◀ step','▲ jump','▶ step','▼ crouch']`, the exact defect
    // it was written to catch. Verified by reverting the fix and re-running:
    // 7 passed. A gate that cannot fail is worse than no gate, because it is
    // read as evidence.
    //
    // So this reads the pairs in DOM order and compares the two *arrowed*
    // horizontal ones, which is the pair that has to differ.
    const line = coach.match(/title:\s*'Stance',\s*pairs:\s*\[([^\]]*)\]/);
    expect(line, "no `title: 'Stance', pairs: [...]` row in coach.ts").not.toBeNull();
    const pairs = [...((line?.[1] ?? '').matchAll(/'([^']+)'/g) ?? [])].map(
      (m) => m[1] as string,
    );
    expect(pairs.length, `read ${pairs.length} stance captions`).toBe(4);
    const byArrow = (arrow: string): string => {
      const hit = pairs.find((c) => c.startsWith(arrow));
      expect(hit, `no stance caption for ${arrow}`).toBeDefined();
      return (hit ?? '').replace(/^\S+\s*/, '').trim();
    };
    const left = byArrow('◀');
    const right = byArrow('▶');
    expect(
      left,
      `stance left is "${left}" and stance right is "${right}" — if these match, the player cannot tell which way to step, which is the r109 defect`,
    ).not.toBe(right);
  });

  test('the + between the two legend halves spans the full row', () => {
    // r109: the two-column layout made the `+` a grid item, so it landed in
    // column two of the STANCE list's last row — inside one of the two lists it
    // was meant to separate. It looked like a divider in every screenshot taken
    // for three rounds, which is the same failure as the dead rule r105 found:
    // the render is right and the intent is not.
    const css = read('../../src/styles.css');
    expect(css).toMatch(/\.tech-key > \.tech-plus \{[^}]*grid-column:\s*1 \/ -1/);
  });
});
