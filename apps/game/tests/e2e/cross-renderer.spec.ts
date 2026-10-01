import { expect, test } from './fixtures.js';
import { MIN_RATIO } from '../../src/renderScale.js';

interface Bench {
  checksum: string;
  tick: number;
  phase: string;
  scores: [number, number];
}

interface ScaleState {
  ratio: number;
  ladder: number[];
  frames: number;
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

/**
 * The adaptive-resolution controller is the fix for the GPU-less runner, where
 * the frame cost was fragment-bound and a Playwright click took 50–53s.
 *
 * Note what this test does *not* assert: that the ratio dropped. Whether it
 * drops depends on the machine — on a GPU the ladder correctly never moves, so
 * an assertion that it degraded would be red on every fast box and green only
 * on the slow one. That is the wrong way round for a gate.
 *
 * So this pins the three things that hold on every machine, and the one that
 * proves the controller is alive. The first three are deliberately quiet: a
 * controller that is never fed still reports a legal ratio, a legal ladder and
 * a ratio that is one of its own rungs. Only the frame count separates a live
 * controller from a dead one, which is why it is here and why it has to be
 * observed *growing* rather than merely non-zero.
 */
test('the render loop feeds the adaptive-resolution controller, and its ratio stays legal', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const read = (): Promise<ScaleState> =>
    page.evaluate(
      () => (globalThis as Record<string, any>)['__smkk'].renderScale() as ScaleState,
    );

  await page.waitForFunction(
    () => ((globalThis as Record<string, any>)['__smkk'].renderScale() as ScaleState).frames > 0,
    null,
    { timeout: 20_000 },
  );

  // Polling for growth rather than comparing two reads, because two evaluates
  // can land inside one animation frame on a slow runner — and a comparison
  // that flakes is worse than no assertion. The margin is several frames so a
  // single straddled read cannot satisfy it.
  const baseline = (await read()).frames;
  await page.waitForFunction(
    (from) => ((globalThis as Record<string, any>)['__smkk'].renderScale() as ScaleState).frames > from + 4,
    baseline,
    { timeout: 20_000 },
  );

  const shot = await read();
  // There has to be somewhere to walk to, or "stable" means "cannot adapt".
  expect(shot.ladder.length).toBeGreaterThan(1);
  // Always a rung of its own ladder — the invariant that survives every path.
  expect(shot.ladder).toContain(shot.ratio);
  // Never past the floor the measurement set, and never sharper than the
  // device's own ratio (the ladder caps at 2 by construction).
  expect(shot.ratio).toBeGreaterThanOrEqual(MIN_RATIO);
  expect(Math.max(...shot.ladder)).toBeLessThanOrEqual(2);
  expect(shot.frames).toBeGreaterThan(baseline);
});
