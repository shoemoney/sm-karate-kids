import type { MatchState, PlayerIndex } from './match.js';
import { Rng } from './rng.js';
import type { Dir4, StickPair } from './input.js';
import type { AttackFamily, Qualifier } from './grammar.js';

export type ArchetypeId = 'sensei' | 'pressure' | 'counter';

export interface CpuArchetype {
  readonly id: ArchetypeId;
  readonly name: string;
  /** Preferred striking distance in metres. */
  readonly spacing: number;
  /** Chance per tick of committing while inside the pocket. */
  readonly aggression: number;
  /** Ticks of enforced pause after any commitment. */
  readonly patience: number;
  /** Chance of answering a telegraphed strike with a block instead of a trade. */
  readonly blockChance: number;
  /** Chance a commitment opens with a jump, which is the only way to reach air techniques. */
  readonly jumpChance: number;
}

export const ARCHETYPES: Record<ArchetypeId, CpuArchetype> = {
  sensei: {
    id: 'sensei',
    name: 'Sensei',
    spacing: 1.8,
    aggression: 0.035,
    patience: 26,
    blockChance: 0.25,
    jumpChance: 0.12,
  },
  pressure: {
    id: 'pressure',
    name: 'Pressure',
    spacing: 1.45,
    aggression: 0.07,
    patience: 14,
    blockChance: 0.1,
    jumpChance: 0.18,
  },
  counter: {
    id: 'counter',
    name: 'Counter',
    spacing: 2.1,
    aggression: 0.02,
    patience: 34,
    blockChance: 0.45,
    jumpChance: 0.06,
  },
};

type Opener = readonly [AttackFamily, Qualifier];

/**
 * Every technique the grammar can produce from the ground, minus the two
 * blocks — those are thrown reactively below rather than as openers.
 *
 * A narrower table than this is how three quarters of the move list became
 * unreachable in CPU play, which made the balance harness blind to it.
 */
const GROUND_OPENERS: readonly Opener[] = [
  ['forward', 'neutral'],
  ['forward', 'forward'],
  ['forward', 'back'],
  ['forward', 'down'],
  ['back', 'neutral'],
  ['back', 'forward'],
  ['back', 'back'],
  ['back', 'down'],
  ['up', 'neutral'],
  ['up', 'forward'],
  ['up', 'down'],
  ['down', 'neutral'],
  ['down', 'forward'],
  ['down', 'down'],
];

/** Only reachable mid-jump, so the controller has to set them up. */
const AIR_OPENERS: readonly Opener[] = [
  ['forward', 'up'],
  ['back', 'up'],
  ['up', 'up'],
  ['down', 'up'],
];

const HIGH_BLOCK: Opener = ['up', 'back'];
const LOW_BLOCK: Opener = ['down', 'back'];

const NEUTRAL: StickPair = { left: 'neutral', right: 'neutral' };

/** How far past preferred spacing the fighter still counts as in the pocket. */
const POCKET_SLACK = 0.2;

/** A deterministic opponent. Same seed plus same state gives the same stick. */
export class CpuController {
  private readonly rng: Rng;
  private cooldown = 0;
  private holding = false;

  constructor(
    private readonly archetype: CpuArchetype,
    seed: number,
    private readonly player: PlayerIndex = 1,
  ) {
    this.rng = new Rng(seed);
  }

  private sticks(opener: Opener, toward: Dir4, away: Dir4): StickPair {
    const [family, qualifier] = opener;
    const right: Dir4 =
      family === 'forward' ? toward : family === 'back' ? away : family === 'up' ? 'up' : 'down';
    const left: Dir4 =
      qualifier === 'forward'
        ? toward
        : qualifier === 'back'
          ? away
          : qualifier === 'up'
            ? 'up'
            : qualifier === 'down'
              ? 'down'
              : 'neutral';
    return { left, right };
  }

  private commit(table: readonly Opener[], toward: Dir4, away: Dir4): StickPair {
    const opener = table[Math.floor(this.rng.next() * table.length) % table.length];
    if (opener === undefined) return NEUTRAL;
    this.cooldown = this.archetype.patience;
    this.holding = true;
    return this.sticks(opener, toward, away);
  }

  poll(state: MatchState): StickPair {
    const self = state.fighters[this.player];
    const foe = state.fighters[this.player === 0 ? 1 : 0];

    if (state.phase !== 'fight') {
      this.holding = false;
      return NEUTRAL;
    }

    if (this.cooldown > 0) this.cooldown -= 1;

    // The right stick must pass through neutral before the next technique.
    if (this.holding) {
      this.holding = false;
      return NEUTRAL;
    }

    if (self.phase !== 'neutral') return NEUTRAL;

    const gap = Math.abs(foe.x - self.x);
    const toward: Dir4 = foe.x > self.x ? 'right' : 'left';
    const away: Dir4 = foe.x > self.x ? 'left' : 'right';

    // Mid-jump is the only window in which the air techniques exist at all.
    if (self.airborne > 0) {
      if (this.rng.next() < 0.3) return this.commit(AIR_OPENERS, toward, away);
      return NEUTRAL;
    }

    // The pocket has to be one band. Two thresholds that do not meet leave a
    // gap the fighter can sit in doing nothing, which is exactly what froze
    // every mirror matchup.
    const pocket = this.archetype.spacing + POCKET_SLACK;
    if (gap > pocket) return { left: toward, right: 'neutral' };

    const telegraphed = foe.phase === 'startup';

    if (telegraphed && this.cooldown === 0 && this.rng.next() < this.archetype.blockChance) {
      const band = foe.move?.height === 'low' ? LOW_BLOCK : HIGH_BLOCK;
      return this.commit([band], toward, away);
    }

    const wants = this.archetype.aggression * (telegraphed ? 4 : 1);
    if (this.cooldown === 0 && this.rng.next() < wants) {
      if (this.rng.next() < this.archetype.jumpChance) {
        this.cooldown = Math.floor(this.archetype.patience / 2);
        return { left: 'up', right: 'neutral' };
      }
      return this.commit(GROUND_OPENERS, toward, away);
    }

    if (gap < this.archetype.spacing - 0.5) return { left: away, right: 'neutral' };
    return NEUTRAL;
  }
}
