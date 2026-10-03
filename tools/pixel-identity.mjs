#!/usr/bin/env node
/**
 * Did a stylesheet change change the picture — and ONLY where it said it would?
 *
 * `tools/contrast-reach.py` proves statically that nine colour literals became
 * tokens `body.high-contrast` can re-point. That is a fact about the FILE. The
 * claim attached to it is about the FRAME: "each token sits on :root at the
 * value it already had, so default mode is unchanged pixel for pixel".
 *
 * Two claims, two instruments, and neither can do the other's job:
 *
 *   ARM A — computed style, exhaustive. The used value of each site, in default
 *   and in high contrast, from BOTH builds. Deterministic: no wall clock, no
 *   animation, no GPU. Reaches the sites a screenshot cannot frame.
 *
 *   ARM B — pixels, sampled, WITH A NOISE FLOOR. The arena behind an overlay is
 *   driven by a frame counter, so two loads of the SAME build do not produce
 *   identical pixels. A delta between two builds is therefore meaningless until
 *   you know what the same-build delta looks like. So every crop is taken
 *   TWICE per build: `self` is build-vs-itself across two loads, `cross` is
 *   build-vs-build. Only `cross` meaningfully above `self` is a change, and a
 *   row where they are close prints INCONCLUSIVE rather than a number that
 *   looks like evidence.
 *
 *   THE CONTROLS ARE THE POINT. `--fade-void` is `rgb(16 11 8 / 0)` before and
 *   `rgb(0 0 0 / 0)` after — alpha zero in both, invisible in both — and MUST
 *   not move. `--switch-track-off` was already `#3a2d22` in high contrast
 *   before the change and MUST not move there either. A probe that reports
 *   motion for a colour no eye can see is measuring its own noise, and every
 *   other row in the table then becomes unreadable.
 *
 * Usage:  node tools/pixel-identity.mjs <oldDist> <newDist>
 * Exit:   0 default mode unchanged · 1 default mode moved · 2 harness failure
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

const server = async (dir, port) => {
  const s = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      // Resolve the file BEFORE the mime type: `extname('/')` is '', so typing
      // the request path serves index.html as application/octet-stream and
      // Chromium offers it as a download instead of rendering it.
      const file = path === '/' ? '/index.html' : path;
      const body = await readFile(join(dir, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('nope');
    }
  });
  await new Promise((r) => s.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}/`, stop: () => new Promise((r) => s.close(r)) };
};

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false };

/**
 * A SCENE is one page load. Sites that share a scene share a context, because a
 * context load costs seconds and the 3D arena is not re-seeded between them.
 *
 * `reach` drives the page to the state where the elements exist. The
 * `.coach-strip` site is the reason scenes exist at all: it is built only under
 * `(hover: none) and (pointer: coarse)` (coach.ts:97) AND only once the bout is
 * live, so a desktop context can never see it — which is exactly the mutual
 * exclusivity r153 recorded for `.key-hint`.
 */
const SCENES = [
  {
    id: 'phone-fight',
    ctx: PHONE,
    reach: async (page, url) => {
      // DOJO, deliberately. This probe compares a stylesheet change between two
      // builds, and the coach strip is one of the things being photographed —
      // but on the tournament routes the OLD build cannot render the strip at
      // all (that is `tools/coach-probe.mjs`'s finding: boot marked the coach
      // seen before it ever appeared). Reaching the strip there would time out
      // on one side of the comparison and measure nothing. Dojo is the one route
      // where both builds teach.
      await page.goto(`${url}?mode=dojo`, { waitUntil: 'domcontentloaded' });
      await ready(page);
      // No click: dojo's pre-bout card auto-starts inside a couple of seconds,
      // so by the time a click is issued the button is gone. The card IS
      // `.result-rematch` (hud.ts:311) on both the pre-bout and result cards.
      // A fresh context has an empty localStorage, which is the state the strip
      // is built for.
      await page.waitForFunction(() => globalThis.__smkk?.state?.().phase === 'fight', null, { timeout: 45_000 });
      await page.waitForFunction(() => globalThis.__smkk?.state?.().phase === 'fight', null, { timeout: 30_000 });
      await page.locator('.coach-strip').waitFor({ state: 'visible', timeout: 10_000 });
      await page.waitForTimeout(300);
    },
    sites: [
      // `defaultMoves` is the ONLY site permitted to change in default mode, and
      // it changes on purpose: the strip's plate token was UNDEFINED, so the
      // lesson had no background at all and its text sat on the tatami. Every
      // other row is a transcription — a literal replaced by a token at the same
      // value — and must not move. A tool that exits non-zero on the intended
      // change is a tool that gets deleted, so the expectation is declared
      // rather than assumed.
      {
        label: 'coach strip plate',
        sel: '.coach-strip',
        prop: 'backgroundColor',
        box: '.coach-strip',
        defaultMoves: true,
      },
    ],
  },
  {
    id: 'phone-card',
    ctx: PHONE,
    reach: async (page, url) => {
      await page.goto(`${url}?mode=tournament`, { waitUntil: 'domcontentloaded' });
      await ready(page);
      await page.waitForTimeout(300);
    },
    sites: [
      { label: 'hud icon button', sel: '.hud-actions .icon-btn', prop: 'backgroundColor', box: '.hud-actions .icon-btn', prep: null },
      {
        label: 'hud icon btn fallback',
        sel: '.hud-actions .icon-btn',
        prop: 'backgroundColor',
        box: '.hud-actions .icon-btn',
        prep: 'no-backdrop-filter',
      },
    ],
  },
  {
    id: 'desk-sheet',
    ctx: DESK,
    reach: async (page, url) => {
      await page.goto(`${url}?mode=tournament`, { waitUntil: 'domcontentloaded' });
      await ready(page);
      await page.locator('#btn-settings').click();
      await page.locator('#settings-sheet').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(400);
    },
    sites: [
      { label: 'tech-ref list fade', sel: '#tech-ref', prop: '--fade-void', box: null, unpaintable: true },
      { label: 'settings sheet scrim', sel: '#settings-sheet', prop: 'boxShadow', box: null },
      {
        label: 'switch OFF track',
        sel: '.setting-row input[type="checkbox"]',
        prop: 'backgroundColor',
        box: '.setting-row input[type="checkbox"]',
        // OFF, explicitly. `reducedMotion` defaults to `prefersReducedMotion()`,
        // and a probe context sets `reducedMotion: 'reduce'` — so the FIRST
        // checkbox in the sheet is CHECKED and paints gold. Reading it measured
        // the ON track, the one state this change does not touch, and reported
        // "no movement" for a reason that had nothing to do with the change.
        needUnchecked: true,
      },
      {
        label: 'switch knob shadow',
        sel: '.setting-row input[type="checkbox"]',
        prop: '::before-shadow',
        box: '.setting-row input[type="checkbox"]',
        needUnchecked: true,
      },
    ],
  },
  {
    id: 'desk-card',
    ctx: DESK,
    reach: async (page, url) => {
      await page.goto(`${url}?mode=tournament`, { waitUntil: 'domcontentloaded' });
      await ready(page);
      await page.locator('.result-detail').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(400);
    },
    sites: [
      // NOTE: `switch OFF track` and `switch knob shadow` share ONE crop — the
  // checkbox element — so in high contrast both rows report the knob shadow's
  // change. They are two declarations over one rectangle, and the table would
  // be lying if it implied otherwise.
  { label: 'round card ink', sel: '.result-detail', prop: 'color', box: '.result-detail' },
      { label: 'round score text shadow', sel: '.result-score', prop: 'textShadow', box: '.result-score' },
    ],
  },
];

const ready = (page) => page.waitForFunction(() => globalThis.__smkk?.ready === true, null, { timeout: 60_000 });

const usedValue = (page, site) =>
  page.evaluate(
    ({ sel, prop, needUnchecked }) => {
      // `needUnchecked` picks the first switch that is actually OFF. See the
      // note on the site: the first one is CHECKED in a probe context.
      const el = needUnchecked
        ? [...document.querySelectorAll(sel)].find((n) => !n.checked)
        : document.querySelector(sel);
      if (!el) return { value: '<no element>' };
      if (prop === '::before-shadow') return { value: getComputedStyle(el, '::before').boxShadow };
      if (prop.startsWith('--')) {
        // A custom property feeding a gradient is not a computed value of the
        // element that uses it; read it off the document instead.
        return { value: getComputedStyle(document.documentElement).getPropertyValue(prop).trim() };
      }
      return { value: getComputedStyle(el)[prop] };
    },
    { sel: site.sel, prop: site.prop, needUnchecked: Boolean(site.needUnchecked) },
  );

async function cropOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box || box.width < 1 || box.height < 1) return null;
  const pad = 6;
  return {
    x: Math.max(0, Math.floor(box.x - pad)),
    y: Math.max(0, Math.floor(box.y - pad)),
    width: Math.min(500, Math.ceil(box.width + pad * 2)),
    height: Math.min(500, Math.ceil(box.height + pad * 2)),
  };
}

/** Compare two PNGs of the same clip. Returns {changed, total, max, blank}.
 *
 *  TWO bugs lived here, and both reported "no change" for a change that had
 *  happened. They are worth writing down because the first one's output was
 *  believed for a full round.
 *
 *  1. The canvas was sized from the CSS-pixel clip while the PNGs are 2x device
 *     pixels, so the two were describing different images.
 *  2. Worse, and the reason it was silent: `page.screenshot({clip})` returns an
 *     image ALREADY cropped to that rectangle, so its pixel space starts at
 *     (0,0) — and the diff was drawing it at `-clip.x * DSF`. For any element
 *     that was not at the very top of the page that offset put the whole canvas
 *     window at negative source coordinates, nothing was drawn, both images came
 *     back empty, and the diff reported **zero changed pixels**.
 *
 *  It printed "same" for the coach strip, whose background had just gone from
 *  fully transparent to 0.94 opaque. The two PNGs hashed differently on disk and
 *  the frames, read by eye, were obviously different.
 *
 *  The canvas is therefore sized from the PNG's own `naturalWidth`, which cannot
 *  disagree with what was captured, and both images are drawn at the origin.
 *  `blank` is returned and asserted on: a crop that came back empty is not a crop
 *  that matched, and that assertion is what would have caught this on run one.
 */
async function diff(browser, aBuf, bBuf) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const out = await page.evaluate(
    async ([a, b]) => {
      const load = async (d) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + d;
        await img.decode();
        return img;
      };
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) {
        return { sizeMismatch: true, a: [ia.naturalWidth, ia.naturalHeight], b: [ib.naturalWidth, ib.naturalHeight] };
      }
      const cv = document.createElement('canvas');
      cv.width = ia.naturalWidth;
      cv.height = ia.naturalHeight;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const grab = (img) => {
        g.clearRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, cv.width, cv.height).data;
      };
      const da = grab(ia);
      const db = grab(ib);
      let changed = 0;
      let max = 0;
      let painted = 0;
      for (let i = 0; i < da.length; i += 4) {
        // "Painted" means the crop contains something at all. An off-canvas
        // draw leaves every pixel fully transparent, which is what the offset
        // bug above produced. A legitimately FLAT region — a switch track, which
        // is one solid charcoal — has opaque pixels and no difference, and must
        // not be confused with the failure. The first version keyed `blank` off
        // `max === 0` and flagged a correct flat crop as an instrument fault.
        if (da[i + 3] > 0) painted++;
        const d = Math.max(
          Math.abs(da[i] - db[i]),
          Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2]),
        );
        if (d > 0) changed++;
        if (d > max) max = d;
      }
      return { changed, total: da.length / 4, max, painted, blank: painted === 0 };
    },
    [aBuf.toString('base64'), bBuf.toString('base64')],
  );
  await ctx.close();
  return out;
}

const OLD = resolve(process.argv[2] ?? '/tmp/smkk-dist-old');
const NEW = resolve(process.argv[3] ?? '/tmp/smkk-dist-new');

const oldSrv = await server(OLD, 4191);
const newSrv = await server(NEW, 4192);
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'] });

/** One scene, one mode, one build, one load. Returns value + crop per site. */
async function take(scene, url, mode) {
  const ctx = await browser.newContext({ ...scene.ctx, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await scene.reach(page, url);
  if (mode === 'high-contrast') {
    await page.evaluate(() => document.body.classList.add('high-contrast'));
    await page.waitForTimeout(150);
  }
  const out = {};
  for (const site of scene.sites) {
    if (site.prep) await page.evaluate((c) => document.body.classList.add(c), site.prep);
    out[site.label] = { value: (await usedValue(page, site)).value };
    if (site.box) {
      const clip = await cropOf(page, site.box);
      if (clip) out[site.label].shot = { buf: await page.screenshot({ clip }), clip };
    }
    if (site.prep) await page.evaluate((c) => document.body.classList.remove(c), site.prep);
  }
  await ctx.close();
  return out;
}

let fail = 0;
try {
  for (const mode of ['default', 'high-contrast']) {
    console.log(`\n=== ${mode} mode ===`);
    console.log(`  ${'site'.padEnd(26)} ${'old value'.padEnd(32)} ${'new value'.padEnd(32)} pixels`);

    // Collected here and asserted below, so a control reads the SAME number the
    // table printed. Re-measuring a control is a second chance to disagree with
    // itself, which is the thing this probe exists to rule out.
    const measured = {};

    for (const scene of SCENES) {
      // TWO loads of the OLD build: A1 vs A2 is the noise floor. A1 vs B1 is
      // the change. A delta is only a change once it clears the floor.
      const a1 = await take(scene, oldSrv.url, mode);
      const a2 = await take(scene, oldSrv.url, mode);
      const b1 = await take(scene, newSrv.url, mode);
      measured[scene.id] = { a: a1, b: b1 };

      for (const site of scene.sites) {
        const va = a1[site.label].value;
        const vb = b1[site.label].value;
        const sameValue = va === vb;

        // An `unpaintable` site is one no instrument here can compare. `--fade-void`
        // is `rgb(16 11 8 / 0)` before and `rgb(0 0 0 / 0)` after: both are alpha
        // ZERO, so no computed-value string comparison can call them equal and no
        // screenshot can see either — the RGB components of a fully transparent
        // colour are not rendered. It is listed and excluded rather than asserted
        // on, because a gate that has to be argued about is a gate nobody trusts.
        if (site.unpaintable) {
          console.log(
            `  ${site.label.padEnd(26)} ${String(va || '<no token>').slice(0, 32).padEnd(32)} ${String(vb).slice(0, 32).padEnd(32)} both alpha 0 — not paintable, not asserted`,
          );
          continue;
        }

        let px = 'static only';
        if (a1[site.label].shot && b1[site.label].shot) {
          const self = await diff(browser, a1[site.label].shot.buf, a2[site.label].shot.buf);
          const cross = await diff(browser, a1[site.label].shot.buf, b1[site.label].shot.buf);
          if (cross.sizeMismatch) {
            px = `*** SIZE MISMATCH ${cross.a} vs ${cross.b} ***`;
            fail = 2;
          } else if (cross.blank) {
            // A crop that came back empty is not a crop that matched. This is the
            // assertion that would have caught the CSS-pixel/device-pixel bug on
            // its first run instead of after two screenshots were read by eye.
            px = '*** BLANK CROP — the diff sampled nothing ***';
            fail = 2;
          } else {
            const moved = cross.changed > Math.max(4, self.changed * 2);
            px = moved
              ? `MOVED ${cross.changed}/${cross.total} max ${cross.max} (noise ${self.changed})`
              : `same   (cross ${cross.changed}, noise ${self.changed})`;
            if (mode === 'default' && sameValue && moved) {
              px += '  <-- SAME VALUE, MOVED';
              fail = 1;
            }
          }
        } else if (site.box) {
          px = 'no box';
        }

        let flag = '';
        if (mode === 'default' && !sameValue) {
          if (site.defaultMoves) {
            flag = '  <-- declared default-mode change';
          } else {
            flag = '  <-- DEFAULT MODE MOVED, and nothing declared it';
            fail = 1;
          }
        }
        console.log(
          `  ${site.label.padEnd(26)} ${String(va).slice(0, 32).padEnd(32)} ${String(vb).slice(0, 32).padEnd(32)} ${px}${flag}`,
        );
      }
    }

    const ctrl = (label, expectMove) => {
      const scene = SCENES.find((s) => s.sites.some((x) => x.label === label));
      // An `unpaintable` site is listed, not asserted — asserting on it is the
      // `--fade-void` FAIL this probe printed on its first two runs.
      if (scene.sites.find((x) => x.label === label).unpaintable) {
        console.log(`  CONTROL ${label.padEnd(24)} not assertable (alpha 0 — no instrument here can see it)`);
        return;
      }
      const { a, b } = measured[scene.id];
      const moved = a[label].value !== b[label].value;
      const ok = moved === expectMove;
      if (!ok) fail = 1;
      console.log(
        `  CONTROL ${label.padEnd(24)} ${expectMove ? 'expected to MOVE' : 'expected to HOLD'} — ${ok ? 'as expected' : '*** NOT AS EXPECTED ***'}`,
      );
    };
    console.log('');
    // Two controls that mean something, and neither of them is the alpha-0 one.
    // `settings sheet scrim` is a straight transcription in default mode and one
    // of the four scrims contrast mode is supposed to flatten, so it is the
    // only row with an expectation that DIFFERS between the two passes.
    ctrl('settings sheet scrim', mode === 'high-contrast');
    // `switch OFF track` held in high contrast before the change too — the
    // override already said `#3a2d22` — so it must hold in both passes, and a
    // control that only works in one of them is not a control.
    ctrl('switch OFF track', false);
  }
} finally {
  await browser.close();
  await oldSrv.stop();
  await newSrv.stop();
}

console.log('');
console.log(fail ? '  FAIL — see the flagged rows above' : '  default mode identical in both used value and pixels');
process.exit(fail);
