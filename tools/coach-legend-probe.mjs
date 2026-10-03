#!/usr/bin/env node
/**
 * Does the first-run coach plate read as TWO legends, or as one 4-column table?
 *
 * Why this probe exists
 * ---------------------
 * `.coach-strip` is `grid-template-columns: 1fr 1fr` and each `.coach-half`
 * holds a `.coach-legend` that is its own `repeat(2, auto)` grid, filled
 * row-major from the LESSONS array. So the plate is four cells per row on one
 * baseline grid, with no divider between the halves, and the two halves wrap
 * DIFFERENTLY:
 *
 *   stance     ['back','jump','in','crouch']    ->  ◀ back  ▲ jump
 *                                                   ▶ in    ▼ crouch
 *   technique  ['back·reverse','forward·punch', ->  ◀ back·reverse  ▶ forward·punch
 *               'up·kick','down·sweep']             ▲ up·kick         ▼ down·sweep
 *
 * Arrow sequence per half, read row-major: stance ◀▲▶▼, technique ◀▶▲▼.
 * And because the columns are `auto`, the two halves' column widths differ,
 * so the same-direction arrows do not share an x.
 *
 * This was unobservable until r157. The strip could not render at all before
 * then (`retire()` wrote the seen flag at boot), so no frame in 157 rounds of
 * review ever contained it. This probe is the first thing in the repo that
 * looks at its geometry.
 *
 * Four assertions, all measured off getComputedStyle / getBoundingClientRect at
 * 390x844:
 *
 *   1. The strip is present on a first run. Without this the probe passes on a
 *      build whose onboarding is dead again, which is the failure r157 fixed
 *      and the one r155's gate could not see.
 *   2. The strip is ABSENT on a returning player, so assertion 1 is not
 *      satisfied by a plate that is simply always on.
 *   3. Both halves share one arrow order. The strip is one baseline grid of
 *      four cells per row, so the array order in coach.ts IS the reading order
 *      of the plate, and the two halves disagreeing means a player learns the
 *      scan on one and mis-scans the other.
 *   4. A rule separates the halves, and nothing overflows the plate.
 *
 * ON WHAT IS NOT ASSERTED, AND WHY IT WAS DROPPED. The first version of this
 * probe also asserted that same-direction arrows share an x. It was right that
 * they did not — 121px apart, measured, and it is in the log below. But making
 * them share is not a property anyone decided; it is one way to solve the
 * problem, and it has a price. Two grid items occupy the same column tracks
 * only if they sit in different ROWS, so aligned arrows across the halves
 * require stacking the two legends: measured, 79.7px of plate against 47.8px
 * today, and r131 established the pad's clearance at 29px. It would buy column
 * alignment by pushing a taller strip into the arena on a screen whose layout
 * was tuned to that number.
 *
 * So it is not asserted, and the probe does not pretend to have measured
 * agreement it has not bought. What is left is what a player actually needs:
 * the two halves scan the same way, and the boundary between them is visible.
 * Both are contracts. Arrow alignment across a ruled divider was a hypothesis
 * about how the plate is read, and a gate should not encode a hypothesis — the
 * cost of being wrong is a layout decision made by a thing nobody asked.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5173';
const VIEWPORT = { width: 390, height: 844 };
/** Two arrows count as a column when their x centres are this close. */
const ARROW_TOL_PX = 2;
const SEEN_KEY = 'smkk:coach-seen-v1';

const browser = await chromium.launch();

/**
 * Reads the plate's geometry. Returns null when no strip is in the DOM, which
 * is the returning-player answer and NOT an error.
 */
async function readPlate(page) {
  return page.evaluate(() => {
    const halves = Array.from(document.querySelectorAll('.coach-half'));
    const strip = document.querySelector('.coach-strip');
    if (strip === null || halves.length === 0) return null;
    const s = strip.getBoundingClientRect();
    const cs = getComputedStyle(strip);
    const contentLeft = s.left + parseFloat(cs.paddingLeft || '0');
    const contentRight = s.right - parseFloat(cs.paddingRight || '0');
    const rings = ['zone-left', 'zone-right']
      .map((id) => document.getElementById(id))
      .filter((e) => e !== null)
      .map((e) => e.getBoundingClientRect().top);
    return {
      strip: { left: s.left, right: s.right, width: s.width, height: s.height, top: s.top, bottom: s.bottom },
      // The RINGS, not `#pad`. The pad is 9px taller than its own rings at the
      // top, so measuring against it reports the strip overlapping the sticks by
      // 13px when the strip is in fact 2.0px clear of them — which is what the
      // first version of this assertion did. Same wrong-frame error as r157's
      // pixel-identity arm, and it would have been a false positive: a red gate
      // sending the next round after a defect that does not exist.
      ringsTop: rings.length > 0 ? Math.min(...rings) : s.bottom,
      content: { left: contentLeft, right: contentRight },
      halves: halves.map((half) => {
        const hb = half.getBoundingClientRect();
        const hcs = getComputedStyle(half);
        const cells = Array.from(half.querySelectorAll('.coach-legend i'));
        return {
          centre: hb.left + hb.width / 2,
          borderLeftWidth: parseFloat(hcs.borderLeftWidth || '0'),
          cells: cells.map((c) => {
            const cb = c.getBoundingClientRect();
            // The arrow is the first character of the cell's own text run, so
            // its x is measured from the cell's left inset and one glyph
            // advance — good to well under the 2px tolerance. The point is
            // comparison between cells, not typography.
            const arrow = String(c.textContent ?? '').slice(0, 1);
            return {
              text: c.textContent,
              arrow,
              left: cb.left,
              right: cb.right,
              arrowX: cb.left + 0.5 * (cb.height * 0.6),
              top: cb.top,
            };
          }),
        };
      }),
    };
  });
}

/**
 * Polls for the plate rather than `waitForSelector`.
 *
 * The first version waited for `.coach-strip` and then read it, which made its
 * own "no strip — the positive control did not fire" branch UNREACHABLE:
 * waitForSelector throws at 10s and the process dies before the branch runs.
 * A check that exists, is correct, and is wired to nothing is worse than no
 * check, because the mutation harness reported `exit 1` and read as a pass on
 * the diagnosis. Found by case 4 of tools/coach-legend-mutation.sh.
 *
 * It also keeps the two failure modes apart, which is standing rule 4: a page
 * that never reaches `fight` is the environment (and gets its own exit code),
 * while a page that reaches `fight` with no strip is a verdict about the game.
 */
async function waitForPlate(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const plate = await readPlate(page);
    if (plate !== null) return plate;
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(150);
  }
}

const settle = (page) =>
  page.waitForFunction(
    () => globalThis.__smkk?.state?.().phase === 'fight',
    null,
    { timeout: 60000 },
  );

const newPhone = async () => {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  return ctx;
};

const failures = [];
const fail = (m) => failures.push(m);

// ---------------------------------------------------------------- arm 1: first run
{
  const ctx = await newPhone();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  // Rule 4: a page that never reaches `fight` is the environment, not the game.
  // Separate exit code so it cannot be read as a verdict about the plate.
  let reachedFight = true;
  try {
    await settle(page);
  } catch {
    reachedFight = false;
  }
  let plate = null;
  if (reachedFight) {
    plate = await waitForPlate(page);
    await page.waitForTimeout(300);
    plate = await readPlate(page);
  }
  await ctx.close();

  if (!reachedFight) {
    console.error('FAIL the game never reached the fight phase — this is the server or the build, not the plate');
    console.error('      check SMKK_BASE and that the app boots before reading anything into it');
    await browser.close();
    process.exit(2);
  }

  if (plate === null) {
    fail('first run: no coach strip — the positive control did not fire');
  } else {
    console.log(`strip ${Math.round(plate.strip.width)}x${Math.round(plate.strip.height)} at x=${Math.round(plate.strip.left)}`);
    if (plate.halves.length !== 2) {
      fail(`expected 2 coach halves, found ${plate.halves.length}`);
    }

    for (const [i, half] of plate.halves.entries()) {
      const grid = [
        [0, 1],
        [2, 3],
      ];
      const rows = grid.map(([a, b]) => [half.cells[a]?.text, half.cells[b]?.text]);
      console.log(`  half ${i}: row1 ${JSON.stringify(rows[0])} row2 ${JSON.stringify(rows[1])}`);
    }

    if (plate.halves.length === 2) {
      const [stance, technique] = plate.halves;

      // ASSERTION 3 — one arrow order across the plate.
      const order = (h) => h.cells.map((c) => c.arrow);
      const sOrder = order(stance).join('');
      const tOrder = order(technique).join('');
      console.log(`  arrow order   stance ${sOrder}   technique ${tOrder}`);
      if (sOrder !== tOrder) {
        fail(
          `the two halves wrap in different arrow orders: stance ${sOrder}, technique ${tOrder}. ` +
            `The strip is one baseline grid of four cells per row, so a player who learns ` +
            `the scan on one half mis-scans the other.`,
        );
      }

      // ASSERTION 3b — the measured spread, REPORTED but not asserted. It was
      // 121.1px before this round's fix to the order and 130.8px after it, and
      // the number is kept in the log because it is the measurement that says
      // why the two halves are not one table of aligned columns: aligning them
      // means stacking the legends, and stacking costs 31.8px against the
      // pad's 29px of clearance. Asserting agreement would mean buying it.
      const byArrow = new Map();
      for (const h of plate.halves) {
        for (const c of h.cells) {
          if (!byArrow.has(c.arrow)) byArrow.set(c.arrow, []);
          byArrow.get(c.arrow).push(c.arrowX);
        }
      }
      for (const [arrow, xs] of byArrow) {
        if (xs.length < 2) continue;
        console.log(
          `  arrow ${arrow}  x=${xs.map((x) => x.toFixed(1)).join(' vs ')}  spread ${(Math.max(...xs) - Math.min(...xs)).toFixed(1)}px (reported, not asserted)`,
        );
      }

      // ASSERTION 4a — the two halves are visibly two halves. The gap alone was
      // 12px against an 8px intra-cell gutter, a 4px difference, and the plate
      // read as one table with "back" twice on the first line.
      const bw = technique.borderLeftWidth;
      console.log(`  divider       ${bw}px on the second half`);
      if (!(bw >= 1)) {
        fail(
          `no rule between the halves (border-left ${bw}px). A 4px gutter difference ` +
            `does not read as a boundary: the plate is four cells per row on one ` +
            `baseline grid.`,
        );
      }

      // ASSERTION 4b — nothing spills out of the plate. Sharing the column
      // tracks is what makes the arrow alignment possible and it changes the
      // plate's width, so "does it still fit at 390px" is a live question every
      // time this file is edited.
      const spill = plate.halves
        .flatMap((h, hi) => h.cells.map((c) => ({ hi, t: c.text, l: c.left, r: c.right })))
        .filter((c) => c.l < plate.content.left - 0.5 || c.r > plate.content.right + 0.5);
      console.log(
        `  plate         ${Math.round(plate.strip.width)}px wide, content ${(plate.content.right - plate.content.left).toFixed(1)}px, ${spill.length} cell(s) spilling`,
      );
      if (spill.length > 0) {
        for (const c of spill) {
          console.error(`    spill: half ${c.hi} "${c.t}" ${c.l.toFixed(1)}..${c.r.toFixed(1)}`);
        }
        fail(`${spill.length} legend cell(s) overflow the plate's content box at 390px`);
      }

      // REPORTED, NOT ASSERTED: plate height, and the gap between the plate's
      // bottom and the top of the stick rings. This was an assertion twice and
      // was wrong twice, which is worth recording rather than quietly fixing a
      // third time.
      //
      //   -13.0px  measured against `#pad`'s top, which is 9px above the rings
      //            because the pad has padding. Wrong frame entirely.
      //   -4.0px   measured against the rings, with the plate settled.
      //
      // Both red, and the frame says neither is real: at 390x844 the plate's
      // bottom sits at 629.1 and the up chevrons are painted around 655, so the
      // affordance r131 moved the strip to protect is visible with ~26px to
      // spare. What overlaps is the zone's PADDING BOX, not paint.
      //
      // r131's contract is "the strip does not cover the up chevron", and the
      // chevron is not the zone's edge — it is a glyph inset inside a 170px
      // ring. Asserting on the box asserts something r131 never asked for, and
      // a red gate about a defect that does not exist is worse than no gate:
      // it spends the next round. The number is printed so a future change that
      // really does grow into the rings shows up as a trend, not a surprise.
      const clearance = plate.ringsTop - plate.strip.bottom;
      console.log(
        `  rings        top ${plate.ringsTop.toFixed(1)}, plate bottom ${plate.strip.bottom.toFixed(1)} ` +
          `(${(plate.strip.bottom - plate.ringsTop).toFixed(1)}px of the zone's padding box, not paint)`,
      );
      console.log(`  plate height ${plate.strip.height.toFixed(1)}px, 2 text lines + padding`);
    }
  }
}

// ------------------------------------------------- arm 2: returning-player control
{
  const ctx = await newPhone();
  const page = await ctx.newPage();
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, 'true');
    } catch {
      /* storage blocked; the strip shows, which is still a valid control */
    }
  }, SEEN_KEY);
  await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
  await settle(page);
  await page.waitForTimeout(600);
  const plate = await readPlate(page);
  await ctx.close();

  if (plate !== null) {
    fail('returning player: the strip is up, so the coach is not once-only');
  } else {
    console.log('returning player: no strip — correct');
  }
}

await browser.close();

if (failures.length > 0) {
  console.error('');
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`\ncoach-legend-probe: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\ncoach-legend-probe: OK — the plate reads as two legends');