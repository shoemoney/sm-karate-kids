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

/**
 * The behavioural contract, checked against the renderer that is actually on
 * screen: every technique plays its own cells out of the atlas, and the
 * referee's window shows the pose's contact frame rather than a frame caught
 * mid-ramp.
 *
 * Samples are collected inside the page on requestAnimationFrame. Polling
 * from the test instead would put a round trip to the browser between reads,
 * and a strike's active window is only a few ticks wide — the sample would
 * miss the very frames this is about.
 */
test('every technique plays its own frames, holding contact through the active window', async ({ page }) => {
  test.skip(!manifestExists, 'fighter atlas not generated yet');

  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  // The round card holds for four seconds before the bell.
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight',
    undefined,
    { timeout: 30_000 },
  );

  const samples = await page.evaluate(async () => {
    const api = (globalThis as Record<string, any>)['__smkk'];
    const collected: Array<{
      fighter: number;
      move: string | null;
      phase: string;
      cell: number;
    }> = [];
    const deadline = performance.now() + 6_000;
    await new Promise<void>((done) => {
      const sample = (): void => {
        const state = api.state();
        const frames = api.spriteFrames();
        const moves = [state.p1Move, state.p2Move];
        const phases = [state.p1Phase, state.p2Phase];
        for (let fighter = 0; fighter < 2; fighter += 1) {
          collected.push({
            fighter,
            move: moves[fighter] ?? null,
            phase: phases[fighter] ?? 'neutral',
            cell: frames[fighter]?.cell ?? -1,
          });
        }
        if (performance.now() >= deadline) done();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return collected;
  });

  expect(samples.length).toBeGreaterThan(100);

  // Both fighters draw real atlas cells. A -1 means the view never resolved a
  // frame, which would make every other assertion here pass vacuously.
  for (const fighter of [0, 1]) {
    const cells = samples.filter((s) => s.fighter === fighter).map((s) => s.cell);
    expect(Math.min(...cells), `fighter ${fighter} never drew a frame`).toBeGreaterThanOrEqual(0);
  }

  // The move set actually came to life: several distinct non-idle poses, and
  // the cells changed rather than holding one still image.
  const moveSamples = samples.filter((s) => s.move !== null);
  expect(moveSamples.length, 'no technique was thrown during the bout').toBeGreaterThan(20);

  const idleCells = new Set(
    samples.filter((s) => s.move === null).map((s) => s.cell),
  );
  const moveCells = new Set(moveSamples.map((s) => s.cell));
  for (const cell of moveCells) {
    expect(idleCells.has(cell), `move frame ${cell} is also used as an idle frame`).toBe(false);
  }
  expect(moveCells.size, 'every technique showed the same single frame').toBeGreaterThan(1);

  // The referee's window. Every observed active tick shows the contact frame
  // the manifest declares for that technique — a strike is never half-ramped
  // while the referee is still deciding it.
  const active = moveSamples.filter((s) => s.phase === 'active');
  expect(active.length, 'never caught the referee window; raise the sample window').toBeGreaterThan(0);
  const wrong = active.filter((s) => contactByMove.get(s.move as string) !== s.cell);
  expect(
    wrong.map((s) => `${s.move}@fighter${s.fighter} showed ${s.cell}, contact is ${contactByMove.get(s.move as string)}`),
    'active window did not hold the contact frame',
  ).toEqual([]);

  // A frozen fighter is frozen on the same frame the referee stopped it at.
  const frozen = moveSamples.filter((s) => s.phase === 'frozen');
  for (const s of frozen) {
    expect(contactByMove.get(s.move as string)).toBe(s.cell);
  }
});
