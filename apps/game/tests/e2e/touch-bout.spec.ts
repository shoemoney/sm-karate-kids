import { expect, test } from '@playwright/test';
import { Thumbs, anchorOf, hold } from './thumbs.js';

interface Snapshot {
  phase: string;
  scores: [number, number];
  positions: [number, number];
  winner: number | null;
}

/** Roundhouse lands from roughly this far out once the step is counted in. */
const STRIKE_GAP = { min: 1.95, max: 2.45 };

test('a bout is won end to end with nothing but two thumbs', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', 'touch is the phone contract');
  test.setTimeout(120_000);

  await page.goto('/?mode=dojo');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const thumbs = await Thumbs.attach(page);
  const stance = await anchorOf(page, '#zone-left', 1);
  const technique = await anchorOf(page, '#zone-right', 2);

  const read = async (): Promise<Snapshot> =>
    page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state() as Snapshot);

  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk'].state().phase === 'fight',
  );

  const deadline = Date.now() + 90_000;
  let strikesThrown = 0;

  while (Date.now() < deadline) {
    const snapshot = await read();
    if (snapshot.phase === 'over') break;

    if (snapshot.phase !== 'fight') {
      await thumbs.release();
      await page.waitForTimeout(150);
      continue;
    }

    const gap = snapshot.positions[1] - snapshot.positions[0];

    if (gap > STRIKE_GAP.max) {
      await hold(thumbs, stance, 'right');
      await page.waitForTimeout(50);
      continue;
    }
    if (gap < STRIKE_GAP.min) {
      await hold(thumbs, stance, 'left');
      await page.waitForTimeout(50);
      continue;
    }

    // Left stick forward qualifies the right-stick-up family into a roundhouse.
    await hold(thumbs, stance, 'right');
    await hold(thumbs, technique, 'up');
    strikesThrown += 1;
    await page.waitForTimeout(130);
    await thumbs.release();
    await page.waitForTimeout(260);
  }

  await thumbs.release();
  const final = await read();

  expect(strikesThrown, 'the loop should have actually thrown techniques').toBeGreaterThan(0);
  expect(final.phase).toBe('over');
  expect(final.winner).toBe(0);
  expect(final.scores[0]).toBeGreaterThanOrEqual(2);
});

test('the stance stick moves the fighter and the technique stick does not', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', 'touch is the phone contract');

  await page.goto('/?mode=dojo');
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk'].state().phase === 'fight',
  );

  const thumbs = await Thumbs.attach(page);
  const stance = await anchorOf(page, '#zone-left', 1);
  const technique = await anchorOf(page, '#zone-right', 2);

  const positionOf = async (): Promise<number> =>
    page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state().positions[0] as number);

  const start = await positionOf();
  await hold(thumbs, stance, 'right');
  await page.waitForTimeout(400);
  await thumbs.release();
  const walked = await positionOf();
  expect(walked).toBeGreaterThan(start + 0.15);

  await page.waitForTimeout(400);
  const settled = await positionOf();
  await hold(thumbs, technique, 'up');
  await page.waitForTimeout(90);
  const struck = await page.evaluate(
    () => (globalThis as Record<string, any>)['__smkk'].state().p1Move as string | null,
  );
  await thumbs.release();

  expect(struck).toBe('front_kick');
  // A technique may step, but it must not walk the fighter across the mat.
  expect(Math.abs((await positionOf()) - settled)).toBeLessThan(0.6);
});
