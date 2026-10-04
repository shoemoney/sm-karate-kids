#!/usr/bin/env node
/**
 * Throwaway: what EXACTLY changes when the ⇄ button is pressed, measured, so
 * shot 23's assertion can be written against the real values instead of a guess.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SMKK_BASE ?? 'http://127.0.0.1:5184';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--use-gl=angle'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
const swap = page.locator('.result-swap');
await swap.waitFor({ state: 'visible', timeout: 30_000 });
// __smkk is published at ready, which is LATER than the card being up. That
// ordering is the crash r169 hit.
await page.waitForFunction(() => typeof globalThis.__smkk?.seats === 'function', null, { timeout: 60_000 });
console.log('seats() available after the card was already visible');

const read = () =>
  page.evaluate(() => ({
    seats: globalThis.__smkk.seats(),
    p1: document.body.dataset.p1 ?? null,
    label: document.querySelector('.result-swap')?.textContent.trim() ?? null,
    phase: globalThis.__smkk.state().phase,
    pos: globalThis.__smkk.state().positions,
  }));

const before = await read();
await swap.click();
await page.waitForTimeout(1200);
const after = await read();

console.log('before', JSON.stringify(before));
console.log('after ', JSON.stringify(after));
await browser.close();