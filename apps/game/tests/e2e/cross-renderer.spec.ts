import { expect, test } from '@playwright/test';

interface Bench {
  checksum: string;
  tick: number;
  phase: string;
  scores: [number, number];
}

const TICKS = 1500;
const SEED = 424242;

async function bench(url: string, page: import('@playwright/test').Page): Promise<{ backend: string; result: Bench }> {
  await page.goto(url);
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  return page.evaluate(
    ([ticks, seed]) => {
      const api = (globalThis as Record<string, any>)['__smkk'];
      return { backend: api.backend as string, result: api.bench(ticks, seed) as Bench };
    },
    [TICKS, SEED] as const,
  );
}

test('the same seed produces the same match on both renderer backends', async ({ page }) => {
  const preferred = await bench('/', page);
  const fallback = await bench('/?renderer=webgl', page);

  expect(fallback.backend).toBe('WebGL 2');
  expect(['WebGPU', 'WebGL 2']).toContain(preferred.backend);

  expect(fallback.result.checksum).toBe(preferred.result.checksum);
  expect(fallback.result.tick).toBe(preferred.result.tick);
  expect(fallback.result.scores).toEqual(preferred.result.scores);
  // A bout that never started would match trivially on both.
  expect(preferred.result.tick).toBeGreaterThan(100);
});

test('the game refuses to die when WebGPU is unavailable', async ({ page }) => {
  await page.goto('/?renderer=webgl');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  await expect(page.locator('#backend')).toHaveText('WebGL 2');
  await expect(page.locator('#banner')).not.toHaveText('FAILED TO START');
});
