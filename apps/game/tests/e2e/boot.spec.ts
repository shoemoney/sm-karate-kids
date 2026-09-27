import { expect, test } from '@playwright/test';

test('boots on a portrait phone with a working renderer backend', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const backend = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].backend);
  expect(['WebGPU', 'WebGL 2']).toContain(backend);
  await expect(page.locator('#backend')).toHaveText(backend);

  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the portrait layout fits the viewport with no horizontal scroll', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', 'portrait baseline only');

  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const metrics = await page.evaluate(() => {
    const stage = document.getElementById('stage');
    const pad = document.getElementById('pad');
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      stageHeight: stage?.clientHeight ?? 0,
      padHeight: pad?.clientHeight ?? 0,
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight,
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.canvasWidth).toBeGreaterThan(300);
  expect(metrics.canvasHeight).toBeGreaterThan(200);
  // Both thumbs need real estate; a pad squeezed under 200px is unplayable.
  expect(metrics.padHeight).toBeGreaterThanOrEqual(200);

  await expect(page.locator('#zone-left')).toBeVisible();
  await expect(page.locator('#zone-right')).toBeVisible();
});

test('both gi emblems carry the ShoeMoney mark', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const emblems = await page.evaluate(() =>
    (globalThis as Record<string, any>)['__smkk'].emblems(),
  );

  expect(emblems).toHaveLength(2);
  for (const emblem of emblems) {
    expect(emblem.bound).toBe(true);
    expect(emblem.visible).toBe(true);
    expect(emblem.width).toBeGreaterThan(0);
    expect(emblem.height).toBeGreaterThan(0);
    expect(emblem.src).toContain('shoemoney-emblem');
  }
});
