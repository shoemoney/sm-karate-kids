// Throwaway look-at-the-game harness. Not part of the test suite.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/smkk-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=metal',
    '--use-gl=angle',
  ],
});

const VIEWPORTS = [
  { name: 'portrait', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${vp.name}-1-title.png` });

  // Straight into a dojo bout.
  await page.goto('http://127.0.0.1:5173/?mode=dojo', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'fight',
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${vp.name}-2-fight-idle.png` });

  // Drive the sticks with real key events so a real move frame renders.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(420);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(60);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(240);
  await page.screenshot({ path: `${OUT}/${vp.name}-3-strike.png` });
  await page.keyboard.up('ArrowUp');

  const backend = await page.evaluate(() => globalThis.__smkk?.backend ?? 'unknown');
  console.log(`${vp.name}: backend=${backend} errors=${errors.length} ${errors.slice(0, 4).join(' | ')}`);
  await ctx.close();
}

await browser.close();
console.log(`shots in ${OUT}`);
