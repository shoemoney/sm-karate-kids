/**
 * Where does the half-point fraction's ink actually sit, relative to the score
 * digits it is attached to?
 *
 * `tools/measure-score.mjs` and `tools/scoreline-stability.mjs` measured the
 * boxes. Boxes cannot say whether the glyphs *look* aligned, and the finding
 * that has now been raised five times is a complaint about how it looks:
 * "reads as a baseline drop", "hard to parse".
 *
 * So: screenshot the scoreline, split it at the gap between the whole number
 * and the fraction, and measure the ink bounding box of each half separately.
 * A fraction whose ink straddles the digits' cap-height-to-baseline band is
 * typeset into the line. One that hangs below the baseline is a subscript, and
 * a subscript is what "baseline drop" is the name of.
 *
 * Run:  node tools/score-ink.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5173';
// Land enough halves on side 0 to reach this score. 0.5 renders the fraction
// with NO whole digit beside it, which is the one case where there is nothing
// to align against; 1.5 is the case that matters, because that is the score a
// player actually reads and the one every reviewer was describing.
const TARGET = Number(process.env.SMKK_TARGET ?? 1.5);
const VIEWPORTS = [
  { name: 'phone-portrait', width: 390, height: 844, mobile: true },
  { name: 'phone-small', width: 360, height: 640, mobile: true },
  { name: 'phone-large', width: 430, height: 932, mobile: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
];

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'],
});
const decodePage = await (await browser.newContext()).newPage();
const out = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__smkk?.state?.().phase === 'fight', null, {
    timeout: 30000,
  });
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
  await page.evaluate((target) => {
    globalThis.__reached = false;
    const watch = () => {
      const s = globalThis.__smkk?.state?.().scores?.[0] ?? 0;
      if (s >= target) globalThis.__reached = true;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }, TARGET);
  let landed = false;
  for (let i = 0; i < 90 && !landed; i += 1) {
    if (await page.evaluate(() => globalThis.__reached === true)) {
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
    out.push({ viewport: vp.name, landed: false });
    await ctx.close();
    continue;
  }
  // Let the call banner settle so the measurement is of a resting frame, not a
  // transition — r147's lesson and mine: measure the state, not the animation.
  await page.waitForTimeout(1800);

  const geom = await page.evaluate(() => {
    const frac = document.querySelector('.points .score-frac');
    const points = frac?.closest('.points');
    if (!frac || !points) return null;
    const fb = frac.getBoundingClientRect();
    const pb = points.getBoundingClientRect();
    return {
      fracLeft: fb.left,
      fracRight: fb.right,
      pointsLeft: pb.left,
      pointsRight: pb.right,
      scoreline: (() => {
        const b = document.querySelector('.scoreline').getBoundingClientRect();
        return { y: b.y, bottom: b.bottom, height: b.height };
      })(),
      fontSize: getComputedStyle(points).fontSize,
      fracFontSize: getComputedStyle(frac).fontSize,
    };
  });
  if (!geom) {
    out.push({ viewport: vp.name, landed: false });
    await ctx.close();
    continue;
  }

  const shot = await page.screenshot({
    clip: { x: geom.pointsLeft - 20, y: geom.scoreline.y - 6, width: 140, height: 64 },
  });
  const S = 2; // deviceScaleFactor
  const clipY = geom.scoreline.y - 6;
  const clipX = geom.pointsLeft - 20;
  // The fraction is one line now, so "everything right of the fraction" is no
  // longer a clean sample: the clock dial sits there and the 45.5px fraction
  // band this produced on 360px was the clock, not the fraction. Clamp both
  // bands to their own boxes.
  const fracX0 = Math.round((geom.fracLeft - clipX) * S);
  const fracX1 = Math.round((geom.fracRight - clipX) * S);
  const bands = await decodePage.evaluate(
    async ({ b64, fracX0, fracX1 }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      // A mode, not a threshold. The plate is a near-black gradient and the
      // backdrop behind it is the arena, so "bright enough" is a guess that
      // quietly clips the antialiased edges of a 22px digit — which is how the
      // first run of this tool measured a 6.5px digit. Take the modal colour of
      // the darkest 20% of pixels as the local background, then take anything
      // materially above it.
      const lum = [];
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i + 3] < 60) continue;
        lum.push(
          0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2],
        );
      }
      lum.sort((a, b) => a - b);
      const bg = lum[Math.floor(lum.length * 0.2)] ?? 0;
      const thresh = bg + 45;
      const bbox = (x0, x1) => {
        let top = null;
        let bot = null;
        let n = 0;
        const peaks = [];
        for (let y = 0; y < c.height; y += 1) {
          for (let x = x0; x < Math.min(x1, c.width); x += 1) {
            const i = (y * c.width + x) * 4;
            if (d.data[i + 3] < 60) continue;
            const L =
              0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2];
            if (L <= thresh) continue;
            n += 1;
            peaks.push(L);
            if (top === null) top = y;
            bot = y;
          }
        }
        // Peak ink luminance. The fraction is set smaller than the digits it
        // sits beside, so on a near-black plate it covers fewer pixels and its
        // antialiased strokes peak lower — which is a *scoring* mark going dim
        // next to the number it modifies. Measure it, do not eyeball it.
        peaks.sort((a, b) => b - a);
        return {
          top,
          bottom: bot,
          ink: n,
          peak: peaks.length ? +peaks[0].toFixed(1) : null,
          p95: peaks.length ? +peaks[Math.floor(peaks.length * 0.05)].toFixed(1) : null,
        };
      };
      return {
        digits: bbox(0, fracX0 - 2),
        fraction: bbox(fracX0, fracX1),
        bg: +bg.toFixed(1),
        thresh: +thresh.toFixed(1),
      };
    },
    { b64: shot.toString('base64'), fracX0, fracX1 },
  );

  const toCss = (v) => (v === null ? null : +(v / S + clipY).toFixed(2));
  // Horizontal gap between the two groups, measured on the same crop. A score
  // of 2.5 rendered as "2 1-2" — the whole number and the fraction's numerator
  // ~1px apart, reading as one numeral sequence. The gap is the thing that
  // separates them, so it gets a number.
  const gap = await decodePage.evaluate(
    async ({ b64, fracX0 }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      let rightmostLeft = -1;
      for (let y = 0; y < c.height; y += 1) {
        for (let x = 0; x < fracX0; x += 1) {
          const i = (y * c.width + x) * 4;
          if (d.data[i + 3] < 60) continue;
          const L = 0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2];
          if (L < 70) continue;
          if (x > rightmostLeft) rightmostLeft = x;
        }
      }
      return rightmostLeft < 0 ? null : fracX0 - rightmostLeft - 1;
    },
    { b64: shot.toString('base64'), fracX0 },
  );
  out.push({
    viewport: vp.name,
    landed: true,
    fontSize: geom.fontSize,
    fracFontSize: geom.fracFontSize,
    scorelineH: +geom.scoreline.height.toFixed(2),
    groupGapCss: gap === null ? null : +(gap / S).toFixed(2),
    bgL: bands.bg,
    digitsInk: { top: toCss(bands.digits.top), bottom: toCss(bands.digits.bottom), px: bands.digits.ink, peak: bands.digits.peak, p95: bands.digits.p95 },
    fracInk: { top: toCss(bands.fraction.top), bottom: toCss(bands.fraction.bottom), px: bands.fraction.ink, peak: bands.fraction.peak, p95: bands.fraction.p95 },
  });
  // Save the crop so a human can see what the numbers are describing.
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('/tmp/smkk-score', { recursive: true });
  writeFileSync(`/tmp/smkk-score/${vp.name}.png`, shot);
  await ctx.close();
}

await browser.close();

for (const r of out) {
  if (!r.landed) {
    console.log(`\n### ${r.viewport} — no half landed`);
    continue;
  }
  const d = r.digitsInk;
  const f = r.fracInk;
  console.log(`\n### ${r.viewport}  score ${r.fontSize}, fraction ${r.fracFontSize}, scoreline h ${r.scorelineH}`);
  console.log(`  digits   ink y ${d.top} .. ${d.bottom}   (cap-to-baseline band, height ${(d.bottom - d.top).toFixed(2)}px)`);
  console.log(`  fraction ink y ${f.top} .. ${f.bottom}   (height ${(f.bottom - f.top).toFixed(2)}px)`);
  console.log(`  --> fraction top vs digit cap:   ${(f.top - d.top).toFixed(2)}px ${f.top - d.top > 0 ? 'BELOW' : 'above'} the digits' top`);
  console.log(`  --> fraction bottom vs digit base: ${(f.bottom - d.bottom).toFixed(2)}px ${f.bottom - d.bottom > 0 ? 'BELOW the baseline' : 'above'}`);
  const centre = (b) => (b.top + b.bottom) / 2;
  console.log(`  --> vertical centre: digits ${centre(d).toFixed(2)}, fraction ${centre(f).toFixed(2)}, offset ${(centre(f) - centre(d)).toFixed(2)}px`);
  console.log(`  --> ink peak luminance: digits ${d.peak}, fraction ${f.peak}  (p95: ${d.p95} vs ${f.p95})`);
  console.log(`  --> gap between whole number and fraction: ${r.groupGapCss}px  (${(r.groupGapCss / parseFloat(r.fontSize)).toFixed(2)} of the score)`);
}
console.log(`\n${JSON.stringify(out, null, 2)}`);
