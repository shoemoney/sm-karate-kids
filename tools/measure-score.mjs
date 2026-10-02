/**
 * Measure the half-point score geometry, in CSS pixels, against the scoreline
 * plate that is supposed to contain it.
 *
 * Why this exists: five models have described the stacked fraction in words —
 * "reads as a baseline drop", "hard to parse", "unreadable at HUD size" — and
 * not one of those is a measurement. Round 147 handed the finding forward
 * because the words agreed and no one had looked at the boxes.
 *
 * `tools/review-shots.mjs:585` already knows how to land a half point (hold the
 * stance stick NEUTRAL, or `match.ts` promotes the call to a full), so this
 * borrows that exact choreography and then measures instead of screenshotting.
 *
 * Run:  node tools/measure-score.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5173';
const VIEWPORTS = [
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-small', width: 360, height: 640 },
  { name: 'phone-large', width: 430, height: 932 },
  { name: 'desktop', width: 1280, height: 800 },
];

/** Pixels whose alpha/luma shows this is ink rather than the plate. */
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'],
});

const results = [];
// One scratch page, created up front, used only to decode screenshots back
// into pixels. Separate contexts cannot see each other, so a fresh page is the
// clean way to do it without pulling in a native image dependency.
const decodePage = await (await browser.newContext()).newPage();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.width < 700,
    hasTouch: vp.width < 700,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'fight',
    null,
    { timeout: 30000 },
  );

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
    results.push({ viewport: vp.name, landed: false });
    await ctx.close();
    continue;
  }

  // Freeze the animation frame loop so the boxes cannot move between the
  // readouts below — every number has to come from the same layout.
  const geom = await page.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: +b.x.toFixed(2),
        y: +b.y.toFixed(2),
        w: +b.width.toFixed(2),
        h: +b.height.toFixed(2),
        top: +b.top.toFixed(2),
        bottom: +b.bottom.toFixed(2),
        left: +b.left.toFixed(2),
        right: +b.right.toFixed(2),
      };
    };
    const frac = document.querySelector('.points .score-frac');
    const points = frac?.closest('.points');
    // The scoreline plate. Walking ancestors for "first painted background"
    // finds <html>, whose background is the page and whose box is the whole
    // viewport — which made every overhang read 0 on the first run. The plate
    // is a named element; name it.
    const plate = document.querySelector('.scoreline');
    const cs = frac ? getComputedStyle(frac) : null;
    const nums = frac
      ? [...frac.querySelectorAll('.score-frac-num')].map((n) => ({
          text: n.textContent,
          box: r(n),
          fontSize: getComputedStyle(n).fontSize,
        }))
      : [];
    return {
      plateSelector: plate ? '.scoreline' : null,
      plate: r(plate),
      points: r(points),
      pointsFontSize: points ? getComputedStyle(points).fontSize : null,
      pointsOverflow: points ? getComputedStyle(points).overflow : null,
      frac: r(frac),
      fracFontSize: cs?.fontSize ?? null,
      fracVerticalAlign: cs?.verticalAlign ?? null,
      fracLineHeight: cs?.lineHeight ?? null,
      nums,
    };
  });

  results.push({ viewport: vp.name, landed: true, ...geom });
  // Pixel evidence, not just boxes: screenshot the scoreline band and count
  // fraction-coloured pixels that fall BELOW the plate's bottom edge.
  const shot = await page.screenshot({
    clip: { x: 0, y: 0, width: vp.width, height: 90 },
  });
  results[results.length - 1].inkBelowPlate = await countInkBelow(
    shot,
    geom.plate.bottom,
    geom.frac,
    decodePage,
  );
  await ctx.close();
}

await browser.close();

/**
 * Count bright pixels in the fraction's x-range that sit BELOW the plate's
 * bottom edge. The finding under test is "the stacked fraction reads as a
 * baseline drop and is hard to parse"; a count of fraction ink that has fallen
 * out of the plate is that claim, measured.
 */
async function countInkBelow(pngBuffer, plateBottomCss, frac, decodePage) {
  const scale = 2; // deviceScaleFactor used for the clip above
  const plateRow = Math.round(plateBottomCss * scale);
  const x0 = Math.max(0, Math.round(frac.left * scale) - 6);
  const x1 = Math.round(frac.right * scale) + 6;
  return decodePage.evaluate(
    async ({ b64, plateRow, x0, x1 }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      let below = 0;
      for (let y = plateRow; y < c.height; y += 1) {
        for (let x = x0; x < Math.min(x1, c.width); x += 1) {
          const i = (y * c.width + x) * 4;
          const a = d.data[i + 3];
          if (a < 40) continue;
          const mean = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
          // The plate below the scoreline is near-black, so a bright pixel down
          // there is fraction ink, not scenery.
          if (mean > 90) below += 1;
        }
      }
      return below;
    },
    { b64: pngBuffer.toString('base64'), plateRow, x0, x1 },
  );
}

for (const r of results) {
  if (!r.landed) {
    console.log(`\n### ${r.viewport} — NO HALF LANDED, nothing measured`);
    continue;
  }
  const f = r.frac;
  const p = r.plate;
  console.log(`\n### ${r.viewport}  (score ${r.pointsFontSize}, fraction ${r.fracFontSize})`);
  console.log(`  plate      ${r.plateSelector}  y ${p.y}..${p.bottom}  h ${p.h}`);
  console.log(`  .points    y ${r.points.y}..${r.points.bottom}  h ${r.points.h}  overflow=${r.pointsOverflow}`);
  console.log(`  .score-frac y ${f.y}..${f.bottom}  h ${f.h}  va=${r.fracVerticalAlign} lh=${r.fracLineHeight}`);
  for (const n of r.nums) {
    console.log(`    num "${n.text}"  ${n.fontSize}  y ${n.box.y}..${n.box.bottom}`);
  }
  const overTop = +(p.top - f.top).toFixed(2);
  const overBot = +(f.bottom - p.bottom).toFixed(2);
  console.log(`  --> fraction vs plate: top ${overTop > 0 ? `${overTop}px ABOVE plate` : `${-overTop}px inside`}, bottom ${overBot > 0 ? `${overBot}px BELOW plate` : `${-overBot}px inside`}`);
  console.log(`  --> bright fraction-ink pixels BELOW the plate: ${r.inkBelowPlate}`);
  console.log(`  --> fraction height ${f.h}px against a ${r.pointsFontSize} score (${(f.h / parseFloat(r.pointsFontSize)).toFixed(2)}x)`);
}
console.log('\nJSON:', JSON.stringify(results, null, 2));
