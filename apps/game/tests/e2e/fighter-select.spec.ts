import { expect, test } from './fixtures.js';
import type { Page } from '@playwright/test';

/**
 * The player decides whether they are Asmongold or HasanAbi.
 *
 * Every arm checks the sim AND the sprites (`seats()`), because the two are
 * wired separately: a swap that moved the simulation and left the atlases put
 * would hand the player HasanAbi's body under Asmongold's controls.
 */

type Seats = { sim: string[]; views: (string | null)[] };
const seats = (page: Page): Promise<Seats> =>
  page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].seats());
const ready = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

test('the opening card swaps who you are, and the pick survives a reload', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  expect(await seats(page)).toEqual({ sim: ['shiro', 'aka'], views: ['shiro', 'aka'] });

  const swap = page.locator('.result-swap');
  await expect(swap).toHaveText(/Play as HasanAbi/i);
  await swap.click();

  await expect(page.locator('.result-score')).toHaveText('vs Asmongold');
  await expect(page.locator('#name-0')).toHaveText('HasanAbi');
  expect(await seats(page)).toEqual({ sim: ['aka', 'shiro'], views: ['aka', 'shiro'] });
  // The side colour belongs to the fighter: HasanAbi on the left is still red.
  const leftColour = await page.locator('#name-0').evaluate((el) => getComputedStyle(el).color);
  const akaDim = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--aka-dim)';
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  expect(leftColour).toBe(akaDim);
  await expect(page.locator('.result-swap')).toHaveText(/Play as Asmongold/i);

  await page.reload();
  await ready(page);
  expect(await seats(page)).toEqual({ sim: ['aka', 'shiro'], views: ['aka', 'shiro'] });
  await page.locator('#btn-settings').click();
  await expect(page.locator('#opt-fighter input[value="aka"]')).toBeChecked();
});

test('the player steers the fighter they picked', async ({ page }) => {
  await page.goto('/?mode=dojo&as=hasan');
  await ready(page);
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk'].state().phase === 'fight', null, { timeout: 30_000 });
  expect(await seats(page)).toEqual({ sim: ['aka', 'shiro'], views: ['aka', 'shiro'] });

  const x0 = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().positions[0]);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  const x1 = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().positions[0]);
  expect(x1, 'D did not walk the player-1 fighter in').toBeGreaterThan(x0);
});

test('?as= wins over the saved pick for that visit', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('.result-swap').click();
  await page.goto('/?as=asmongold');
  await ready(page);
  expect((await seats(page)).sim).toEqual(['shiro', 'aka']);
});

test('in the dojo, Settings swaps fighters at once', async ({ page }) => {
  await page.goto('/?mode=dojo');
  await ready(page);
  await page.locator('#btn-settings').click();
  await page.locator('#opt-fighter input[value="aka"]').check();
  expect(await seats(page)).toEqual({ sim: ['aka', 'shiro'], views: ['aka', 'shiro'] });
  await expect(page.locator('#name-0')).toHaveText('HasanAbi');
});

test('mid-bout in a tournament, a Settings change waits for the next bout, then applies', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await ready(page);
  await page.locator('.result-rematch').click();
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk'].state().phase === 'fight', null, { timeout: 30_000 });
  await page.locator('#btn-settings').click();
  await page.locator('#opt-fighter input[value="aka"]').check();
  await page.locator('#settings-close').click();
  // The bout in progress is not restarted or reseated.
  expect(await seats(page)).toEqual({ sim: ['shiro', 'aka'], views: ['shiro', 'aka'] });
  await expect(page.locator('#name-0')).toHaveText('Asmongold');

  // And the pick is not merely recorded: the next bout is built with it. Nobody
  // touches the sticks, so the bout ends on the clock or the CPU's points.
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk'].state().phase === 'over', null, { timeout: 60_000 });
  await page.locator('.result-rematch').click();
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk'].seats().sim[0] === 'aka', null, { timeout: 15_000 });
  expect(await seats(page)).toEqual({ sim: ['aka', 'shiro'], views: ['aka', 'shiro'] });
  await expect(page.locator('#name-0')).toHaveText('HasanAbi');
});

test('a pick made over the dojo result card is not undone by its rematch timer', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?mode=dojo');
  await ready(page);
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk'].state().phase === 'over', null, { timeout: 60_000 });
  await page.locator('#btn-settings').click();
  await page.locator('#opt-fighter input[value="aka"]').check();
  await page.locator('#settings-close').click();
  expect((await seats(page)).sim).toEqual(['aka', 'shiro']);

  // Every frame, because a second restart is a tick that goes backwards for
  // one frame and a couple of reads afterwards would never see it.
  await page.evaluate(() => {
    const g = globalThis as Record<string, any>;
    g['__ticks'] = [];
    const sample = (): void => {
      g['__ticks'].push(g['__smkk'].state().tick);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.waitForTimeout(10_000); // past REMATCH_AFTER_MS (8s)
  const ticks: number[] = await page.evaluate(() => (globalThis as Record<string, any>)['__ticks']);
  const backwards = ticks.findIndex((t, i) => i > 0 && t < ticks[i - 1]!);
  expect(backwards, `the bout restarted under the player at sample ${backwards}`).toBe(-1);
  expect(ticks.at(-1)!, 'the new bout is not running').toBeGreaterThan(ticks[0]!);
});
