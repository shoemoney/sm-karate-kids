/**
 * When does the pre-bout card's read budget start counting?
 *
 * The bug, in one line: it started at MODULE EVAL. `main.ts` calls
 * `newRun(performance.now())` at top level, which arms
 * `schedule(beginBout, ROUND_INTRO_MS, nowMs)` — and that runs before the first
 * `requestAnimationFrame`. So the nine seconds `ROUND_INTRO_MS` documents as
 * reading time were spent on boot instead, and on any device whose boot is
 * slower than nine seconds the card is added to the DOM and removed from it
 * inside a single frame. Never painted, never read, no error anywhere.
 *
 * Measured (`tools/card-no-probe.mjs`, `logs/card-no-probe.json`): boot took
 * 2700 / 4106 / 6250ms against the 9000ms budget at load 12.2 — 30%, 46%, 69%
 * of the player's reading time spent compiling shaders — and under load it
 * passed 9000ms, at which point the pre-bout card was never visible and
 * `result-card-fighters-clear.spec.ts` went red 7 of 12.
 *
 * This is the pure decision, separated from the render loop so it can be tested
 * without a browser. The same reasoning drove `tests/e2e/holdFloors.ts` into
 * `hold-floor-discriminates.test.ts`, and the reason is identical: a wall-clock
 * deadline cannot be tested in a unit test by waiting for it, so the arithmetic
 * is extracted and the clock is an argument.
 */

/** The pre-bout card's documented read budget. Mirrors `main.ts`. */
export const ROUND_INTRO_MS = 9_000;

/**
 * The absolute deadline at which the pending action should fire.
 *
 * `pendingAt` is the deadline the card was armed with; `presented` is the page
 * clock of the first frame that actually reached the screen; `handedOver` is
 * whether that frame has happened yet.
 *
 * Re-anchors to the first presented frame, and ONLY while the pre-boot card is
 * still up. Two reasons it is not unconditional:
 *
 *   - `handedOver` false means the first frame has not been presented, so this
 *     can only ever re-anchor the one deadline that exists at that moment (the
 *     first round card). Nothing else can be touched by accident.
 *   - Re-anchoring AFTER handover would be re-arming the REMATCH countdown on
 *     every subsequent round, which is a different timer with a different
 *     meaning (`REMATCH_AFTER_MS`) and its own tuned copy.
 *
 * An earlier version guarded with `pendingAt <= now` instead, reasoning that a
 * fast boot should change nothing. That is wrong in the worst way: the case that
 * still broke is a boot that consumes MOST of the budget rather than all of it —
 * first frame at 11000ms with the deadline at 12629ms — so the card was
 * presented with 1.6 seconds left. Half a fix for a full defect.
 */
export function preBoutDeadline(args: {
  pendingAt: number;
  presented: number;
  handedOver: boolean;
}): number {
  const { pendingAt, presented, handedOver } = args;
  if (handedOver) return pendingAt;
  if (pendingAt === 0) return pendingAt;
  return presented + ROUND_INTRO_MS;
}
