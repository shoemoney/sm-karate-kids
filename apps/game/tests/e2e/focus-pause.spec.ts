import { expect, test } from './fixtures.js';
import type { Page } from '@playwright/test';

/**
 * Losing page focus pauses a single-player bout (PRD FR-018).
 *
 * A phone notification, a call, or an alt-tab used to leave the CPU fighting a
 * player who was not looking. The bout now freezes behind a full-screen
 * RESUME button, and only the player's own tap or key brings it back.
 *
 * Each arm checks both halves: the tick stops, AND it runs again after the
 * resume. "The tick did not move" is also what a crashed page reports.
 */

async function intoFight(page: Page): Promise<void> {
  await page.goto('/?mode=dojo');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight', null, {
    timeout: 30_000,
  });
}

const tick = (page: Page): Promise<number> => page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().tick);

async function expectFrozen(page: Page): Promise<number> {
  await expect(page.locator('#pause')).toBeVisible();
  // Visible is not enough: an unstyled button is visible too. The pause screen
  // must be what a tap on the technique stick actually lands on, or the tap
  // that resumes can also throw.
  const onPad = await page.evaluate(() => {
    const r = document.getElementById('zone-right')!.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#pause') !== null;
  });
  expect(onPad, 'the pause screen does not cover the technique stick').toBe(true);
  const at = await tick(page);
  await page.waitForTimeout(1_200);
  expect(await tick(page), 'the bout ran on while the page had lost focus').toBe(at);
  return at;
}

test('a window blur mid-bout pauses it, and a tap resumes', async ({ page }) => {
  await intoFight(page);
  const before = await tick(page);
  await page.waitForTimeout(600);
  expect(await tick(page), 'the bout clock is not running at all').toBeGreaterThan(before);

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const frozen = await expectFrozen(page);

  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toBeHidden();
  await page.waitForFunction((t) => (globalThis as Record<string, any>)['__smkk'].state().tick > t, frozen, { timeout: 10_000 });
});

test('a hidden tab pauses the bout, and the key that resumes it throws nothing', async ({ page }) => {
  await intoFight(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const frozen = await expectFrozen(page);

  // Every frame from here on, because a leaked technique is over in well under
  // a second and a single read afterwards would find p1Move back at null.
  await page.evaluate(() => {
    const g = globalThis as Record<string, any>;
    g['__p1Moves'] = [];
    const sample = (): void => {
      const move = g['__smkk'].state().p1Move;
      if (move !== null) g['__p1Moves'].push(move);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  // A technique key: if the resume press leaked through, it would come out.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#pause')).toBeHidden();
  await page.waitForFunction((t) => (globalThis as Record<string, any>)['__smkk'].state().tick > t + 60, frozen, { timeout: 10_000 });
  expect(await page.evaluate(() => (globalThis as Record<string, any>)['__p1Moves']), 'the resume key threw a technique').toEqual([]);
});

test('focus loss during the pre-bout card does not pause anything', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(300);
  await expect(page.locator('#pause')).toBeHidden();
});
