import { describe, expect, it } from 'vitest';
import { preBoutDeadline, heldDeadline, ROUND_INTRO_MS } from '../../src/preBoutBudget.js';

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

/**
 * A sheet opened over the card holds its countdown.
 *
 * `docs/COMPLETION-PLAN.md` item 1.2 has been closed since r136 with the accept
 * line "pressing it opens the techniques sheet and returns to the card". The
 * first half was true and measured. The second half was never true: the 9s
 * deadline fired with no reference to sheet state, `beginBout()` ran, and
 * `.result { display: none }` took the card away underneath the sheet.
 *
 * MEASURED, `tools/sheet-pause-probe.mjs` (load 8.5–10.2, 390x844), by walking
 * the journey rather than reading the code:
 *
 *   open the sheet, close it at 3.0s   -> card SHOWN,  clock at 0
 *   open the sheet, close it at 11.0s  -> card GONE,  clock running at 259
 *   never open it,     wait 11.0s     -> card GONE,  clock running at 285
 *
 * The first row is the positive control, and it is what makes the other two
 * mean something: the card survives the sheet, so the sheet is not what removes
 * it. The deadline is, and the deadline could not see the sheet.
 *
 * The arithmetic lives in `src/preBoutBudget.ts` for the same reason
 * `preBoutDeadline` does — a wall-clock deadline cannot be unit-tested by
 * waiting for one, so the clock is an argument. The browser-level claim is
 * `tools/sheet-pause-probe.mjs`, which exits non-zero while the claim is false.
 */
describe('heldDeadline', () => {
  it('pushes the deadline out by exactly the time the sheet was open', () => {
    // Measured pair from the failing probe: tapped at t=0 with the deadline at
    // +9000, sheet closed 11s later. Without the hold the card was gone.
    const deadline = heldDeadline(9_000, 11_000);
    expect(deadline).toBe(20_000);
    // The property that matters: the player is left with the budget they had at
    // the moment they tapped, not the budget minus the time they read.
    expect(deadline - 11_000).toBe(9_000);
  });

  it('gives back exactly the remaining budget, not a fresh one', () => {
    // The tap happened 2.5s into the card's life, so 6.5s were left. Reading
    // for 4s must leave 6.5s, not 9s — otherwise the hold becomes a way to
    // buy extra reading time by opening the sheet twice.
    const tappedAt = 2_500;
    const armedAt = 0;
    const heldFor = 4_000;
    const remainingAtTap = armedAt + ROUND_INTRO_MS - tappedAt;
    expect(remainingAtTap).toBe(6_500);
    expect(heldDeadline(armedAt + ROUND_INTRO_MS, heldFor) - (tappedAt + heldFor)).toBe(remainingAtTap);
  });

  it('is a no-op when nothing is scheduled', () => {
    // `pendingAt === 0` means "no deadline armed". Adding a hold to it would
    // invent a deadline out of nothing, and `act()` would then fire against an
    // action that is not there. This is the HUD's TECHNIQUES sheet during a live
    // bout, which has no pre-bout countdown at all.
    expect(heldDeadline(0, 11_000)).toBe(0);
  });

  it('leaves the deadline alone when no sheet is open', () => {
    // The ordinary path — nothing has been tapped, `heldMs` is 0 — must be
    // bit-identical, or every untouched round inherits a new arithmetic.
    for (const pendingAt of [1, 4_242, 9_000, 86_400_000]) {
      expect(heldDeadline(pendingAt, 0)).toBe(pendingAt);
    }
  });

  it('never shrinks a deadline, however long the hold', () => {
    // A negative hold is not reachable from the render loop (it is
    // `performance.now()` at close minus at open), but the function must not be
    // the thing that silently eats a budget if that ever stops being true.
    for (const heldMs of [0, 1, 4_000, 60_000, 10 ** 9]) {
      expect(heldDeadline(9_000, heldMs)).toBeGreaterThanOrEqual(9_000);
    }
  });
});
