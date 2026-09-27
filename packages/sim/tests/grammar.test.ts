import { describe, expect, test } from 'vitest';
import {
  allMoveIds,
  moveIdFor,
  parseCommand,
  type AttackFamily,
  type Qualifier,
} from '@smkk/sim';

const FAMILIES: readonly AttackFamily[] = ['forward', 'back', 'up', 'down'];
const QUALIFIERS: readonly Qualifier[] = ['neutral', 'up', 'down', 'forward', 'back'];

describe('allMoveIds', () => {
  test('returns exactly 20 unique ids', () => {
    const ids = allMoveIds();
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });
});

describe('technique triggering', () => {
  test('a technique fires only on the transition of the right stick out of neutral', () => {
    const held = { left: 'neutral' as const, right: 'right' as const };

    const first = parseCommand(held, 'neutral', 1);
    expect(first.kind).toBe('attack');

    // Holding the same direction next tick: previousRight is now also 'right', so no re-fire.
    const second = parseCommand(held, 'right', 1);
    expect(second.kind).toBe('idle');
  });

  test('releasing to neutral and pressing again re-fires the technique', () => {
    const press = { left: 'neutral' as const, right: 'right' as const };
    const neutral = { left: 'neutral' as const, right: 'neutral' as const };

    const afterRelease = parseCommand(neutral, 'right', 1);
    expect(afterRelease.kind).toBe('idle');

    const afterRepress = parseCommand(press, 'neutral', 1);
    expect(afterRepress.kind).toBe('attack');
  });
});

describe('facing mirroring', () => {
  test('facing -1 pressing right-stick LEFT matches facing 1 pressing right-stick RIGHT', () => {
    const facing1 = parseCommand({ left: 'neutral', right: 'right' }, 'neutral', 1);
    const facingNeg1 = parseCommand({ left: 'neutral', right: 'left' }, 'neutral', -1);

    expect(facing1.kind).toBe('attack');
    expect(facingNeg1.kind).toBe('attack');
    if (facing1.kind === 'attack' && facingNeg1.kind === 'attack') {
      expect(facingNeg1.moveId).toBe(facing1.moveId);
    }
  });

  test('facing also mirrors the left-stick qualifier', () => {
    // Qualifier 'forward': facing 1 wants left stick raw 'right'; facing -1 wants raw 'left'.
    const facing1 = parseCommand({ left: 'right', right: 'up' }, 'neutral', 1);
    const facingNeg1 = parseCommand({ left: 'left', right: 'up' }, 'neutral', -1);

    expect(facing1.kind).toBe('attack');
    expect(facingNeg1.kind).toBe('attack');
    if (facing1.kind === 'attack' && facingNeg1.kind === 'attack') {
      expect(facingNeg1.moveId).toBe(facing1.moveId);
    }
  });
});

describe('left-stick-only commands', () => {
  const facing = 1;

  test('right walks forward', () => {
    const command = parseCommand({ left: 'right', right: 'neutral' }, 'neutral', facing);
    expect(command).toEqual({ kind: 'walk', direction: 'forward' });
  });

  test('left walks back', () => {
    const command = parseCommand({ left: 'left', right: 'neutral' }, 'neutral', facing);
    expect(command).toEqual({ kind: 'walk', direction: 'back' });
  });

  test('up jumps', () => {
    const command = parseCommand({ left: 'up', right: 'neutral' }, 'neutral', facing);
    expect(command).toEqual({ kind: 'jump' });
  });

  test('down crouches', () => {
    const command = parseCommand({ left: 'down', right: 'neutral' }, 'neutral', facing);
    expect(command).toEqual({ kind: 'crouch' });
  });

  test('neutral is idle', () => {
    const command = parseCommand({ left: 'neutral', right: 'neutral' }, 'neutral', facing);
    expect(command).toEqual({ kind: 'idle' });
  });
});

describe('the family/qualifier grid', () => {
  test('every (family, qualifier) pair maps to a distinct move id', () => {
    const ids = new Set<string>();
    for (const family of FAMILIES) {
      for (const qualifier of QUALIFIERS) {
        ids.add(moveIdFor(family, qualifier));
      }
    }
    expect(ids.size).toBe(FAMILIES.length * QUALIFIERS.length);
    expect(ids.size).toBe(20);
  });
});
