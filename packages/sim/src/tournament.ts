import { ARCHETYPES, type ArchetypeId, type CpuArchetype } from './cpu.js';
import type { CallValue } from './match.js';

/**
 * The championship ladder. Each round is a harder opponent than the last:
 * a different style, and a difficulty that scales how often he commits, how
 * patiently he waits, how well he blocks, and how hard he punishes a
 * telegraphed technique.
 */
export interface TournamentRound {
  readonly id: string;
  readonly name: string;
  readonly archetype: ArchetypeId;
  /** 0 is a gentle opener, 1 is the final. */
  readonly difficulty: number;
  /** Score multiplier for bouts won in this round. */
  readonly multiplier: number;
}

export const TOURNAMENT: readonly TournamentRound[] = [
  // Ordered by measured difficulty, not by name. The counter style is the
  // weakest at low difficulty and the strongest at full: patient and fast to
  // punish a wind-up. So it opens the ladder gently and closes it as the boss.
  // The tournament tests hold this order to measurement.
  { id: 'qualifier', name: 'Qualifier', archetype: 'counter', difficulty: 0.1, multiplier: 1 },
  { id: 'regional', name: 'Regional', archetype: 'sensei', difficulty: 0.35, multiplier: 1.5 },
  { id: 'quarter', name: 'Quarter-final', archetype: 'sensei', difficulty: 0.65, multiplier: 2 },
  { id: 'semi', name: 'Semi-final', archetype: 'pressure', difficulty: 0.8, multiplier: 3 },
  { id: 'final', name: 'Final', archetype: 'counter', difficulty: 1, multiplier: 4 },
];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * A base archetype tuned for a round. Difficulty 0 is deliberately softer
 * than the base archetype, so the first round teaches rather than punishes;
 * difficulty 1 is sharper on every axis.
 */
export function roundArchetype(round: TournamentRound): CpuArchetype {
  const base = ARCHETYPES[round.archetype];
  const d = clamp(round.difficulty, 0, 1);
  return {
    ...base,
    aggression: base.aggression * (0.55 + 1.15 * d),
    patience: Math.max(6, Math.round(base.patience * (1.35 - 0.7 * d))),
    blockChance: clamp(base.blockChance * (0.4 + 1.2 * d) + 0.15 * d, 0, 0.85),
    jumpChance: base.jumpChance,
    punish: 2 + 6 * d,
  };
}

export interface BoutTally {
  readonly ippon: number;
  readonly wazaAri: number;
  readonly counters: number;
  /** Points the opponent scored against you. */
  readonly conceded: number;
  /** Simulation ticks left on the bout clock when it ended. */
  readonly ticksLeft: number;
  readonly won: boolean;
}

export const SCORE = {
  ippon: 1000,
  wazaAri: 400,
  counter: 250,
  perSecondLeft: 25,
  perfect: 1500,
} as const;

/**
 * Points for one bout. Only a won bout banks: the ladder is a run, and a
 * loss ends it, so a defeat scores what the run had already earned.
 */
export function scoreBout(tally: BoutTally, round: TournamentRound): number {
  if (!tally.won) return 0;
  const techniques = tally.ippon * SCORE.ippon + tally.wazaAri * SCORE.wazaAri + tally.counters * SCORE.counter;
  const time = Math.floor(tally.ticksLeft / 60) * SCORE.perSecondLeft;
  const perfect = tally.conceded === 0 ? SCORE.perfect : 0;
  return Math.round((techniques + time + perfect) * round.multiplier);
}

export function emptyTally(): { ippon: number; wazaAri: number; counters: number; conceded: number } {
  return { ippon: 0, wazaAri: 0, counters: 0, conceded: 0 };
}

export function tallyCall(
  tally: { ippon: number; wazaAri: number; counters: number; conceded: number },
  scorer: 0 | 1,
  value: CallValue,
  counter: boolean,
): void {
  if (scorer === 1) {
    tally.conceded += value === 'full' ? 1 : 0.5;
    return;
  }
  if (value === 'full') tally.ippon += 1;
  else tally.wazaAri += 1;
  if (counter) tally.counters += 1;
}
