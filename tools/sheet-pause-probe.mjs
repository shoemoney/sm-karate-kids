/**
 * Does the pre-bout card's TECHNIQUES button actually "return to the card"?
 *
 * THE CLAIM, docs/COMPLETION-PLAN.md item 1.2, Accept: line:
 *
 *   "pressing it opens the techniques sheet and returns to the card"
 *
 * Read off the code, nothing in `main.ts` ever looks at sheet state when the
 * 9-second deadline is evaluated. `act()` fires on `now > pendingAt`
 * unconditionally, and `act()` runs `beginBout()`, which is `held = false` plus
 * `hud.hideResult()`. `hideResult` removes `.show` from `.result`, and
 * `.result { display: none }`. So the sequence a player gets is:
 *
 *   1. card is up, 9s budget running
 *   2. tap TECHNIQUES -> sheet opens over the card
 *   3. 9s elapses -> beginBout -> card removed from the render tree
 *   4. sheet is still open, now over a LIVE fight
 *   5. tap the sheet's close button -> player is in a running bout with no card
 *
 * Step 5 is the claim being false. Nobody has ever measured it; the one e2e
 * that touches the button reads the clock *immediately* after the tap and
 * documents the later expiry as "not this test's business"
 * (`result-card-fighters-clear.spec.ts:110-141`).
 *
 * SO THIS MEASURES IT, by performing the journey a real player performs and
 * reading the DOM at each stage. It loads no init script: every timestamp comes
 * from Node around Playwright's own waits, for the reason
 * `tools/card-no-probe.mjs` gives — an instrument that competes with its
 * subject for the page thread cannot be told apart from it.
 *
 * The CONTROL is the same journey with no tap at all. Without it, a card that
 * disappears in every case would be indistinguishable from a card that
 * disappears *because of the tap*, and that is exactly the no-op agreement that
 * shipped three bad metrics in rounds 90, 93 and 95.
 *
 * Usage:  node tools/sheet-pause-probe.mjs     (WAIT_MS, RUNS)
 */
import { chromium, devices } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadavg } from 'node:os';
import { startPreview } from './bench-server.mjs';

const root = resolve(import.meta.dirname, '..');
const gameDir = resolve(root, 'apps/game');
const arg = (k, d) => process.env[k] ?? d;

/**
 * Numeric env var, and NOT `Number(arg(...))`.
 *
 * `Number('11_000')` is `NaN` — a JS numeric separator, not a valid number
 * literal. `page.waitForTimeout(NaN)` resolves immediately, so every arm
 * "waited" for nothing and the probe reported CLAIM-TRUE: the no-op agreeing
 * with itself. Rounds 90, 93 and 95 each shipped exactly that, and it is the
 * reason this helper refuses to hand back a non-finite value instead of
 * quietly becoming a no-op.
 */
const numArg = (k, d) => {
  const raw = process.env[k];
  if (raw === undefined) return d;
  const n = Number(String(raw).replace(/[_,]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${k}=${JSON.stringify(raw)} is not a finite number >= 0`);
  return n;
};

const RUNS = numArg('RUNS', 2);
const PORT = numArg('PORT', 4188);

const WAIT = numArg('WAIT_MS', 11_000);
// The `early` arm's wait: comfortably inside the 9s budget, so a player who
// opens the sheet, skims it and closes it still has the card waiting.
const EARLY_MS = numArg('EARLY_MS', 3_000);
const READY_TIMEOUT = Number(arg('READY_TIMEOUT', '240_000'));

/** Everything the claim needs, read in ONE round trip so no state moves. */
const SNAPSHOT = `(() => {
  const card = document.querySelector('.result');
  const sheet = document.getElementById('tech-ref');
  const s = window.__smkk;
  return {
    cardInDom: card !== null,
    cardHasShow: card ? card.classList.contains('show') : null,
    cardDisplay: card ? getComputedStyle(card).display : null,
    cardBox: card ? (() => { const b = card.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })() : null,
    sheetHidden: sheet ? sheet.hidden : null,
    sheetOpen: sheet ? sheet.classList.contains('open') : null,
    tick: s?.state?.().tick ?? null,
    phase: s?.state?.().phase ?? null,
    scores: s?.state?.().scores ?? null,
    pageClock: performance.now(),
  };
})()`;

const server = await startPreview(gameDir, PORT);
console.log(`probe server: ${server.url}\n`);

const browser = await chromium.launch();
const rows = [];

try {
  for (const arm of ['tap', 'control', 'early']) {
    for (let i = 1; i <= RUNS; i += 1) {
      const context = await browser.newContext({
        ...devices['iPhone 12'],
        baseURL: server.url,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      const row = { arm, run: i, load1: loadavg()[0].toFixed(2) };

      try {
        await page.goto('/', { waitUntil: 'load' });
        await page.waitForFunction(() => globalThis.__smkk?.ready === true, null, { timeout: READY_TIMEOUT });

        // The card is up.
        await page.locator('.result-reference').waitFor({ state: 'visible', timeout: 20_000 });
        row.t0_clock = await page.evaluate(() => performance.now());
        row.t0 = await page.evaluate(SNAPSHOT);

        if (arm === 'tap' || arm === 'early') {
          // Exactly what a player does. Playwright's tap, not an in-page
          // click: an in-page `click()` is r145's measured shortcut that
          // dodged the 52s actionability wait, and it is the symptom, not the
          // journey. On a real button this returns in single-digit ms.
          const tapStart = Date.now();
          await page.locator('.result-reference').tap();
          row.tap_ms = Date.now() - tapStart;

          // WAIT FOR THE SHEET, do not sample on the way out of the tap.
          //
          // First version read `afterTap` straight off the back of the tap and
          // got `sheetOpen: false` on 1 of 2 runs, which would have been filed
          // as "the button does not work". It does not: `toggleSheet` adds
          // `.open` inside a `requestAnimationFrame`, so there is a gap between
          // the tap resolving and the sheet being open. Sampling inside that gap
          // measures the harness, not the game — round 151's instrument lesson,
          // one layer down.
          row.sheetOpenWaited = await page
            .waitForFunction(
              () => {
                const s = document.getElementById('tech-ref');
                return s !== null && !s.hidden && s.classList.contains('open');
              },
              null,
              { timeout: 5_000 },
            )
            .then(() => true)
            .catch(() => false);
          row.afterTap = await page.evaluate(SNAPSHOT);
        }

        // Sit past the budget. WAIT is the 9s plus a margin, and the margin is
        // generous on purpose: a claim that only fails within 200ms of a
        // deadline is not a claim anyone can feel.
        //
        // THE `early` ARM CLOSES FIRST, INSIDE THE BUDGET, and is the reason this
        // probe can be believed. It performs the identical journey and differs
        // in exactly one variable: whether the 9 seconds elapsed while the sheet
        // was up. If `early` finds the card waiting and `tap` does not, the
        // sheet is not what removes the card — elapsed time is — and the finding
        // is about the deadline, not about the button. Without that arm a probe
        // which returns "card gone" every single time is indistinguishable from
        // one whose verdict never depends on the thing it is measuring, which is
        // how a no-op gets reported as a result.
        await page.waitForTimeout(arm === 'early' ? EARLY_MS : WAIT);

        row.afterBudget = await page.evaluate(SNAPSHOT);
        row.afterBudget_wallMs = Date.now();
        row.waited_ms = arm === 'early' ? EARLY_MS : WAIT;

        if (arm === 'tap' || arm === 'early') {
          // The fifth step, and the whole point. Close the sheet the way the
          // player closes it and see where they land.
          const close = page.locator('#tech-ref-close');
          row.closeVisible = await close.isVisible().catch(() => false);
          if (row.closeVisible) {
            await close.tap();
            // The close path waits on `transitionend` for `transform`, so the
            // element is still in the tree when this returns. Give the
            // transition a beat rather than racing it.
            await page.waitForTimeout(700);
          }
          row.afterClose = await page.evaluate(SNAPSHOT);
        }
      } catch (err) {
        row.error = String(err).split('\n')[0];
      }
      rows.push(row);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.stop();
}

// ---- the verdict ------------------------------------------------------------
//
// The claim has three observable parts. The one that matters is the third:
// after tapping, closing, and waiting, is the card still there?
const fmt = (v) => (v === null || v === undefined ? 'null' : String(v));
const tapRows = rows.filter((r) => r.arm === 'tap' && !r.error);
const ctlRows = rows.filter((r) => r.arm === 'control' && !r.error);
const earlyRows = rows.filter((r) => r.arm === 'early' && !r.error);

console.log('arm      run  load1  waited  t0.cardShow  afterTap.sheetOpen  afterBudget.cardShow  afterBudget.tick  afterBudget.phase  afterClose.cardShow  afterClose.tick');
for (const r of rows) {
  console.log(
    `${r.arm.padEnd(8)} ${fmt(r.run).padEnd(3)}  ${fmt(r.load1).padEnd(5)}  ${fmt(r.waited_ms).padEnd(6)}  ` +
      `${fmt(r.t0?.cardHasShow).padEnd(12)}  ${fmt(r.afterTap?.sheetOpen).padEnd(18)}  ` +
      `${fmt(r.afterBudget?.cardHasShow).padEnd(21)}  ${fmt(r.afterBudget?.tick).padEnd(17)}  ` +
      `${fmt(r.afterBudget?.phase).padEnd(20)}  ${fmt(r.afterClose?.cardHasShow).padEnd(20)}  ${fmt(r.afterClose?.tick)}` +
      (r.error ? `  ERROR ${r.error}` : ''),
  );
}

// Fails loudly if a row came back without the snapshots the verdict needs,
// rather than quietly treating an unread field as `false`.
//
// THE `early` ARM IS WHAT MAKES THIS A MEASUREMENT. It walks the identical
// journey and differs in one variable — whether the 9 seconds elapsed while the
// sheet was up. A probe that answers "the card is gone" every single time is
// indistinguishable from one whose answer does not depend on what it is
// measuring, and that is how a no-op gets written up as a result (rounds 90, 93
// and 95). So: if the card survives the sheet when the budget has NOT expired,
// and does not survive it when it HAS, the verdict is about the deadline.
const earlyFound = earlyRows.filter((r) => r.afterClose?.cardHasShow === true).length;
const tapFound = tapRows.filter((r) => r.afterClose?.cardHasShow === true).length;
const ctlGone = ctlRows.filter((r) => r.afterBudget.cardHasShow !== true).length;

let verdict = 'INCONCLUSIVE';
let why = '';
if (tapRows.length === 0 || ctlRows.length === 0 || earlyRows.length === 0) {
  why = 'an arm produced no readable snapshots';
} else if (
  tapRows.some((r) => r.afterTap?.sheetOpen !== true) ||
  earlyRows.some((r) => r.afterTap?.sheetOpen !== true)
) {
  why = 'the tap did not open the sheet, so nothing downstream means anything';
} else if (tapRows.some((r) => r.afterClose === undefined)) {
  why = 'the tap arm never reached afterClose';
} else if (earlyFound === 0) {
  // No positive control: the probe cannot tell "the deadline took the card" from
  // "the card was never there". Not a finding — an instrument that cannot fail
  // informatively.
  why =
    `the early-close arm also failed to find the card (0/${earlyRows.length}), so this probe cannot ` +
    `separate "the deadline took it" from "it was never there". Not a result.`;
} else if (earlyFound === earlyRows.length && tapFound === 0) {
  verdict = 'CLAIM-FALSE';
  why =
    `the card survives the sheet when the budget has NOT expired (${earlyFound}/${earlyRows.length} early-close runs) ` +
    `and does not survive it when it HAS (${tapFound}/${tapRows.length} tap runs, bout clock running). ` +
    `The no-tap control also lost the card on ${ctlGone}/${ctlRows.length} runs, so the sheet is not what ` +
    `removes it: the pre-bout deadline runs underneath the sheet and beginBout() hides the card whether or ` +
    `not the player is still reading it.`;
} else if (tapFound === tapRows.length) {
  verdict = 'CLAIM-TRUE';
  why = `card still shown after close on all ${tapRows.length} tap runs`;
} else {
  verdict = 'PARTIAL';
  why = `early ${earlyFound}/${earlyRows.length}, tap ${tapFound}/${tapRows.length} — inconsistent, needs more runs`;
}

console.log(`\n${verdict}: ${why}`);

mkdirSync(resolve(root, 'logs'), { recursive: true });
writeFileSync(
  resolve(root, 'logs/sheet-pause-probe.json'),
  `${JSON.stringify({ waitMs: WAIT, runs: RUNS, verdict, why, rows }, null, 2)}\n`,
);
console.log('wrote logs/sheet-pause-probe.json');

process.exit(verdict === 'CLAIM-TRUE' ? 0 : 1);