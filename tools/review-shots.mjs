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

await browser.close();
console.log(`shots in ${OUT}`);
if (errors.length) console.log('console errors:\n' + [...new Set(errors)].join('\n'));
