import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, '../../src/main.ts'), 'utf8');

/* The tournament pre-bout card headlined "QUALIFIER" while the HUD strip 130px
 * above it read "Round 1/5 · Qualifier" — the round name twice on one screen.
 * This card has already been through that exact defect once (r117 removed a
 * duplicated lesson line), so the guard is on the pattern: the round name
 * belongs to exactly ONE surface, the headline. */
describe('tournament round name placement', () => {
  test('the HUD progress strip carries progress, not the round name', () => {
    const setRound = main.match(/hud\.setRound\(`([^`]*)`\)/)?.[1] ?? '';
    expect(setRound).not.toContain('round.name');
  });

  test('the card still headlines the round name', () => {
    expect(main).toMatch(/headline:\s*round\.name/);
  });

  test('the round name is not interpolated into two tournament surfaces', () => {
    // Exactly one `headline: round.name`, and zero in any setRound call.
    expect((main.match(/headline:\s*round\.name/g) ?? []).length).toBe(1);
  });
});
