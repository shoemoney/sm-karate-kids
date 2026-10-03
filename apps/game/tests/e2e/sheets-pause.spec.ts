import { expect, test } from './fixtures.js';

/**
 * An open sheet pauses the bout.
 *
 * Every sheet hides `#pad`, so a sheet over a live bout takes the player's
 * controls away. Until `openSheets` existed only the pre-bout card's own
 * TECHNIQUES button held anything: SETTINGS (the only way to reach
 * LEFT-HANDED) and the HUD's TECHNIQUES left the CPU fighting a player who
 * could neither see nor move.
 *
 * The resume arm is the control. "The tick did not move" is also what a
 * crashed page reports, so each sheet must freeze the tick AND let it run again
 * once closed.
 */

const SHEETS = [
  { name: 'settings', open: '#btn-settings', close: '#settings-close', sheet: '#settings-sheet' },
  { name: 'techniques', open: '#btn-techniques', close: '#tech-ref-close', sheet: '#tech-ref' },
] as const;

for (const s of SHEETS) {
  test(`opening ${s.name} mid-bout pauses the fight, closing it resumes`, async ({ page }) => {
    await page.goto('/?mode=dojo');
    await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
    await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight', null, {
      timeout: 30_000,
    });

    // Positive control first: the same wait with no sheet must see the clock run.
    const before = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().tick);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().tick), 'the bout clock is not running at all').toBeGreaterThan(before);

    await page.locator(s.open).click();
    await page.locator(s.sheet).waitFor({ state: 'visible' });
    const frozen = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state());
    await page.waitForTimeout(1_500);
    const after = await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state());
    expect(after.tick, `the bout ran on under the ${s.name} sheet`).toBe(frozen.tick);
    expect(after.timerTicks).toBe(frozen.timerTicks);

    await page.locator(s.close).click();
    await page.locator(s.sheet).waitFor({ state: 'hidden' });
    await page.waitForFunction((t) => (globalThis as Record<string, any>)['__smkk'].state().tick > t, after.tick, { timeout: 10_000 });
  });
}
