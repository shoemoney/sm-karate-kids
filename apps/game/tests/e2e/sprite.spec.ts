import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures.js';

// The asset pipeline generates this file separately. Until it exists there is
// nothing for the sprite renderer to load, so the whole suite stays green
// rather than red on a build that simply hasn't been asset-generated yet.
const MANIFEST_PATH = resolve(import.meta.dirname, '../../public/fighters/manifest.json');
const manifestExists = existsSync(MANIFEST_PATH);

const TICKS = 1500;
const SEED = 424242;

test.beforeEach(() => {
  test.skip(!manifestExists, 'apps/game/public/fighters/manifest.json does not exist yet');
});

test('?fighters=sprite boots with the sprite renderer and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/?fighters=sprite');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const fighters = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].fighters);
  expect(fighters).toBe('sprite');

  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('both fighters report a bound sprite texture with real dimensions', async ({ page }) => {
  await page.goto('/?fighters=sprite');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const emblems = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].emblems());

  expect(emblems).toHaveLength(2);
  for (const emblem of emblems) {
    expect(emblem.bound).toBe(true);
    expect(emblem.width).toBeGreaterThan(0);
    expect(emblem.height).toBeGreaterThan(0);
    expect(emblem.src.length).toBeGreaterThan(0);
  }
});

test('the sprite renderer never touches simulation state', async ({ page }) => {
  const bench = async (url: string): Promise<{ checksum: string; tick: number; scores: [number, number] }> => {
    await page.goto(url);
    await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
    return page.evaluate(
      ([ticks, seed]) => (globalThis as Record<string, any>)['__smkk'].bench(ticks, seed),
      [TICKS, SEED] as const,
    );
  };

  const sprite = await bench('/?fighters=sprite');
  const mesh = await bench('/?fighters=mesh');

  expect(sprite.checksum).toBe(mesh.checksum);
  expect(sprite.tick).toBe(mesh.tick);
  expect(sprite.scores).toEqual(mesh.scores);
  // A bout that never started would match trivially on both.
  expect(sprite.tick).toBeGreaterThan(100);
});

test('the sprite fighters are the default, and ?fighters=mesh opts out', async ({ page }) => {
  test.skip(!manifestExists, 'fighter atlas not generated yet');
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  expect(await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].fighters)).toBe('sprite');

  await page.goto('/?fighters=mesh');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  expect(await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].fighters)).toBe('mesh');
});
