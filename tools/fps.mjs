// Measure real frame rate + the cost of the post chain. Throwaway.
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'],
});

for (const vp of [
  { name: 'portrait 390x844', width: 390, height: 844, dpr: 2 },
  { name: 'desktop 1280x800', width: 1280, height: 800, dpr: 1 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/?mode=dojo', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__smkk?.ready === true || true, null, { timeout: 30000 });

  // Sample rAF deltas directly — the in-game perf HUD is behind a setting.
  const stats = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let last = performance.now();
        let n = 0;
        const tick = () => {
          const now = performance.now();
          samples.push(now - last);
          last = now;
          if (++n < 180) requestAnimationFrame(tick);
          else {
            samples.sort((a, b) => a - b);
            resolve({
              median: samples[Math.floor(samples.length / 2)],
              p95: samples[Math.floor(samples.length * 0.95)],
              worst: samples[samples.length - 1],
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );

  const fps = (ms) => (1000 / ms).toFixed(1);
  console.log(
    `${vp.name.padEnd(18)} median ${fps(stats.median).padStart(5)} fps  ` +
      `p95 ${fps(stats.p95).padStart(5)} fps  worst ${fps(stats.worst).padStart(5)} fps`,
  );
  await ctx.close();
}

await browser.close();
