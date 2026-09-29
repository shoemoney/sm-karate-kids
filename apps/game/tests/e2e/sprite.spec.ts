import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures.js';

// The asset pipeline generates this file separately. Until it exists there is
// nothing for the sprite renderer to load, so the whole suite stays green
// rather than red on a build that simply hasn't been asset-generated yet.
const MANIFEST_PATH = resolve(import.meta.dirname, '../../public/fighters/manifest.json');
const manifestExists = existsSync(MANIFEST_PATH);

const TICKS = 1500;
const SEED = 424242;

interface Manifest {
  readonly poses: Record<string, { readonly frames: readonly number[]; readonly contact: number }>;
}

const contactByMove = new Map<string, number>(
  Object.entries(
    (
      JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
    ).poses,
  ).map(([id, pose]) => [id, pose.frames[pose.contact] as number]),
);

/** One observation of one fighter, captured inside the page. */

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

interface SweepEntry {
  readonly id: string;
  readonly seen: ReadonlyArray<{ readonly phase: string; readonly cell: number }>;
}

/**
 * The per-technique contract, checked against the renderer that is actually on
 * screen: every technique in the game plays its own cells, and the referee's
 * window shows that technique's contact frame rather than a frame caught
 * mid-ramp.
 *
 * Driven through `spriteSweep()` rather than by waiting for a real fight. The
 * other fighter is a person, and a person standing still does not throw
 * anything, so a live bout exercises a handful of techniques and no more —
 * asserting on that would be a coin toss, not a test. The sweep walks the real
 * `SpriteFighterView` through every move's startup, active and recovery ticks,
 * which covers the whole move list in milliseconds with no race.
 */
test('every technique plays its own frames, holding contact through the active window', async ({ page }) => {
  test.skip(!manifestExists, 'fighter atlas not generated yet');

  await page.goto('/?fighters=sprite');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const report = await page.evaluate(
    () => (globalThis as Record<string, any>)['__smkk'].spriteSweep() as SweepEntry[] | null,
  );
  expect(report, 'the sprite renderer is not the one on screen').not.toBeNull();
  const entries = report ?? [];

  // Every technique in the game, not a convenient sample of them.
  const moveIds = [...new Set(entries.map((e) => e.id))].sort();
  expect(moveIds.length).toBeGreaterThanOrEqual(20);
  expect(moveIds).toContain('lunge_punch');
  expect(moveIds).toContain('front_kick');
  expect(moveIds).toContain('low_block');

  const problems: string[] = [];
  const framesPerMove = new Map<string, Set<number>>();

  for (const entry of entries) {
    const contact = contactByMove.get(entry.id);
    if (contact === undefined) {
      problems.push(`${entry.id}: no pose in the atlas`);
      continue;
    }

    const cells = new Set(entry.seen.map((s) => s.cell));
    framesPerMove.set(entry.id, cells);

    // Each technique must animate, and must animate out of its own frames.
    if (cells.size < 2) problems.push(`${entry.id}: showed a single frame (${[...cells].join(',')})`);

    for (const frame of entry.seen) {
      if (frame.cell < 0) problems.push(`${entry.id}: ${frame.phase} drew no cell`);
    }

    // The referee's window, tick by tick, on the live view.
    const active = entry.seen.filter((s) => s.phase === 'active');
    if (active.length === 0) {
      problems.push(`${entry.id}: never entered the active window`);
    }
    for (const frame of active) {
      if (frame.cell !== contact) {
        problems.push(`${entry.id}: active showed cell ${frame.cell}, contact is ${contact}`);
      }
    }
  }

  expect(problems, `sprite frame contract broken:\n  ${problems.join('\n  ')}`).toEqual([]);

  // No two techniques may play the same cells, or they are not their own art.
  const signature = new Map<string, string>();
  const shared: string[] = [];
  for (const [id, cells] of framesPerMove) {
    const key = [...cells].sort((a, b) => a - b).join(',');
    const owner = signature.get(key);
    if (owner !== undefined) shared.push(`${owner} & ${id}`);
    else signature.set(key, id);
  }
  expect(shared, `these techniques play identical frames: ${shared.join('; ')}`).toEqual([]);
});

test('a live bout draws atlas cells and holds contact when the referee is deciding', async ({ page }) => {
  test.skip(!manifestExists, 'fighter atlas not generated yet');

  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  // The round card holds for four seconds before the bell.
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight',
    undefined,
    { timeout: 30_000 },
  );

  // Sampled inside the page on requestAnimationFrame: a poll from the test puts
  // a round trip between reads, and the active window is only a few ticks wide,
  // so it would miss the frames this is about. The window is generous because a
  // software-rendered CI runner can manage well under 5fps, and this test is
  // about what the renderer draws when it does draw — the exhaustive
  // per-technique contract is the sweep's job above.
  const samples = await page.evaluate(async () => {
    const api = (globalThis as Record<string, any>)['__smkk'];
    const collected: Array<{ move: string | null; phase: string; cell: number }> = [];
    const deadline = performance.now() + 10_000;
    await new Promise<void>((done) => {
      const sample = (): void => {
        const state = api.state();
        const frames = api.spriteFrames();
        for (let i = 0; i < 2; i += 1) {
          collected.push({
            move: (i === 0 ? state.p1Move : state.p2Move) ?? null,
            phase: (i === 0 ? state.p1Phase : state.p2Phase) ?? 'neutral',
            cell: frames[i]?.cell ?? -1,
          });
        }
        if (performance.now() >= deadline) done();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return collected;
  });

  // Enough that both fighters contributed a sample — below two, one of the
  // per-fighter minimums below is taken over an empty list and passes on
  // Infinity. Not a frame-rate expectation: a software-rendered CI runner can
  // manage well under 5fps, and a floor it cannot reach is a flaky test.
  expect(samples.length, 'the in-page sampler collected nothing').toBeGreaterThanOrEqual(2);

  // Both fighters draw real atlas cells. A -1 would make every assertion below
  // pass vacuously, so it is checked first.
  for (const fighter of [0, 1]) {
    const cells = samples
      .filter((_, index) => index % 2 === fighter)
      .map((s) => s.cell);
    expect(Math.min(...cells), `fighter ${fighter} never drew a frame`).toBeGreaterThanOrEqual(0);
  }

  // Whatever the fight happened to throw, it held contact through every active
  // tick we caught. Stated conditionally on what was observable: a runner too
  // slow to land a sample inside a three-tick window has not falsified
  // anything, and the per-technique sweep above is the exhaustive check.
  const throwing = samples.filter((s) => s.move !== null);
  const wrong = throwing
    .filter((s) => s.phase === 'active' && contactByMove.get(s.move as string) !== s.cell)
    .map((s) => `${s.move} active showed ${s.cell}, contact is ${contactByMove.get(s.move as string)}`);
  expect(wrong, 'a live strike did not hold its contact frame').toEqual([]);

  test.info().annotations.push({
    type: 'observed',
    description: `${throwing.length} moving sample(s), ${samples.filter((s) => s.phase === 'active').length} in the active window`,
  });
});
