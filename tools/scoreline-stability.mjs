/**
 * Does the scoreline change height when a half point lands?
 *
 * `tools/measure-score.mjs` reported `.points` at 39.09px and at 77.23px on the
 * same 390x844 viewport, minutes apart, with no code change. If the score box
 * nearly doubles every time a half goes on the board, then "the fraction reads
 * as a baseline drop" is not a taste complaint about a glyph — it is a layout
 * that moves, and a moving box is a real defect that a still screenshot of one
 * settled frame cannot show.
 *
 * Measures the scoreline, `.points` and the fraction, in three states:
 *   1. as loaded, no half anywhere
 *   2. with a half on the board
 *   3. immediately again, still with the half (drift check)
 *
 * Run:  node tools/scoreline-stability.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5173';
const VP = { width: 390, height: 844 };

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'],
});
const ctx = await browser.newContext({
  viewport: VP,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__smkk?.state?.().phase === 'fight', null, {
  timeout: 30000,
});

const read = () =>
  page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { y: +b.y.toFixed(2), h: +b.height.toFixed(2), bottom: +b.bottom.toFixed(2) };
    };
    const frac = document.querySelector('.points .score-frac');
    return {
      hasFrac: Boolean(frac),
      scoreline: box('.scoreline'),
      points: box('.points'),
      frac: box('.points .score-frac'),
      scoreText: [...document.querySelectorAll('.points')].map((p) => p.textContent),
    };
  });

const out = [];
out.push({ state: '1. loaded, no half', ...(await read()) });

// Land a half with the same choreography review-shots uses (stance neutral, or
// match.ts promotes the call to a full point).
const anchor = async (sel) => {
  const b = await page.locator(sel).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const L = await anchor('#zone-left');
const R = await anchor('#zone-right');
const cdp = await ctx.newCDPSession(page);
const pts = new Map();
const send = (type) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [...pts].map(([id, q]) => ({ x: Math.round(q.x), y: Math.round(q.y), id })),
  });
await page.evaluate(() => {
  globalThis.__half = false;
  const watch = () => {
    if (document.querySelector('.points .score-frac')) globalThis.__half = true;
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
});
let landed = false;
for (let i = 0; i < 34 && !landed; i += 1) {
  if (await page.evaluate(() => globalThis.__half === true)) {
    landed = true;
    break;
  }
  if (await page.locator('.result-score').isVisible().catch(() => false)) break;
  pts.clear();
  pts.set(1, { x: L.x, y: L.y });
  await send('touchStart');
  pts.set(2, { x: R.x, y: R.y });
  await send('touchStart');
  pts.set(2, { x: R.x + 58, y: R.y });
  await send('touchMove');
  await page.waitForTimeout(240);
  pts.clear();
  await send('touchEnd');
  await page.waitForTimeout(180);
}

if (!landed) {
  console.log('NO HALF LANDED — nothing measured');
  await browser.close();
  process.exit(0);
}

out.push({ state: '2. half on the board', ...(await read()) });
await page.waitForTimeout(400);
out.push({ state: '3. half, +400ms', ...(await read()) });
await page.waitForTimeout(1200);
out.push({ state: '4. half, +1600ms', ...(await read()) });

await browser.close();

for (const r of out) {
  console.log(`\n${r.state}   scores=${JSON.stringify(r.scoreText)}`);
  console.log(
    `  .scoreline  y ${r.scoreline.y}..${r.scoreline.bottom}  h ${r.scoreline.h}`,
  );
  console.log(`  .points     y ${r.points.y}..${r.points.bottom}  h ${r.points.h}`);
  if (r.frac) {
    console.log(
      `  .score-frac y ${r.frac.y}..${r.frac.bottom}  h ${r.frac.h}   ` +
        `below scoreline bottom by ${(r.frac.bottom - r.scoreline.bottom).toFixed(2)}px`,
    );
  } else {
    console.log('  .score-frac absent');
  }
}
