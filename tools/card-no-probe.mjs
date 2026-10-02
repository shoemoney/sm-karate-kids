/**
 * The pre-bout card, with nothing running inside the page.
 *
 * `tools/card-window.mjs` put a rAF recorder in the page and found the card
 * closed before `__smkk.ready` fired on 6 of 6 runs — but its own first frame
 * took 9.99s, so either the game is that slow or the recorder is. An instrument
 * that cannot be distinguished from its subject is not evidence, so this one
 * loads no init script at all: every timestamp below is taken from Node, around
 * Playwright's own waits, so nothing runs on the page's thread that would not
 * also run in the e2e suite.
 *
 * What it answers, per run:
 *
 *   navToReady_ms   page clock at the instant `__smkk` appears
 *   cardSeenAt_ms   page clock the first time `.result-reference` is visible
 *   cardVisible     whether it was EVER visible after ready
 *   readyToVisible  how long after `ready` the button appeared, or null
 *
 * `navToReady_ms` is the number that matters: `newRun(performance.now())` arms
 * the 9s auto-start at module eval, so any boot longer than 9s spends the whole
 * budget before the player has seen a frame.
 *
 * THE LOAD COLUMN IS LOAD-BEARING, and it is here because this probe was run
 * once while 16 stray CPU burners from an earlier experiment were still alive
 * and every row read as a catastrophic regression (`navToReady_ms` 14.9s–61.2s,
 * card never visible) on a machine that had been deliberately saturated. Load is
 * printed on every row so an environment failure can never again be filed as a
 * finding. This machine does not idle: it runs ~10-13 from other work, which is
 * why the e2e suite is red at 14-16 and green at 8-10 on the same code.
 *
 * Usage:  node tools/card-no-probe.mjs      (CPU_LADDER=1,4,8  RUNS=2)
 */
import { chromium, devices } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadavg } from 'node:os';
import { startPreview } from './bench-server.mjs';

const root = resolve(import.meta.dirname, '..');
const gameDir = resolve(root, 'apps/game');
const arg = (k, d) => process.env[k] ?? d;
const LADDER = String(arg('CPU_LADDER', '1,4,8')).split(',').map(Number);
const RUNS = Number(arg('RUNS', '2'));
const PORT = Number(arg('PORT', '4188'));
const WAIT = Number(arg('WAIT', 240_000));

const server = await startPreview(gameDir, PORT);
console.log(`probe server: ${server.url}\n`);

const browser = await chromium.launch();
const rows = [];

try {
  for (const cpu of LADDER) {
    for (let i = 1; i <= RUNS; i += 1) {
      const context = await browser.newContext({
        ...devices['iPhone 12'],
        baseURL: server.url,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      if (cpu > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      }

      const row = { cpu, run: i, load1: loadavg()[0].toFixed(2) };
      const t0 = Date.now();
      try {
        await page.goto('/', { waitUntil: 'load' });
        // The e2e suite's own first wait, unchanged.
        await page.waitForFunction(() => globalThis.__smkk?.ready === true, null, { timeout: WAIT });
        row.navToReady_ms = Date.now() - t0;
        row.readyPageClock = await page.evaluate(() => performance.now());

        // The e2e suite's own second wait, unchanged: is the card there?
        const visible = await page
          .locator('.result-reference')
          .waitFor({ state: 'visible', timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        row.cardVisible = visible;
        row.readyToVisible_ms = visible ? Date.now() - t0 - row.navToReady_ms : null;
        if (visible) row.cardSeenPageClock = await page.evaluate(() => performance.now());

        row.cardHiddenNow = await page.evaluate(() => {
          const card = document.querySelector('.result');
          return card ? !card.classList.contains('show') : null;
        });
      } catch (err) {
        row.error = String(err).split('\n')[0];
      }
      row.wall_ms = Date.now() - t0;
      rows.push(row);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.stop();
}

const pad = (s, n) => String(s).padEnd(n);
console.log('cpu run   load1  navToReady_ms  cardVisible  readyToVisible_ms  cardHiddenNow  wall_ms');
for (const r of rows) {
  console.log(
    `${pad(r.cpu, 3)} ${pad(r.run, 3)}  ${pad(r.load1, 5)}  ${pad(r.navToReady_ms, 12)}  ${pad(
      r.cardVisible,
      11,
    )}  ${pad(r.readyToVisible_ms, 16)}  ${pad(r.cardHiddenNow, 14)}  ${pad(r.wall_ms, 7)}` +
      (r.error ? `  ERROR ${r.error}` : ''),
  );
}

const good = rows.filter((r) => !r.error);
const gone = good.filter((r) => r.cardVisible === false);
console.log(`\nruns=${good.length}  card_never_visible_after_ready=${gone.length}`);
for (const r of gone) console.log(`  GONE @cpu=${r.cpu} run=${r.run} navToReady_ms=${r.navToReady_ms}`);

mkdirSync(resolve(root, 'logs'), { recursive: true });
writeFileSync(resolve(root, 'logs/card-no-probe.json'), `${JSON.stringify({ ladder: LADDER, rows }, null, 2)}\n`);
console.log('\nwrote logs/card-no-probe.json');