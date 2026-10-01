import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../../src/styles.css'), 'utf8');

const rule = css.match(
  /body:has\(\.sheet:not\(\[hidden\]\)\) \.sheet\s*\{([^}]*)\}/,
)?.[1] ?? '';

/* The open sheet rendered 517px tall in an 844px viewport, so the bottom 327px
 * of the live bout sat at full brightness under the panel: elementFromPoint at
 * 80% down returned the canvas, and a pixel strip there attenuated 9.6% — i.e.
 * the "dimmed behind the sheet" treatment verified in earlier rounds was
 * measuring the scrim OVER the panel, never the live strip BENEATH it.
 *
 * This is a source guard because the defect is in the wiring, not a value: a
 * browser assertion belongs in e2e, but the cascade rule that failed to fill is
 * readable here. */
describe('open sheet coverage', () => {
  test('states an explicit viewport height rather than relying on inset alone', () => {
    // `inset: 0` did not fill. A height makes the fix independent of which rule
    // wins the cascade, so it cannot silently regress the same way.
    expect(rule).toMatch(/height:\s*100dvh/);
  });

  test('keeps the rule that hides the pad, which is what created the gap', () => {
    expect(css).toMatch(/body:has\(\.sheet:not\(\[hidden\]\)\) #pad/);
  });
});
