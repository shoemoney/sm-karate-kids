import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const spec = readFileSync(join(here, '../e2e/capture.spec.ts'), 'utf8');
const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');

/** Does any .gitignore pattern cover this repo-relative path? */
function ignored(rel: string): boolean {
  // Enough of gitignore for the entries this repo actually uses: a literal
  // segment, a `dir/` form, and a leading-slash anchored form.
  return gitignore.split('\n').some((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return false;
    const pattern = line.endsWith('/') ? line.slice(0, -1) : line;
    if (pattern.startsWith('/')) {
      return rel === pattern.slice(1) || rel.startsWith(`${pattern.slice(1)}/${sep}`);
    }
    return rel === pattern || rel.startsWith(`${pattern}/`) || rel.split('/').includes(pattern);
  });
}

/* `capture.spec.ts` writes the README's preview image, and it used to write it
 * into the tracked tree on every run. That is not a cosmetic annoyance:
 *
 *   - every local `pnpm test:e2e` ended with `docs/preview/portrait.png`
 *     modified, a diff nobody reviewed;
 *   - r164b found the tree dirty, could not tell that dirt from another agent
 *     mid-edit, and refused to deploy — so a shipped bundle kept a dangling
 *     source-map reference for an extra release cycle;
 *   - and seven rounds each reverted the file by hand and wrote it down, which
 *     is the loop doing a manual workaround for a defect a constant could have
 *     removed.
 *
 * The invariant is therefore about WHERE the default output lands, not about the
 * pixels. A guard that only checked "the spec still contains the word
 * docs/preview" would pass on the broken version, so these assertions are
 * written to fail on it: the old default is a bare `OUT` bound to the committed
 * directory with no branch. */
describe('the preview capture does not write into the tracked tree by default', () => {
  test('the committed preview is reached only behind an explicit opt-in', () => {
    expect(spec).toMatch(/SMKK_COMMIT_PREVIEW/);
    // The committed path must appear exactly once, in the opt-in branch — not as
    // the fallback and not as a second default.
    const uses = spec.match(/COMMITTED_PREVIEW/g) ?? [];
    expect(uses.length).toBe(2); // the declaration and the branch that returns it
    expect(spec).toMatch(/process\.env\.SMKK_COMMIT_PREVIEW\s*\?\s*COMMITTED_PREVIEW\s*:/);
  });

  test('the default output directory is genuinely git-ignored', () => {
    // Recompute the default from the spec rather than trusting the constant, so
    // a change to the path is caught instead of being asserted against itself.
    const branch = spec.match(
      /:\s*resolve\(import\.meta\.dirname,\s*'([^']+)'\)\s*;/,
    )?.[1];
    expect(branch, 'the default branch no longer resolves a scratch directory').toBeTruthy();

    const out = resolve(join(here, '../e2e'), branch!);
    const rel = relative(repoRoot, out);
    expect(rel.startsWith('..'), `default output escaped the repo: ${rel}`).toBe(false);
    expect(ignored(rel)).toBe(true);
  });

  test('and the committed image itself is tracked, so the opt-in produces a reviewable diff', () => {
    expect(ignored(join('docs', 'preview', 'portrait.png'))).toBe(false);
  });
});