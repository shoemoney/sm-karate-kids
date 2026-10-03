import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every open sheet pauses the game: the bout clock and a pending card's
 * countdown alike.
 *
 * A source guard, deliberately the weak kind — a grep is not a browser. The
 * browser-level claims are `tests/e2e/sheets-pause.spec.ts` (a live bout
 * freezes under each sheet and resumes after) and `tools/sheet-pause-probe.mjs`
 * (the pre-bout card survives a long read). This file exists because r152's
 * version of the rule was wired per button: the card's TECHNIQUES held, the
 * HUD's TECHNIQUES and SETTINGS did not, and the guard this one replaced
 * asserted that split as correct.
 */
const main = readFileSync(resolve(import.meta.dirname, '../../src/main.ts'), 'utf8');

describe('an open sheet pauses the game', () => {
  it('registers every sheet on open and releases it on close, in one place', () => {
    const toggle = main.match(/function toggleSheet\([\s\S]*?\n\}\n/);
    expect(toggle, 'toggleSheet moved').not.toBeNull();
    expect(toggle?.[0]).toMatch(/openSheets\.add\(sheetEl\)/);
    expect(toggle?.[0]).toMatch(/openSheets\.delete\(sheetEl\)/);
  });

  it('gives the bout clock no time while a sheet is up', () => {
    expect(main).toMatch(/const sheetUp = openSheets\.size > 0;/);
    expect(main).toMatch(/clock\.drain\(held \|\| sheetUp(?: \|\| paused)? \? 0 :/);
  });

  it('holds a pending card countdown while a sheet is up, every frame', () => {
    expect(main).toMatch(/pendingAt = frameDeadline\(pendingAt, frameDt, sheetUp(?: \|\| paused)?\)/);
  });

  it('has no per-button opt-in left to forget', () => {
    // Every call site is exactly (sheet, open, reducedMotion): nothing else to pass.
    const all = main.split('toggleSheet(').length - 2; // minus the definition
    const plain = [...main.matchAll(/toggleSheet\([^\n]+?, (?:true|false), settings\.get\(\)\.reducedMotion\)/g)].length;
    expect(all).toBeGreaterThanOrEqual(4);
    expect(plain).toBe(all);
  });
});
