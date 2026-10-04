#!/usr/bin/env node
/**
 * THROWAWAY DIAGNOSTIC — decides champion-probe.mjs's fate. Not a gate.
 *
 * r167 left `tools/champion-probe.mjs` wired into nothing: on one run at load
 * 19-30 arms 2 and 3 read their exact strings; on later runs at load 60-106 the
 * same arms read `undefined`, and the round recorded it as a measurement that
 * did not reproduce rather than making it green or deleting it.
 *
 * This run (quiet box, load 10-12) got 3 of 4 arms right and arm 4 at
 * `undefined`. That is the fact worth chasing: if the machine were busy the
 * WHOLE run, arms 2 and 3 would have failed too. One arm in four means the
 * question is not "was the box busy" — it is "what was arm 4's run doing".
 *
 * Two candidate explanations, and they need opposite fixes:
 *
 *   A. The bot plays badly sometimes, so the run does not end inside BOUT_MS.
 *      Fix: make the run end deterministically instead of hoping.
 *   B. The probe missed a card that was actually up.
 *      Fix: the probe is blind, and the bot is fine.
 *
 * THE EXPERIMENT. An IDLE player — no touch input at all, not one flick — is
 * the trivially reproducible version of the same journey: the CPU beats a
 * player who does nothing, the run ends DEFEATED, and the seeded store's
 * unreachable 30,000 puts the card on the `Best N · titles M` branch every
 * arm asserts on. If that ends the run at the same time every time, the probe
 * has a deterministic arm available and the flick bot's skill level — the thing
 * r141 refused to gate on — stops being load-bearing.
 *
 * If it does NOT, the honest answer is to delete the probe, because a gate
 * whose verdict depends on a bot's luck is the gate that cries wolf.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startPreview } from './bench-server.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const GAME_DIR = resolve(HERE, '..', 'apps', 'game');
const VIEWPORT = { width: 390, height: 844 };
const BUDGET_MS = 90_000;
const REPEATS = 3;

const server = process.env.SMKK_BASE ? null : await startPreview(GAME_DIR);
const BASE = process.env.SMKK_BASE ?? server.url;

const browser = await chromium.launch();

const ENDS_RUN = /CHAMPION|DEFEATED/;

async function idleRun(championships) {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript((value) => {
    window.localStorage.setItem('smkk:tournament', value);
  }, JSON.stringify({ bestScore: 30_000, bestRound: 4, championships }));

  await page.goto(`${BASE}/?mode=tournament`);
  await page.waitForFunction(() => globalThis.__smkk?.ready === true, null, { timeout: 90_000 });

  // Press FIGHT to get past the pre-bout card, then do nothing at all.
  const fight = page.locator('.result-rematch');
  if (await fight.isVisible().catch(() => false)) await fight.click().catch(() => {});
  await page.waitForTimeout(400);

  const started = Date.now();
  const until = started + BUDGET_MS;
  let card = null;
  let last = null;
  const trace = [];

  while (Date.now() < until) {
    const seen = await page.evaluate(() => {
      const el = document.querySelector('.result');
      const text = (s) => document.querySelector(s)?.textContent?.trim() ?? '';
      return {
        phase: el?.getAttribute('data-phase') ?? null,
        headline: text('.result-headline'),
        detail: text('.result-detail'),
        visible: el === null ? false : getComputedStyle(el).display !== 'none',
      };
    });
    const st = await page.evaluate(() => globalThis.__smkk?.state?.() ?? null);
    last = { st, seen };

    if (seen.visible && ENDS_RUN.test(seen.headline ?? '')) {
      card = seen;
      break;
    }
    // Round-clear card: press on. (An idle player should rarely see one.)
    if (seen.visible && seen.phase === 'result' && !ENDS_RUN.test(seen.headline ?? '')) {
      trace.push(`round-clear: ${seen.headline}`);
      const next = page.locator('.result-rematch');
      if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    }

    // A cheap sample of the fight so a stall is visible in the log, not inferred.
    if (trace.length < 400 && trace[trace.length - 1]?.startsWith('t=') === false) {
      const s = st?.timerTicks ?? -1;
      trace.push(
        `t=${((Date.now() - started) / 1000).toFixed(1)}s phase=${st?.phase} timer=${s} ` +
          `pos=${st?.positions?.map((n) => n.toFixed(2)).join('/')} ` +
          `scores=${st?.scores?.join('/')} winner=${st?.winner} draw=${st?.draw}`,
      );
    }
    await page.waitForTimeout(500);
  }

  const elapsed = Date.now() - started;
  await context.close();
  return { card, elapsed, last, trace };
}

console.log(`base ${BASE}  viewport ${VIEWPORT.width}x${VIEWPORT.height}  budget ${BUDGET_MS / 1000}s`);
console.log('IDLE player — no touch input after the FIGHT press.');
console.log('');

for (const championships of [0, 1, 2, 5]) {
  const r = await idleRun(championships);
  const verdict = r.card === null ? 'NO CARD (run never ended)' : `card: "${r.card.headline}" / "${r.card.detail}"`;
  console.log(`titles ${championships}: ${(r.elapsed / 1000).toFixed(1)}s  ${verdict}`);
  if (r.card === null) {
    // A stall is a fact, not a guess: print the tail of what the sim was doing.
    console.log('           sim tail:');
    for (const line of r.trace.slice(-6)) console.log(`             ${line}`);
    if (r.last?.seen) {
      console.log(
        `           card in DOM: phase=${r.last.seen.phase} visible=${r.last.seen.visible} ` +
          `headline="${r.last.seen.headline}"`,
      );
    }
  }
  console.log('');
}

await browser.close();
await server?.stop();
