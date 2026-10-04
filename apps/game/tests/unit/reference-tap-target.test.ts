import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../../src/styles.css'), 'utf8');
const main = readFileSync(join(here, '../../src/main.ts'), 'utf8');

// The rule may be shared with the opening card's fighter swap, which sits in
// the same row and must meet the same floor.
const rule = css.match(/\.result-reference((?:\s*,\s*[^,{]+)*)\s*\{([^}]*)\}/);
const block = rule?.[2] ?? '';

/* The pre-bout card's only route to the techniques sheet measured 102x21px in
 * --text-2xs caps — under half the 44px tap floor, on the one screen every
 * player passes through, with the HUD's own TECHNIQUES button behind the card.
 * WCAG 2.5.8 / Apple HIG both put the floor at 44. */
describe('pre-bout reference button', () => {
  test('declares a min-height at or above the 44px tap floor', () => {
    const m = block.match(/min-height:\s*(\d+)px/);
    expect(m, '.result-reference has no min-height').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });

  test('the fighter swap beside it shares the same rule, and so the same floor', () => {
    expect(rule?.[1] ?? '').toMatch(/\.result-swap\b/);
  });

  test('is not the smallest type token in the system', () => {
    // --text-2xs at 10px was what made it a whisper beside a gold FIGHT button.
    expect(block).not.toContain('var(--text-2xs)');
  });

  test('labels itself with the word the player already knows', () => {
    // "REFERENCE" named a concept the card never introduces, while the HUD
    // calls the same sheet TECHNIQUES.
    expect(main).toContain("label: 'TECHNIQUES'");
  });
});
