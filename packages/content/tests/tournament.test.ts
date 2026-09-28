import { describe, expect, test } from 'vitest';
import {
  ARCHETYPES,
  CpuController,
  SCORE,
  TOURNAMENT,
  emptyTally,
  roundArchetype,
  runMatch,
  scoreBout,
  tallyCall,
  type ArchetypeId,
} from '@smkk/sim';
import { content } from '../src/index.js';

const REFERENCES: readonly ArchetypeId[] = ['sensei', 'pressure', 'counter'];
const BOUTS = 120;

/** How often a fixed reference fighter beats this round's opponent, averaged over three styles. */
function referenceWinRate(roundIndex: number): number {
  const round = TOURNAMENT[roundIndex]!;
  let total = 0;
  for (const ref of REFERENCES) {
    let wins = 0;
    for (let s = 1; s <= BOUTS; s += 1) {
      const me = new CpuController(ARCHETYPES[ref], s * 7 + 1, 0);
      const him = new CpuController(roundArchetype(round), s * 13 + 5, 1);
      const { state } = runMatch({ content }, (_t, st) => ({ p1: me.poll(st), p2: him.poll(st) }));
      if (state.winner === 0) wins += 1;
    }
    total += wins / BOUTS;
  }
  return total / REFERENCES.length;
}

describe('the tournament ladder', () => {
  test('every round is measurably harder than the one before', () => {
    // Measured 2026-09-28 at 200 bouts per reference: 89.5% -> 55.2% -> 29.3%
    // -> 21.2% -> 16.3%. If a tuning change flattens or inverts a step, the
    // ladder stops being a ladder, and this fails.
    const rates = TOURNAMENT.map((_, i) => referenceWinRate(i));
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i], `${TOURNAMENT[i]!.id} must be harder than ${TOURNAMENT[i - 1]!.id}`).toBeLessThan(rates[i - 1]!);
    }
    expect(rates[0], 'the qualifier teaches rather than punishes').toBeGreaterThan(0.75);
    expect(rates.at(-1)!, 'the final is a wall').toBeLessThan(0.25);
  }, 120_000);

  test('difficulty 0 is softer than the base style and difficulty 1 is sharper', () => {
    const base = ARCHETYPES.pressure;
    const easy = roundArchetype({ id: 'e', name: 'e', archetype: 'pressure', difficulty: 0, multiplier: 1 });
    const hard = roundArchetype({ id: 'h', name: 'h', archetype: 'pressure', difficulty: 1, multiplier: 1 });
    expect(easy.aggression).toBeLessThan(base.aggression);
    expect(hard.aggression).toBeGreaterThan(base.aggression);
    expect(hard.blockChance).toBeGreaterThan(easy.blockChance);
    expect(hard.patience).toBeLessThan(easy.patience);
    expect(hard.punish!).toBeGreaterThan(easy.punish!);
  });

  test('multipliers rise with the rounds', () => {
    for (let i = 1; i < TOURNAMENT.length; i += 1) {
      expect(TOURNAMENT[i]!.multiplier).toBeGreaterThan(TOURNAMENT[i - 1]!.multiplier);
    }
  });
});

describe('bout scoring', () => {
  const final = TOURNAMENT.at(-1)!;
  const qualifier = TOURNAMENT[0]!;

  test('a lost bout banks nothing', () => {
    expect(scoreBout({ ippon: 1, wazaAri: 1, counters: 1, conceded: 2, ticksLeft: 900, won: false }, final)).toBe(0);
  });

  test('techniques, time left, and a perfect bout all count, then the round multiplies', () => {
    const tally = { ippon: 2, wazaAri: 0, counters: 1, conceded: 0, ticksLeft: 600, won: true };
    const raw = 2 * SCORE.ippon + SCORE.counter + 10 * SCORE.perSecondLeft + SCORE.perfect;
    expect(scoreBout(tally, qualifier)).toBe(raw);
    expect(scoreBout(tally, final)).toBe(raw * final.multiplier);
  });

  test('conceding anything costs the perfect bonus', () => {
    const clean = { ippon: 2, wazaAri: 0, counters: 0, conceded: 0, ticksLeft: 0, won: true };
    expect(scoreBout(clean, qualifier) - scoreBout({ ...clean, conceded: 0.5 }, qualifier)).toBe(SCORE.perfect);
  });

  test('calls are tallied to the right fighter', () => {
    const t = emptyTally();
    tallyCall(t, 0, 'full', true);
    tallyCall(t, 0, 'half', false);
    tallyCall(t, 1, 'half', false);
    expect(t).toEqual({ ippon: 1, wazaAri: 1, counters: 1, conceded: 0.5 });
  });
});
