import { expect, test } from './fixtures.js';

/**
 * The pre-bout card must still be on screen when boot is slower than its budget.
 *
 * WHY THIS IS A BROWSER TEST. The defect is in WHEN a wall-clock deadline is
 * armed, and no unit test can see a wall clock. It is also invisible to every
 * gate this repo had: `result-card-fighters-clear.spec.ts` DID catch it, 7
 * failures in 12 at load 19-32 — but it caught it as a 30s timeout on
 * `waitFor('.result-reference')` with "locator resolved to hidden" as the only
 * clue, which reads as a flake and is not.
 *
 * `main.ts` armed `schedule(beginBout, ROUND_INTRO_MS, nowMs)` from
 * `newRun(performance.now())` at module eval, which runs BEFORE the first
 * `requestAnimationFrame`. So the nine seconds the constant documents as reading
 * time were spent on boot. Measured at load 12.2, boot took 2700 / 4106 / 6250ms
 * — 30% / 46% / 69% of the budget gone before the card was presented — and under
 * load it passed 9000ms, at which point `act()` fired inside the very first
 * frame and removed a card nobody had seen.
 *
 * WHY THE LOOP IS STARVED RATHER THAN THE CPU THROTTLED. CPU throttling is the
 * obvious control and it is the wrong one: at the rate that pushes boot past
 * 9000ms this test took 30-90s per run, which is most of a 60s budget spent
 * waiting for a slow machine to be slow. Delaying the first frames instead costs
 * a fixed 11s of wall clock on any hardware, spends no CPU, and reproduces the
 * condition by construction — boot cannot finish before the budget, because the
 * test is holding the frames that would have finished it.
 *
 * A gate that only goes red on a loaded machine is a gate whose red is a
 * coincidence. This one is not: revert the `handedOver` guard in `main.ts` and
 * it fails here, on an idle machine, every time.
 */
test.describe('the pre-bout card survives a boot slower than its own budget', () => {
  test('the card is still up, and still readable, when boot outlasts the deadline', async ({ page }) => {
    // The suite's default 60s is not enough for a boot that is DELIBERATELY
    // slower than 12s: measured at 43-49s on this machine and once over 60s when
    // the box was loaded, which reads as a game failure and is a budget one.
    // `test.slow()` triples the timeout, which is the point of it — this test is
    // slow by design rather than by accident.
    test.slow();
    // 11s > ROUND_INTRO_MS (9s), pinned from main.ts the way
    // tests/e2e/holdFloors.ts pins it for the bout clock.
    const SLOW_BOOT_MS = 12_500;

    // Installed before any module runs, and it stalls EVERY animation frame for the
    // first 11 seconds of page life — not a chosen number of frames.
    //
    // Two earlier versions of this harness were wrong in ways worth recording,
    // because both were green against code that was broken:
    //
    //   three delayed frames  -> 33s, which is PAST the 20s deadline the fix
    //                          hands out, so the test went red on the FIX
    //   one delayed frame    -> passed against the OLD code, because "the first
    //                          rAF callback" is not necessarily `frame()`; the
    //                          boot screen and the renderer queue ahead of it,
    //                          so the delay landed somewhere harmless and the
    //                          gate certified nothing
    //
    // Stalling the whole pipeline by elapsed time instead of counting callbacks
    // makes the ordering irrelevant: there is no frame at all for the first 11s,
    // so `frame()` cannot have run, so the deadline cannot have been checked, and
    // the card is guaranteed to still be on screen when the app finally draws.
    // It also costs a fixed 11s on any hardware.
    // Delay the game's OWN asset loads, which is what `boot()` genuinely waits on
    // (`await stage.ready`, main.ts:287). Boot is slow because work is slow; the
    // clock it burns is the same clock the deadline is armed from, so a boot
    // pushed past ROUND_INTRO_MS reproduces the defect exactly.
    //
    // THREE earlier harnesses were wrong here, all the same mistake — perturbing
    // something and assuming the game's first frame or clock was what got
    // perturbed:
    //
    //   delay 3 rAF callbacks -> 33s, past the re-armed deadline, so it went red
    //                          against the FIX
    //   delay 1 rAF callback  -> passed against the OLD code, because the first
    //                          rAF is the boot screen's, not `frame()`
    //   delay all rAF         -> also delayed the boot card's exit transition,
    //                          so `screen.close()` never resolved, `__smkk.ready`
    //                          never published, and the test timed out at 60s
    //
    // The last one is the instructive one: a harness that delays the observer
    // cannot distinguish "the game never got there" from "I never let it finish",
    // and it fails in the costume of a game bug. A network delay has no such
    // ambiguity — the page's own timers, transitions and Playwright's polling all
    // run at full speed, and the only thing that takes longer is the boot.
    await page.route('**/generated/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_BOOT_MS));
      await route.continue();
    });
    await page.route('**/fighters/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_BOOT_MS));
      await route.continue();
    });

    await page.goto('/');

    // EVERY wait below polls on a TIMER, not on rAF, and that is not a detail.
    //
    // This harness replaces `window.requestAnimationFrame`, and Playwright's
    // `waitForFunction` and `toBeVisible` both default to rAF polling — so the
    // first version of this test stalled the very mechanism it used to observe
    // the page with. It passed 5/5 on an idle box and then failed 3/3 on a
    // loaded one, on the same build and the same bundle hash, because how long
    // the observer took to notice was a function of the stall. A harness that
    // changes what it is measuring by the amount it perturbs is not a harness.
    //
    // `polling: 100` puts the observation back on wall-clock time, which is the
    // axis this test is actually about.
    const POLL = 100;

    // The stall must be longer than the budget it is defeating, and by enough
    // that a loaded box's slower boot cannot pull the first frame back under
    // 9000ms — measured at load 10-17, boot alone runs 2.3-6.3s on top of the
    // stall, so 9.5s of stall was only just enough and the margin moved with the
    // weather. 12s leaves the condition true across the range this box runs at.
    expect(SLOW_BOOT_MS).toBeGreaterThan(9000);

// NO explicit `timeout` here, deliberately. An explicit one overrides
    // `test.slow()` and pins the wait at 60s while the boot it is waiting for is
    // deliberately 12.5s slower than the page's normal boot — which is how this
    // test failed three times with a timeout that looked like a game failure and
    // was a budget one. Letting the wait inherit the test's own budget means one
    // number governs the slowness instead of two disagreeing.
    await page.waitForFunction(() => (globalThis as Record<string, any>)['__smkk']?.ready === true, null, {
      polling: POLL,
    });

    // ONE atomic read of all three facts, because checking them separately is how
    // this test was flaky twice.
    //
    // `held` and `tick` are only true WHILE the card is up: the card's own
    // 9000ms budget expires, `beginBout` runs, `held` goes false and the tick
    // starts — with nothing wrong. So a version that waited for the button and
    // only then asked about the clock had a race between the two reads.
    //
    // It showed, on the SAME bundle hash: passed at load 16.1 and 17.6, failed
    // at 29.9 and again at 14.8. Non-monotonic in load is the signature of a
    // race, not a threshold — and a gate that red and green on the same build
    // certifies nothing, so it is fixed rather than retried.
    //
    // Reading visibility, `held` and `tick` in one evaluate closes the window:
    // there is no gap between them in which the budget can expire, so a green run
    // means all three held at a single instant.
    const seen = await page.evaluate(() => {
      const s = (globalThis as Record<string, any>)['__smkk'];
      const card = document.querySelector('.result');
      const ref = card?.querySelector('.result-reference');
      return {
        shown: card?.classList.contains('show') === true,
        refHasBox: (ref?.getBoundingClientRect().height ?? 0) > 0,
        held: s.tournament().held,
        tick: s.state().tick,
      };
    });

    // The claim. Before the fix `act()` had already run inside the first frame,
    // so `.result` never carried `show` at all.
    expect(seen.shown, 'the pre-bout card was dismissed during boot instead of after it').toBe(true);
    expect(seen.refHasBox, 'the TECHNIQUES button is inside a card nobody can see').toBe(true);
    expect(seen.held, 'the bout clock was released before the card was presented').toBe(true);
    expect(seen.tick, 'the fight ran while the card was still up').toBe(0);
  });
});

