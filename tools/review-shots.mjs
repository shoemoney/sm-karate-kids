#!/usr/bin/env node
/**
 * Capture a full review set for the vision loop: every distinct screen and
 * state a player actually sees, at the portrait baseline and on desktop.
 *
 * Not a test harness — this exists to feed tools/vision-review.py.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/smkk-review';
const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5173';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'],
});

const errors = [];

async function capture(name, viewport, steps) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: viewport.width < 700,
    hasTouch: viewport.width < 700,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
  await steps(page);
  await ctx.close();
}

const waitFight = (page) =>
  page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'fight',
    null,
    { timeout: 30000 },
  );

// Throttle so the loading screen is actually observable.
async function boot(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1200 * 1024) / 8,
    uploadThroughput: (600 * 1024) / 8,
  });
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForTimeout(600);
  if (await page.locator('#boot').count()) {
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  await ctx.close();
}

const phone = { width: 390, height: 844 };
const desk = { width: 1280, height: 800 };

await boot('00-boot-loading');

await capture('01-phone-title', phone, async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-phone-title.png` });
});

await capture('02-phone-fight', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/02-phone-fight.png` });
});

await capture('03-phone-strike', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(420);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(60);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(230);
  await page.screenshot({ path: `${OUT}/03-phone-strike.png` });
  await page.keyboard.up('ArrowUp');
});

await capture('04-phone-controls', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  const zone = await page.locator('#zone-right').boundingBox();
  const cx = zone.x + zone.width / 2;
  const cy = zone.y + zone.height / 2;
  await page.touchscreen.tap(cx, cy - 60);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx, y: cy, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: cx + 40, y: cy - 40, id: 1 }],
  });
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/04-phone-controls.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});

await capture('05-phone-techref', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.locator('#btn-techniques').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/05-phone-techref.png` });
});

await capture('06-phone-settings', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.locator('#btn-settings').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/06-phone-settings.png` });
});

await capture('07-phone-result', phone, async (page) => {
  await page.goto(`${BASE}/?mode=classic`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'over',
    null,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/07-phone-result.png` });
});

await capture('08-desktop-fight', desk, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/08-desktop-fight.png` });
});

await capture('09-phone-highcontrast', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.evaluate(() => document.body.classList.add('high-contrast'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/09-phone-highcontrast.png` });
});

await capture('10-phone-tournament', phone, async (page) => {
  await page.goto(`${BASE}/?mode=tournament`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/10-phone-tournament.png` });
});

/* ---------------------------------------------------------------------------
 * The states round 10 proved we were missing.
 *
 * Ten rounds of the same eleven screens produced an all-reject round: a fresh
 * model on an exhausted set of screens stops finding things. These are the
 * screens the game actually has that nothing was shooting — a real contact, a
 * fighter off the ground, and the tournament ladder before a round card is up.
 * ------------------------------------------------------------------------- */

// A landed strike, framed at the moment of contact.
//
// The first version of this shot watched for a kick pose and screenshotted
// there, which captured a *missed* kick: the fighters were not touching, so
// there was no contact and therefore no impact art — and the obvious
// conclusion, "the impact VFX never render", was wrong. The reliable signal is
// `navigator.vibrate`, which `juice.impact()` calls on every contact. Shoot on
// that, not on a pose.
await capture('11-phone-impact', phone, async (page) => {
  await page.addInitScript(() => {
    globalThis.__hits = 0;
    navigator.vibrate = () => {
      globalThis.__hits += 1;
      return true;
    };
  });
  await page.goto(`${BASE}/?mode=classic`, { waitUntil: 'networkidle' });
  await waitFight(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const before = await page.evaluate(() => globalThis.__hits);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(330);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(80);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    let landed = false;
    for (let tick = 0; tick < 25 && !landed; tick += 1) {
      landed = (await page.evaluate(() => globalThis.__hits)) > before;
      if (!landed) await page.waitForTimeout(35);
    }
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowRight');
    if (landed) {
      await page.waitForTimeout(60);
      await page.screenshot({ path: `${OUT}/11-phone-impact.png` });
      return;
    }
    await page.waitForTimeout(600);
  }
});

// A fighter in the air. Vertical state is a different pose set, a different
// shadow, and a different silhouette — none of which any capture had shown.
await capture('12-phone-jump', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'fight',
    null,
    { timeout: 30000 },
  );
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(230);
  await page.screenshot({ path: `${OUT}/12-phone-jump.png` });
  await page.keyboard.up('ArrowUp');
});

// The tournament ladder before a round card covers it. Ten captures had only
// ever seen the round card, never the thing the round card is covering.
await capture('13-phone-ladder', phone, async (page) => {
  await page.goto(`${BASE}/?mode=tournament`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/13-phone-ladder.png` });
});

/* The state every returning player sees, and the state reviewers had been
   judging as if it were the only one.
 *
 * Every capture in this harness runs in a fresh browser context with an empty
   localStorage, so the first-run coach strip was present in EVERY frame the
   loop ever showed a model. Three separate rounds reported it as "a permanent
   instruction wall" that "never clears between moves". It clears on the first
   bout once both sticks have been used — but no reviewer could have known that
   from a screenshot, because no screenshot showed the other state.
 *
 * This seeds the seen flag, so the review set contains both first-run and
 * returning-player views of the same screens. */
await capture('14-phone-returning', phone, async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('smkk:coach-seen-v1', 'true');
    } catch {
      /* storage blocked; the strip shows, which is still a valid frame */
    }
  });
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/14-phone-returning.png` });
});

await browser.close();
console.log(`shots in ${OUT}`);
if (errors.length) console.log('console errors:\n' + [...new Set(errors)].join('\n'));
