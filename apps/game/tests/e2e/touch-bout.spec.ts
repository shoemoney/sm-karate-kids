import { expect, test } from '@playwright/test';
import { Thumbs, anchorOf, hold, tap, type Dir } from './thumbs.js';

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
const STRIKES: ReadonlyArray<{ name: string; min: number; max: number; technique: Dir }> = [
  { name: 'front_kick', min: 1.6, max: 2.05, technique: 'up' },
  { name: 'lunge_punch', min: 1.15, max: 1.6, technique: 'right' },
];

/**
 * The dojo opens the drill at front-kick range.
 *
 * Closing the distance by touch is not testable over a slow link: the fighter
 * walks about three metres a second, so a half-second round trip carries it
 * through the whole strike band before the release lands. Walking has its own
 * test below. This one is about whether a bout can be WON by thumb, so it
 * drills from the range the technique lands at, exactly as a student would.
 */
const DRILL_SPACING = 1.85;

/** Beyond this the fighter has to close before anything can land. */
const MAX_REACH = 2.05;

/** Inside this even the shortest technique overshoots, so back off. */
const STEP_BACK_BELOW = 1.15;

test('a bout is won end to end with nothing but two thumbs', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', 'touch is the phone contract');
  test.setTimeout(300_000);

  await page.goto(`/?mode=dojo&spacing=${DRILL_SPACING}`);
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
    // Let go before looking. A round trip to a loaded CI runner is seconds of
    // game time, and a fighter still walking during it crosses the whole
    // strike band between two reads. Standing still makes the gap we read the
    // gap we actually strike from.
    await thumbs.release();
    const snapshot = await read();
    if (snapshot.phase === 'over') {
      if (snapshot.winner === 0) break;
      // The bout ran out of clock. The game restarts itself; drill the next one
      // rather than failing on a round trip that happened to be slow.
      await page.waitForFunction(
        () => (globalThis as Record<string, any>)['__smkk'].state().phase !== 'over',
        null,
        { timeout: 30_000 },
      );
      continue;
    }

    if (snapshot.phase !== 'fight') {
      await page.waitForTimeout(120);
      continue;
    }

    const gap = snapshot.positions[1] - snapshot.positions[0];

    if (gap > MAX_REACH || gap < STEP_BACK_BELOW) {
      await tap(thumbs, stance, gap > MAX_REACH ? 'right' : 'left');
      continue;
    }

    const strike = STRIKES.find((candidate) => gap >= candidate.min && gap <= candidate.max);
    if (strike === undefined) {
      await tap(thumbs, stance, 'left');
      continue;
    }

    // Both of these are thrown from a neutral stance, so nothing walks while
    // the technique is in the air and the gap we measured is the gap it lands
    // from. The press latch catches a tap shorter than a frame.
    await tap(thumbs, technique, strike.technique);
    strikesThrown += 1;
    await page.waitForTimeout(220);
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
  await expect
    .poll(async () => (await positionOf()) - start, { timeout: 10_000 })
    .toBeGreaterThan(0.15);
  await thumbs.release();

  await page.waitForTimeout(400);
  const settled = await positionOf();
  await tap(thumbs, technique, 'up');
  // The technique lives for a few hundred milliseconds, so poll the record of
  // what started rather than what is currently mid-flight.
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            ((globalThis as Record<string, any>)['__smkk'].state().lastStarted as
              | { moveId: string }
              | null)?.moveId ?? null,
        ),
      { timeout: 20_000 },
    )
    .toBe('front_kick');
  // A technique may step, but it must not walk the fighter across the mat.
  expect(Math.abs((await positionOf()) - settled)).toBeLessThan(0.6);
});
