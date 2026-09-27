#!/usr/bin/env -S pnpm exec tsx
/**
 * Balance report.
 *
 * Runs a large seeded batch of CPU-vs-CPU matches across every pairing of the
 * three archetypes in ARCHETYPES (six pairings: each archetype against every
 * other, plus itself) and reports win/draw/timeout rates, technique usage,
 * call composition, and contact distance. See docs/balance.md for the
 * findings and tools/validate-content.ts for why this imports the sim/content
 * packages by relative path instead of the @smkk/sim / @smkk/content
 * workspace specifiers (tools/ is not a workspace package).
 *
 * The whole run is driven off seeded Rng instances inside CpuController —
 * nothing here touches Math.random — so `--seed 1` twice in a row produces
 * byte-identical docs/balance-data.json.
 *
 * Usage: pnpm tsx tools/balance-report.ts [--matches 300] [--seed 1]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHETYPES,
  CpuController,
  allMoveIds,
  createMatch,
  step,
  type ArchetypeId,
  type CallValue,
  type MatchState,
  type PlayerIndex,
} from '../packages/sim/src/index.js';
import { content } from '../packages/content/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'balance-data.json');

/** Generous ceiling: ready (72) + several exchanges each capped by the 1800-tick
 * classic timer plus referee holds. Matches the soak test's own ceiling. */
const MAX_TICKS = 7200;

const ARCHETYPE_IDS: readonly ArchetypeId[] = ['sensei', 'pressure', 'counter'];

interface CliArgs {
  readonly matches: number;
  readonly seed: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let matches = 300;
  let seed = 1;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const [flag, inline] = arg.split('=');

    const readValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      i += 1;
      return next;
    };

    if (flag === '--matches') {
      const value = readValue();
      if (value !== undefined) matches = Number.parseInt(value, 10);
    } else if (flag === '--seed') {
      const value = readValue();
      if (value !== undefined) seed = Number.parseInt(value, 10);
    }
  }

  if (!Number.isFinite(matches) || matches < 1) {
    throw new Error(`--matches must be a positive integer, got ${String(matches)}`);
  }
  if (!Number.isFinite(seed)) {
    throw new Error(`--seed must be an integer, got ${String(seed)}`);
  }
  return { matches, seed };
}

/** Deterministic integer mix. Never Math.random — the same inputs always give the same seed. */
function deriveSeed(base: number, pairingIndex: number, matchIndex: number, side: number): number {
  let h = (base >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ pairingIndex, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ matchIndex, 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ side, 0x27d4eb2f) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

interface Pairing {
  readonly a: ArchetypeId;
  readonly b: ArchetypeId;
}

/** Every unordered pairing of archetypes, including an archetype against itself. */
function allPairings(ids: readonly ArchetypeId[]): Pairing[] {
  const pairs: Pairing[] = [];
  for (const [i, a] of ids.entries()) {
    for (const b of ids.slice(i)) {
      pairs.push({ a, b });
    }
  }
  return pairs;
}

interface CallRecord {
  readonly scorer: PlayerIndex;
  readonly value: CallValue;
  readonly moveId: string;
  readonly counter: boolean;
}

interface MatchResult {
  readonly winner: PlayerIndex | null;
  readonly timedOut: boolean;
  readonly finishTick: number;
  readonly calls: readonly CallRecord[];
  readonly contactDistances: readonly number[];
}

function runOneMatch(archA: ArchetypeId, seedA: number, archB: ArchetypeId, seedB: number): MatchResult {
  const state: MatchState = createMatch({ content });
  const cpuA = new CpuController(ARCHETYPES[archA], seedA, 0);
  const cpuB = new CpuController(ARCHETYPES[archB], seedB, 1);

  const calls: CallRecord[] = [];
  const contactDistances: number[] = [];
  let timedOut = false;

  for (let tick = 0; tick < MAX_TICKS && state.phase !== 'over'; tick += 1) {
    const frame = { p1: cpuA.poll(state), p2: cpuB.poll(state) };
    const events = step(state, frame);
    for (const event of events) {
      if (event.type === 'call') {
        calls.push({
          scorer: event.call.scorer,
          value: event.call.value,
          moveId: event.call.moveId,
          counter: event.call.counter,
        });
        contactDistances.push(Math.abs(state.fighters[0].x - state.fighters[1].x));
      } else if (event.type === 'simultaneous') {
        contactDistances.push(Math.abs(state.fighters[0].x - state.fighters[1].x));
      } else if (event.type === 'timeout') {
        timedOut = true;
      }
    }
  }

  if (state.phase !== 'over') {
    throw new Error(
      `match ${archA} vs ${archB} (seeds ${seedA}/${seedB}) did not resolve within ${MAX_TICKS} ticks`,
    );
  }

  return { winner: state.winner, timedOut, finishTick: state.tick, calls, contactDistances };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return (lower + upper) / 2;
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

interface AggregateReport {
  readonly matches: number;
  readonly winRateA: number;
  readonly winRateB: number;
  readonly drawRate: number;
  readonly timeoutRate: number;
  readonly meanTicksToWin: number;
  readonly medianTicksToWin: number;
  readonly totalCalls: number;
  readonly fullShare: number;
  readonly halfShare: number;
  readonly counterShare: number;
  readonly meanContactDistance: number;
  readonly moveCounts: Record<string, number>;
}

function summarize(results: readonly MatchResult[]): AggregateReport {
  const matches = results.length;
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let timeouts = 0;
  const ticksToWin: number[] = [];
  const moveCounts: Record<string, number> = {};
  let fullCalls = 0;
  let counterCalls = 0;
  let totalCalls = 0;
  const distances: number[] = [];

  for (const result of results) {
    if (result.timedOut) timeouts += 1;
    if (result.winner === 0) winsA += 1;
    else if (result.winner === 1) winsB += 1;
    else draws += 1;
    if (!result.timedOut) ticksToWin.push(result.finishTick);

    for (const call of result.calls) {
      totalCalls += 1;
      moveCounts[call.moveId] = (moveCounts[call.moveId] ?? 0) + 1;
      if (call.value === 'full') fullCalls += 1;
      if (call.counter) counterCalls += 1;
    }
    distances.push(...result.contactDistances);
  }

  return {
    matches,
    winRateA: round(matches === 0 ? 0 : winsA / matches),
    winRateB: round(matches === 0 ? 0 : winsB / matches),
    drawRate: round(matches === 0 ? 0 : draws / matches),
    timeoutRate: round(matches === 0 ? 0 : timeouts / matches),
    meanTicksToWin: round(mean(ticksToWin)),
    medianTicksToWin: round(median(ticksToWin)),
    totalCalls,
    fullShare: round(totalCalls === 0 ? 0 : fullCalls / totalCalls),
    halfShare: round(totalCalls === 0 ? 0 : 1 - fullCalls / totalCalls),
    counterShare: round(totalCalls === 0 ? 0 : counterCalls / totalCalls),
    meanContactDistance: round(mean(distances)),
    moveCounts,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const { matches, seed } = parseArgs(process.argv.slice(2));
  const pairings = allPairings(ARCHETYPE_IDS);
  const moveNameOf = new Map(content.moves.map((move) => [move.id, move.name]));

  console.log(`⚔️  Balance report — ${matches} matches per pairing × ${pairings.length} pairings, seed ${seed}`);
  console.log('');

  const pairingReports: Array<{ a: ArchetypeId; b: ArchetypeId } & AggregateReport> = [];
  const allResults: MatchResult[] = [];

  pairings.forEach((pairing, pairingIndex) => {
    const results: MatchResult[] = [];
    for (let m = 0; m < matches; m += 1) {
      const seedA = deriveSeed(seed, pairingIndex, m, 0);
      const seedB = deriveSeed(seed, pairingIndex, m, 1);
      results.push(runOneMatch(pairing.a, seedA, pairing.b, seedB));
    }
    allResults.push(...results);

    const report = summarize(results);
    pairingReports.push({ a: pairing.a, b: pairing.b, ...report });

    console.log(`🥋 ${pairing.a} vs ${pairing.b} (${matches} bouts)`);
    console.log(
      `   win rate: p0/${pairing.a} ${pct(report.winRateA)} | p1/${pairing.b} ${pct(report.winRateB)} | draw ${pct(report.drawRate)} | timeout ${pct(report.timeoutRate)}`,
    );
    console.log(`   ticks to win: mean ${report.meanTicksToWin.toFixed(0)}, median ${report.medianTicksToWin.toFixed(0)}`);
    console.log(
      `   calls: ${report.totalCalls} total, full ${pct(report.fullShare)} / half ${pct(report.halfShare)}, counters ${pct(report.counterShare)}`,
    );
    console.log(`   mean contact distance: ${report.meanContactDistance.toFixed(3)}m`);
    const topMoves = Object.entries(report.moveCounts).sort((left, right) => right[1] - left[1]);
    console.log(
      `   technique usage: ${topMoves.map(([id, count]) => `${moveNameOf.get(id) ?? id}=${count}`).join(', ') || '(none)'}`,
    );
    console.log('');
  });

  const overall = summarize(allResults);
  const grammarMoveIds = allMoveIds();
  const landedMoveIds = new Set(Object.keys(overall.moveCounts));
  const deadMoves = grammarMoveIds.filter((id) => !landedMoveIds.has(id));

  console.log('📊 Overall');
  console.log(
    `   ${overall.matches} bouts total | draw ${pct(overall.drawRate)} | timeout ${pct(overall.timeoutRate)}`,
  );
  console.log(`   ticks to win: mean ${overall.meanTicksToWin.toFixed(0)}, median ${overall.medianTicksToWin.toFixed(0)}`);
  console.log(
    `   calls: ${overall.totalCalls} total, full ${pct(overall.fullShare)} / half ${pct(overall.halfShare)}, counters ${pct(overall.counterShare)}`,
  );
  console.log(`   mean contact distance: ${overall.meanContactDistance.toFixed(3)}m`);
  console.log('');
  console.log(`💀 Dead techniques (never landed in any of ${overall.matches} bouts): ${deadMoves.length}/${grammarMoveIds.length}`);
  for (const id of deadMoves) {
    console.log(`   - ${moveNameOf.get(id) ?? id} (${id})`);
  }

  const report = {
    seed,
    matchesPerPairing: matches,
    totalMatches: overall.matches,
    archetypes: ARCHETYPE_IDS,
    pairings: pairingReports,
    overall,
    deadMoves,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('');
  console.log(`📝 wrote ${path.relative(path.join(__dirname, '..'), OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error('❌ balance-report crashed unexpectedly');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
