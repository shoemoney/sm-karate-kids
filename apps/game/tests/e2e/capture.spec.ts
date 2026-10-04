import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from './fixtures.js';
import { Thumbs, anchorOf, hold } from './thumbs.js';

/**
 * Where the captured frame lands.
 *
 * The committed README image is NOT the default destination, and making it not
 * the default is the whole point of this constant. The capture spec runs on
 * every `pnpm test:e2e`, so writing the tracked path meant every local run
 * ended with a modified file in the tree — a diff nobody reviewed, in the one
 * artifact that is supposed to be a deliberate choice. Seven rounds have
 * reverted it by hand (REVIEW-LOOP.md r152, r154, r155, r156, r157, r158,
 * r159), and it cost a deploy: r164b found the tree dirty and, correctly,
 * refused to publish over a tree that looked like another agent's work in
 * progress. A known side effect was presenting as an unknown one.
 *
 * So the frame goes to the git-ignored scratch directory by default, and
 * refreshing the committed preview is an explicit act whose result is a real
 * diff to read:
 *
 *     SMKK_COMMIT_PREVIEW=1 pnpm test:e2e
 *
 * The assertions below are unchanged and still run in both modes — the capture
 * proves the emblems render and a technique was playing when the shutter was
 * open whichever path the pixels take.
 */
const COMMITTED_PREVIEW = resolve(import.meta.dirname, '../../../../docs/preview');
const OUT = process.env.SMKK_COMMIT_PREVIEW
  ? COMMITTED_PREVIEW
  : resolve(import.meta.dirname, '../../test-results/preview');

/**
 * A roundhouse reaches 2.05m, so opening the drill just inside it means the
 * kick already lands. Walking the fighters together first would work, but it
 * leaves the spacing wherever the walk happened to end — and a capture taken
 * from a different spacing drifts one fighter off the edge of the frame.
 */
const DRILL_SPACING = 1.95;

/**
 * Not a test of behaviour — this is the committed proof that the emblem reads
 * on a real phone frame, and the only automated check that the sprite fighters
 * are what actually renders.
 *
 * Freshness is a manual step, and deliberately so: this test runs on every
 * `pnpm test:e2e`, but by default its frame goes to a git-ignored scratch
 * directory (see OUT below), so the PNG in the repo is only as current as the
 * last run someone made with `SMKK_COMMIT_PREVIEW=1` and committed. Do not read
 * a green CI run as "the preview is up to date". What CI *does* guarantee is
 * that capturing still works and the emblems still render.
 */
test('captures the portrait preview frame', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', 'the preview frame is portrait');

  await page.goto(`/?mode=dojo&spacing=${DRILL_SPACING}`);
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight',
  );

  // The committed proof has to be a picture of the sprite fighters. Without
  // this, a build that fell back to the 3D rig would still capture, and the
  // one artefact that is supposed to show the art would show the wrong thing.
  expect(await page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].fighters)).toBe('sprite');

  const thumbs = await Thumbs.attach(page);
  const technique = await anchorOf(page, '#zone-right', 2);

  // Freeze the frame on an extended roundhouse.
  //
  // The poses are recorded in the page across the whole capture, because the
  // game latches a press: a held thumb throws once and then returns to neutral,
  // and a strike is only a few ticks wide. Asking the page what it is drawing
  // *after* the shot always answers "idle", long after the pose is gone.
  await page.evaluate(() => {
    const w = globalThis as Record<string, any>;
    w.__poses = [];
    const sample = (): void => {
      const api = w['__smkk'];
      if (api?.spriteFrames) {
        w.__poses.push((api.spriteFrames() as Array<{ pose: string }>).map((f) => f.pose));
      }
      if (!w.__poseStop) requestAnimationFrame(sample);
    };
    w.__poseStop = false;
    requestAnimationFrame(sample);
  });

  // No approach walk: the drill opens at kick range already.
  await hold(thumbs, technique, 'up');
  await page.waitForTimeout(210);

  mkdirSync(dirname(`${OUT}/portrait.png`), { recursive: true });
  await page.screenshot({ path: `${OUT}/portrait.png` });

  const recorded = await page.evaluate(() => {
    const w = globalThis as Record<string, any>;
    w.__poseStop = true;
    return w.__poses as string[][];
  });
  await thumbs.release();

  const emblems = await page.evaluate(() =>
    (globalThis as Record<string, any>)['__smkk'].emblems(),
  );
  expect(emblems.every((e: { bound: boolean }) => e.bound)).toBe(true);

  // A technique really was playing while the shutter was open — a portrait of
  // two fighters idling does not show the animation, and the only thing that
  // proves it is the recording made across the capture.
  expect(recorded.length, 'the in-page pose recorder collected nothing').toBeGreaterThan(0);
  const playedSomething = recorded.some((poses) => poses.some((pose) => pose !== 'idle'));
  expect(playedSomething, 'no technique played while the portrait was captured').toBe(true);
});
