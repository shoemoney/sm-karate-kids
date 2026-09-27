import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { Thumbs, anchorOf, hold } from './thumbs.js';

const OUT = resolve(import.meta.dirname, '../../../../docs/preview');

/**
 * Not a test of behaviour — this is the committed proof that the emblem reads
 * on a real phone frame, regenerated every CI run so it can never go stale.
 */
test('captures the portrait preview frame', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', 'the preview frame is portrait');

  await page.goto('/?mode=dojo');
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight',
  );

  const thumbs = await Thumbs.attach(page);
  const stance = await anchorOf(page, '#zone-left', 1);
  const technique = await anchorOf(page, '#zone-right', 2);

  // Close the distance, then freeze the frame on an extended roundhouse.
  await hold(thumbs, stance, 'right');
  await page.waitForTimeout(330);
  await hold(thumbs, technique, 'up');
  await page.waitForTimeout(190);

  mkdirSync(dirname(`${OUT}/portrait.png`), { recursive: true });
  await page.screenshot({ path: `${OUT}/portrait.png` });
  await thumbs.release();

  const emblems = await page.evaluate(() =>
    (globalThis as Record<string, any>)['__smkk'].emblems(),
  );
  expect(emblems.every((e: { bound: boolean }) => e.bound)).toBe(true);
});
