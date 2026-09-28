import { expect, test } from './fixtures.js';

type Tournament = { active: boolean; round: number; roundId: string | null; score: number; held: boolean };
const tournament = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].tournament() as Tournament);
const tick = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().tick as number);

test('the game opens on the tournament, holding the bout behind the round card', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const t = await tournament(page);
  expect(t).toMatchObject({ active: true, round: 0, roundId: 'qualifier', score: 0, held: true });

  const card = page.locator('.result');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Qualifier');
  await expect(page.locator('.round-tag')).toContainText('1/5');

  // The bout clock gets no time while the card is up.
  const before = await tick(page);
  await page.waitForTimeout(600);
  expect(await tick(page)).toBe(before);

  await page.locator('.result-rematch').click();
  await expect(card).toBeHidden();
  expect((await tournament(page)).held).toBe(false);
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk'].state().phase === 'fight',
    null,
    { timeout: 20_000 },
  );
});

test('the old single-bout modes stay out of the tournament', async ({ page }) => {
  await page.goto('/?mode=classic');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  expect((await tournament(page)).active).toBe(false);
  await expect(page.locator('.result')).toBeHidden();
});
