import { describe, expect, it } from 'vitest';
import { preBoutDeadline, ROUND_INTRO_MS } from '../../src/preBoutBudget.js';

/**
 * The pre-bout card's read budget is anchored to the first presented frame.
 *
 * The defect this guards was invisible to every gate in this repo for its whole
 * life, and it is worth saying why, because the shape of the hole is the point:
 * the card's auto-dismiss is a WALL-CLOCK deadline, so "the player got to read
 * the card" cannot be checked by a unit test that does not wait, and the e2e
 * test that did wait reported it as a 30-second timeout on
 * `waitFor('.result-reference')` — which reads as a flake and is not.
 *
 * So the arithmetic is extracted (`src/preBoutBudget.ts`) and the clock is an
 * argument. The browser-level consequence is covered by
 * `tests/e2e/prefight-card-budget.spec.ts`, which is the slow check; this is
 * the one that cannot go flaky, and it is the one that says WHY.
 */
describe('preBoutDeadline', () => {
  /**
   * Boots measured on this machine, `tools/card-no-probe.mjs`. Each is a real
   * navigation-to-`ready` time, and each is a number the deadline was losing.
   */
  const BOOTS = {
    fast: 1_200,
    /** 2700ms — 30% of the budget gone before the card was on screen. */
    typical: 2_700,
    /** 6250ms — 69% gone. The card appeared with under 3 seconds. */
    slow: 6_250,
    /** 9500ms — past the budget entirely; the card was never presented. */
    pastBudget: 9_500,
  };

  it('re-anchors to the first presented frame, not to module eval', () => {
    for (const [name, boot] of Object.entries(BOOTS)) {
      const armedAt = 0;
      const pendingAt = armedAt + ROUND_INTRO_MS;
      const deadline = preBoutDeadline({ pendingAt, presented: boot, handedOver: false });
      // Whatever the boot cost, the player gets the whole budget AFTER the card
      // is on screen. This is the claim, and it is the whole fix.
      expect(deadline, `boot=${name}`).toBe(boot + ROUND_INTRO_MS);
    }
  });

  it('never hands the player less than the full budget, whatever the boot cost', () => {
    // The specific case that broke the first version of the fix, which re-armed
    // only when the deadline had already expired. Boot consumed MOST of the
    // budget rather than all of it, the guard did not fire, and the card was
    // presented with 1.6 seconds left. These are the numbers that run measured,
    // so the deadline is still in the future at the moment the card appears.
    const boot = 11_000;
    const pendingAt = 12_629;
    const deadline = preBoutDeadline({ pendingAt, presented: boot, handedOver: false });
    expect(boot).toBeLessThan(pendingAt); // the deadline had NOT expired...
    expect(deadline - boot).toBe(ROUND_INTRO_MS); // ...and still got a full budget
  });

  it('leaves the deadline alone once the first frame has been presented', () => {
    // After handover this must not run, or it would re-arm the REMATCH
    // countdown — a different timer, with a different constant and its own copy
    // — on every subsequent round.
    const pendingAt = 4_242;
    expect(preBoutDeadline({ pendingAt, presented: 99_999, handedOver: true })).toBe(pendingAt);
  });

  it('is a no-op when nothing is pending', () => {
    // `pendingAt === 0` means "no deadline armed". Re-anchoring it would invent
    // one, and `act()` would then fire against an action that is not there.
    expect(preBoutDeadline({ pendingAt: 0, presented: 5_000, handedOver: false })).toBe(0);
  });

  it('leaves a still-future deadline alone on a fast boot, within a frame', () => {
    // On a device that boots in one frame the anchoring is a no-op in practice,
    // which is what keeps r119-r122's tuned constant meaning what it means today
    // for everyone whose hardware can afford it.
    const boot = 16;
    const deadline = preBoutDeadline({ pendingAt: ROUND_INTRO_MS, presented: boot, handedOver: false });
    expect(Math.abs(deadline - ROUND_INTRO_MS)).toBeLessThanOrEqual(boot);
  });

  it('pins the budget to the constant the rest of the game reads', () => {
    // If `ROUND_INTRO_MS` ever moves, this moves with it and says so. The
    // harness, the comment in main.ts and this file all quote 9000.
    expect(ROUND_INTRO_MS).toBe(9_000);
  });
});
