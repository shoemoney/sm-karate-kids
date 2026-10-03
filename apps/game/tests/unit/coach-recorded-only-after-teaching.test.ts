import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `coach.dismiss()` must not record a lesson that was never shown.
 *
 * This is a source guard, and it is here for the same reason
 * `sheet-holds-prebout.test.ts` is a source guard: the defect it covers was
 * invisible to every other gate in the repo for a hundred and thirty-three
 * rounds. `tools/coach-probe.mjs` is the browser-level check and it exited 1
 * while this claim was false; this pins the invariant where a future edit will
 * actually trip over it. Neither subsumes the other — the probe cannot be a
 * unit test, and this cannot tell whether `dismiss()` is called.
 *
 * What happened, because the shape of it is the point:
 *
 *   - r3 added the first-run coach and logged it as the most productive round
 *     in the loop's history ("there was no onboarding at all").
 *   - r23 found the strip legible through the result card's REMATCH button and
 *     fixed it by adding `coach.dismiss()` to `clearBoutUi`.
 *   - `clearBoutUi` is also called by `startRound`, and `startRound` runs at
 *     boot on the tournament routes.
 *   - `dismiss()` was `retire()`, and `retire()` writes the "already seen" flag.
 *     So boot marked the coach seen before it had ever appeared, `show()` took
 *     its early return on every first run, and the strip could not render — for
 *     a tournament player, on any run, ever.
 *
 * Measured with `tools/coach-probe.mjs`, 390x844:
 *
 *   | arm                        | flag at ready | strip rendered |
 *   |----------------------------|---------------|----------------|
 *   | first run `/`              | true          | NO             |
 *   | first run `?mode=tournament` | true        | NO             |
 *   | first run `?mode=dojo`     | null          | yes, 2 halves  |
 *   | CONTROL returning `?mode=dojo` | true      | no (correct)   |
 *
 * The dojo arm is the reason this is a defect and not a design choice: the
 * identical code path renders there. The only difference is that dojo does not
 * call `startRound` at boot (`main.ts` — `if (tournament) newRun(...)`). And
 * the returning-player arm is why the probe was worth building: if all four
 * arms had answered "no strip", it would have passed on a build where
 * onboarding is simply gone.
 *
 * A correct r23 fix, one call site wider than it was meant for, that no gate
 * could see because the thing it broke only renders on a touch device and the
 * e2e suite runs desktop. The tenth drift in a row between what a file says and
 * what the product does.
 */
const coach = readFileSync(fileURLToPath(new URL('../../src/coach.ts', import.meta.url)), 'utf8');

/**
 * Strip `//` comments before any POSITIONAL assertion.
 *
 * The first version of this file compared `indexOf('clear()')` against
 * `indexOf('if (shown)')` inside `retire`, and failed — because the explanatory
 * comment for this very fix contains the sentence "`shown` is read before
 * `clear()`, which resets it". The assertion was measuring the prose about the
 * code. r156 found the same thing in a different tool: a CSS comment quoting a
 * colour made the literal counter report 13 instead of 10. An instrument that
 * reads its own documentation is not reading the code.
 */
const stripComments = (src: string): string =>
  src
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');

/** `retire`'s body, comment-stripped. Throws rather than narrowing, because a
 *  test that cannot find its subject should fail with that fact, not with a
 *  type error on `string | undefined`. */
const retireBody = (): string => {
  const m = coach.match(/const retire = \(\): void => \{([\s\S]*?)\n  \};/);
  if (m === null || m[1] === undefined) {
    throw new Error('retire() not found in coach.ts — its shape changed and this fence no longer reads it');
  }
  return stripComments(m[1]);
};

describe('the coach records a lesson only once it has given one', () => {
  it('writes the seen flag only when the strip was actually shown', () => {
    const src = retireBody();

    // The write must be inside a conditional on `shown`, not unconditional.
    expect(src).toMatch(/if \(shown\)\s+saveValue\(SEEN_KEY, true\)/);

    // And the guard must read `shown` BEFORE `clear()` resets it, or the
    // condition is always false and the lesson is never recorded at all —
    // onboarding that shows forever instead of onboarding that never shows.
    expect(src.indexOf('if (shown)')).toBeGreaterThanOrEqual(0);
    expect(src.indexOf('if (shown)')).toBeLessThan(src.indexOf('clear()'));
  });

  it('still removes the strip on a dismiss that never taught anything', () => {
    expect(retireBody()).toMatch(/clear\(\);/);
  });

  it('does not mark the coach seen from a call site that runs before a bout', () => {
    // The reason a conditional alone is not enough: nothing stops a future
    // caller from writing the flag directly. `main.ts` is the only file that
    // drives the coach, so it is asserted not to write the flag itself.
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    expect(main).not.toMatch(/saveValue\(\s*['"`]coach-seen/);
  });
});
