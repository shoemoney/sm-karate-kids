import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../src/hud.ts'), 'utf8');

/* The visible countdown caption must name what is counting down to, not just how
 * long. "starting in 8" on its own is the bare-numeral mistake the aria-label was
 * already fixed for — the label says "REMATCH, starting in 8 seconds" while the
 * caption said "starting in 8", so only assistive tech knew what 8 counted. */
describe('result countdown caption', () => {
  const caption = src.match(/resultCount\.textContent\s*=\s*`([^`]*)`/);

  test('is built from a template literal', () => {
    expect(caption).not.toBeNull();
  });

  test('names the action it is counting down to', () => {
    expect(caption?.[1]).toContain('${this.resultAction');
  });

  test('does not ship the ambiguous bare "starting in"', () => {
    expect(caption?.[1]).not.toMatch(/^\s*starting in/);
  });
});
