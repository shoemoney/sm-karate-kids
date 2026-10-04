#!/usr/bin/env node
/**
 * r169: what does the settings capture ACTUALLY toggle?
 *
 * `15-phone-settings-mixed` clicks `.setting-row input` at nth(4) and nth(5),
 * and its comment names "Rows 4 and 5 — Mute sound and Show performance HUD".
 * r166 appended two `label.setting-row` radios for the fighter pick to the TOP
 * of the same selector. Positional indices are the instrument here, and the
 * meaning of a position moved under a feature that landed above it.
 *
 * Throwaway: measures, does not gate.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5184';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--use-gl=angle'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);

await page.goto(`${BASE}/?mode=dojo`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__smkk?.state?.().phase === 'fight', null, { timeout: 60_000 });
await page.locator('.hud-actions button').last().click();
await page.waitForTimeout(600);

const before = await page.evaluate(() => ({
  order: [...document.querySelectorAll('.setting-row input')].map((i) => ({
    id: i.id || '(radio)',
    type: i.type,
    label: i.closest('.setting-row')?.textContent.trim() ?? null,
  })),
  bodyClass: document.body.className,
  on: [...document.querySelectorAll('.setting-row input')].filter((i) => i.checked).length,
}));

// Exactly what the capture does.
await page.locator('.setting-row input').nth(4).click();
await page.locator('.setting-row input').nth(5).click();
await page.waitForTimeout(600);

const after = await page.evaluate(() => ({
  checked: [...document.querySelectorAll('.setting-row input')]
    .filter((i) => i.checked)
    .map((i) => ({ id: i.id || '(radio)', label: i.closest('.setting-row')?.textContent.trim() ?? null })),
  bodyClass: document.body.className,
  // What the frame actually shows, if the instrument is describing it wrong.
  stickLeft: (() => {
    const z = document.getElementById('zone-left');
    const r = z.getBoundingClientRect();
    return { x: +r.x.toFixed(0), w: +r.width.toFixed(0), right: +r.right.toFixed(0) };
  })(),
  stickCap: (() => {
    const z = document.getElementById('zone-right');
    const r = z.getBoundingClientRect();
    return { x: +r.x.toFixed(0), right: +r.right.toFixed(0) };
  })(),
  padFont: getComputedStyle(document.getElementById('pad')).fontSize,
  rootFont: getComputedStyle(document.documentElement).fontSize,
}));

console.log(JSON.stringify({ before, after }, null, 2));
await browser.close();