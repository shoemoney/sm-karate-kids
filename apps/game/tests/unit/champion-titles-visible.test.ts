import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { recordPieces, recordRun } from '../../src/persist.js';

/**
 * The championship counter must be visible on the screen that awards it.
 *
 * This is the r158 shape — a state that becomes reachable is not a state that
 * has been reviewed — arrived at from a different direction. The CHAMPION card
 * was not missed by a reviewer: `champion` appears zero times in 11,007 lines
 * of REVIEW-LOOP.md, and the review set cannot photograph it, because reaching
 * it takes five consecutive won bouts and every result frame in
 * `tools/review-shots.mjs` is a single bout.
 *
 * The card's record line was a bare either/or:
 *
 *     newBest ? 'New best score' : `Best ${best} · titles ${n}`
 *
 * Two facts that are frequently BOTH true, with `titles` on the losing branch.
 * And the branch that loses is the one a first title always takes: `bestScore`
 * starts at 0 and a championship scores more than 0, so `newBest` is
 * necessarily true. The counter went 0 -> 1 with no on-screen trace, and only
 * ever appeared on a LATER run that failed to beat the same score.
 */

/** Renders pieces the way `main.ts` does, minus the DOM. */
function render(pieces: readonly ({ text: string } | { score: number })[]): string {
  return pieces.map((p) => ('score' in p ? String(p.score) : p.text)).join('');
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  // `persist.ts` reads `globalThis.localStorage?.` and falls back to defaults,
  // so without a stub every `recordRun` here would read a blank slate forever
  // and the two-run cases below could not be expressed.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('the record line on the card that ends a run', () => {
  it('counts the first title, which is the case the old line lost', () => {
    const { record, newBest } = recordRun(12_400, 4, true);
    expect(newBest).toBe(true); // the premise: a first title is ALWAYS a new best
    const line = render(recordPieces({ champion: true, newBest, record }));
    expect(line).toContain('titles 1');
  });

  it('still counts a second title when the run is also a best', () => {
    recordRun(12_400, 4, true);
    const { record, newBest } = recordRun(20_000, 4, true);
    expect(newBest).toBe(true);
    expect(render(recordPieces({ champion: true, newBest, record }))).toContain('titles 2');
  });

  it('keeps both facts when a championship is not a best score', () => {
    recordRun(30_000, 4, true);
    const { record, newBest } = recordRun(12_400, 4, true);
    expect(newBest).toBe(false);
    const line = render(recordPieces({ champion: true, newBest, record }));
    expect(line).toContain('30000'); // the standing best
    expect(line).toContain('titles 2');
  });

  it('leaves the defeat card exactly as it was', () => {
    const { record, newBest } = recordRun(12_400, 4, false);
    expect(newBest).toBe(true);
    expect(render(recordPieces({ champion: false, newBest, record }))).toBe('New best score');
  });

  it('leaves the defeat card that shows a standing record alone', () => {
    recordRun(30_000, 4, true);
    const { record, newBest } = recordRun(12_400, 1, false);
    expect(newBest).toBe(false);
    expect(render(recordPieces({ champion: false, newBest, record }))).toBe(
      'Best 30000 · titles 1',
    );
  });

  /**
   * The character budget. Rounds 119-122 measured this card's copy to the
   * character and cut it twice, so a fix that lengthened the line would trade a
   * real defect for a wrapping one. `New best score` and `Best N · titles N`
   * are the strings being replaced; this one must not be longer than the longer
   * of them at any title count.
   */
  it('does not lengthen the line it replaces', () => {
    const previous = 'New best score'.length;
    for (const titles of [1, 9, 10, 99, 100, 1000]) {
      const record = { bestScore: 30_000, bestRound: 4, championships: titles };
      const line = render(recordPieces({ champion: true, newBest: true, record }));
      const replacement = `Best 30000 · titles ${titles}`.length;
      expect(line.length).toBeLessThanOrEqual(Math.max(previous, replacement));
    }
  });
});

describe('main.ts actually renders the pieces', () => {
  /**
   * A pure function that nothing calls is the exact class this repo keeps
   * hitting — `coach-probe` had a positive arm nobody read, and r164b's whole
   * round was a guard wired to nothing. The assertions above would all stay
   * green if someone inlined the old `newBest ? ... : ...` branch back into the
   * card, so this pins the call site.
   */
  const src = readFileSync(
    fileURLToPath(new URL('../../src/main.ts', import.meta.url)),
    'utf8',
  );

  it('calls recordPieces for the detail line', () => {
    expect(src).toContain('recordPieces({ champion: won && last, newBest, record })');
  });

  it('no longer hand-writes the titles line', () => {
    expect(src).not.toContain('` · titles ${record.championships}`');
  });
});