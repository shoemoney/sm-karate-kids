#!/usr/bin/env node
/**
 * Throwaway diagnostic for r169. Is the r166 fighter-select reachable, what
 * does it look like, and does anything overlap it?
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5184';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--use-gl=angle'] });

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__smkk?.ready === true || document.querySelector('.result.show'), null, { timeout: 60_000 });
await page.waitForTimeout(1200);

const out = await page.evaluate(() => {
  const card = document.querySelector('.result');
  const btns = [...document.querySelectorAll('.result button')].map((b) => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return {
      cls: b.className,
      text: b.textContent.trim(),
      box: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      font: `${cs.fontSize}/${cs.lineHeight}`,
      color: cs.color,
      bg: cs.backgroundColor,
      display: cs.display,
      visible: r.width > 0 && r.height > 0,
    };
  });
  const secondary = document.querySelector('.result-secondary');
  const cr = card?.getBoundingClientRect();
  return {
    cardShown: !!card && getComputedStyle(card).display !== 'none',
    card: cr ? { x: +cr.x.toFixed(1), y: +cr.y.toFixed(1), w: +cr.width.toFixed(1), h: +cr.height.toFixed(1) } : null,
    viewport: { w: innerWidth, h: innerHeight },
    btns,
    secondaryBox: secondary
      ? (({ x, y, width, height }) => ({ x: +x.toFixed(1), y: +y.toFixed(1), w: +width.toFixed(1), h: +height.toFixed(1) }))(secondary.getBoundingClientRect())
      : null,
    secondaryDisplay: secondary ? getComputedStyle(secondary).display : null,
    phase: globalThis.__smkk?.state?.().phase,
  };
});

console.log(JSON.stringify(out, null, 2));
console.log('pageerrors:', errs);
await browser.close();