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
/**
 * Two fences, because round 110's mutation test found a gap in the first.
 *
 * Four of five mutations fired the correct assertion. The fifth — reverting
 * round 102's *computed* rules paragraph back to hand-written text — fired
 * nothing, because the glyph fence had no opinion about it. That is the fix
 * this loop is most proud of and the one that produced its generalisable lesson,
 * and it was the only one in the sheet with no assertion around it.
 */
describe('the rules paragraph is computed, not written', () => {
  test('the technique counts in the paragraph come from the move table', () => {
    // If a literal "20" or "10" appears in the sentence, it is hand-written
    // again and will disagree with the table the moment a move is added.
    const para = hud.match(/Point karate\.[\s\S]{0,600}?takes the round\.`;/);
    expect(para, 'could not find the techniques rules paragraph').not.toBeNull();
    const text = para?.[0] ?? '';
    expect(text, 'the paragraph hard-codes a technique count').toMatch(/\$\{all\.length\}/);
    expect(text, 'the paragraph hard-codes the half count').toMatch(/\$\{halfCount\}/);
    expect(text, 'the paragraph hard-codes the full count').toMatch(/\$\{fullCount\}/);
  });

  test('the round target comes from the ruleset, not from the sentence', () => {
    expect(hud).toMatch(/First to \$\{pointsToWin\}/);
    // The signature has to take it, or the template above is a lie.
    expect(hud).toMatch(/pointsToWin: number,/);
  });
});

/**
 * The briefing has to say what the move table requires, not what fits.
 *
 * Round 118 added a notation sentence to the pre-bout card. Round 120 shortened
 * it to satisfy a measured reading budget, and the shortened sentence said "one
 * stance input + one technique input" — which is wrong for the thirteen of
 * twenty moves whose `posture` is `stand`, because for those the stance stick
 * stays *centred*. Round 122 found it, from a reviewer, two rounds late.
 *
 * It passed 136 tests including every assertion in this file, because every
 * assertion here is about *shape* — is the ordering right, are the words
 * distinct, does the `+` span the row. None of them asks whether the sentence
 * is *complete*, and a shape test cannot: completeness is a property of the
 * copy against the data, and nothing in the repo was comparing those two.
 *
 * That is the round-120 mistake stated as a class. **A string measured against
 * a budget will be shortened until the measurement passes, and the measurement
 * does not notice what stopped being said.** So this asserts the sentence
 * covers the case the data says is the majority one.
 */
describe('the pre-bout briefing is complete, not merely short', () => {
  const main = read('../../src/main.ts');
  const moves = JSON.parse(read('../../data/../../../packages/content/data/moves.json') ?? '[]') as {
    posture?: string;
  }[];

  test('the data really does have a majority neutral-stance case', () => {
    // If this ever stops being true the assertion below is guarding nothing, and
    // it should fail loudly rather than pass against a changed world.
    const list = Array.isArray(moves) ? moves : [];
    expect(list.length, 'could not read the move table').toBeGreaterThan(0);
    const standing = list.filter((m) => m.posture === 'stand').length;
    expect(
      standing / list.length,
      'the neutral-stance majority is what makes the briefing sentence matter',
    ).toBeGreaterThan(0.5);
  });

  test('the briefing names the centred-stance option', () => {
    // Read the sentence out of whichever form it takes. It was a
    // `textContent` assignment until round 131, when the objective was appended
    // as a second child and the sentence became a `document.createTextNode`.
    // The fence caught that immediately — and it caught a *change of mechanism*,
    // not a change of meaning, which is the round-128 limit stated concretely: a
    // source-shaped assertion breaks when the shape moves even if the words do
    // not. It now reads the whole notation block and looks for the words.
    const note =
      main.match(/note\.textContent = '([^']+)'/) ??
      main.match(/document\.createTextNode\(\s*'(A move[^']+)'\s*\)/);
    expect(note, 'could not find the briefing notation sentence').not.toBeNull();
    const text = (note?.[1] ?? '').toLowerCase();
    expect(
      text,
      'the sentence implies both sticks must be used; the stance stick is left centred for most moves',
    ).toMatch(/centred|centered|neutral|standing/);
  });

  test('the briefing still names both inputs', () => {
    // The complement of the above: a sentence that stops naming the technique
    // input is short for the same reason the last one was.
    const note =
      main.match(/note\.textContent = '([^']+)'/) ??
      main.match(/document\.createTextNode\(\s*'(A move[^']+)'\s*\)/);
    expect((note?.[1] ?? '').toLowerCase()).toContain('technique');
  });

  test('the briefing states the objective, derived from the ruleset', () => {
    // Round 131. The card taught the notation and left "first to 2" on a screen
    // one tap away, so a first-time player was told the grammar of the game and
    // not the point of it. And the number must come from the ruleset, because
    // the techniques sheet computes its own paragraph from the same value and
    // two hand-written copies of a number is the defect this file exists to stop.
    expect(main, 'the pre-bout card does not state the win target')
      .toMatch(/First to \$\{content\.rulesets\[0\]!\.pointsToWin\} takes the round/);
  });
});

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

  test('the coach and the sheet name the same four technique actions', () => {
    // The disagreement that has reappeared five times in this log — r102, r105,
    // r109, r122 and now r124. Every instance is the same: the sheet's legend
    // and the coach's strip are changed on one side and not the other, and
    // because each is individually correct nothing in the repo notices.
    //
    // So compare them directly. The pairing is the thing that drifts, which is
    // exactly what round 110 found when the hand-written list shipped the same
    // word under two glyphs.
    const coachPairs = coach.match(/pairs:\s*\[([^\]]*sweep[^\]]*)\]/);
    expect(coachPairs, 'could not read the technique caption list from coach.ts').not.toBeNull();
    const legend = hud.match(/TECHNIQUE_ACTION: Record<AttackFamily, string> = \{([\s\S]*?)\};/);
    expect(legend, 'no TECHNIQUE_ACTION map in hud.ts').not.toBeNull();
    // Read BOTH sides into plain strings first. Writing `coach?.[1]` inside the
    // loop silently re-resolved the regexp against the wrong value and compared
    // against a stray `*` — which is a test that fails for the wrong reason and
    // would have been a waste of a round to diagnose later.
    const coachText = coachPairs?.[1] ?? '';
    const legendText = legend?.[1] ?? '';
    const actions = [...legendText.matchAll(/:\s*'([a-z]+)'/g)].map((m) => m[1] as string);
    expect(actions.length, 'could not read the sheet action map').toBe(4);
    for (const action of actions) {
      expect(coachText, `coach strip is missing the action "${action}" the sheet uses`)
        .toContain(action);
    }
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
