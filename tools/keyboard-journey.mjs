#!/usr/bin/env node
/**
 * Does a desktop player who reads the key hints actually control the fighter?
 *
 * Why this probe exists
 * ---------------------
 * Plan item 1.1 is a CLOSED box. It shipped at r135 and its `Accept:` line reads
 * "the keys appear on desktop and are absent on a 390px phone" — which was
 * proven by reading `display:block` and `display:none` off two viewports. That
 * is a stylesheet fact, not a behaviour fact.
 *
 * This is r152's lesson applied to a closed box. Item 1.2's `Accept:` line said
 * "returns to the card" and the card did not return, and the reason it could
 * not be seen is that the button worked perfectly — the defect was entirely in
 * what happened next. "The glyphs render" is the button working perfectly.
 * Whether WASD walks, whether the arrows throw, and whether IJKL — which the
 * stylesheet comment advertises and the hint does not print — reaches the
 * simulation has never been walked by anything in this repo.
 *
 * It has never been walked because there is no reason to suspect it is broken.
 * `keyboard.ts` binds all eight keys and `grammar.ts` maps a bare left stick to
 * jump/crouch/walk. Reading that, the box is closed. Reading a screenshot of a
 * bout on a desktop viewport, the box is closed. Only pressing the keys
 * distinguishes "bound in source" from "wired to the game".
 *
 * ON THE INSTRUMENT. Everything here reads `__smkk.state()`, never
 * `__smkk.sticks()`. That is not a style choice: `sticks()` is documented on a
 * surface whose header says "Read-only: nothing here can score a point or move
 * a fighter", and it is implemented as `input.read()` — which advances the
 * keyboard adapter's `previousRight` and consumes a queued press. Polling it
 * would eat the very transitions these measurements are about.
 *
 * Arms
 * ----
 *   hint-1280 / hint-390   the closed box's Accept line, walked rather than read
 *   walk-forward / back    D and A move the fighter (state.positions)
 *   jump / crouch          W and S produce their posture
 *   arrows x4              each technique family comes out (state.p1Move)
 *   ijk-l x4               the same four move ids as the arrows
 *   unbound                KeyZ and KeyX produce NOTHING — the negative control
 *
 * The unbound arm is the one that makes the rest mean anything. Without it, a
 * probe that watches a fighter move during a bout can be satisfied by the
 * opponent's CPU, the hit-stop juice, or a bout that simply ended. r155 fed
 * eight real frames to a gate and it returned "motion 12.08" on a set where
 * the game never ran.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5173';
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
/** How long a key is held while the simulation is sampled. */
const HOLD_MS = 500;
/** Sample period. The sim runs at 60Hz; this is comfortably under a tick. */
const SAMPLE_MS = 16;
/** A fighter must move this many world units for "it walked" to be a claim. */
const WALK_EPSILON = 0.5;

const browser = await chromium.launch();

const failures = [];
const note = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(26)} ${detail}`);
  if (!ok) failures.push(label);
};

/**
 * One key press, sampled off `__smkk.state()` for as long as it is held.
 *
 * Returns everything the press could possibly show, so the caller decides what
 * counts. Nothing here infers a hit from a phase name.
 */
/**
 * Waits until fighter 1 is back in `neutral` with no move in flight.
 *
 * The fixed 250ms the first version used was shorter than a move's recovery,
 * so the next arm's keypress was swallowed mid-move and reported the PREVIOUS
 * technique instead of its own: KeyJ read `active/foot_sweep`, KeyK's missing
 * `recovery` frame, KeyL a stale sweep followed by its own punch. Three arms
 * were reporting each other's moves, which is the r155 failure mode — an
 * instrument agreeing with whatever happened to be on screen.
 *
 * Poll on the state, not on the clock. A timeout here is a real finding, so it
 * is reported rather than papered over with a longer sleep.
 */
async function settle(page, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => globalThis.__smkk.state());
    if (s.p1Phase === 'neutral' && s.p1Move === null) return true;
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
  }
  return false;
}

async function press(page, code) {
  await settle(page);
  const before = await page.evaluate(() => globalThis.__smkk.state());
  await page.keyboard.down(code);
  const moves = new Set();
  const postures = new Set();
  let minX = before.positions[0];
  let maxX = before.positions[0];
  const deadline = Date.now() + HOLD_MS;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => globalThis.__smkk.state());
    // `p1Move` is null in neutral, so a real technique is any non-null id.
    if (s.p1Move !== null) moves.add(s.p1Move);
    postures.add(s.postures[0]);
    minX = Math.min(minX, s.positions[0]);
    maxX = Math.max(maxX, s.positions[0]);
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
  }
  await page.keyboard.up(code);
  const after = await page.evaluate(() => globalThis.__smkk.state());
  await page.waitForTimeout(150);
  return {
    moves: [...moves],
    postures: [...postures],
    travelled: Math.max(Math.abs(maxX - before.positions[0]), Math.abs(minX - before.positions[0])),
    net: after.positions[0] - before.positions[0],
  };
}

async function newPage(viewport, url) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__smkk?.ready === true, null, { timeout: 60_000 });
  return { context, page };
}

try {
  // ---------------------------------------------------------------- hints
  console.log('closed box 1.1, its Accept line walked rather than read');
  {
    const { context, page } = await newPage(DESKTOP, `${BASE}/?mode=dojo`);
    const desktop = await page.evaluate(() => {
      const hints = Array.from(document.querySelectorAll('.key-hint'));
      return hints.map((h) => ({
        text: h.textContent.trim(),
        display: getComputedStyle(h).display,
        box: h.getBoundingClientRect().width,
      }));
    });
    note(
      desktop.length === 2 && desktop.every((h) => h.display !== 'none' && h.box > 0),
      'hints visible at 1280',
      desktop.map((h) => `${JSON.stringify(h.text)} ${h.display} ${h.box.toFixed(0)}px`).join(' · '),
    );
    await context.close();
  }
  {
    const { context, page } = await newPage(PHONE, `${BASE}/?mode=dojo`);
    const phone = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.key-hint')).map((h) => ({
        display: getComputedStyle(h).display,
        box: h.getBoundingClientRect().width,
      })),
    );
    note(
      phone.length === 2 && phone.every((h) => h.display === 'none' || h.box === 0),
      'hints absent at 390',
      phone.map((h) => `${h.display} ${h.box.toFixed(0)}px`).join(' · '),
    );
    await context.close();
  }

  // -------------------------------------------------------------- the keys
  const { context, page } = await newPage(DESKTOP, `${BASE}/?mode=dojo`);
  // Dojo: the partner never attacks, so no bout ends mid-measurement.
  await page.waitForFunction(() => globalThis.__smkk?.state?.().phase === 'fight', null, {
    timeout: 45_000,
  });

  console.log('\nnegative control first, so the arms below cannot be the CPU');
  for (const unbound of ['KeyZ', 'KeyX']) {
    const r = await press(page, unbound);
    // Both halves matter: a technique, OR a posture change. S crouches without
    // ever entering a move phase, so checking only `moves` would let S look
    // inert here and active three arms later.
    note(
      r.moves.length === 0 && r.postures.length === 1 && r.postures[0] === 'stand',
      `${unbound} unbound`,
      `moves=[${r.moves.join(',')}] postures=[${r.postures.join(',')}]`,
    );
  }

  console.log('\nleft stick — WASD, bound to the grammar\'s bare-left cases');
  const forward = await press(page, 'KeyD');
  note(forward.travelled > WALK_EPSILON && forward.net > 0, 'D walks forward', `travelled ${forward.travelled.toFixed(2)} net ${forward.net.toFixed(2)}`);
  const back = await press(page, 'KeyA');
  note(back.travelled > WALK_EPSILON && back.net < 0, 'A walks back', `travelled ${back.travelled.toFixed(2)} net ${back.net.toFixed(2)}`);
  // W and S set `airborne` / `crouching`, which are NOT phases — the first
  // version of this probe asserted on `p1Phase`, where they cannot appear, and
  // fell through to a condition that was true of `neutral`. Posture is read
  // off `state().postures`, which exists for exactly this reason.
  const jump = await press(page, 'KeyW');
  note(jump.postures.includes('air') && !jump.postures.includes('crouch'), 'W leaves the ground', `postures=[${jump.postures.join(',')}] moves=[${jump.moves.join(',')}]`);
  const crouch = await press(page, 'KeyS');
  note(crouch.postures.includes('crouch'), 'S crouches', `postures=[${crouch.postures.join(',')}] moves=[${crouch.moves.join(',')}]`);
  // The control for the two arms above: releasing S must stand back up, or
  // `crouching` is a latch nobody clears and "S crouches" would be trivially
  // true because the fighter is permanently crouched.
  const stand = await press(page, 'KeyZ');
  note(stand.postures.every((p) => p === 'stand'), 'releases to stand', `postures=[${stand.postures.join(',')}]`);

  console.log('\nright stick — arrows, the four technique families');
  const arrowIds = {};
  for (const [code, dir] of [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right']]) {
    const r = await press(page, code);
    arrowIds[dir] = r.moves;
    note(r.moves.length > 0, `${code} (${dir})`, `moves=[${r.moves.join(',')}]`);
  }

  console.log('\nIJKL — bound in source, advertised in a comment, printed nowhere');
  for (const [code, dir] of [['KeyI', 'up'], ['KeyK', 'down'], ['KeyJ', 'left'], ['KeyL', 'right']]) {
    const r = await press(page, code);
    // Compare the SET of move ids, not the phase strings. The arrows and the
    // letters resolve to the same techniques, and the first version compared
    // phase/id pairs, which differ by how many recovery frames a 500ms window
    // happened to catch — which is not a difference in the game at all.
    const same = JSON.stringify([...r.moves].sort()) === JSON.stringify([...arrowIds[dir]].sort());
    note(r.moves.length > 0 && same, `${code} = ${dir}`, `moves=[${r.moves.join(',')}] arrows=[${arrowIds[dir].join(',')}]`);
  }

  // ------------------------------------------------------- the whole journey
  //
  // Everything above says the keys reach the simulation. What the glyphs
  // actually promise a desktop player is that they can PLAY — reach a decision,
  // land it, and see a point on the board. That is a longer walk than any arm
  // above, and it is the one a player takes.
  //
  // Dojo, so the partner never attacks and the bout cannot end underneath the
  // measurement: walk in on D, then throw ArrowUp and let it repeat. The bout
  // is won by SCORE, not by clock, so a keyboard player who cannot land is a
  // keyboard player who loses and does not know why.
  console.log('\nthe journey the glyphs promise: walk in, land it, see a point');
  const scoreBefore = await page.evaluate(() => globalThis.__smkk.state().scores[0]);
  let sawContact = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => globalThis.__smkk.state());
    if (s.scores[0] > scoreBefore) {
      sawContact = true;
      break;
    }
    if (s.phase !== 'fight') break;
    // Close the distance, then throw. Held keys, released between throws,
    // because the grammar only fires a technique on the edge out of neutral.
    const gap = s.positions[1] - s.positions[0];
    const want = gap > 2.2;
    if (want) await page.keyboard.down('KeyD');
    else {
      await page.keyboard.up('KeyD');
      await settle(page);
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(120);
      await page.keyboard.up('ArrowUp');
      await page.waitForTimeout(180);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  await page.keyboard.up('KeyD').catch(() => {});
  const scoreAfter = await page.evaluate(() => globalThis.__smkk.state());
  note(
    sawContact && scoreAfter.scores[0] > scoreBefore,
    'keyboard-only scores',
    `${scoreBefore} -> ${scoreAfter.scores[0]} at tick ${scoreAfter.tick} (lastCall ${JSON.stringify(scoreAfter.lastCall)})`,
  );

  await context.close();
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\nFAIL — ${failures.length}: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — the key hints describe a keyboard that drives the game');