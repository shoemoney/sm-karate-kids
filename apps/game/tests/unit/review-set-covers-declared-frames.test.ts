import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const shots = readFileSync(join(here, '../../../../tools/review-shots.mjs'), 'utf8');
const manifestRaw = readFileSync(join(here, '../../../../tools/review-frames.tsv'), 'utf8');

/* r171. The review set is this loop's primary instrument and nothing said what
 * it had to contain.
 *
 * `tools/verify_shots.py` asked "is this a real render from a bout that was
 * actually played?" and never "is every state still here?". `MIN_FRAMES` is a
 * floor on a COUNT, so measured on this game's own set: delete 13 of 22 frames
 * and the gate answers `OK 9 frames, 9 distinct`. Gone in that pass — the
 * techniques sheet, the result card, desktop entirely, the high-contrast mode,
 * the bracket, the airborne fighter, the returning-player control. The frames
 * rounds 96-154 are findings *about*.
 *
 * And it is not hypothetical that frames go missing, because the harness is
 * built to skip one: three captures carry a guard that `return`s without
 * writing a file. On the very run that found this, two of them fired and
 * `verify_shots.py` still returned 0.
 *
 * So there are two halves, and this file is the one that runs in `pnpm check`.
 * `verify_shots.py --frames` catches the RUN — a declared frame that was not
 * written. This catches the AUTHOR — a capture added to `review-shots.mjs` with
 * no row saying which state it photographs. Offline, offline-fast, and it fails
 * the moment someone adds shot 24 rather than six rounds later when a reviewer
 * is looking at a set that quietly does not have it.
 *
 * r158's sentence, pointed at the loop's own reviewer instead of the game:
 * a state that becomes reachable is not a state that has been reviewed. */

/** Block comments first, then line comments that are not part of a URL. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');
}

const code = stripComments(shots);

/** Every frame the harness writes, from `boot('x')` and `await capture('x',`. */
const captured = [
  ...[...code.matchAll(/(?:await\s+capture|await\s+boot)\(\s*'([^']+)'/g)].map((m) => m[1]!),
];

/** The manifest's rows, minus comments. A tab-separated file, house style. */
const declared = manifestRaw
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [name, kind, state, why] = line.split('\t').map((f) => (f ?? '').trim());
    return { name: name!, kind: kind ?? '', state: state ?? '', why: why ?? '' };
  });

describe('review set: every capture is declared, and every declaration is a capture', () => {
  test('the capture tool and the manifest agree, in both directions', () => {
    // One direction is a coverage hole; the other is a row that will outlive
    // the capture it describes, which is a stale contract of exactly the kind
    // r151 found five of. Both are checked because either one alone is a gate
    // that can pass while reporting something else.
    expect(
      captured.filter((name) => !declared.some((d) => d.name === name)),
      'review-shots.mjs writes a frame that tools/review-frames.tsv does not declare',
    ).toEqual([]);
    expect(
      declared.filter((d) => !captured.includes(d.name)).map((d) => d.name),
      'tools/review-frames.tsv declares a frame the capture tool never writes',
    ).toEqual([]);
  });

  test('the harness writes something and the manifest declares something', () => {
    // A pair that is empty on both sides agrees with itself. r170's lesson, and
    // the reason the mutation harness runs a baseline first.
    expect(captured.length, 'no capture found in review-shots.mjs — the parse is wrong').toBeGreaterThan(0);
    expect(declared.length, 'no row in tools/review-frames.tsv — the parse is wrong').toBeGreaterThan(0);
  });

  test('every kind is one the gate knows', () => {
    // `verify_shots.py` reads this column and treats anything else as
    // INCONCLUSIVE. A typo here would fail every review run with a diagnosis
    // that points at the wrong file.
    expect(
      declared.filter((d) => d.kind !== 'capture' && d.kind !== 'opportunistic').map((d) => `${d.name}:${d.kind}`),
      'a row declares a kind the gate does not recognise',
    ).toEqual([]);
  });

  test('every row says what it covers and why it is in the set', () => {
    // The manifest is the only place that records why a frame exists. r163
    // added a capture for the ladder "because the previous round added a
    // capture for the settings screen and a reviewer said the settings screen
    // looked like a bracket" — a reason that only survived in the capture's own
    // comment, which no gate reads and no reviewer sees.
    expect(declared.filter((d) => !d.state).map((d) => d.name), 'a row declares no state').toEqual([]);
    expect(declared.filter((d) => !d.why).map((d) => d.name), 'a row gives no reason').toEqual([]);
  });
});

/* r172. The three frames that could not find their subjects, and what it took.
 *
 * The coverage contract above says WHICH states the set must contain. It says
 * nothing about whether a capture can still SEE the thing it photographs, and
 * that turned out to be the half of the problem r171 could not reach: the set
 * did contain a `19-phone-half-point` row, and the capture was watching for an
 * element that has not existed since r148.
 *
 * Three assertions, each written to be RED on the source this round replaced.
 * None of them is a general "does the selector resolve" check — that would need
 * a DOM, and a static one that greps the source hits the same trap r153 fell
 * into, where a class named in prose inside a comment counts as a class that
 * exists. So each names the specific thing that broke. */

/** The game's own tripwire, so the two files cannot disagree about it. */
const notation = readFileSync(join(here, '../../src/spriteFrames.ts'), 'utf8');
void notation;

describe('review set: a capture cannot be watching for something the game deleted', () => {
  test('no capture polls `.score-frac`, which r148 deleted', () => {
    // `scoreFragment` emits the whole number and the `½` as ONE text node.
    // `styles.css` says there is deliberately no `.score-frac` rule any more and
    // `score-notation.test.ts` is a tripwire against one returning — so a capture
    // that polls for one matches nothing, ever.
    //
    // Measured: `19-phone-half-point` had a **0%** hit rate in every review run
    // from r148 to r172, and four review passes had argued about that
    // notation on sets where the half point was in none of them. The guard's
    // "8 firings" in the retained logs was an undercount of a total failure.
    expect(
      code.match(/score-frac/g) ?? [],
      'review-shots.mjs polls .score-frac — an element r148 deleted, so it matches nothing',
    ).toEqual([]);
  });

  test('the half-point capture looks for the notation that actually ships', () => {
    // The positive direction, so the test above cannot be satisfied by deleting
    // the capture: `½` in the score element's own text, checked BOTH before and
    // after the shutter. The second check is not decoration — a screenshot is
    // ~200ms of a game that is still running.
    expect(code, 'the half-point capture does not test for the `½` glyph').toMatch(/½/);
    expect(code, 'the half-point capture reads neither score element').toMatch(/#points-0[\s\S]{0,200}#points-1/);
    const reads = code.match(/textContent\.includes\('½'\)/g) ?? [];
    expect(
      reads.length,
      'the `½` check runs once; the capture sandwiches the shutter so it runs twice',
    ).toBeGreaterThanOrEqual(1);
  });

  test('every capture that declines to write a frame says so through `miss()`', () => {
    // r171's defect in one line: a guard that `return`s and prints a warning is
    // a hole in the set that nothing turns red. r172 routed all five through
    // `miss()`, which records the miss and — for a row declared `capture`, read
    // from the same manifest the gate reads — sets exit 1. Asserted on the
    // string rather than on a parse, because the failure it guards is exactly a
    // path that never reaches `miss()` and would not be seen by one.
    expect(
      [...code.matchAll(/frame not written/g)].length,
      'review-shots.mjs skips a frame without going through miss()',
    ).toBe(1);
    expect(code, 'miss() does not exist, so a skip cannot be recorded').toMatch(/const miss = /);
    expect(code, 'miss() does not honour the manifest, so an expected miss would cry wolf').toMatch(
      /declaredCapture\.has\(name\)/,
    );
  });
});
