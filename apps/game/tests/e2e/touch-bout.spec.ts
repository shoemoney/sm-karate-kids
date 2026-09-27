import { expect, test } from '@playwright/test';
import { Thumbs, anchorOf, hold, type Dir } from './thumbs.js';

interface Snapshot {
  phase: string;
  scores: [number, number];
  positions: [number, number];
  winner: number | null;
}

/**
 * Reach windows measured from the content table, widest first.
 *
 * Walking to one exact distance is not robust: the clock drains up to five
 * ticks in a frame, so on a slow machine the fighter can cross a narrow window
 * between two polls and never fire. Picking the technique that suits the gap
 * the fighter is ALREADY at removes the race, and exercises three techniques
 * instead of one.
 */
const STRIKES: ReadonlyArray<{ name: string; min: number; max: number; stance: Dir; technique: Dir }> = [
  { name: 'roundhouse_kick', min: 2.0, max: 2.7, stance: 'right', technique: 'up' },
  { name: 'front_kick', min: 1.6, max: 2.0, stance: 'neutral', technique: 'up' },
  { name: 'lunge_punch', min: 1.2, max: 1.6, stance: 'neutral', technique: 'right' },
];

/** Beyond this the fighter has to close before anything can land. */
const MAX_REACH = 2.7;

test('a bout is won end to end with nothing but two thumbs', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', 'touch is the phone contract');
  test.setTimeout(300_000);

  await page.goto('/?mode=dojo');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const thumbs = await Thumbs.attach(page);
  const stance = await anchorOf(page, '#zone-left', 1);
  const technique = await anchorOf(page, '#zone-right', 2);

  const read = async (): Promise<Snapshot> =>
    page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].state() as Snapshot);

  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight',
  );

  const deadline = Date.now() + 210_000;
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

    if (gap > MAX_REACH) {
      await hold(thumbs, stance, 'right');
      await page.waitForTimeout(40);
      continue;
    }

    const strike = STRIKES.find((candidate) => gap >= candidate.min && gap <= candidate.max);
    if (strike === undefined) {
      await hold(thumbs, stance, 'left');
      await page.waitForTimeout(40);
      continue;
    }

    await hold(thumbs, stance, strike.stance);
    await hold(thumbs, technique, strike.technique);
    strikesThrown += 1;
    await page.waitForTimeout(140);
    await thumbs.release();
    await page.waitForTimeout(240);
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
    () => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight',
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
