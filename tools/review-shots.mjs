#!/usr/bin/env node
/**
 * Capture a full review set for the vision loop: every distinct screen and
 * state a player actually sees, at the portrait baseline and on desktop.
 *
 * Not a test harness — this exists to feed tools/vision-review.py.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/smkk-review';
const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5173';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'],
});

const errors = [];

/** Action timeout for a cold page load on a machine that may be busy. */
const SHOT_TIMEOUT_MS = 120_000;

async function capture(name, viewport, steps) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: viewport.width < 700,
    hasTouch: viewport.width < 700,
  });
  const page = await ctx.newPage();
  // Playwright's default action timeout is 30s, and it applies to `screenshot`.
  // On a loaded machine that is not enough for a software-rendered WebGL canvas to
  // hand the compositor a frame, and the whole run dies with no frames written at
  // all — measured at load 18.9, `08-desktop-fight`, `Timeout 30000ms exceeded:
  // taking page screenshot` after fonts had loaded.
  //
  // r151's standing instruction is that a red result on this machine is not a
  // verdict until the load is printed beside it, and the same applies to a dead
  // one: the fix is more headroom plus a visible load, not a tighter timeout.
  // Waiting for an idle machine is not available to an unattended round.
  page.setDefaultTimeout(SHOT_TIMEOUT_MS);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
  await steps(page);
  await ctx.close();
}

const waitFight = (page) =>
  page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'fight',
    null,
    { timeout: 30000 },
  );

// Throttle so the loading screen is actually observable.
async function boot(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1200 * 1024) / 8,
    uploadThroughput: (600 * 1024) / 8,
  });
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  // Wait for the stylesheet before anything else.
  //
  // At `commit` + 600ms the page has no CSS at all — document.styleSheets
  // enumerates zero style rules — so the card renders unstyled. An unstyled
  // `.boot-fill` is a plain block-level div: full width, no gradient, opacity
  // 1. That is a bar at 100%, under a line that says "Downloading the game",
  // which is exactly what glm-5.3-flash reported this round and exactly what
  // twelve providers have been describing as a broken loading screen for the
  // life of the loop.
  await page.waitForFunction(
    () => {
      let n = 0;
      for (const sh of document.styleSheets) {
        try {
          n += sh.cssRules.length;
        } catch {
          /* cross-origin sheet; the boot card has none */
        }
      }
      return n > 0;
    },
    null,
    { timeout: 15000 },
  );
  // Wait for the card to finish fading in before the shot.
  //
  // This capture was taken 600ms after commit, which is inside `boot-enter`.
  // Every screenshot of this card in every round of the loop has therefore been
  // a photograph of a fade — which is what "loading screen", "empty black
  // screen", "low contrast" and "no progress" all add up to when twelve
  // different providers are shown one.
  //
  // It cost more than it should have to notice. Chasing the boot card's contrast
  // ratio produced a nominally correct colour that measured 2.7:1 on screen,
  // because 0.68 x rgb(133,127,119) is rgb(91,86,81) — exactly the peak pixel,
  // and the card was sitting at 0.68 opacity the whole time. The measurement
  // was fine; the moment it was taken in was not.
  await page.waitForTimeout(600);
  if (await page.locator('#boot').count()) {
    // Wait for the card to actually be at full opacity, rather than guessing
    // how long the fade takes.
    //
    // Every screenshot of this card in every round of the loop has been taken
    // at ~0.67 opacity. A nominally correct colour measured 2.7:1 on screen,
    // because 0.67 x rgb(133,127,119) is rgb(89,85,80) — which is the peak
    // pixel the capture reports, to the digit. The true contrast of these lines
    // is 4.94:1; the loop has been reviewing 2.66:1 and twelve different
    // providers have called it dim, empty, broken and low-contrast accordingly.
    //
    // Waiting on `getAnimations` was not enough — the fade is a transition, not
    // an animation, and the animation list is already empty when we ask. Poll
    // the property we actually care about.
    //
    // Polling `getComputedStyle(card).opacity` does not work, and the reason is
    // worth recording: it reports 1 while the card is still painting at 0.67.
    // `.boot-card` is `animation: boot-enter ... both`, and `both` is a
    // backwards fill — the card holds the from-state of the keyframes, which is
    // where the 0.67 lives, and the property reads as settled while the pixels
    // are not. So the fix is to take the animation out of the picture entirely
    // for the capture, which is what the harness is for: show a reviewer the
    // product, not a transition.
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el) => {
        el.style.animation = 'none';
      });
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  await ctx.close();
}

const phone = { width: 390, height: 844 };
const desk = { width: 1280, height: 800 };

await boot('00-boot-loading');

await capture('01-phone-title', phone, async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-phone-title.png` });
});

await capture('02-phone-fight', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/02-phone-fight.png` });
});

await capture('03-phone-strike', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(420);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(60);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(230);
  await page.screenshot({ path: `${OUT}/03-phone-strike.png` });
  await page.keyboard.up('ArrowUp');
});

await capture('04-phone-controls', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  const zone = await page.locator('#zone-right').boundingBox();
  const cx = zone.x + zone.width / 2;
  const cy = zone.y + zone.height / 2;
  await page.touchscreen.tap(cx, cy - 60);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx, y: cy, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: cx + 40, y: cy - 40, id: 1 }],
  });
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/04-phone-controls.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});

await capture('05-phone-techref', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.locator('#btn-techniques').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/05-phone-techref.png` });
});

await capture('06-phone-settings', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.locator('#btn-settings').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/06-phone-settings.png` });
});

await capture('07-phone-result', phone, async (page) => {
  await page.goto(`${BASE}/?mode=classic`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'over',
    null,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/07-phone-result.png` });
});

await capture('08-desktop-fight', desk, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/08-desktop-fight.png` });
});

await capture('09-phone-highcontrast', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.evaluate(() => document.body.classList.add('high-contrast'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/09-phone-highcontrast.png` });
});

await capture('10-phone-tournament', phone, async (page) => {
  await page.goto(`${BASE}/?mode=tournament`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/10-phone-tournament.png` });
});

/* ---------------------------------------------------------------------------
 * The states round 10 proved we were missing.
 *
 * Ten rounds of the same eleven screens produced an all-reject round: a fresh
 * model on an exhausted set of screens stops finding things. These are the
 * screens the game actually has that nothing was shooting — a real contact, a
 * fighter off the ground, and the tournament ladder before a round card is up.
 * ------------------------------------------------------------------------- */

// A landed strike, framed at the moment of contact.
//
// The first version of this shot watched for a kick pose and screenshotted
// there, which captured a *missed* kick: the fighters were not touching, so
// there was no contact and therefore no impact art — and the obvious
// conclusion, "the impact VFX never render", was wrong. The reliable signal is
// `navigator.vibrate`, which `juice.impact()` calls on every contact. Shoot on
// that, not on a pose.
await capture('11-phone-impact', phone, async (page) => {
  await page.addInitScript(() => {
    globalThis.__hits = 0;
    navigator.vibrate = () => {
      globalThis.__hits += 1;
      return true;
    };
  });
  await page.goto(`${BASE}/?mode=classic`, { waitUntil: 'networkidle' });
  await waitFight(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const before = await page.evaluate(() => globalThis.__hits);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(330);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(80);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    let landed = false;
    for (let tick = 0; tick < 25 && !landed; tick += 1) {
      landed = (await page.evaluate(() => globalThis.__hits)) > before;
      if (!landed) await page.waitForTimeout(35);
    }
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowRight');
    if (landed) {
      await page.waitForTimeout(60);
      await page.screenshot({ path: `${OUT}/11-phone-impact.png` });
      return;
    }
    await page.waitForTimeout(600);
  }
});

// A fighter in the air. Vertical state is a different pose set, a different
// shadow, and a different silhouette — none of which any capture had shown.
await capture('12-phone-jump', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'fight',
    null,
    { timeout: 30000 },
  );
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(230);
  await page.screenshot({ path: `${OUT}/12-phone-jump.png` });
  await page.keyboard.up('ArrowUp');
});

// The tournament ladder before a round card covers it. Ten captures had only
// ever seen the round card, never the thing the round card is covering.
await capture('13-phone-ladder', phone, async (page) => {
  await page.goto(`${BASE}/?mode=tournament`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/13-phone-ladder.png` });
});

/* The state every returning player sees, and the state reviewers had been
   judging as if it were the only one.
   *
   * CORRECTED at r158 — this comment was wrong in BOTH directions.
   *
   * It said the first-run coach strip "was present in EVERY frame the loop ever
   * showed a model". True r3-r22. False r23-r156, because r23 added
   * `coach.dismiss()` to `clearBoutUi`, `dismiss()` is `retire()`, and
   * `retire()` wrote the "already seen" flag — so boot marked the coach seen
   * before it had appeared, and no frame after r23 could contain it. r157 fixed
   * that, which makes the sentence true AGAIN, and every capture below is a
   * first run with the strip up.
   *
   * So both halves of this set are first-run on purpose now: this one seeds the
   * flag, so the set also carries the view a returning player has. The strip
   * clears once both sticks have been used — which no reviewer could have
   * known from one screenshot, because until this round no screenshot showed
   * the other state. Three rounds had called it "a permanent instruction wall"
   * that "never clears between moves"; they were describing a plate they had
   * only ever seen un-retired.
   *
   * r158 is also the first round whose review set carries this plate in a
   * legible state, and the first look anyone has given it found the two halves
   * wrapping in different arrow orders. A frame nobody captured cannot be
   * reviewed, and a frame nobody LOOKED at is the same thing in a better hat. */
await capture('14-phone-returning', phone, async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('smkk:coach-seen-v1', 'true');
    } catch {
      /* storage blocked; the strip shows, which is still a valid frame */
    }
  });
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/14-phone-returning.png` });
});

/* The settings sheet with a MIXED set of states.
 *
 * Every settings frame the loop has ever shown a model had all six toggles off,
 * because the harness never touched one. So the state system was invisible: a
 * reviewer looking at six identical dark tracks in round 21 correctly concluded
 * "settings toggles lack visual state feedback" (mistral-medium-3-5, round 25)
 * about switches that had been legible in both states since round 21, and the
 * same sampling blind spot that hid the returning-player pad for three rounds
 * hid the ON state for four more.
 *
 * Two on, four off, so the frame actually shows the thing it is a review of. */
await capture('15-phone-settings-mixed', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  await page.locator('.hud-actions button').last().click();
  await page.waitForTimeout(600);
  // Mute sound and Show performance HUD — NOT High contrast or Reduced motion.
  //
  // The first version of this capture toggled High contrast, which meant every
  // reviewer saw the settings sheet rendered in its best-case theme and could
  // not judge the contrast of the default one. Two models reported "the
  // settings menu lacks sufficient contrast" off a frame that was, in fact,
  // the high-contrast theme.
  //
  // Toggling a state must not change the conditions under which the state is
  // being reviewed. These two have no effect on how the sheet paints.
  //
  // r169: these two were `rows.nth(4)` and `rows.nth(5)`, and the comment above
  // named what those positions meant. r166 appended two `label.setting-row`
  // radios for the fighter pick to the TOP of that same selector, so every
  // position after them moved down by two and the comment stopped describing the
  // instrument. Measured, not inferred — clicking nth(4)/nth(5) left
  // `body.class = "coach-active large-controls left-handed"`, i.e. the frame was
  // photographing **Large controls** and **Left-handed layout**, in a capture whose
  // stated purpose is the settings sheet as it normally paints. `opt-muted` and
  // `opt-show-perf` were never on. Three rounds of reviewers were shown a state
  // nobody named.
  //
  // So: select by identity, and **assert the identity**. A capture that cannot
  // tell you it clicked the wrong switch is the r154 shape — an instrument that
  // reports a plausible value it never measured. If a row is renamed or moved,
  // this throws instead of quietly photographing the neighbour.
  const clickSetting = async (id, expectedLabel) => {
    const input = page.locator(`#${id}`);
    const label = (await input.evaluate((el) => el.closest('.setting-row')?.textContent.trim() ?? '')).trim();
    if (label !== expectedLabel) {
      throw new Error(`settings capture: #${id} reads "${label}", expected "${expectedLabel}"`);
    }
    await input.click();
  };
  await clickSetting('opt-muted', 'Mute sound');
  await clickSetting('opt-show-perf', 'Show performance HUD');
  // The whole reason for the row choice above: this frame must show the sheet's
  // DEFAULT paint so a reviewer can judge its contrast. Recorded every run,
  // because the failure this guards against is silent by construction.
  const bodyClass = await page.evaluate(() => document.body.className);
  if (/high-contrast|large-controls|left-handed/.test(bodyClass)) {
    throw new Error(`settings capture: frame would show a non-default theme: "${bodyClass}"`);
  }
  console.log(`  15 settings frame body class: "${bodyClass}"`);
  // Drop focus before the shot.
  //
  // The switch's own focus ring is correct — measured: a touch tap leaves
  // `:focus-visible` false and the element unfocused, a Tab leaves it true with
  // a 2px ring. That is right for a touch-first product and it is worth having.
  //
  // But a programmatic Playwright click leaves the row focused, so the capture
  // showed a gold ring on a switch that a real thumb would never have focused,
  // and grok-4.3 reported it as "a stray yellow border" in round 42. The
  // product is right and the photograph is not.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/15-phone-settings-mixed.png` });
});

/* A bout in progress, with a score on the board and feedback on screen.
 *
 * Every frame in this set is the first fifteen seconds of a game. That is why
 * `10½` clipped for twenty-three rounds (round 43) and why the tip's contrast
 * went unmeasured until round 50: nothing here has ever been played.
 *
 * Round 53 read the result as an all-clear — fifteen findings, fifteen stale or
 * refused — which is the signal that the set is exhausted rather than that the
 * product is. The models are reporting accurately on a set of screenshots of a
 * game at 0-0.
 *
 * So this one is played rather than posed: real CDP touch input on both zone
 * anchors, the same grammar the e2e suite uses, driven until the referee
 * actually awards a point. The three attempts in round 43 all forced the DOM
 * text and all lost to the HUD's per-frame write — posing a value the render
 * loop owns cannot work. Playing to the state is slower and it is honest. */
await capture('16-phone-in-play', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  const cdp = await page.context().newCDPSession(page);
  const pts = new Map();
  const send = (type) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...pts].map(([id, q]) => ({ x: Math.round(q.x), y: Math.round(q.y), id })),
    });
  const anchor = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const L = await anchor('#zone-left');
  const R = await anchor('#zone-right');
  const DIRS = { right: [58, 0], left: [-58, 0], up: [0, -58], down: [0, 58], neutral: [0, 0] };
  const COMBOS = [
    ['neutral', 'up'], ['neutral', 'right'], ['right', 'right'],
    ['neutral', 'left'], ['right', 'left'], ['neutral', 'down'],
  ];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const [sd, td] = COMBOS[attempt % COMBOS.length];
    pts.clear();
    pts.set(1, { x: L.x, y: L.y });
    await send('touchStart');
    pts.set(1, { x: L.x + DIRS[sd][0], y: L.y + DIRS[sd][1] });
    await send('touchMove');
    pts.set(2, { x: R.x, y: R.y });
    await send('touchStart');
    pts.set(2, { x: R.x + DIRS[td][0], y: R.y + DIRS[td][1] });
    await send('touchMove');
    await page.waitForTimeout(220);
    await send('touchEnd');
    const scored = await page.evaluate(() => {
      const a = document.querySelector('#points-0')?.textContent ?? '0';
      const b = document.querySelector('#points-1')?.textContent ?? '0';
      return a.trim() !== '0' || b.trim() !== '0';
    });
    if (scored) break;
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/16-phone-in-play.png` });
});

/* ---------- Round 68: the scored result card, which the set never had ---------- */

/* `07-phone-result` is a tournament bracket showing `BOUTS WON 0 / 1 · BEST —`.
 * It is not the card that renders a score. So for thirty-one rounds this set
 * contained no frame of the bout result at all — which is precisely why five
 * models reported the half-point notation, why the round 53 fix reached only
 * the HUD, and why nobody could see that it had been fixed. The instrument was
 * missing the exact screen the finding was about.
 *
 * Played to, with the same thumb grammar the e2e suite uses, so the score on
 * the card is a real one. */
await capture('17-phone-scored-result', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  const anchor = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const L = await anchor('#zone-left');
  const R = await anchor('#zone-right');
  const cdp = await page.context().newCDPSession(page);
  const pts = new Map();
  const send = (type) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...pts].map(([id, q]) => ({ x: Math.round(q.x), y: Math.round(q.y), id })),
    });
  const DIRS = { up: [0, -58], right: [58, 0], left: [-58, 0], down: [0, 58] };
  const READS = ['up', 'right', 'left', 'down'];
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('.result-score').isVisible().catch(() => false)) break;
    pts.clear();
    pts.set(1, { x: L.x, y: L.y });
    await send('touchStart');
    pts.set(1, { x: L.x + 58, y: L.y });
    await send('touchMove');
    const dir = DIRS[READS[i % READS.length]];
    pts.set(2, { x: R.x, y: R.y });
    await send('touchStart');
    pts.set(2, { x: R.x + dir[0], y: R.y + dir[1] });
    await send('touchMove');
    await page.waitForTimeout(190);
    await send('touchEnd');
    await page.waitForTimeout(190);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/17-phone-scored-result.png` });
});

/* ---------- Round 69: a frame that actually contains a kick ---------- */

/* `03-phone-strike` shows a guard stance and has done since round 1, which is
 * why two models have reported an amputated kick from a frame with no kick in
 * it. The kick also has the longest reach in the game and is the only move the
 * camera pulls back for, so it is the frame most worth actually having.
 *
 * Drawn on the simulation clock, not on a screenshot timer: the phase is read
 * from the same debug surface the e2e suite reads, so the capture lands in the
 * active window of a real kick rather than near one. */
await capture('18-phone-kick', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  const anchor = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const L = await anchor('#zone-left');
  const R = await anchor('#zone-right');
  const cdp = await page.context().newCDPSession(page);
  const pts = new Map();
  const send = (type) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...pts].map(([id, q]) => ({ x: Math.round(q.x), y: Math.round(q.y), id })),
    });
  const state = () =>
    page.evaluate(() => (globalThis.__smkk?.state?.() ?? null));

  // Close the gap first, so the kick is thrown from inside strike range rather
  // than from across the mat where it would whiff.
  for (let i = 0; i < 24; i += 1) {
    pts.clear();
    pts.set(1, { x: L.x, y: L.y });
    await send('touchStart');
    pts.set(1, { x: L.x + 58, y: L.y });
    await send('touchMove');
    await page.waitForTimeout(170);
    await send('touchEnd');
    await page.waitForTimeout(140);
    const s = await state();
    const pos = s?.positions ?? [];
    const ax = typeof pos[0] === 'object' ? pos[0].x : pos[0];
    const bx = typeof pos[1] === 'object' ? pos[1].x : pos[1];
    if (typeof ax === 'number' && typeof bx === 'number' && Math.abs(ax - bx) < 1.5) break;
  }

  // Now throw, and shoot on the frame the move is actually active.
  pts.clear();
  pts.set(1, { x: L.x, y: L.y });
  await send('touchStart');
  pts.set(2, { x: R.x, y: R.y });
  await send('touchStart');
  // technique UP is `front_kick`. The stick directions are not named after the
  // moves: forward is a lunge punch, down a foot sweep, back a reverse punch.
  pts.set(2, { x: R.x, y: R.y - 58 });
  await send('touchMove');
  await send('touchEnd');
  pts.clear();

  // `p1Phase` and `p1Move` are the flat debug surface; a kick is an active
  // phase on a move whose id names a kick. Anything else and this would
  // screenshot a recovery frame and call it a kick, which is the mistake the
  // `03-phone-strike` frame has been making since round 1.
  let caught = false;
  for (let i = 0; i < 24; i += 1) {
    const s = await state();
    const isKick = String(s?.p1Move ?? '').includes('kick');
    if (s?.p1Phase === 'active' && isKick) {
      await page.screenshot({ path: `${OUT}/18-phone-kick.png` });
      caught = true;
      break;
    }
    if (String(s?.p1Move ?? '').includes('kick') && s?.p1Phase === 'startup') {
      await page.screenshot({ path: `${OUT}/18-phone-kick.png` });
      caught = true;
      break;
    }
    await page.waitForTimeout(20);
  }
  if (!caught) console.warn('18-phone-kick: no active kick observed, frame not written');
});

/* ---------- Round 73: a half point, on the board, in the review set ---------- */

/* This is the frame the loop spent thirty-one rounds trying to see.
 *
 * A half point is only awarded when the defender is NOT winding up —
 * `match.ts` promotes the call to a full point when `defender.phase ===
 * 'startup'`, which is what every earlier probe did by accident, thirty lunges
 * in a row, and why two rounds of "there is no half point" measurements came
 * back clean. The stance stick is held NEUTRAL here for exactly that reason.
 *
 * Five models reported this notation as ambiguous, cramped, or reading as
 * `21/2`. It is none of those, and this frame is what settles it for a reviewer
 * rather than leaving them to infer it from the source. */
await capture('19-phone-half-point', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  const anchor = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const L = await anchor('#zone-left');
  const R = await anchor('#zone-right');
  const cdp = await page.context().newCDPSession(page);
  const pts = new Map();
  const send = (type) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...pts].map(([id, q]) => ({ x: Math.round(q.x), y: Math.round(q.y), id })),
    });
  // Watched from inside the page, on every frame, because the state this needs
  // to catch is shorter than one round trip to the driver.
  await page.evaluate(() => {
    globalThis.__half = false;
    const watch = () => {
      if (document.querySelector('.points .score-frac')) globalThis.__half = true;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });

  for (let i = 0; i < 34; i += 1) {
    if (await page.evaluate(() => globalThis.__half === true)) {
      await page.screenshot({ path: `${OUT}/19-phone-half-point.png` });
      return;
    }
    if (await page.locator('.result-score').isVisible().catch(() => false)) break;
    pts.clear();
    pts.set(1, { x: L.x, y: L.y });
    await send('touchStart');            // stance neutral: no step, so no counter
    pts.set(2, { x: R.x, y: R.y });
    await send('touchStart');
    pts.set(2, { x: R.x + 58, y: R.y }); // forward = lunge_punch = a half
    await send('touchMove');
    await page.waitForTimeout(240);
    pts.clear();
    await send('touchEnd');
    await page.waitForTimeout(180);
  }
  console.warn('19-phone-half-point: no half landed, frame not written');
});

/* ---------- Round 75: the call. Nothing in the set had ever shown one. ---------- */

/* Four models have reported on the IPPON / WAZA-ARI announcement — that it
 * covers the fighters, that it is illegible, that it collides with the strike.
 * The set had no frame of a *call*. It had a strike (round 69), a scored result
 * (round 68) and a half point (round 73), but the moment a referee awards
 * something — the announcement, the caller's name, the move that earned it, and
 * the new score, all at once — had never been photographed.
 *
 * Captured on the simulation phase rather than a timer, because `referee` is the
 * phase the call lives in and it is short. */
await capture('20-phone-call', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);
  const anchor = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const L = await anchor('#zone-left');
  const R = await anchor('#zone-right');
  const cdp = await page.context().newCDPSession(page);
  const pts = new Map();
  const send = (type) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...pts].map(([id, q]) => ({ x: Math.round(q.x), y: Math.round(q.y), id })),
    });

  for (let i = 0; i < 40; i += 1) {
    if (await page.evaluate(() => globalThis.__smkk?.state?.().phase === 'referee')) {
      await page.screenshot({ path: `${OUT}/20-phone-call.png` });
      return;
    }
    pts.clear();
    pts.set(1, { x: L.x, y: L.y });
    await send('touchStart');            // stance neutral, so a half stays a half
    pts.set(2, { x: R.x, y: R.y });
    await send('touchStart');
    pts.set(2, { x: R.x + 58, y: R.y });
    await send('touchMove');
    await page.waitForTimeout(230);
    pts.clear();
    await send('touchEnd');
    await page.waitForTimeout(150);
  }
  console.warn('20-phone-call: no call observed, frame not written');
});

/* ---------- Round 88: a kick into open space ---------- */

/* Six reviews in six rounds have reported the front kick as amputated,
 * truncated, or pointing the wrong way, and the loop has refused all six — each
 * time correctly. The frame is the reason: a kick that LANDS puts the foot on the
 * defender's body, under an impact effect, with both fighters overlapping. So
 * the thing the reviewer is asked to judge (which way does the foot point, is the
 * leg whole) is the thing the capture deliberately obscures.
 *
 * This one is thrown into air with the opponent out of reach: the whole kick,
 * end to end, against the mat. It is the frame that settles the family. */
await capture('21-phone-kick-open', phone, async (page) => {
  // `spacing` sets the start separation in dojo mode. Stepping the stance stick
  // right does NOT open the gap — the camera re-frames to hold both fighters,
  // so they stay in contact range and the foot still lands on the opponent,
  // which is the whole thing this frame exists to avoid.
  await page.goto(`${BASE}/?mode=dojo&spacing=5.6`, { waitUntil: 'networkidle' });
  await waitFight(page);
  const anchor = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const L = await anchor('#zone-left');
  const R = await anchor('#zone-right');
  const cdp = await page.context().newCDPSession(page);
  const pts = new Map();
  const send = (type) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...pts].map(([id, q]) => ({ x: Math.round(q.x), y: Math.round(q.y), id })),
    });
  await page.waitForTimeout(400);

  // Kick, and shoot on the frame the move is actually active.
  pts.clear();
  pts.set(1, { x: L.x, y: L.y });
  await send('touchStart');
  pts.set(2, { x: R.x, y: R.y });
  await send('touchStart');
  pts.set(2, { x: R.x, y: R.y - 58 });  // up = front_kick
  await send('touchMove');
  await send('touchEnd');
  pts.clear();

  let caught = false;
  for (let i = 0; i < 24; i += 1) {
    const s = await page.evaluate(() => globalThis.__smkk?.state?.() ?? null);
    if (s?.p1Phase === 'active' && String(s?.p1Move ?? '').includes('kick')) {
      await page.screenshot({ path: `${OUT}/21-phone-kick-open.png` });
      caught = true;
      break;
    }
    await page.waitForTimeout(20);
  }
  if (!caught) console.warn('21-phone-kick-open: no active kick observed, frame not written');
});

/* ---------- r164: the PAUSED overlay (PRD FR-018) ---------- */

/* The overlay r163 shipped has never been in a review set.
 *
 * This is round 158's lesson landing again, verbatim and one release later. r158
 * found that fixing the onboarding did not mean anyone had looked at it: the
 * review set is this loop's instrument, and it had been pointed at the coach for
 * twenty rounds while describing a plate it could not see. r163 made the PAUSED
 * state reachable — losing focus mid-bout raises a full-viewport scrim and only
 * the player dismisses it — and a state that becomes reachable is not a state
 * that has been reviewed.
 *
 * So for one release the loop reviewed a game with a feature it never once
 * photographed. `#pause` is `hidden` in every other frame in this set, so all
 * twenty-one previous frames and this one are the same game to a reviewer.
 *
 * The frame is taken mid-bout on the phone viewport, because that is the state
 * that triggers it: `pause()` returns early unless a bout is live, so a capture
 * posed on a menu would show no overlay and be indistinguishable from a
 * regression. Hence the assertion below rather than a bare screenshot — a frame
 * that cannot fail on the defect is not a frame of this feature. */
await capture('22-phone-paused', phone, async (page) => {
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await waitFight(page);

  // A real focus loss, not a class toggle. `pause()` is a `window` blur handler
  // and `pauseEl.hidden` is what it sets, so un-hiding the element by hand would
  // photograph a state the game never reaches.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.locator('#pause').waitFor({ state: 'visible', timeout: 3000 });
  await page.waitForTimeout(250);

  // Confirm the thing the frame exists to show is actually in the frame. Without
  // this the shot is written unconditionally and a silently-broken overlay still
  // produces a picture a reviewer reads as "all clear" — which is precisely how
  // r53 turned fifteen stale frames into fifteen accurate-looking findings.
  const state = await page.evaluate(() => {
    const el = document.querySelector('#pause');
    const r = el?.getBoundingClientRect();
    return {
      hidden: el?.hasAttribute('hidden') ?? true,
      covers: r ? r.width >= innerWidth && r.height >= innerHeight : false,
    };
  });
  if (state.hidden || !state.covers) {
    console.warn(`22-phone-paused: overlay not raised (hidden=${state.hidden} covers=${state.covers}), frame not written`);
    return;
  }
  await page.screenshot({ path: `${OUT}/22-phone-paused.png` });
});

/* The fighter pick, AFTER the press — the state r166 created and nobody looked at.
 *
 * r158's sentence has now landed three times: a state that becomes reachable is
 * not a state that has been reviewed. r164 found the PAUSED overlay, r167 found
 * the championship card, and here it is again. The ⇄ button *was* in the set —
 * shot 01 frames the opening card — but only ever as scenery in a review of
 * something else, and no reviewer has written the words "Play as" once in 11,400
 * lines of the loop log.
 *
 * What has never been photographed is the effect: the fighters trading places
 * behind the card, and the button's own label flipping to the other fighter. That
 * is the feature. This frame is it.
 *
 * `seats()` reports the sim order and the drawn order separately (r166 built it
 * for exactly this: "a swap that moved one and not the other is a player steering
 * the wrong body"), so the capture can assert the trade happened rather than
 * photograph a card that looks right while the seats are wrong. */
await capture('23-phone-picked', phone, async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const swap = page.locator('.result-swap');
  await swap.waitFor({ state: 'visible', timeout: 30_000 });
  // `__smkk` is published at `ready`, which is LATER than the card being up —
  // the card is markup the boot screen hands over before boot finishes. The
  // first version of this capture read `seats()` as soon as the button appeared
  // and died with `Cannot read properties of undefined`, taking the whole run's
  // remaining frames with it. Order matters: button, then handle.
  await page.waitForFunction(() => typeof globalThis.__smkk?.seats === 'function', null, { timeout: 60_000 });

  const read = () =>
    page.evaluate(() => ({
      sim: globalThis.__smkk.seats().sim,
      views: globalThis.__smkk.seats().views,
      label: document.querySelector('.result-swap')?.textContent.trim() ?? null,
    }));

  const before = await read();
  await swap.click();
  await page.waitForTimeout(1200);
  const after = await read();

  // Two assertions, and the second is the one r166 exists for. Measured off the
  // shipped build: shiro/aka -> aka/shiro in BOTH lists.
  //
  // 1. The seats actually traded, and the label now offers the other fighter.
  // 2. `views` still equals `sim`. r166's own words: "a swap that moved one and
  //    not the other is a player steering the wrong body" — the sprite in seat
  //    one is not the fighter the sim thinks is in seat one. That is invisible
  //    in a screenshot and fatal in play, so a capture that only checked the
  //    label would photograph a working button over a broken game.
  const traded = before.views.join('>') !== after.views.join('>');
  const aligned = after.views.join('>') === after.sim.join('>');
  const labelFlipped = after.label !== before.label && after.label !== null;
  if (!traded || !aligned || !labelFlipped) {
    console.warn(
      `23-phone-picked: not the state this frame reviews (traded=${traded} aligned=${aligned} label=${labelFlipped}; sim ${after.sim.join('>')} views ${after.views.join('>')} "${before.label}" -> "${after.label}"), frame not written`,
    );
    return;
  }
  console.log(
    `  23 pick: "${before.label}" -> "${after.label}" | sim ${before.sim.join('>')} -> ${after.sim.join('>')} | views ${before.views.join('>')} -> ${after.views.join('>')}`,
  );
  await page.screenshot({ path: `${OUT}/23-phone-picked.png` });
});

/* ── The motion burst ───────────────────────────────────────────────────────
 * Every shot above is a cold page load in its own browser context. No two
 * frames in this set share a page, so sorting them by filename compares
 * unrelated screens: `verify_shots.py`'s mean-luma "motion" over that order
 * reads 12.08 on eight static menus containing no gameplay at all, and its
 * largest contributors are a settings menu and a bracket — while the real
 * gameplay pair, fight -> strike, scores 0.67. Adjacency in this set is not
 * time, so no statistic over it can measure motion.
 *
 * The only frames where adjacency means time are frames taken back to back
 * from ONE running bout. That is what the gate is given: a burst, plus the
 * simulation tick and fighter positions at each frame, so it can ask whether
 * the game was actually advancing instead of inferring it from pictures.
 */
const BURST = 8;
rmSync(`${OUT}/burst`, { recursive: true, force: true });
mkdirSync(`${OUT}/burst`, { recursive: true });

const burstCtx = await browser.newContext({
  viewport: phone,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const burstPage = await burstCtx.newPage();
await burstPage.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
await waitFight(burstPage);

const burst = [];
const tap = async (key, hold = 40) => {
  await burstPage.keyboard.down(key);
  await burstPage.waitForTimeout(hold);
  await burstPage.keyboard.up(key);
};

// The burst has to be PLAYED. Captured idle, the simulation clock still runs
// (measured: ticks 72..240) while the fighters stand at one position pair and
// the last three frames come back 0.00% different — an unplayed bout that is
// rich in colour, distinct frame to frame, and completely motionless. That is
// the failure this burst exists to catch, so it has to be played to give the
// gate a passing arm, and the mutation harness supplies the unplayed one.
const script = [
  async () => {},
  async () => tap('ArrowRight', 220),
  async () => {},
  async () => tap('ArrowLeft', 260),
  async () => { await burstPage.keyboard.down('ArrowUp'); await burstPage.waitForTimeout(230); await burstPage.keyboard.up('ArrowUp'); },
  async () => tap('ArrowRight', 240),
  async () => tap('ArrowLeft', 200),
  async () => { await burstPage.keyboard.down('ArrowUp'); await burstPage.waitForTimeout(210); await burstPage.keyboard.up('ArrowUp'); },
];

for (let i = 0; i < BURST; i += 1) {
  const s = await burstPage.evaluate(() => globalThis.__smkk?.state?.() ?? null);
  await burstPage.screenshot({ path: `${OUT}/burst/${String(i).padStart(2, '0')}.png` });
  burst.push({
    file: `${String(i).padStart(2, '0')}.png`,
    tick: s?.tick ?? null,
    phase: s?.phase ?? null,
    positions: s?.positions ?? null,
  });
  await script[i]();
  await burstPage.waitForTimeout(90);
}
writeFileSync(`${OUT}/burst/frames.json`, `${JSON.stringify(burst, null, 2)}\n`);
await burstCtx.close();
console.log(`burst: ${BURST} frames, ticks ${burst[0]?.tick}..${burst.at(-1)?.tick}`);

await browser.close();

// The load belongs next to the frame count, for r151's reason: this machine does
// not idle, and a review set is only as good as the machine it was taken on. The
// gate that consumes these frames cannot see it from inside the PNG.
//
// Read via the repo's own reader rather than a second `sysctl` parse here, so
// there is one place that knows how a load is read and what an unreadable one
// looks like. An unreadable load prints as whatever that reader prints — never 0.
const load = execFileSync(process.execPath, [new URL('./host-load.mjs', import.meta.url).pathname], {
  encoding: 'utf8',
}).trim();
console.log(`shots in ${OUT}`);
console.log(`host load at capture: ${load}`);
if (errors.length) console.log('console errors:\n' + [...new Set(errors)].join('\n'));
