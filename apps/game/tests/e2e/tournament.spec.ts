import { expect, test } from './fixtures.js';
import type { Page } from '@playwright/test';
import { Thumbs, anchorOf, tap } from './thumbs.js';

type Tournament = { active: boolean; round: number; roundId: string | null; score: number; held: boolean };
const tournament = (page: Page) =>
  page.evaluate(() => (globalThis as Record<string, any>)['__smkk'].tournament() as Tournament);

type HeldSample = { t: number; tick: number; roundTag: string; cardText: string };
type HeldWindow = { samples: HeldSample[]; openedAt: number; closedAt: number };

/**
 * How often the in-page recorder samples while the round card is up.
 *
 * Measured, not guessed: 4ms holds at a 4.06–4.16ms mean on both projects,
 * phone-portrait mobile emulation included, and the render loop still held
 * 17ms/frame (≈58fps) with the recorder running, so it is not measurably
 * stealing time from the thing it measures.
 */
const SAMPLE_MS = 4;

/**
 * ROUND_INTRO_MS as it is in `apps/game/src/main.ts` today, and the floors a
 * recorded hold has to clear before the per-sample claims below count as
 * evidence.
 *
 * These were wrong in this file for a long time, and the wrongness is the whole
 * story of the CI failures they now exist to prevent. The card was 4000ms when
 * they were written. It is 9000ms now — lengthened twice, for readability, in
 * commits that touched no line of this spec — and the comments kept describing a
 * 4s budget that stopped existing.
 *
 * The floors and their discrimination are in `holdFloors.ts`, unit-tested
 * against the recordings that used to defeat them.
 */
import { evaluateHoldFloors } from './holdFloors.js';

// Progress only. The round NAME belongs to the card headline; the HUD strip
// carries how far through the run we are. Both used to name it, 130px apart.
const ROUND_ONE_TAG = 'Round 1/5';

/**
 * Records the whole round-card window from inside the page, starting before the
 * game boots.
 *
 * The previous version of this check sampled *after* `ready`, from the test
 * process, and then branched on whether it had managed to collect any samples
 * at all, running the clock and round-tag assertions only inside that branch.
 * The card is only up for 4s, so a runner slow enough to arrive after it had
 * dismissed took the empty branch, asserted nothing, and still passed — the
 * exact hole commit 0820ee6 closed for the art-folder audit.
 *
 * Recording in-page from an init script removes the race instead of routing
 * around it. The window is captured whether or not the test happened to be
 * looking yet, so every claim below can be unconditional, and a card that never
 * came up becomes a named failure rather than a branch that quietly skips.
 */
const recordHold = async (page: Page): Promise<void> => {
  await page.addInitScript((sampleMs) => {
    const w = globalThis as Record<string, any>;
    const hold: { samples: unknown[]; openedAt: number; closedAt: number } = {
      samples: [],
      openedAt: 0,
      closedAt: 0,
    };
    w['__hold'] = hold;

    const timer = setInterval(() => {
      const api = w['__smkk'];
      if (!api) return;

      if (api.tournament().held) {
        const t = performance.now();
        if (hold.openedAt === 0) hold.openedAt = t;
        hold.samples.push({
          t,
          tick: api.state().tick,
          roundTag: document.querySelector('.round-tag')?.textContent ?? '',
          cardText: document.querySelector('.result')?.textContent ?? '',
        });
        return;
      }

      // Only the first close matters: after it, the recorder has the window.
      if (hold.openedAt > 0 && hold.closedAt === 0) {
        hold.closedAt = performance.now();
        clearInterval(timer);
      }
    }, sampleMs);
  }, SAMPLE_MS);
};

const readHold = (page: Page) => page.evaluate(() => (globalThis as Record<string, any>)['__hold'] as HeldWindow);

/**
 * Waits for the card to dismiss on its own, and says so by name if it never
 * did. A bare Playwright timeout here would read as "test timed out"; the
 * whole point is that a card which never held must be loud.
 */
const waitForHoldToClose = async (page: Page): Promise<void> => {
  try {
    await page.waitForFunction(
      () => (globalThis as Record<string, any>)['__hold'].closedAt > 0,
      null,
      { timeout: 20_000 },
    );
  } catch (cause) {
    const hold = await readHold(page);
    const span = hold.openedAt === 0 ? 0 : Math.round((hold.closedAt - hold.openedAt) || 0);
    throw new Error(
      'the round card was never held and dismissed, so every claim about the hold would have been ' +
        `vacuous: the in-page recorder saw ${hold.samples.length} held samples over ${span}ms. ` +
        `Original failure: ${String(cause)}`,
    );
  }
};

test('the game opens on the tournament, holding the bout behind the round card', async ({ page }) => {
  await recordHold(page);
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  // The precondition, asserted while the card is unambiguously up. If the card
  // has already dismissed by the time the test arrives, that is a real,
  // distinguishable state — so it fails here, loudly, instead of skipping the
  // clock assertions below.
  expect(await tournament(page)).toMatchObject({
    active: true,
    round: 0,
    roundId: 'qualifier',
    score: 0,
    held: true,
  });

  const card = page.locator('.result');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Qualifier');
  await expect(page.locator('.round-tag')).toContainText('1/5');

  // Now let the card run its own full countdown. Nobody presses anything, so
  // the recorded window is the entire life of the card — which is what makes
  // the clock claim worth making, and why this test never races the 4s timer.
  await waitForHoldToClose(page);

  const hold = await readHold(page);
  const ticks = [...new Set(hold.samples.map((sample) => sample.tick))];
  const tags = [...new Set(hold.samples.map((sample) => sample.roundTag))];

  // Unconditional from here down. The window is proven real by the floors first,
  // so each claim below is about a measured stretch of the card being up rather
  // than about whatever happened to be true.
  //
  // The floors live in holdFloors.ts and are unit-tested against the shapes that
  // used to defeat them, because the first version of this check was a bare
  // sample COUNT and it failed on CI at 9 samples on a two-core runner.
  const floors = evaluateHoldFloors(hold);
  expect(floors.ok, floors.ok ? '' : floors.because).toBe(true);
  expect(ticks, 'the bout clock must not move while the round card is up').toHaveLength(1);
  // `tick` is the simulation step count: createMatch starts it at 0 and step()
  // is the only thing that raises it, so a single 0 means no tick ran at all.
  expect(ticks[0], 'the bout clock was not at its opening value during the hold').toBe(0);
  expect(tags, 'the round tag must name the same round for the whole hold').toEqual([ROUND_ONE_TAG]);
  expect(
    hold.samples.filter((sample) => !sample.cardText.includes('Qualifier')),
    'the round card must name its round for the whole hold',
  ).toEqual([]);

  // And the hold really does end: the card goes away, `held` clears, the bout
  // starts. Same tail the old test had, now reached by the countdown.
  await expect(card).toBeHidden();
  expect((await tournament(page)).held).toBe(false);
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk'].state().phase === 'fight',
    null,
    { timeout: 20_000 },
  );
});

test('the round card’s FIGHT button releases the bout clock', async ({ page }) => {
  await recordHold(page);
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);

  const card = page.locator('.result');
  await expect(card).toBeVisible();

  // Pin, read, and press — in that order, in ONE round trip, inside the page.
  //
  // The press cannot be a Playwright `.click()`. Not because clicking is hard:
  // because Playwright's actionability wait cannot fit inside the card's
  // lifetime. Measured on CI's condition (no GPU, SwiftShader) and read off the
  // trace artifact:
  //
  //   step                        t+        dur
  //   Evaluate (pin + label)      6.32s     1.38s
  //   Click                       6.32s    45.99s     ← 77% of a 60s budget
  //   Expect "toBeHidden"        52.31s     8.27s
  //   Wait for function          60.07s   (test timeout, ~0.1s of budget left)
  //
  // Both CI attempts, and the same test on the desktop project passing in 15.1s.
  // The cause is that the phone project runs at deviceScaleFactor 3 — 2.96M
  // backing pixels against the desktop project's 1.02M — so under software
  // rasterization every page round trip queues behind a ~460ms frame, and the
  // actionability poll needs many of them. Meanwhile `frame(now)` is driven by the
  // rAF timestamp, so ROUND_INTRO_MS really is 9 seconds of wall time: the card
  // dismisses itself while the click is still queued, and the countdown wins
  // every time. The page snapshot from the failure shows the consequence — "29
  // seconds remaining" and an IPPON already scored, because the bout ran
  // unattended for the ~48s the click was waiting to be actionable.
  //
  // Worse than slow: the wait outlives the card, so the locator re-resolves onto
  // the NEXT round's freshly-built button and the click "succeeds" on round 2.
  // `expect(card).toBeHidden()` and `held === false` then pass for the wrong
  // reason, which is why this read as a clock assertion failing when the clock
  // claim was never the thing that broke.
  //
  // So the press is delivered in-page, in the same synchronous block as the pin.
  // `button.click()` dispatches a real click event at the real listener
  // (`addEventListener('click', opts.rematch, { once: true })`), so `act()` runs
  // exactly as a tap does: it cancels `pendingAt` and calls `beginBout`. Nothing
  // between the pin and the press crosses the page boundary, because a round trip
  // there is precisely the time this whole change exists to remove. What this no
  // longer exercises is the browser's synthesized pointer event and hit-testing;
  // real-pointer reachability of this control is covered by
  // reference-tap-target.test.ts, and the claim here is about the clock.
  const before = await page.evaluate(() => {
    const w = globalThis as Record<string, any>;
    const button = document.querySelector<HTMLButtonElement>('.result-rematch');
    const box = button?.getBoundingClientRect();
    // Proof the press is about to land on a control that is genuinely on screen.
    // A card that has already dismissed reports a 0x0 box, so this is what stops
    // the press from silently becoming a press on nothing.
    const onScreen = !!box && box.width > 0 && box.height > 0;
    const pinnedTick = w['__smkk'].state().tick as number;
    // The label carries a live countdown, so only the stable part is asserted.
    const label = button?.textContent ?? '';
    button?.click();
    return { pinnedTick, label, onScreen };
  });
  expect(before.onScreen, 'the FIGHT button must be on screen when the press lands').toBe(true);
  const pinnedTick = before.pinnedTick;
  expect(pinnedTick, 'the clock was not pinned while the round card was up').toBe(0);
  expect(before.label, "the round card's action must read FIGHT").toContain('FIGHT');

  await expect(card).toBeHidden();
  expect((await tournament(page)).held).toBe(false);

  // The press has to release the clock, not just hide the card: the bout tick
  // was pinned at 0 across the whole hold, so seeing it move is the release.
  await page.waitForFunction(
    (pinned) => (globalThis as Record<string, any>)['__smkk'].state().tick > pinned,
    pinnedTick,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk'].state().phase === 'fight',
    null,
    { timeout: 20_000 },
  );
});

test('the old single-bout modes stay out of the tournament', async ({ page }) => {
  await page.goto('/?mode=classic');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  expect((await tournament(page)).active).toBe(false);
  await expect(page.locator('.result')).toBeHidden();
});

/**
 * The result card's score is the one score the player sees that is not the HUD.
 *
 * For thirty-one rounds it was a string while the HUD was DOM, so a glyph that
 * renders slashed — `2½` reading as `21/2` — sat on the card for five models
 * after the HUD itself had been fixed. This asserts the notation on the card
 * that is actually rendered, because the defect was never in a value: it was in
 * the card not using the same mechanism as the HUD.
 */
test('the result card scores with the HUD notation, never the slashed glyph', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', 'the card layout under test is the phone card');
  test.setTimeout(180_000);

  await page.goto('/?mode=dojo');
  await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true);
  const rematch = page.locator('.result-rematch');
  if (await rematch.isVisible().catch(() => false)) await rematch.click();
  await page.waitForFunction(
    () => (globalThis as Record<string, any>)['__smkk']?.state?.().phase === 'fight',
    null,
    { timeout: 20_000 },
  );

  const thumbs = await Thumbs.attach(page);
  const stance = await anchorOf(page, '#zone-left', 1);
  const technique = await anchorOf(page, '#zone-right', 2);
  const deadline = Date.now() + 120_000;
  const reads = ['up', 'right', 'left', 'down'] as const;
  let i = 0;

  while (Date.now() < deadline) {
    if (await page.locator('.result-score').isVisible().catch(() => false)) break;
    await thumbs.release();
    await tap(thumbs, stance, 'right');
    const dir = reads[i++ % reads.length]!;
    await tap(thumbs, technique, dir);
  }
  await thumbs.release();

  const card = page.locator('.result-score');
  await expect(card).toBeVisible({ timeout: 20_000 });
  // No U+00BD anywhere in the rendered card, whatever the notation.
  await expect(card).not.toContainText('\u00bd');
  // If a half is showing it is the stacked fraction the HUD builds, and its
  // numerator is a real 1 rather than a glyph pretending to be one.
  if ((await card.locator('.score-frac').count()) > 0) {
    await expect(card.locator('.score-frac-num').first()).toHaveText('1');
  }
  // It still reads as a score rather than as raw state.
  await expect(card).toHaveText(/\d/);
});
