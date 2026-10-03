#!/usr/bin/env node
/**
 * Does the first-run coach actually appear on a first run?
 *
 * THE CLAIM, from round 3 — the review that found "there was no onboarding at
 * all", added `coach.ts`, and was logged as the most productive round in the
 * loop's history:
 *
 *   "One-time captions inside each stick ring, real touch devices only,
 *    dismissed by the first committed technique."
 *
 * A claim about a player's journey, which is the class r152 established cannot
 * be settled by reading code: the code can be correct and the journey still
 * wrong. So this walks the journey.
 *
 * WHAT IT WALKED INTO. `coach.show()` refuses to build when the seen flag is
 * already set, and `coach.dismiss()` SETS that flag — it is `clear()` plus
 * `saveValue`. r23 added `coach.dismiss()` to `clearBoutUi` to stop the strip
 * bleeding through the result card, and `clearBoutUi` is also called by
 * `startRound`, which runs at boot. So the flag was written before the first
 * bout, and the strip could not appear for anyone, ever. The three arms below
 * are what turned that from a reading into a number.
 *
 * THE CONTROL IS THE POINT. `returning` seeds the flag and must NOT show the
 * strip — if every arm said "no strip", this probe would pass on a build where
 * onboarding is simply gone, which is exactly the instrument reporting a
 * plausible answer to the wrong question. `firstrun` must show it.
 *
 * Usage:  node tools/coach-probe.mjs [baseUrl]
 * Exit:   0 the first run is taught · 1 it is not · 2 harness failure
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

const DIST = join(process.cwd(), 'apps/game/dist');
const PORT = 4195;

const startStatic = async (dir, port) => {
  const s = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = p === '/' ? '/index.html' : p;
      const body = await readFile(join(dir, f));
      res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('nope');
    }
  });
  await new Promise((r) => s.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}/`, stop: () => new Promise((r) => s.close(r)) };
};

const SEEN = 'smkk:coach-seen-v1';

/**
 * Build a page URL from a base that may carry a PATH.
 *
 * `new URL('/', 'https://arcade.shoemoney.ai/smkk/')` resolves to
 * `https://arcade.shoemoney.ai/` — the domain root, not the game — so the
 * probe booted nothing, timed out, and reported a page error that had nothing
 * to do with the claim under test. Production itself was fine: it reaches
 * `__smkk.ready` in 1.5s, and its only failing request is the documented
 * leaderboard 404. A probe that cannot address the deployed sub-path is
 * measuring the wrong server, which is standing rule 4's whole subject.
 */
const urlFor = (base, route) => `${base.replace(/\/+$/, '')}${route}`;

/** One arm: a phone, one route, one seeded flag. Reports what the player saw. */
async function arm(browser, base, { route, seed }) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  // Without this a failure inside the app is silent: `waitForFunction` reports
  // only that `__smkk.ready` never became true, which reads as a hung boot and
  // sends the next reader to the app instead of to the harness.
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
  });
  if (seed) {
    await page.addInitScript(([k]) => globalThis.localStorage.setItem(k, 'true'), [SEEN]);
  }
  await page.goto(urlFor(base, route), { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => globalThis.__smkk?.ready === true, null, { timeout: 60_000 });
  } catch (e) {
    await ctx.close();
    throw new Error(`boot never completed on "${route}": ${pageErrors.join(' | ') || 'no page error reported'}`);
  }

  // Read the flag the instant the app is ready. main.ts calls newRun() at
  // module scope for tournament mode, so by `ready` the decision has been made.
  const atReady = await page.evaluate((k) => globalThis.localStorage.getItem(k), SEEN);

  await page.waitForFunction(() => globalThis.__smkk?.state?.().phase === 'fight', null, { timeout: 45_000 });
  await page.waitForTimeout(900);

  const seen = await page.evaluate(
    ([k, sel]) => {
      const strip = document.querySelector(sel);
      return {
        flag: globalThis.localStorage.getItem(k),
        strip: strip !== null,
        visible: strip !== null && getComputedStyle(strip).display !== 'none',
        halves: document.querySelectorAll('.coach-half').length,
      };
    },
    [SEEN, '.coach-strip'],
  );
  const shot = await page.screenshot();
  await ctx.close();
  return { atReady, ...seen, shot };
}

const arg = process.argv[2];
const srv = arg ? null : await startStatic(DIST, PORT);
const base = arg ?? srv.url;
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'] });

// The mode check is part of the journey, not an assumption: the strip is built
// only under `(hover: none) and (pointer: coarse)` (coach.ts:97), so a probe
// that ran on desktop would report "no strip" forever and look correct.
const probeCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const probePage = await probeCtx.newPage();
await probePage.goto(urlFor(base, '/'), { waitUntil: 'domcontentloaded' });
const media = await probePage.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
await probeCtx.close();

let fail = 0;
console.log(`base     ${base}`);
console.log(`media    (hover:none) and (pointer:coarse) -> ${media}${media ? '' : '  *** CANNOT SHOW THE COACH ***'}`);
if (!media) fail = 2;
console.log('');

const arms = [
  { label: 'firstrun  /', route: '/', seed: false, expect: true },
  { label: 'firstrun  ?mode=tournament', route: '?mode=tournament', seed: false, expect: true },
  { label: 'firstrun  ?mode=dojo', route: '?mode=dojo', seed: false, expect: true },
  // THE CONTROL. A returning player must NOT be taught again. If this arm
  // passes while every first-run arm fails, the probe is measuring the flag
  // rather than the coach, and the first-run failures mean nothing.
  { label: 'CONTROL   returning ?mode=dojo', route: '?mode=dojo', seed: true, expect: false },
];

for (const a of arms) {
  const r = await arm(browser, base, a);
  const ok = r.visible === a.expect && r.strip === a.expect;
  if (!ok) fail = 1;
  console.log(
    `  ${a.label.padEnd(34)} flag-at-ready=${String(r.atReady).padEnd(6)} flag-now=${String(r.flag).padEnd(6)} strip=${String(r.strip).padEnd(6)} visible=${String(r.visible).padEnd(6)} halves=${r.halves}  ${ok ? 'ok' : '*** WRONG — expected ' + (a.expect ? 'TAUGHT' : 'not taught') + ' ***'}`,
  );
}

console.log('');
console.log(
  fail === 0
    ? '  the first-run coach is taught on a first run, and only then'
    : fail === 2
      ? '  HARNESS FAILURE — the context cannot reach the coach at all'
      : '  FAIL — a first-run player is not being taught',
);

await browser.close();
if (srv) await srv.stop();
process.exit(fail);
