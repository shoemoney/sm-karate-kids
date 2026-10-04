#!/usr/bin/env node
/**
 * Does the record line on the card that ends a run actually reach the SCREEN?
 *
 * Why this probe exists
 * ---------------------
 * `champion` appeared zero times in 11,007 lines of REVIEW-LOOP.md before round
 * 166, and no frame in `tools/review-shots.mjs` can reach the state: the card
 * that ends a run needs five consecutive won bouts, and every result frame in
 * the set is a single bout. This is r158's shape exactly — "a state that becomes
 * reachable is not a state that has been reviewed".
 *
 * The defect it was written against, on that card:
 *
 *     detail: newBest ? 'New best score' : `Best ${best} · titles ${n}`
 *
 * Two facts that are frequently BOTH true, with `titles` on the losing branch. A
 * first title always takes the winning branch — `bestScore` starts at 0 and a
 * championship scores more than 0 — so the counter went 0 -> 1 with no on-screen
 * trace at all, and only ever appeared on a LATER run that failed to beat the
 * same score. The one number recording the rarest achievement in the game was
 * shown precisely when the player had done worse.
 *
 * WHAT THIS GATE COVERS, AND WHAT IT DOES NOT — read this before trusting it
 * ----------------------------------------------------------------------
 * **It covers the line reaching the DOM, and it does NOT decide the branch.**
 *
 * That split is the whole design, and it was measured rather than assumed:
 *
 *   - The BRANCH is owned by `apps/game/tests/unit/champion-titles-visible.test.ts`,
 *     which runs the real `recordRun` and the real `recordPieces` over the
 *     champion/newBest matrix and is proved red by mutation.
 *   - This probe reaches a real card in a real browser and reads the rendered
 *     text. Nothing else does that. Before this round **no assertion anywhere in
 *     the repo touched `.result-detail`** — the unit test renders the pieces
 *     through its own local `render()` helper and never builds a DOM node, and
 *     its guard on the call site is `expect(src).toContain('recordPieces(...)')`,
 *     a string match on the source. That cannot see a call site that runs and
 *     then drops a piece, appends it to the wrong node, or never appends it.
 *     This is the "declared but never invoked" class this repo has hit four
 *     times, and a source match is one of its weaker forms.
 *
 * **It would NOT, on its own, have caught the r166 defect.** Stated plainly
 * because it is the obvious question and the answer is unflattering: this probe
 * seeds an unreachable `bestScore` of 30,000, so `newBest` is false and the card
 * lands on the `Best N · titles M` branch — which is the branch the buggy code
 * also rendered. Restoring the old `newBest ? ... : ...` line leaves this probe
 * GREEN. Verified by mutation; see `tools/champion-probe-mutation.sh`. The
 * champion branch, where the count used to be lost, is not reachable in a
 * browser at all, because it needs a bot that can win five bouts, and r167
 * measured that a competent flick bot reaches the semi-final and no further:
 *
 *     throw only in range  1.6 -> loses the qualifier
 *                        2.6 -> clears 1, out in the Regional
 *                        3.2 -> clears 3, out in the Semi-final   (best)
 *                        4.5 -> clears 1, then the bout never ended
 *                       99   -> clears 2, out in the Quarter-final
 *
 * A gate that needs a skilled player to go green is a gate that flakes and then
 * gets deleted, and r141 recorded the reason: a gate that cries wolf is worse
 * than no gate.
 *
 * WHY THE PLAYER DOES NOTHING — the change at this round
 * ------------------------------------------------------
 * The first version drove a flick bot, and it did not reproduce: arms 2 and 3
 * read their exact strings at load 19-30, and at load 60-106 the same arms read
 * `undefined` because the bot's run had not ended inside its budget. r167 left
 * it wired into nothing and asked the next round with a quiet box to make it
 * green or delete it.
 *
 * On a quiet box (load 10-12) it went 3 arms green and 1 arm `undefined` — and
 * that is the detail worth keeping, because it is NOT what a busy machine looks
 * like. A busy machine loses all four arms, because it is busy for all four.
 * One arm in four means the question was never "was the box busy" but "what was
 * that arm's run doing", which is a question about the bot.
 *
 * So the bot is gone, and that is the fix. **An idle player is the deterministic
 * version of the same journey.** The CPU beats a player who does nothing, the
 * run ends DEFEATED, and the seeded store's unreachable 30,000 puts the card on
 * the branch every arm asserts. Measured, four arms, on this box:
 *
 *     titles 0  17.1s   Best 30,000 · titles 0
 *     titles 1  17.4s   Best 30,000 · titles 1
 *     titles 2  17.1s   Best 30,000 · titles 2
 *     titles 5  17.8s   Best 30,000 · titles 5
 *
 * A **0.7s spread over four runs** where the flick bot's run length depended on
 * how well it happened to be playing. The verdict no longer depends on a bot's
 * luck, which is the only property r141 said a gate here has to have.
 *
 * FIVE ARMS, and why each is needed:
 *
 *   1. CONTROL — a run reaches its end card and the card is painted. Without it
 *      a probe that never finished a run reports "no title count" about every
 *      arm and looks like a pass, which is r155's instrument: an assertion that
 *      cannot fail.
 *   2. A FRESH STORE, unseeded — a first-time player's real state, rendered from a
 *      blank record. Note what it does NOT do: it cannot reach the
 *      `New best score` branch, because an idle player scores 0 and `newBest` is
 *      `score > bestScore`, so `0 > 0` is false. Measured, not assumed — the first
 *      run of this rewrite asserted that branch and read `Best 0 · titles 0`.
 *      Which means **neither `newBest: true` branch is reachable by this probe**,
 *      for the same reason: both need a player who scores, and this player does
 *      not. That is the coverage, and it is stated here rather than discovered by
 *      the next reader.
 *   3-5. THREE DIFFERENT STORED COUNTS — 0, 1 and 2 — each reading its own
 *      number. A probe that only ever sees `titles 1` cannot tell a record from
 *      a constant, which is the mistake r163 caught in the coach legend.
 *   6. The standing best is still on the line beside the count, so a fix did not
 *      buy the count by dropping the other fact.
 *
 * The store is seeded with `addInitScript`, which is how a returning player is
 * simulated. `recordRun` reads the record, folds the run in and writes it back,
 * so what the card shows is read from storage through the real path.
 *
 * EVERY ROW PRINTS THE HOST LOAD. r151's standing instruction, and not a
 * formality here: this box does not idle (~10-13 from other work at rest), and a
 * probe whose budget is wall-clock is the one place that matters. The elapsed
 * time per arm is printed too — the determinism claim above is a measurement,
 * and a reader should be able to see it on any run rather than take it on faith.
 *
 * SMKK_BASE points at a server. Otherwise this harness spawns and kills its own
 * preview on 4188 — a benchmark whose subject can vanish between the build and
 * the measurement is measuring something else.
 *
 * Proved able to fail: `tools/champion-probe-mutation.sh`.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startPreview } from './bench-server.mjs';
import { hostLoad } from './host-load.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const GAME_DIR = resolve(HERE, '..', 'apps', 'game');
const VIEWPORT = { width: 390, height: 844 };
/** Measured at 17.1-17.8s across four arms; this is ~5x the worst case. */
const BOUT_MS = 90_000;

const server = process.env.SMKK_BASE ? null : await startPreview(GAME_DIR);
const BASE = process.env.SMKK_BASE ?? server.url;

const failures = [];
const note = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch();
const ENDS_RUN = /CHAMPION|DEFEATED/;

/**
 * Plays no touch input at all — deliberately, and see the header.
 *
 * The only press is FIGHT, to get past the pre-bout card. After that the CPU
 * does what it does, the run ends, and the card is read off the rendered DOM.
 */
async function run(seed) {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  if (seed !== null) {
    await page.addInitScript((value) => {
      window.localStorage.setItem('smkk:tournament', value);
    }, JSON.stringify(seed));
  }
  await page.goto(`${BASE}/?mode=tournament`);
  await page.waitForFunction(() => globalThis.__smkk?.ready === true, null, { timeout: 90_000 });

  const fight = page.locator('.result-rematch');
  if (await fight.isVisible().catch(() => false)) await fight.click().catch(() => {});
  await page.waitForTimeout(400);

  const started = Date.now();
  const until = started + BOUT_MS;
  let card = null;

  while (Date.now() < until) {
    const seen = await page.evaluate(() => {
      const el = document.querySelector('.result');
      const text = (s) => document.querySelector(s)?.textContent?.trim() ?? '';
      return {
        phase: el?.getAttribute('data-phase') ?? null,
        headline: text('.result-headline'),
        score: text('.result-score'),
        detail: text('.result-detail'),
        visible: el === null ? false : getComputedStyle(el).display !== 'none',
      };
    });
    if (seen.visible && ENDS_RUN.test(seen.headline ?? '')) {
      card = seen;
      break;
    }
    await page.waitForTimeout(400);
  }

  const elapsed = Date.now() - started;
  await context.close();
  return { card, elapsed };
}

/** A stored best of 30,000 is unreachable for a run this player can score. */
const seeded = (championships) => ({ bestScore: 30_000, bestRound: 4, championships });

console.log(`base ${BASE}  viewport ${VIEWPORT.width}x${VIEWPORT.height}`);
console.log('idle player — no touch input after the FIGHT press');
console.log('');

// ---- arm 1: CONTROL. A run reaches the card that ends it, and it is painted. --
const control = await run(seeded(5));
note(control.card !== null, `control: a run reached the card that ends it (${(control.elapsed / 1000).toFixed(1)}s)`);
note(control.card?.visible === true, 'control: the card was on screen, not merely in the DOM');
note(
  /CHAMPION|DEFEATED/.test(control.card?.headline ?? ''),
  `control: the card names the outcome (read "${control.card?.headline}")`,
);
note(
  /\d/.test(control.card?.score ?? ''),
  `control: the card carries a run score (read "${control.card?.score}")`,
);
note(
  /\btitles 5\b/.test(control.card?.detail ?? ''),
  `control: the count came from the store, not a constant (read "${control.card?.detail}")`,
);

// ---- arm 2: a FRESH store — the first-time player's real state. --------------
// Unseeded, so the store holds `{bestScore: 0, championships: 0}` and the card
// must render that zeroed record without complaint. This is the state every real
// first-time player meets.
//
// CORRECTED at the first run of this rewrite, and the correction is the point.
// The arm was written to reach the `New best score` branch, on the reasoning
// that a blank store means `bestScore: 0` and therefore any run score beats it.
// It does not: **an idle player scores exactly 0, and `newBest = 0 > 0` is
// false.** So the card lands on the same `Best N · titles M` branch as every
// other arm, and it read `Best 0 · titles 0`.
//
// That is not a bug in the game, and it is not the assertion being weakened to
// match what came out. It is a fact about the coverage, and it is worth more
// than the branch I was reaching for:
//
//   **An idle player scores 0, so `newBest` is never true, so NEITHER
//   `newBest: true` branch is reachable by this probe.** The `New best score`
//   branch and the champion branch `titles N · new best` — the one the r166
//   defect destroyed — are both out of reach, for the same reason: both require
//   this player to score, and this player does not.
//
// So the arm asserts what it genuinely establishes, which is still a browser
// assertion and not a tautology: a brand-new store renders a record line, with
// the zeroed count on it, on the card a first-time player actually sees.
const fresh = await run(null);
note(fresh.card !== null, `fresh store: a first run reached its card (${(fresh.elapsed / 1000).toFixed(1)}s)`);
note(
  /\btitles 0\b/.test(fresh.card?.detail ?? ''),
  `fresh store: a blank record renders a zeroed count (read "${fresh.card?.detail}")`,
);
note(
  /\bBest\b/.test(fresh.card?.detail ?? ''),
  `fresh store: and it renders the standing record beside it (read "${fresh.card?.detail}")`,
);

// ---- arms 3-5: three different stored counts, each reading its own number ----
for (const championships of [0, 1, 2]) {
  const { card, elapsed } = await run(seeded(championships));
  note(card !== null, `titles ${championships}: the run reached its end card (${(elapsed / 1000).toFixed(1)}s)`);
  note(
    new RegExp(`\\btitles ${championships}\\b`).test(card?.detail ?? ''),
    `titles ${championships}: the card shows "titles ${championships}" (read "${card?.detail}")`,
  );
  if (championships === 2) {
    note(
      /30[.,\s ]?000/.test(card?.detail ?? ''),
      `titles 2: the standing best is still on the line beside it (read "${card?.detail}")`,
    );
  }
}

console.log('');
console.log(`host-load: ${hostLoad() ?? 'UNAVAILABLE'}`);
console.log(
  failures.length === 0 ? 'RECORD LINE OK' : `RECORD LINE FAILED (${failures.length})`,
);
await browser.close();
await server?.stop();
process.exit(failures.length === 0 ? 0 : 1);
