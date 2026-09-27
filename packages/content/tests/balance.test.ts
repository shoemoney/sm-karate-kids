import { describe, expect, test } from 'vitest';
import {
  ARCHETYPES,
  CpuController,
  allMoveIds,
  createMatch,
  step,
  type ArchetypeId,
  type MatchState,
  type PlayerIndex,
} from '@smkk/sim';
import { content } from '../src/index.js';

/**
 * Balance guard rails on the real content table.
 *
 * Every threshold below cites the number actually measured by
 * `pnpm tsx tools/balance-report.ts --matches 300 --seed 1` against the
 * current packages/content/data/moves.json and packages/sim/src/cpu.ts (full
 * findings in docs/balance.md). This file reruns the same deterministic batch
 * itself, rather than reading docs/balance-data.json, so a change to move
 * data or CPU tuning is caught the moment the suite runs, not only when
 * someone remembers to regenerate the JSON.
 *
 * These numbers were re-measured after two CpuController fixes (the spacing
 * pocket band and a widened opener table) and a scoreFor narrowing (counter
 * now requires the defender to still be in startup). None of the thresholds
 * below carry a number forward from before that change — see docs/balance.md
 * for the before/after.
 */

const MATCHES_PER_PAIRING = 300;
const BASE_SEED = 1;
const MAX_TICKS = 7200;
const ARCHETYPE_IDS: readonly ArchetypeId[] = ['sensei', 'pressure', 'counter'];

/** Deterministic integer mix, matching tools/balance-report.ts. Never Math.random. */
function deriveSeed(pairingIndex: number, matchIndex: number, side: number): number {
  let h = (BASE_SEED >>> 0) ^ 0x9e3779b9;
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

function allPairings(ids: readonly ArchetypeId[]): Pairing[] {
  const pairs: Pairing[] = [];
  for (const [i, a] of ids.entries()) {
    for (const b of ids.slice(i)) pairs.push({ a, b });
  }
  return pairs;
}

interface MatchOutcome {
  readonly winner: PlayerIndex | null;
  readonly timedOut: boolean;
  readonly moveIds: readonly string[];
  readonly fullCalls: number;
}

function runOneMatch(archA: ArchetypeId, seedA: number, archB: ArchetypeId, seedB: number): MatchOutcome {
  const state: MatchState = createMatch({ content });
  const cpuA = new CpuController(ARCHETYPES[archA], seedA, 0);
  const cpuB = new CpuController(ARCHETYPES[archB], seedB, 1);
  const moveIds: string[] = [];
  let fullCalls = 0;
  let timedOut = false;

  for (let tick = 0; tick < MAX_TICKS && state.phase !== 'over'; tick += 1) {
    const events = step(state, { p1: cpuA.poll(state), p2: cpuB.poll(state) });
    for (const event of events) {
      if (event.type === 'call') {
        moveIds.push(event.call.moveId);
        if (event.call.value === 'full') fullCalls += 1;
      }
      if (event.type === 'timeout') timedOut = true;
    }
  }
  if (state.phase !== 'over') {
    throw new Error(`match ${archA} vs ${archB} (seeds ${seedA}/${seedB}) never resolved within ${MAX_TICKS} ticks`);
  }
  return { winner: state.winner, timedOut, moveIds, fullCalls };
}

interface PairingStats {
  readonly a: ArchetypeId;
  readonly b: ArchetypeId;
  readonly winRateA: number;
  readonly winRateB: number;
  readonly drawRate: number;
  readonly timeoutRate: number;
  readonly totalCalls: number;
  readonly fullShare: number;
}

function computeBalance(): {
  readonly pairings: readonly PairingStats[];
  readonly moveCounts: Readonly<Record<string, number>>;
  readonly totalCalls: number;
} {
  const pairings = allPairings(ARCHETYPE_IDS);
  const moveCounts: Record<string, number> = {};
  let totalCalls = 0;
  const pairingStats: PairingStats[] = [];

  pairings.forEach((pairing, pairingIndex) => {
    let winsA = 0;
    let winsB = 0;
    let draws = 0;
    let timeouts = 0;
    let pairingCalls = 0;
    let pairingFullCalls = 0;

    for (let m = 0; m < MATCHES_PER_PAIRING; m += 1) {
      const outcome = runOneMatch(
        pairing.a,
        deriveSeed(pairingIndex, m, 0),
        pairing.b,
        deriveSeed(pairingIndex, m, 1),
      );
      if (outcome.timedOut) timeouts += 1;
      if (outcome.winner === 0) winsA += 1;
      else if (outcome.winner === 1) winsB += 1;
      else draws += 1;
      pairingCalls += outcome.moveIds.length;
      pairingFullCalls += outcome.fullCalls;
      for (const id of outcome.moveIds) {
        moveCounts[id] = (moveCounts[id] ?? 0) + 1;
        totalCalls += 1;
      }
    }

    pairingStats.push({
      a: pairing.a,
      b: pairing.b,
      winRateA: winsA / MATCHES_PER_PAIRING,
      winRateB: winsB / MATCHES_PER_PAIRING,
      drawRate: draws / MATCHES_PER_PAIRING,
      timeoutRate: timeouts / MATCHES_PER_PAIRING,
      totalCalls: pairingCalls,
      fullShare: pairingCalls === 0 ? 0 : pairingFullCalls / pairingCalls,
    });
  });

  return { pairings: pairingStats, moveCounts, totalCalls };
}

const balance = computeBalance();
const crossPairings = balance.pairings.filter((p) => p.a !== p.b);
const mirrorPairings = balance.pairings.filter((p) => p.a === p.b);

test('sanity: the batch actually produced scoring calls', () => {
  expect(balance.totalCalls).toBeGreaterThan(0);
});

describe('technique dominance', () => {
  test('no single technique accounts for more than 30% of all scoring calls', () => {
    // Measured (seed 1, 300 matches/pairing): crouching_punch peaks at 933/5266 =
    // 17.7% of all scoring calls, the highest of any technique now that the CPU can
    // throw all 20. 30% leaves real headroom above that while still catching a
    // technique that comes to dominate the table.
    for (const [moveId, count] of Object.entries(balance.moveCounts)) {
      const share = count / balance.totalCalls;
      expect(share, `${moveId} share of all calls`).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('technique reachability', () => {
  test('the never-landing technique count does not grow past the measured baseline', () => {
    // Measured (seed 1, 300/pairing): only 2 of the 20 grammar techniques never
    // score — High Block and Low Block. That is not a bug: connects() only ever
    // credits a hit to an attacker whose own active move has kind 'strike' (match.ts),
    // so a block can never itself register as a scoring call, by construction. 2 is
    // therefore both the measured value and the structural floor — this ceiling
    // exists to catch a STRIKE technique going dead again, not to invite the floor
    // to move. Before the CpuController opener-table fix this was 15/20; see
    // docs/balance.md.
    const landed = new Set(Object.keys(balance.moveCounts));
    const dead = allMoveIds().filter((id) => !landed.has(id));
    expect(dead.length).toBeLessThanOrEqual(2);
  });
});

describe('archetype match-ups', () => {
  test.each(crossPairings.map((pairing) => [`${pairing.a} vs ${pairing.b}`, pairing] as const))(
    '%s is uneven but never a total wipeout',
    (_label, pairing) => {
      // Measured (seed 1, 300/pairing): the tightest underdog rate across the three
      // cross-archetype pairings is 22.0% (pressure vs counter) and the widest
      // favourite rate is 77.3% (also pressure vs counter) — both far healthier than
      // before this pass's fixes. 10%/90% gives headroom on both sides while still
      // catching an actual 0%/100% wipeout.
      expect(Math.min(pairing.winRateA, pairing.winRateB), `${pairing.a} vs ${pairing.b} underdog rate`).toBeGreaterThanOrEqual(0.1);
      expect(Math.max(pairing.winRateA, pairing.winRateB), `${pairing.a} vs ${pairing.b} favourite rate`).toBeLessThanOrEqual(0.9);
    },
  );

  test('cross-archetype bouts resolve within the 30-second timer in the large majority of cases', () => {
    // Measured (seed 1, 300/pairing): the worst cross-archetype timeout rate is now
    // 4.0% (sensei vs pressure), down from 9.33% before this pass. 15% leaves
    // headroom while still catching a real slide toward timing out becoming common.
    for (const pairing of crossPairings) {
      expect(pairing.timeoutRate, `${pairing.a} vs ${pairing.b} timeout rate`).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('mirror match-ups (same archetype vs itself)', () => {
  test('mirror pairings actually fight now — the old 100% freeze is gone', () => {
    // Before the CpuController pocket-band fix, sensei-sensei, pressure-pressure, and
    // counter-counter were ALL exactly 100% draw / 100% timeout / 0 scoring calls
    // (see docs/balance.md § "what changed"). Now every mirror pairing produces real
    // scoring calls and none of them times out anywhere near every bout.
    for (const pairing of mirrorPairings) {
      expect(pairing.totalCalls, `${pairing.a} mirror total calls`).toBeGreaterThan(0);
      expect(pairing.timeoutRate, `${pairing.a} mirror timeout rate`).toBeLessThan(0.9);
    }
  });

  test('pressure-vs-pressure and counter-vs-counter still time out far more than any cross-archetype pairing', () => {
    // Measured (seed 1, 300/pairing): pressure-pressure times out 45.7% of bouts —
    // worse than any cross-archetype pairing (worst there is 4.0%) — and
    // counter-counter times out 23.3%. Both are genuine, still-open weak spots (see
    // docs/balance.md); this is not a target to celebrate, just a ceiling with
    // headroom so a further slide toward "mirror matchups mostly time out" is caught.
    const pressureMirror = mirrorPairings.find((p) => p.a === 'pressure');
    const counterMirror = mirrorPairings.find((p) => p.a === 'counter');
    expect(pressureMirror?.timeoutRate, 'pressure-pressure timeout rate').toBeLessThanOrEqual(0.6);
    expect(counterMirror?.timeoutRate, 'counter-counter timeout rate').toBeLessThanOrEqual(0.4);
  });

  test('counter-vs-counter is still overwhelmingly full points, not the half/full spread the PRD wants', () => {
    // Measured (seed 1, 300/pairing): 89.1% of counter-counter's scoring calls are
    // full points, because two very patient, high-block-chance archetypes mostly
    // trade startup counters against each other, and a counter is always scored
    // 'full' (match.ts scoreFor) regardless of the landing move's own base value.
    // That's a real, still-open weak spot — flagged plainly in docs/balance.md, not
    // laundered into "it fights now, so it's fine." Ceiling with headroom above the
    // measured value so a further slide toward "every call is full" is caught.
    const counterMirror = mirrorPairings.find((p) => p.a === 'counter');
    expect(counterMirror?.fullShare, 'counter-counter full share').toBeLessThanOrEqual(0.97);
  });
});
