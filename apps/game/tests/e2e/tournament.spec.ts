import { expect, test } from './fixtures.js';

type Tournament = { active: boolean; round: number; roundId: string | null; score: number; held: boolean };
const tournament = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].tournament() as Tournament);

test('the game opens on the tournament, holding the bout behind the round card', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const t = await tournament(page);
  expect(t).toMatchObject({ active: true, round: 0, roundId: 'qualifier', score: 0 });

  // The round card counts itself down, and on a slow runner it can finish
  // before a test gets here. So measure the frozen clock inside the page,
  // frame by frame, only for as long as the card is genuinely up.
  const held = await page.evaluate(
    () =>
      new Promise<{ frames: number; ticks: number[] }>((resolve) => {
        const api = (globalThis as Record<string, any>)['__smkk'];
        const ticks = new Set<number>();
        let frames = 0;
        const sample = (): void => {
          if (!api.tournament().held || frames >= 30) {
            resolve({ frames, ticks: [...ticks] });
            return;
          }
          ticks.add(api.state().tick);
          frames += 1;
          requestAnimationFrame(sample);
        };
        sample();
      }),
  );
  if (held.frames > 0) {
    expect(held.ticks, 'the bout clock must not move while the round card is up').toHaveLength(1);
    await expect(page.locator('.round-tag')).toContainText('1/5');
  }

  const card = page.locator('.result');
  if (await card.isVisible()) {
    await expect(card).toContainText('Qualifier');
    await page.locator('.result-rematch').click();
  }
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
