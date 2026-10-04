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