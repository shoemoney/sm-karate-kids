#!/usr/bin/env -S pnpm exec tsx
/**
 * Content validator.
 *
 * Importing `@smkk/content` already runs the full Zod schema validation for
 * every move/fighter/arena/ruleset AND the grammar cross-check (every
 * technique id the twin-stick grammar can produce must have frame data, and
 * every move in the data files must be reachable from the grammar — see
 * `loadContent` in packages/sim/src/content.ts). If that import throws, the
 * content is broken and we report it as check #1.
 *
 * Everything below that is additional, PRD-specific policy this repo cares
 * about that the generic schema does not (and should not) enforce.
 */
// Root-level tools/ is not itself a pnpm workspace package (see
// pnpm-workspace.yaml: only packages/* and apps/* are members), so the bare
// specifiers `@smkk/sim`/`@smkk/content` are not resolvable from here — only
// apps/game declares them as real dependencies. We reach the exact same
// modules by relative path instead of adding a workspace dependency just for
// this script.
import { allMoveIds, type ContentBundle } from '../packages/sim/src/index.js';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function pass(label: string): void {
  console.log(`✅ ${label}`);
}

function fail(label: string, detail: string): never {
  console.error(`❌ ${label}`);
  console.error(`   ${detail}`);
  process.exit(1);
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

async function main(): Promise<void> {
  let bundle: ContentBundle;

  // Check 1: schema validation + grammar cross-check, via the import itself.
  try {
    const mod = await import('../packages/content/src/index.js');
    bundle = mod.content;
  } catch (err) {
    fail(
      'schema validation and grammar cross-check (@smkk/content import)',
      err instanceof Error ? err.message : String(err),
    );
  }
  pass('schema validation and grammar cross-check (@smkk/content import)');

  // Check 2: every grammar move id has frame data.
  const grammarIds = allMoveIds();
  const moveIds = new Set(bundle.moves.map((m) => m.id));
  const missingFrameData = grammarIds.filter((id) => !moveIds.has(id));
  if (missingFrameData.length > 0) {
    fail('every grammar move id has frame data', `missing: ${missingFrameData.join(', ')}`);
  }
  pass('every grammar move id has frame data');

  // Check 3: no duplicate ids within any content collection.
  const collections: Array<[string, readonly string[]]> = [
    ['moves', bundle.moves.map((m) => m.id)],
    ['fighters', bundle.fighters.map((f) => f.id)],
    ['arenas', bundle.arenas.map((a) => a.id)],
    ['rulesets', bundle.rulesets.map((r) => r.id)],
  ];
  for (const [label, ids] of collections) {
    const dupes = duplicates(ids);
    if (dupes.length > 0) {
      fail(`no duplicate ids (${label})`, `duplicated: ${dupes.join(', ')}`);
    }
  }
  pass('no duplicate ids across moves, fighters, arenas, rulesets');

  // Check 4: every move's active window is >= 1 tick and startup < 40.
  for (const move of bundle.moves) {
    if (!(move.active >= 1)) {
      fail('move active window >= 1 tick', `${move.id} has active=${move.active}`);
    }
    if (!(move.startup < 40)) {
      fail('move startup < 40 ticks', `${move.id} has startup=${move.startup}`);
    }
  }
  pass("every move's active window is >= 1 tick and startup < 40");

  // Check 5: both fighters have distinct ids and valid hex colours.
  if (bundle.fighters.length !== 2) {
    fail('exactly two fighters', `found ${bundle.fighters.length}`);
  }
  const fighterIds = new Set(bundle.fighters.map((f) => f.id));
  if (fighterIds.size !== bundle.fighters.length) {
    fail('fighters have distinct ids', bundle.fighters.map((f) => f.id).join(', '));
  }
  for (const fighter of bundle.fighters) {
    if (!HEX_COLOR.test(fighter.giColor)) {
      fail('fighters have valid hex colours', `${fighter.id} giColor=${fighter.giColor}`);
    }
    if (!HEX_COLOR.test(fighter.beltColor)) {
      fail('fighters have valid hex colours', `${fighter.id} beltColor=${fighter.beltColor}`);
    }
  }
  pass('both fighters have distinct ids and valid hex colours');

  // Check 6: at least one arena and one ruleset.
  if (bundle.arenas.length < 1) fail('at least one arena', 'arenas array is empty');
  if (bundle.rulesets.length < 1) fail('at least one ruleset', 'rulesets array is empty');
  pass('at least one arena and one ruleset');

  // Check 7: pointsToWin is 2 for the classic ruleset.
  const classic = bundle.rulesets.find((r) => r.id === 'classic');
  if (!classic) {
    fail('classic ruleset exists', 'no ruleset with id "classic" was found');
  }
  if (classic.pointsToWin !== 2) {
    fail('pointsToWin is 2 for the classic ruleset', `classic.pointsToWin=${classic.pointsToWin}`);
  }
  pass('pointsToWin is 2 for the classic ruleset');

  console.log('');
  console.log(
    `content OK: ${bundle.moves.length} moves, ${bundle.fighters.length} fighters, ` +
      `${bundle.arenas.length} arenas, ${bundle.rulesets.length} rulesets`,
  );
}

main().catch((err) => {
  console.error('❌ validate-content crashed unexpectedly');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
