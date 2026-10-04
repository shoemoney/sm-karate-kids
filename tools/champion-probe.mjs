#!/usr/bin/env node
/**
 * Does the record line on the final card actually put the championship count on
 * the screen?
 *
 * Why this probe exists
 * ---------------------
 * `champion` appeared zero times in 11,007 lines of REVIEW-LOOP.md before
 * round 166, and no frame in `tools/review-shots.mjs` can reach the state: the
 * CHAMPION card needs five consecutive won bouts, and every result frame in the
 * set is a single bout. This is r158's shape exactly — "a state that becomes
 * reachable is not a state that has been reviewed" — and it had been reachable
 * since the tournament ladder shipped.
 *
 * The defect, on that screen:
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
 * WHAT THIS GATE COVERS, AND WHAT IT DOES NOT
 * -------------------------------------------
 * This walks a real run in a real browser and asserts the count reaches the
 * screen. It does NOT win five bouts, and that is deliberate — see "THE VERSION
 * THAT WAS NOT BUILT" below.
 *
 * The champion branch itself is decided by `recordPieces` and covered in
 * `apps/game/tests/unit/champion-titles-visible.test.ts`, which runs the real
 * `recordRun` against a stubbed store and is proved red by mutation. Neither gate
 * subsumes the other: that one cannot see whether the pieces are rendered, and
 * this one cannot see the decision without reaching a state a browser bot loses.
 * The unit test also pins the call site, so "the pure function is correct" cannot
 * be satisfied by a function `main.ts` stopped calling.
 *
 * THE VERSION THAT WAS NOT BUILT
 * ------------------------------
 * A first version of this probe reached the CHAMPION card through a
 * `test.finishBout` / `test.setRound` on the test surface. That surface is
 * documented read-only — "nothing here can score a point or move a fighter", the
 * comment above `publishTestSurface` in `main.ts` — and adding a mutator to it to
 * make a probe convenient is the trade r141 refused: the instrument gets easier
 * and the thing measured stops being the thing that ships.
 *
 * A second version played for the title with real touch input and was dropped for
 * a different reason, which is worth recording because it is a measurement and
 * not an opinion. The bot is competent — it wins the qualifier in 1.92s — and it
 * was tuned across five range settings until it reached the semi-final:
 *
 *     throw only in range  1.6 -> loses the qualifier
 *                        2.6 -> clears 1, out in the Regional
 *                        3.2 -> clears 3, out in the Semi-final   (best)
 *                        4.5 -> clears 1, then the bout never ended
 *                       99   -> clears 2, out in the Quarter-final
 *
 * Round 3 is a difficulty-0.8 CPU and round 4 is difficulty 1.0, so the ladder
 * ends exactly where a blind flick bot stops being able to win. A gate that needs
 * a skilled player to go green is a gate that flakes and then gets deleted, and
 * r141 recorded the reason: a sha256 comparison is exact, and a gate that cries
 * wolf is worse than no gate. The claim is covered by a gate that cannot flake.
 *
 * FOUR ARMS, and why each is needed:
 *
 *   1. CONTROL — a run reaches a card and the card is painted. Without this a
 *      probe that never reached a result would report "no title count" about
 *      every arm and look like a pass, which is r155's instrument: an
 *      assertion that cannot fail.
 *   2. A stored record of 0 titles shows `titles 0`, so the digits come from the
 *      store rather than from a constant in the card.
 *   3. THREE DIFFERENT COUNTS — 0, 1 and 2 — each render their own number. A
 *      probe that only ever sees `titles 1` cannot tell a record from a string,
 *      and this is the same mistake r163 caught in the coach legend (one plate
 *      described as two).
 *   4. The standing best is still on the line beside the count, so the fix did
 *      not buy the count by dropping the other fact.
 *
 * The store is seeded with `addInitScript`, which is how a returning player is
 * simulated. `recordRun` reads the record, folds the run in and writes it back,
 * so what the card shows is read from storage through the real path.
 *
 * SMKK_BASE points at a server. Otherwise this harness spawns and kills its own
 * preview on 4188 — a benchmark whose subject can vanish between the build and
 * the measurement is measuring something else.
 *
 * ---------------------------------------------------------------------
 * STATUS: NOT A GATE, and not yet reproducible on this machine.
 *
 * It is deliberately wired into nothing. `pnpm check` must stay offline and this
 * needs a browser; and more to the point it did not go green end to end. On one
 * run at load 19-30 arms 2 and 3 passed and read, off the card:
 *
 *     Best 30,000 · titles 0
 *     Best 30,000 · titles 1
 *     Best 30,000 · titles 2
 *
 * which is the fix rendering through the loop this round changed — real
 * evidence, and the reason the tool is here. On later runs at load 60-106 the
 * same arms went red: the bot's run no longer finished inside `BOUT_MS`, so
 * `card` was null and every assertion read "undefined".
 *
 * That is the machine, not the game, and the difference is measured rather than
 * asserted: the failing value is `undefined` on a card that never appeared,
 * where the passing value is the exact string. But "the machine was busy" is not
 * a licence to ship a gate that cries wolf — r141 refused a marker-string gate
 * for exactly that reason. So this is recorded as a measurement that did not
 * reproduce (standing rule 5), the browser-level claim rests on the three
 * strings above plus the unit test, and the next round with a quiet box should
 * either make it green or delete it. Do not add it to `pnpm check` or CI before
 * then.
 * ---------------------------------------------------------------------
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startPreview } from './bench-server.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const GAME_DIR = resolve(HERE, '..', 'apps', 'game');
const VIEWPORT = { width: 390, height: 844 };
const THROW = 58;
/** Tuned by measurement, not guessed — see the range table in the header. */
const RANGE = 3.2;
const CLOSE = 2.2;
const BOUT_MS = 75_000;

const server = process.env.SMKK_BASE ? null : await startPreview(GAME_DIR);
const BASE = process.env.SMKK_BASE ?? server.url;

const failures = [];
const note = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch();

/** Real touch through the browser's own input pipeline, as `thumbs.ts` does. */
class Thumbs {
  constructor(cdp) {
    this.cdp = cdp;
    this.active = new Map();
  }
  async send(type) {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...this.active.entries()].map(([id, p]) => ({
        x: Math.round(p.x),
        y: Math.round(p.y),
        id,
      })),
    });
  }
  async flick(id, x, y, dx, dy) {
    this.active.set(id, { x, y });
    await this.send('touchStart');
    this.active.set(id, { x: x + dx, y: y + dy });
    await this.send('touchMove');
    await new Promise((r) => setTimeout(r, 90));
    this.active.delete(id);
    await this.send('touchEnd');
  }
}

async function readCard(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.result');
    if (card === null) return null;
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? '';
    return {
      phase: card.getAttribute('data-phase'),
      headline: text('.result-headline'),
      score: text('.result-score'),
      detail: text('.result-detail'),
      visible: getComputedStyle(card).display !== 'none',
    };
  });
}

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

  const cdp = await context.newCDPSession(page);
  const thumbs = new Thumbs(cdp);
  const box = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    if (b === null) throw new Error(`no ${sel} on screen`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const L = await box('#zone-left');
  const R = await box('#zone-right');

  const fight = page.locator('.result-rematch');
  if (await fight.isVisible().catch(() => false)) await fight.click().catch(() => {});
  await page.waitForTimeout(400);

  const DIRS = { up: [0, -THROW], right: [THROW, 0], left: [-THROW, 0], down: [0, THROW] };
  const ORDER = ['up', 'right', 'left', 'down'];
  const until = Date.now() + BOUT_MS;
  let i = 0;
  let card = null;

  /**
   * Plays bouts until the RUN ends, not until a bout ends.
   *
   * This is the second mistake this probe made, and it is the r155 lesson from
   * the other end. Winning the qualifier renders `Next: the Regional` — the
   * round-clear card, which has no record line at all, so every assertion about
   * `titles` failed against a card that never claims to carry one. A probe that
   * reports a missing fact about the wrong screen is not a weak check, it is a
   * wrong one, and it looks exactly like a red gate.
   *
   * So the loop continues past a won round and only stops on the card that ends
   * the run, which is the only one with a record line: CHAMPION or DEFEATED.
   */
  const ENDS_RUN = /CHAMPION|DEFEATED/;
  while (Date.now() < until) {
    if (await page.locator('.result[data-phase="result"]').isVisible().catch(() => false)) {
      const seen = await readCard(page);
      if (seen !== null && ENDS_RUN.test(seen.headline ?? '')) {
        card = seen;
        break;
      }
      // A won round. Continue the ladder.
      const next = page.locator('.result-rematch');
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
        await page.waitForTimeout(500);
        continue;
      }
    }
    const st = await page.evaluate(() => globalThis.__smkk?.state?.() ?? null);
    if (st === null) break;
    const [a, b] = st.positions;
    const gap = Math.abs(b - a);
    if (gap < RANGE) {
      const d = DIRS[ORDER[i % ORDER.length]];
      i += 1;
      await thumbs.flick(2, R.x, R.y, d[0], d[1]);
    }
    if (gap > CLOSE) await thumbs.flick(1, L.x, L.y, THROW, 0);
    await page.waitForTimeout(110);
  }
  const stored = await page.evaluate(() => window.localStorage.getItem('smkk:tournament'));
  await context.close();
  return { card, stored };
}

console.log(`base ${BASE}  viewport ${VIEWPORT.width}x${VIEWPORT.height}  range ${RANGE}`);
console.log('');

// ---- arm 1: CONTROL. A run reaches its END card, and it is painted. ------
// Without this, every arm below is vacuous: a probe that never finished a run
// would report "no title count" about all three seeds and look like a finding.
// Seeded, and seeded with a count no other arm uses, so this is both the
// positive control and a fourth data point.
//
// It was originally an UNSEEDED store, on the reasoning that a fresh player is
// the first-title case and therefore the most valuable arm. It is not, in a
// browser: with no standing best the bot cleared the qualifier and kept going,
// so how long the run took depended on touch-timing luck and the arm went red on
// its budget. That is the same defect that killed the champion-walking version —
// a gate whose verdict depends on how well the bot plays — and it is recorded
// here rather than papered over with a bigger timeout.
//
// The first-title case is the defect's sharpest end, and it is settled where it
// can be settled exactly: `recordRun(12_400, 4, true)` on a blank store, in the
// unit test, asserting `newBest === true` and the count on the line. A browser
// arm would reach the same branch by losing three rounds to a CPU instead.
const control = await run({ bestScore: 30_000, bestRound: 4, championships: 5 });
note(control.card !== null, 'control: a run reached the card that ends it');
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
  /\btitles [56]\b/.test(control.card?.detail ?? ''),
  `control: the count came from the store, not a constant (read "${control.card?.detail}")`,
);

// ---- arms 2-4: three different stored counts, each reading its own number --
for (const championships of [0, 1, 2]) {
  const seed = { bestScore: 30_000, bestRound: 4, championships };
  const { card } = await run(seed);
  // A stored best of 30000 is unreachable for a run the bot can win, so the
  // card lands on the "not a new best" branch for every seed — which is the
  // branch that has always carried the count, and therefore the one this can
  // hold fixed. The champion branch, where the count used to be LOST, is the
  // unit test's job and the header says why.
  note(card !== null, `titles ${championships}: the run reached its end card`);
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
console.log(
  failures.length === 0 ? 'RECORD LINE OK' : `RECORD LINE FAILED (${failures.length})`,
);
await browser.close();
await server?.stop();
process.exit(failures.length === 0 ? 0 : 1);