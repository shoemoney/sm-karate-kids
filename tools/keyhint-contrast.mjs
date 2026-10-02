/**
 * Does the desktop key hint actually take part in high-contrast mode?
 *
 * r152 left one thing on this box unfixed, and said why: `styles.css` line 1147
 * hardcodes `color: #b8a894` where every other label reads a token. That violates
 * the stylesheet's own rule 3, and it pins this one label out of
 * `body.high-contrast`, where `--text-faint` lifts to `#dcdcdc` and every other
 * faint label re-points with it.
 *
 * r152 also said the blocker was measurement: "it needs a pixel measurement of
 * the composited high-contrast backdrop, which is a paint-time value no static
 * read can supply." That is right, and it is worth being precise about *why*:
 *
 *   - `#pad` layers `--pad-lip` and `--pad-wash` over an opaque gradient, so the
 *     backdrop is a composite, not the token.
 *   - the key hint is thin 12px mono with wide tracking, so its ink is mostly
 *     antialiased edge and the *painted* peak is what a player can actually read.
 *   - the pad carries an `opacity` transition, so "the backdrop" is not even one
 *     number over time.
 *
 * So this reads pixels off a rendered frame, in both modes, and never reads a
 * colour out of the stylesheet for the verdict.
 *
 * THE POSITIVE CONTROL IS THE POINT
 * ----------------------------------
 * `.stick-label` sits in the same `.stick-zone` as `.key-hint` — same backdrop,
 * same pad, same frame, same font size — and it reads `--text-muted`, which does
 * re-point in high-contrast. So the control is not a separate run or a separate
 * fixture: it is the neighbour, in the same pixels, measured by the same code.
 *
 * A probe that reports "the ink did not move" for BOTH elements is not a pass and
 * not a fail — it is an instrument that cannot see change, which is rounds 90, 93
 * and 95: a metric agreeing with a no-op. So the control's movement is a
 * precondition for the verdict, and the run exits 2 (inconclusive) rather than
 * reporting green when the control sits still.
 *
 * That also makes the probe falsifiable in both directions: a hard-coded colour
 * cannot move, and a token whose high-contrast value equals its normal value
 * cannot either. Only a colour that genuinely re-points passes, and only if it
 * still clears AA once it has.
 *
 * Run:  node tools/keyhint-contrast.mjs
 * Exit: 0 pass · 1 claim failed · 2 inconclusive / environment
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { startPreview } from './bench-server.mjs';

const GAME_DIR = new URL('../apps/game', import.meta.url).pathname;
const OUT_DIR = '/tmp/smkk-keyhint';

// AA for body text. 12px mono is not "large text" by any WCAG definition, so the
// 3:1 large-text allowance does not apply and 4.5:1 is the bar.
const AA = 4.5;

/** A move in painted luminance this far above local background counts as ink. */
const INK_DELTA = 30;

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-gl=angle'],
});
// A second, content-free page used only as a canvas to decode PNGs. Decoding in
// the page under test would mean measuring the frame I just screenshotted with
// the same renderer that produced it.
const decodePage = await (await browser.newContext()).newPage();

/**
 * sRGB -> WCAG relative luminance, from the 8-bit channel values.
 * The measured value is already in the display's sRGB space, so this is the
 * straight WCAG transform, not a linearise-then-render approximation.
 */
const relLuminance = (r, g, b) => {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const ratio = (l1, l2) => {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Peak ink colour and composited backdrop inside one element's own box.
 *
 * Local background is the modal colour of the darker pixels rather than a fixed
 * near-black: `score-ink.mjs` records what that buys, and the pad gradients here
 * mean a fixed floor would clip the antialiased edge of a 12px glyph and measure
 * the wrong thing.
 */
async function measureInk(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) return null;
  const pad = 6;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
  const shot = await page.screenshot({ clip });

  return decodePage.evaluate(
    async ({ b64, pad, clip, box, S, delta }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);

      const at = (x, y) => {
        const i = (y * c.width + x) * 4;
        return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]];
      };
      // Restrict every sample to the element's own box inside the crop, so the
      // padding band — which contains the stick or the label's neighbours — can
      // never contribute to either the ink or the backdrop.
      const x0 = Math.round((box.x - clip.x) * S);
      const x1 = Math.round((box.x + box.width - clip.x) * S);
      const y0 = Math.round((box.y - clip.y) * S);
      const y1 = Math.round((box.y + box.height - clip.y) * S);

      const all = [];
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) all.push(at(x, y));
      }
      if (all.length === 0) return null;

      const lumOf = ([r, gg, b]) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const sorted = all.map(lumOf).sort((a, b) => a - b);
      const bgL = sorted[Math.floor(sorted.length * 0.2)];

      let peak = null;
      let peakPx = null;
      let inkPx = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const px = at(x, y);
          if (px[3] < 60) continue;
          const L = lumOf(px);
          if (L <= bgL + delta) continue;
          inkPx += 1;
          if (peak === null || L > peak) {
            peak = L;
            peakPx = px;
          }
        }
      }
      // The composited backdrop, sampled as the median RGB of the same box's
      // non-ink pixels. This is the value a static read of the stylesheet cannot
      // produce: it is what the pad's lip, wash and gradient actually painted.
      const bgPx = all.filter((px) => lumOf(px) <= bgL + delta);
      bgPx.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
      const med = bgPx[Math.floor(bgPx.length / 2)] ?? [0, 0, 0];

      return {
        bgRgb: med.slice(0, 3),
        bgLum: +bgL.toFixed(1),
        inkPx,
        peakRgb: peakPx ? peakPx.slice(0, 3) : null,
        peakLum: peak === null ? null : +peak.toFixed(1),
      };
    },
    {
      b64: shot.toString('base64'),
      pad,
      clip,
      box,
      S: 2,
      delta: INK_DELTA,
    },
  );
}

const server = await startPreview(GAME_DIR);
const findings = [];
let verdict = 0;
let note = '';

try {
  mkdirSync(OUT_DIR, { recursive: true });
  // 1280x800 is the desktop baseline used by every other pixel tool here. The
  // hint is gated on `(hover: hover) and (pointer: fine) and (min-width: 720px)`,
  // all three of which a default Playwright desktop context satisfies — but the
  // probe asserts `display` rather than assuming it, because an element measured
  // at `display: none` reports a zero box and a zero box is not a result.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto(`${server.url}?mode=dojo`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__smkk?.ready === true, null, {
    timeout: 45000,
  });

  const visibility = await page.evaluate(() => {
    const el = document.querySelector('.key-hint');
    if (!el) return { present: false };
    const cs = getComputedStyle(el);
    const label = document.querySelector('.stick-label');
    return {
      present: true,
      display: cs.display,
      color: cs.color,
      fontSize: cs.fontSize,
      matchesQuery: matchMedia(
        '(hover: hover) and (pointer: fine) and (min-width: 720px)',
      ).matches,
      labelColor: label ? getComputedStyle(label).color : null,
      hc: document.body.classList.contains('high-contrast'),
    };
  });

  if (!visibility.present) {
    verdict = 2;
    note = '.key-hint is not in the DOM — nothing to measure';
  } else if (visibility.display !== 'block' || !visibility.matchesQuery) {
    verdict = 2;
    note = `.key-hint is ${visibility.display} at 1280x800 with the desktop media query ${visibility.matchesQuery ? 'matching' : 'NOT matching'} — the probe measured nothing, which is not a pass`;
  } else {
    // ---- normal mode -------------------------------------------------------
    const normalHint = await measureInk(page, '#zone-left .key-hint');
    const normalLabel = await measureInk(page, '#zone-left .stick-label');
    writeFileSync(`${OUT_DIR}/normal.png`, await page.screenshot({ clip: await page.locator('#zone-left').boundingBox() }));

    // ---- walk the real journey: Settings -> High contrast ------------------
    // Not `body.classList.add`. The class is what the stylesheet keys on, but the
    // question a player has is whether turning the setting on lifts this label,
    // and the checkbox is the only thing that decides it.
    await page.locator('#btn-settings').click();
    await page.locator('#settings-sheet').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#opt-high-contrast').click();
    await page.waitForFunction(() => document.body.classList.contains('high-contrast'), null, {
      timeout: 10_000,
    });
    await page.locator('#settings-close').click();
    await page.locator('#settings-sheet').waitFor({ state: 'hidden', timeout: 10_000 });
    // The pad and the sheet both carry transitions; measure a resting frame.
    await page.waitForTimeout(700);

    const hc = await page.evaluate(() => document.body.classList.contains('high-contrast'));
    const hcHint = await measureInk(page, '#zone-left .key-hint');
    const hcLabel = await measureInk(page, '#zone-left .stick-label');
    writeFileSync(`${OUT_DIR}/high-contrast.png`, await page.screenshot({ clip: await page.locator('#zone-left').boundingBox() }));

    const L = (m) => (m?.peakRgb ? relLuminance(...m.peakRgb) : null);
    const B = (m) => (m?.bgRgb ? relLuminance(...m.bgRgb) : null);
    const side = (m) => ({
      ink: L(m),
      bg: B(m),
      ratio: L(m) === null || B(m) === null ? null : ratio(L(m), B(m)),
      inkRgb: m?.peakRgb ?? null,
      bgRgb: m?.bgRgb ?? null,
    });

    const row = {
      subject: {
        name: '.key-hint (W A S D)',
        normal: side(normalHint),
        highContrast: side(hcHint),
        computed: visibility.color,
      },
      control: {
        name: '.stick-label (STANCE) — reads --text-muted',
        normal: side(normalLabel),
        highContrast: side(hcLabel),
        computed: visibility.labelColor,
      },
      highContrastApplied: hc,
    };
    findings.push(row);

    const moved = (a, b) => a !== null && b !== null && Math.abs(a - b) > 0.01;
    const controlMoved = moved(row.control.normal.ink, row.control.highContrast.ink);
    const subjectMoved = moved(row.subject.normal.ink, row.subject.highContrast.ink);

    if (!hc) {
      verdict = 2;
      note = 'the High contrast checkbox did not put the class on <body> — the second half of this run measured the same mode twice';
    } else if (!controlMoved) {
      // The constant-false instrument. Refuse to report a verdict at all.
      verdict = 2;
      note = `INSTRUMENT INCONCLUSIVE: the control (.stick-label) ink did not move between modes (${row.control.normal.ink} -> ${row.control.highContrast.ink}). This probe cannot see a colour re-point, so its verdict about .key-hint would be meaningless.`;
    } else if (!subjectMoved) {
      verdict = 1;
      note = `PINNED: .key-hint ink is unchanged by high-contrast (${row.subject.normal.ink} -> ${row.subject.highContrast.ink}) while its neighbour .stick-label in the same zone moved (${row.control.normal.ink} -> ${row.control.highContrast.ink}). The hint is a colour literal, so the mode that exists to lift faint text leaves it behind.`;
    } else if (row.subject.highContrast.ratio < AA || row.subject.normal.ratio < AA) {
      verdict = 1;
      note = `CONTRAST: .key-hint is ${row.subject.normal.ratio.toFixed(2)}:1 normal / ${row.subject.highContrast.ratio.toFixed(2)}:1 high-contrast, under AA ${AA}:1.`;
    } else {
      note = `CLAIM-TRUE: .key-hint ink moved ${row.subject.normal.ink.toFixed(4)} -> ${row.subject.highContrast.ink.toFixed(4)} with the control (${row.control.normal.ink.toFixed(4)} -> ${row.control.highContrast.ink.toFixed(4)}); contrast ${row.subject.normal.ratio.toFixed(2)}:1 -> ${row.subject.highContrast.ratio.toFixed(2)}:1, both >= ${AA}:1.`;
    }
  }

  console.log('\n### desktop key hint — composited backdrop and ink, measured off pixels');
  for (const r of findings) {
    for (const which of ['subject', 'control']) {
      const e = r[which];
      const px = (s) => (s.inkRgb ? `rgb(${s.inkRgb.join(', ')})` : 'n/a');
      const bx = (s) => (s.bgRgb ? `rgb(${s.bgRgb.join(', ')})` : 'n/a');
      const rt = (s) => (s.ratio === null ? 'n/a' : `${s.ratio.toFixed(2)}:1`);
      console.log(`  ${e.name}`);
      console.log(
        `    normal         ink ${px(e.normal)} L=${e.normal.ink?.toFixed(4)}   bg ${bx(e.normal)} L=${e.normal.bg?.toFixed(4)}   ${rt(e.normal)}   [computed ${e.computed}]`,
      );
      console.log(
        `    high-contrast  ink ${px(e.highContrast)} L=${e.highContrast.ink?.toFixed(4)}   bg ${bx(e.highContrast)} L=${e.highContrast.bg?.toFixed(4)}   ${rt(e.highContrast)}`,
      );
    }
  }
  console.log(`\n  crops: ${OUT_DIR}/normal.png ${OUT_DIR}/high-contrast.png`);
  console.log(`\n${note}\n`);
  console.log(JSON.stringify(findings, null, 2));
} finally {
  await browser.close();
  await server.stop();
}

process.exit(verdict);