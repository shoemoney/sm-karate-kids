import { describe, expect, test } from 'vitest';
import {
  CpuController,
  ARCHETYPES,
  createMatch,
  playback,
  runMatch,
  type ContentBundle,
  type InputFrame,
  type MatchState,
  type MoveSpec,
} from '@smkk/sim';

/**
 * The player chooses which fighter they are, so player 1 is no longer always
 * the first fighter in the content. The two fighters walk at different speeds
 * here so that the order is observable in the simulation itself: with the real
 * roster's identical stats, a replay played back in the wrong order would still
 * match its checksum and this whole file could pass against a bug.
 */
const lunge: MoveSpec = { id: 'lunge_punch', name: 'Lunge Punch', kind: 'strike', height: 'mid', posture: 'stand', startup: 6, active: 3, recovery: 10, reach: 1.55, value: 'half', advance: 0.25 };

const bundle: ContentBundle = {
  moves: [lunge],
  fighters: [
    { id: 'slow', name: 'Slow', giColor: '#f2f2ef', beltColor: '#1b1b1f', walkSpeed: 0.03, hitTolerance: 0.42 },
    { id: 'fast', name: 'Fast', giColor: '#c8443c', beltColor: '#1b1b1f', walkSpeed: 0.07, hitTolerance: 0.42 },
  ],
  arenas: [{ id: 'test-dojo', name: 'Test Dojo', floorColor: '#c9a071', backdropColor: '#141a24', bounds: 5 }],
  rulesets: [{ id: 'test-classic', name: 'Test Classic', pointsToWin: 2, timerTicks: 1800, refereeTicks: 96, startSeparation: 3.2 }],
};

function cpus(): (tick: number, state: MatchState) => InputFrame {
  const a = new CpuController(ARCHETYPES.pressure, 11, 0);
  const b = new CpuController(ARCHETYPES.counter, 22, 1);
  return (_tick, state) => ({ p1: a.poll(state), p2: b.poll(state) });
}

describe('choosing which fighter player 1 is', () => {
  test('defaults to the content order', () => {
    const state = createMatch({ content: bundle });
    expect(state.fighters.map((f) => f.spec.id)).toEqual(['slow', 'fast']);
  });

  test('fighterIds puts the chosen fighter on the player-1 side, facing in', () => {
    const state = createMatch({ content: bundle, fighterIds: ['fast', 'slow'] });
    expect(state.fighters.map((f) => f.spec.id)).toEqual(['fast', 'slow']);
    expect(state.fighters[0].x).toBeLessThan(0);
    expect(state.fighters[0].facing).toBe(1);
    expect(state.fighters[1].facing).toBe(-1);
  });

  test('refuses an unknown fighter and a fighter against itself', () => {
    expect(() => createMatch({ content: bundle, fighterIds: ['fast', 'nobody'] })).toThrow(/unknown fighter/);
    expect(() => createMatch({ content: bundle, fighterIds: ['fast', 'fast'] })).toThrow(/two different fighters/);
  });

  test('the order changes the bout, so it is not cosmetic', () => {
    const normal = runMatch({ content: bundle }, cpus(), 600);
    const swapped = runMatch({ content: bundle, fighterIds: ['fast', 'slow'] }, cpus(), 600);
    expect(swapped.replay.checksum).not.toBe(normal.replay.checksum);
  });

  test('a replay recorded with a chosen order reproduces from the replay alone', () => {
    const { replay } = runMatch({ content: bundle, fighterIds: ['fast', 'slow'] }, cpus(), 600);
    expect(replay.fighterIds).toEqual(['fast', 'slow']);
    // Handed only the content, as a saved replay file would be.
    expect(playback(replay, { content: bundle }).matches).toBe(true);
  });
});
