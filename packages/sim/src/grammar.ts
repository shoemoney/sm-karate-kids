import type { Dir4, StickPair } from './input.js';
import { toFacingRelative } from './input.js';

/**
 * The twin-stick command grammar.
 *
 * The right stick chooses the technique family; the left stick qualifies it.
 * Four attack directions times five left-stick states is twenty techniques,
 * plus four movement commands when the right stick rests: twenty-four in all.
 *
 * Directions are normalized against facing before lookup, so one table serves
 * both fighters and every input adapter.
 */
export type Qualifier = 'neutral' | 'up' | 'down' | 'forward' | 'back';
export type AttackFamily = 'forward' | 'back' | 'up' | 'down';

export type Command =
  | { kind: 'idle' }
  | { kind: 'walk'; direction: 'forward' | 'back' }
  | { kind: 'jump' }
  | { kind: 'crouch' }
  | { kind: 'attack'; moveId: string };

const FAMILY_TABLE: Record<AttackFamily, Record<Qualifier, string>> = {
  forward: {
    neutral: 'lunge_punch',
    up: 'jumping_punch',
    down: 'crouching_punch',
    forward: 'stepping_lunge_punch',
    back: 'back_fist',
  },
  back: {
    neutral: 'reverse_punch',
    up: 'somersault_kick',
    down: 'crouching_reverse_punch',
    forward: 'back_kick',
    back: 'spinning_back_kick',
  },
  up: {
    neutral: 'front_kick',
    up: 'jumping_front_kick',
    down: 'rising_knee',
    forward: 'roundhouse_kick',
    back: 'high_block',
  },
  down: {
    neutral: 'foot_sweep',
    up: 'jumping_sweep_kick',
    down: 'low_sweep',
    forward: 'leg_sweep',
    back: 'low_block',
  },
};

function familyOf(dir: Dir4): AttackFamily | null {
  if (dir === 'right') return 'forward';
  if (dir === 'left') return 'back';
  if (dir === 'up') return 'up';
  if (dir === 'down') return 'down';
  return null;
}

function qualifierOf(dir: Dir4): Qualifier {
  if (dir === 'right') return 'forward';
  if (dir === 'left') return 'back';
  if (dir === 'up') return 'up';
  if (dir === 'down') return 'down';
  return 'neutral';
}

/** Every technique id the grammar can produce, in stable order. */
export function allMoveIds(): string[] {
  const ids: string[] = [];
  for (const family of ['forward', 'back', 'up', 'down'] as AttackFamily[]) {
    for (const q of ['neutral', 'up', 'down', 'forward', 'back'] as Qualifier[]) {
      ids.push(FAMILY_TABLE[family][q]);
    }
  }
  return ids;
}

export function moveIdFor(family: AttackFamily, qualifier: Qualifier): string {
  return FAMILY_TABLE[family][qualifier];
}

/**
 * Resolves one tick of stick state into a command.
 *
 * `previousRight` is the right stick from the previous tick: a technique fires
 * on the transition out of neutral, so holding a direction never machine-guns.
 */
export function parseCommand(
  sticks: StickPair,
  previousRight: Dir4,
  facing: 1 | -1,
): Command {
  const right = toFacingRelative(sticks.right, facing);
  const left = toFacingRelative(sticks.left, facing);
  const prev = toFacingRelative(previousRight, facing);

  const family = familyOf(right);
  if (family !== null) {
    if (prev === 'neutral') {
      return { kind: 'attack', moveId: FAMILY_TABLE[family][qualifierOf(left)] };
    }
    return { kind: 'idle' };
  }

  if (left === 'up') return { kind: 'jump' };
  if (left === 'down') return { kind: 'crouch' };
  if (left === 'right') return { kind: 'walk', direction: 'forward' };
  if (left === 'left') return { kind: 'walk', direction: 'back' };
  return { kind: 'idle' };
}
