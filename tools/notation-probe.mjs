#!/usr/bin/env node
/**
 * Render every candidate half-point notation side by side, in the font stack the
 * game actually ships, at the score's real size, on the real plate colour.
 *
 * This is the evidence for reversing the r36/r53 rejection of U+00BD, so it has
 * to be re-runnable rather than a screenshot in a commit message.
 *
 * The history it settles, none of it measured until now:
 *   - r36/r53: U+00BD "renders as a *slashed* fraction, so `2½` reads as 21/2"
 *     (gpt-5.2's report). Rejected, and replaced with a stacked column.
 *   - r147: the stacked column "reads as a baseline drop" (r148 measured it:
 *     the denominator sat 15.00px below the digit baseline and the scoreline
 *     grew 9.94px on every half).
 *   - r148: the one-line fraction "renders as confusing hyphenated strings"
 *     (gemini-3.8-flash, on two independent fresh review sets).
 *
 * Five rounds, three notations, and nobody had put them on screen together. The
 * slashed glyph reads as unambiguous precisely BECAUSE of the diagonal: a minus
 * is horizontal, and the numerator and denominator are not on one line to be
 * read as a range. The r36 objection cited the slash as the defect when the
 * slash is the reason it works.
 *
 * Run:  node tools/notation-probe.mjs [outPng]
 */
import { chromium } from '@playwright/test';
import { writeFileSync, unlinkSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/smkk-notation.png';
const PAGE = '/tmp/.smkk-notation-probe.html';

const html = `<!doctype html><meta charset="utf-8"><style>
  :root {
    --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    --fighter-0: #f2ede4;
    --plate: #221913;
  }
  body { margin:0; background:#000; font-family: var(--font-sans); }
  .row { display:flex; align-items:center; gap:40px; background: var(--plate);
    color: var(--fighter-0); padding:10px 16px; margin-bottom:6px; font-size:22px;
    font-weight:800; font-variant-numeric: tabular-nums; width:max-content; }
  .label { font:500 11px/1 ui-monospace, monospace; color:#8a7a63; width:150px;
    flex:0 0 auto; text-transform:uppercase; }
  /* A: the one-line fraction, r148. */
  .a { display:inline-flex; align-items:center; vertical-align:baseline;
    line-height:1; margin-inline-start:0.3em; font-size:0.72em; }
  .a b { inline-size:0.5em; block-size:0.13em; background:currentColor;
    border-radius:1px; margin-inline:0.07em; }
  /* D: the stacked column, r53..r147. */
  .d { display:inline-flex; flex-direction:column; align-items:center;
    vertical-align:-0.3em; line-height:0.82; margin-inline-start:0.04em;
    font-size:0.72em; }
  .d i { inline-size:0.66em; block-size:0.13em; background:currentColor;
    border-radius:1px; }
  .probe { font-size:13px; color:#6b5f4e; font-weight:400; }
</style>
<div class="row"><span class="label">A one-line frac r148</span><span>1<span class="a"><span>1</span><b></b><span>2</span></span></span><span class="probe">0.72em, mid bar</span></div>
<div class="row"><span class="label">B U+00BD @ 1em</span><span>1½</span><span class="probe">score-size glyph</span></div>
<div class="row"><span class="label">C U+00BD @ 0.72em</span><span>1<span style="font-size:0.72em">½</span></span><span class="probe">0.72em glyph</span></div>
<div class="row"><span class="label">D stacked r147</span><span>1<span class="d"><span>1</span><i></i><span>2</span></span></span><span class="probe">2 lines</span></div>
<div class="row"><span class="label">E decimal</span><span>1.5</span><span class="probe">what r36 replaced</span></div>`;

writeFileSync(PAGE, html);
const browser = await chromium.launch();
try {
  const page = await (
    await browser.newContext({ viewport: { width: 760, height: 340 }, deviceScaleFactor: 3 })
  ).newPage();
  await page.goto(`file://${PAGE}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: OUT });
  console.log(`wrote ${OUT}`);
  console.log('  B is the shipped notation as of r148: a single glyph at the score size.');
} finally {
  await browser.close();
  unlinkSync(PAGE);
}
