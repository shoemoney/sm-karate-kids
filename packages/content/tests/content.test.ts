import { describe, expect, test } from 'vitest';
import {
  allMoveIds,
  loadContent,
  ContentError,
  type MoveSpec,
  type FighterSpec,
  type ArenaSpec,
  type RulesetSpec,
} from '@smkk/sim';
import { content, CONTENT_MOVE_COUNT } from '../src/index.js';

function makeMove(id: string): MoveSpec {
  return {
    id,
    name: id,
    kind: 'strike',
    height: 'mid',
    posture: 'stand',
    startup: 5,
    active: 3,
    recovery: 8,
    reach: 1,
    value: 'half',
    advance: 0,
  };
}

function makeFighter(id: string): FighterSpec {
  return {
    id,
    name: id,
    giColor: '#ffffff',
    beltColor: '#000000',
    walkSpeed: 0.05,
    hitTolerance: 0.4,
  };
}

function makeArena(id: string): ArenaSpec {
  return { id, name: id, floorColor: '#ffffff', backdropColor: '#000000', bounds: 5 };
}

function makeRuleset(id: string): RulesetSpec {
  return { id, name: id, pointsToWin: 2, timerTicks: 600, refereeTicks: 30, startSeparation: 3 };
}

function validRawBundle() {
  const ids = allMoveIds();
  return {
    moves: ids.map(makeMove),
    fighters: [makeFighter('f1'), makeFighter('f2')],
    arenas: [makeArena('a1')],
    rulesets: [makeRuleset('r1')],
  };
}

describe('@smkk/content real bundle', () => {
  test('imports and validates without throwing, with the expected shape', () => {
    expect(content.moves).toHaveLength(20);
    expect(content.fighters).toHaveLength(2);
    expect(content.arenas.length).toBeGreaterThanOrEqual(1);
    expect(content.rulesets.length).toBeGreaterThanOrEqual(1);
    expect(CONTENT_MOVE_COUNT).toBe(20);
  });

  test('every move satisfies the frame-data schema bounds', () => {
    for (const move of content.moves) {
      expect(move.startup).toBeGreaterThanOrEqual(1);
      expect(move.startup).toBeLessThanOrEqual(40);
      expect(move.active).toBeGreaterThanOrEqual(1);
      expect(move.active).toBeLessThanOrEqual(20);
      expect(move.recovery).toBeGreaterThanOrEqual(1);
      expect(move.recovery).toBeLessThanOrEqual(40);
      expect(move.reach).toBeGreaterThanOrEqual(0.5);
      expect(move.reach).toBeLessThanOrEqual(3);
      expect(move.advance).toBeGreaterThanOrEqual(-1);
      expect(move.advance).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('loadContent validation', () => {
  test('a well-formed bundle validates without throwing', () => {
    const ids = allMoveIds();
    expect(() => loadContent(validRawBundle(), ids)).not.toThrow();
  });

  test('a duplicate move id throws ContentError', () => {
    const ids = allMoveIds();
    const bundle = validRawBundle();
    const first = bundle.moves[0];
    if (first === undefined) throw new Error('fixture produced no moves');
    bundle.moves = [...bundle.moves, { ...first }];

    expect(() => loadContent(bundle, ids)).toThrow(ContentError);
    expect(() => loadContent(bundle, ids)).toThrow(/duplicate move id/);
  });

  test('a grammar move id with no frame data throws ContentError', () => {
    const ids = allMoveIds();
    const bundle = validRawBundle();
    bundle.moves = bundle.moves.slice(1);

    expect(() => loadContent(bundle, ids)).toThrow(ContentError);
    expect(() => loadContent(bundle, ids)).toThrow(/no frame data/);
  });

  test('a move unreachable from the grammar throws ContentError', () => {
    const ids = allMoveIds();
    const bundle = validRawBundle();
    bundle.moves = [...bundle.moves, makeMove('phantom_move')];

    expect(() => loadContent(bundle, ids)).toThrow(ContentError);
    expect(() => loadContent(bundle, ids)).toThrow(/unreachable from the grammar/);
  });
});
