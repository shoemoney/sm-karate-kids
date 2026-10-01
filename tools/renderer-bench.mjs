/**
 * Renderer cost benchmark — measures the two things round 145 needs.
 *
 * 1. FRAME TIME. rAF deltas sampled straight off the page, so this is the real
 *    cost of a frame under whatever renderer config is in the tree right now.
 *
 * 2. THE CLICK. The thing that actually goes red in CI. `tournament.spec.ts`
 *    clicks `.result-rematch` and Playwright's actionability wait is several
 *    round trips, each of which queues behind the main thread. A frame-time
 *    number and a click number are different measurements and only the second
 *    one is the failure, so both are reported.
 *
 * THE TWO ARE MEASURED ON SEPARATE PAGE LOADS. The round card self-dismisses
 * at ROUND_INTRO_MS (9s), so a bench that samples frames and then clicks
 * measures the click against a card that is already gone. That is exactly the
 * mistake the test file documents at tournament.spec.ts:198, and it is why an
 * earlier version of this script read `NEW TOURNAMENT` and a tick of 1015
 * instead of the round card and a pinned 0.
 *
 * Software rendering is FORCED, because the machine this runs on has a GPU and
 * the runner that goes red does not. Measuring with a GPU measures a different
 * machine than the one that fails. `--gfx` picks which software backend to ask
 * for: `webgl` (SwiftShader via ANGLE) or `webgpu` (Dawn on SwiftShader, which
 * is what the Linux runner picks).
 *
 * Usage: node tools/renderer-bench.mjs <label> [--frames N] [--gfx webgl|webgpu]
 * Prints one JSON object so a driver can collect several configs in a row.
 */
import { chromium, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const label = process.argv[2] ?? 'unlabelled';
const FRAMES = Number(arg('frames', 120));
const GFX = arg('gfx', 'webgl');
const CLICKS = Number(arg('clicks', 1));
/**
 * CPU throttling rate, applied over CDP for the whole session.
 *
 * WHY THIS EXISTS. Every measurement of this problem on a GPU machine, including
 * round 144's, has been taken on hardware roughly eight times faster than the
 * runner that goes red. At 60ms/frame locally nothing is starved, Playwright's
 * actionability poll is not queueing behind frames, and the click comes back in
 * under a second — which is why a sweep here produced the best frame times
 * (16.7ms, vsync-capped) attached to the worst click times (930ms). A harness
 * that cannot make the failure appear cannot tell you whether a candidate fix
 * removes it. Throttling is how the failure is made to appear on demand, and
 * the throttle rate is a control, so every row in a sweep is measured at the
 * same one.
 */
const CPU = Number(arg('cpu', 1));

const PORT = Number(process.env['BENCH_PORT'] ?? 4188);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Both backends, rasterized in software. `--disable-gpu` alone is not enough on
 * Chromium: ANGLE can still find a hardware path, so the GL backend is pinned
 * to swiftshader explicitly.
 */
const GL_FLAGS = ['--disable-gpu', '--disable-gpu-compositing'];
const SOFTWARE_GL =
  GFX === 'webgpu'
    ? [...GL_FLAGS, '--use-gl=swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan']
    : [...GL_FLAGS, '--use-gl=swiftshader'];

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const round = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

/**
 * Host load, recorded with every row.
 *
 * This is not decoration. Round 145's first sweep returned 56.6ms of median
 * frame time for the baseline; a later sweep of the identical, unmodified tree
 * returned 77.1ms; another returned 161.9ms. Nothing in the tree changed. The
 * unattended review loop was running its own Playwright suite on the same CPU,
 * and the "renderer change" being evaluated was the machine's contention for
 * cores. A frame-time number without the load it was taken at is not a
 * measurement, it is a rumour — so the number travels with its conditions, and
 * a caller can refuse to compare rows taken at different loads.
 */
function hostLoad() {
  try {
    const out = execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' });
    const [m1] = out.trim().replace(/[{}]/g, '').split(/\s+/);
    return round(Number(m1));
  } catch {
    return null;
  }
}

/**
 * Generous by design.
 *
 * At the deep end of the throttle ladder a boot takes tens of seconds, and a
 * short wait reports "the card never appeared" when the truth is "the card had
 * not appeared yet". Those are different findings and this harness is supposed
 * to be able to tell them apart, so the waits are sized for the slowest row
 * rather than for the fastest one.
 */
const WAIT = Number(arg('wait', 240_000));

const boot = async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__smkk?.ready === true, null, { timeout: WAIT });
};

/**
 * A phone-portrait context with CPU throttling already applied.
 *
 * The CDP session has to attach to a live page, so the page is made here too
 * rather than by the caller — otherwise every caller has to remember to
 * throttle before it navigates, and a forgotten throttle produces a row that
 * looks like every other row and is not.
 */
const newPhonePage = async (browser) => {
  const context = await browser.newContext({
    ...devices['iPhone 12'],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  if (CPU > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  }
  return { context, page };
};

/** Pass 1 — steady-state frame cost. No dependence on where the tournament is. */
async function measureFrames(browser) {
  const { context, page } = await newPhonePage(browser);
  await boot(page);
  await page.waitForTimeout(1_500); // let the boot card and shader compiles settle

  const samples = await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        let n = 0;
        const tick = () => {
          const now = performance.now();
          // The first delta spans the settle wait; drop it so it cannot dominate.
          if (n > 0) out.push(now - last);
          last = now;
          if (++n <= count) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    FRAMES,
  );

  const meta = await page.evaluate(() => ({
    backend: globalThis.__smkk.backend,
    fighters: globalThis.__smkk.fighters,
  }));

  await context.close();
  const sorted = [...samples].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  return {
    backend: meta.backend,
    fighters: meta.fighters,
    frameSamples: sorted.length,
    frameMs: {
      median: round(median),
      p95: round(percentile(sorted, 0.95)),
      max: round(sorted[sorted.length - 1] ?? 0),
      fpsMedian: round(1000 / (median || 1)),
    },
  };
}

/**
 * Pass 2 — the click, on a page that has just booted so the round card is still
 * up. This is tournament.spec.ts's FIGHT test, measured instead of asserted.
 *
 * REPEATED, because a single click is not a measurement. The first sweep of
 * this harness took one click per config and produced a table where the
 * best-performing frame times (16.6ms, vsync-capped) carried the WORST click
 * time (1127ms) — a contradiction, not a finding. Playwright's actionability
 * wait is a poll, and one poll is one sample of a distribution this harness has
 * no business summarising with a single number. Median over several fresh page
 * loads is the smallest honest unit, and every sample is reported so the spread
 * stays visible instead of disappearing into a confident figure.
 */
async function measureClick(browser) {
  const samples = [];
  let lastError = null;
  let lastHeld = null;
  let lastPinned = null;
  let lastLabel = null;

  for (let run = 0; run < CLICKS; run += 1) {
    const { context, page } = await newPhonePage(browser);
    await boot(page);

    const card = page.locator('.result');
    await card.waitFor({ state: 'visible', timeout: WAIT });
    const held = await page.evaluate(() => globalThis.__smkk.tournament().held);

    // One round trip for the pinned tick AND the label, exactly as the spec
    // does. Reading them separately spends two round trips the 9s countdown
    // does not have, which is the mistake the spec documents at line 198.
    const pinned = await page.evaluate(() => ({
      tick: globalThis.__smkk.state().tick,
      label: document.querySelector('.result-rematch')?.textContent ?? '',
    }));

    const clickStart = Date.now();
    let clickError = null;
    try {
      await page.locator('.result-rematch').click({ timeout: WAIT });
    } catch (error) {
      clickError = String(error).split('\n')[0];
    }
    const clickMs = Date.now() - clickStart;

    let released = false;
    try {
      await page.waitForFunction((t) => globalThis.__smkk.state().tick > t, pinned.tick, { timeout: WAIT });
      released = true;
    } catch {
      released = false;
    }

    samples.push({ run, clickMs, released, error: clickError });
    lastError = clickError;
    lastHeld = held;
    lastPinned = pinned.tick;
    lastLabel = pinned.label.trim().slice(0, 40);
    await context.close();
  }

  const ok = samples.filter((s) => s.released).map((s) => s.clickMs).sort((a, b) => a - b);
  return {
    clicks: samples.length,
    clickReleased: ok.length,
    clickMsMedian: round(percentile(ok, 0.5)),
    clickMsMax: round(ok[ok.length - 1] ?? 0),
    // Every sample, but capped. A deep ladder multiplies the runs, and an
    // unbounded array turns one slow row into a megabyte of stack trace that
    // buries the number that matters. The cap is 20 per row, and the log file
    // carries the full set.
    clickSamples: samples.slice(0, 20).map((s) => round(s.clickMs)),
    clickError: lastError,
    heldAtPress: lastHeld,
    pinnedTick: lastPinned,
    cardLabel: lastLabel,
  };
}

const browser = await chromium.launch({ args: SOFTWARE_GL });
try {
  const result = {
    label,
    gfx: GFX,
    cpuThrottle: CPU,
    loadBefore: hostLoad(),
    ...(await measureFrames(browser)),
    loadAfter: hostLoad(),
    ...(await measureClick(browser)),
  };
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}