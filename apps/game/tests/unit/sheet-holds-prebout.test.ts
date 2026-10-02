import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The card's TECHNIQUES button must HOLD the pre-bout countdown, not merely
 * open the sheet.
 *
 * This is a source guard, and it is here because of the shape of the defect it
 * covers. `tests/unit/pre-bout-budget.test.ts` pins the arithmetic, and it was
 * green while the game dropped the player into a live fight mid-read — because
 * the arithmetic was never wired to the button in the first place. A correct
 * pure function that nothing calls reports nothing.
 *
 * So this reads `main.ts` and asserts the wiring exists. It is deliberately the
 * weak kind of test — a grep is not a browser — and `tools/sheet-pause-probe.mjs`
 * is the browser-level check, which exits non-zero while the claim is false. Both
 * exist because neither subsumes the other: the probe cannot be a unit test, and
 * a unit test cannot see whether the function is called.
 */
const main = readFileSync(resolve(import.meta.dirname, '../../src/main.ts'), 'utf8');

describe('the pre-bout card holds its countdown while the sheet is open', () => {
  it('wires the card TECHNIQUES button to the hold', () => {
    // The card's own button is the one that opens a hold. It is the button the
    // plan's accept line is about ("pressing it opens the techniques sheet and
    // returns to the card"), and the one whose deadline is running underneath.
    //
    // Matched as one contiguous call rather than a slice between two markers:
    // `rematch: () => act()` appears four times in this file, so an index-based
    // slice silently took the wrong pair and produced an empty string, which
    // the first version of this test then reported as "the block moved". A
    // guard that fails on its own anchor is a guard that cannot be trusted to
    // fail on the defect.
    expect(
      main,
      "the card's TECHNIQUES button opens the sheet without passing holdForSheet, so the 9s budget runs underneath it",
    ).toMatch(/toggleSheet\(byId<HTMLElement>\('tech-ref'\), true, settings\.get\(\)\.reducedMotion, holdForSheet\)/);
  });

  it('does NOT hold for the HUD TECHNIQUES button', () => {
    // The negative half, and it is the half that matters for the next reader.
    // The HUD button is reachable during a live bout, where there is no
    // pre-bout countdown to hold. Wiring it to the hold would be a different
    // bug in the same place, so the distinction is asserted rather than left as
    // a comment for someone to reverse-engineer.
    //
    // Anchored on the literal handler line, so it stays honest if `main.ts` grows
    // more `btn-techniques` calls in other files' style.
    const hudButton = main.match(
      /byId<HTMLButtonElement>\('btn-techniques'\)[\s\S]*?\n\s*\}\);/,
    );
    expect(hudButton, 'the HUD TECHNIQUES handler moved').not.toBeNull();
    expect(hudButton?.[0], 'the HUD TECHNIQUES button must not hold a pre-bout deadline').not.toMatch(/holdForSheet/);
  });

  it('pays the hold back on close, not only on open', () => {
    // Recording the open time is half a fix. If the close never writes it back,
    // the deadline is pushed out and the countdown silently restarts — the
    // player gets the budget again, and no gate anywhere reports it.
    const closeHandler = main.match(/byId<HTMLButtonElement>\('tech-ref-close'\)[\s\S]*?\n\s*\}\);/);
    expect(closeHandler, 'the sheet close handler moved').not.toBeNull();
    expect(closeHandler?.[0], 'closing the sheet does not pay the hold back').toMatch(/holdForSheet/);
  });

  it('holds the deadline while the sheet is open, in the frame loop', () => {
    // The loop has to extend the deadline on every frame the sheet is up, not
    // only at the moment of the tap. A single extension at open time would
    // cover the first few hundred milliseconds of reading and then let the
    // clock run out under the sheet again — which is the bug, narrower.
    expect(main, 'the frame loop no longer extends the deadline').toMatch(
      /if \(sheetOpenSince !== 0\) pendingAt = heldDeadline\(pendingAt, now - sheetOpenSince\);/,
    );
  });

  it('keeps the ordinary path untouched — no hold, no change', () => {
    // `sheetOpenSince === 0` is the entire default state of the game. If this
    // guard is ever true the hold is running on a round nobody opened a sheet
    // on, and every deadline in the game is silently wrong.
    expect(main).toMatch(/let sheetOpenSince = 0;/);
  });
});