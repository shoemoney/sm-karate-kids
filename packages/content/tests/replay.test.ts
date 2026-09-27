import { describe, expect, test } from 'vitest';
import {
  runMatch,
  playback,
  CpuController,
  ARCHETYPES,
  scores,
  packFrame,
  unpackFrame,
  DIR4,
  NEUTRAL_FRAME,
  type ContentBundle,
  type InputFrame,
  type MatchState,
} from '@smkk/sim';
import { content } from '../src/index.js';

function cpuFrameSource(seedP1: number, seedP2: number) {
  const cpu0 = new CpuController(ARCHETYPES.pressure, seedP1, 0);
  const cpu1 = new CpuController(ARCHETYPES.counter, seedP2, 1);
  return (_tick: number, state: MatchState): InputFrame => ({
    p1: cpu0.poll(state),
    p2: cpu1.poll(state),
  });
}

describe('recording and playback', () => {
  test('a recorded CPU-vs-CPU match plays back to the same result', () => {
    const { state, replay } = runMatch({ content }, cpuFrameSource(11, 22));
    const result = playback(replay, { content });

    expect(result.matches).toBe(true);
    expect(scores(result.state)).toEqual(scores(state));
  });
});

describe('frame packing', () => {
  test('every one of the 625 possible packed codes round-trips exactly', () => {
    for (let code = 0; code < 625; code += 1) {
      const frame = unpackFrame(code);
      expect(packFrame(frame)).toBe(code);
    }
  });

  test('every stick combination packs into range and unpacks back to itself', () => {
    for (const p1Left of DIR4) {
      for (const p1Right of DIR4) {
        for (const p2Left of DIR4) {
          for (const p2Right of DIR4) {
            const frame: InputFrame = {
              p1: { left: p1Left, right: p1Right },
              p2: { left: p2Left, right: p2Right },
            };
            const packed = packFrame(frame);
            expect(packed).toBeGreaterThanOrEqual(0);
            expect(packed).toBeLessThan(625);
            expect(unpackFrame(packed)).toEqual(frame);
          }
        }
      }
    }
  });
});

describe('determinism', () => {
  test('the same seed produces the same trace on every run', () => {
    const run1 = runMatch({ content }, cpuFrameSource(7, 9));
    const run2 = runMatch({ content }, cpuFrameSource(7, 9));
    expect(run2.trace).toBe(run1.trace);
    expect(scores(run2.state)).toEqual(scores(run1.state));
  });
});

describe('divergence detection', () => {
  test('flipping one recorded input frame changes the replayed checksum', () => {
    // A minimal, fully neutral baseline: nobody ever attacks, so the match runs out the
    // clock to a 0-0 draw. Flipping the very first fight-phase frame into an attack that
    // lands changes the score permanently (scores never reset), which playback's
    // fixed-length frame loop cannot silently absorb: it either lands mid-exchange
    // (different phase/timer) or finishes with a different score than the recorded draw.
    const divergeContent: ContentBundle = {
      moves: [
        { id: 'lunge_punch', name: 'Lunge Punch', kind: 'strike', height: 'mid', posture: 'stand', startup: 2, active: 2, recovery: 6, reach: 1.2, value: 'half', advance: 0 },
      ],
      fighters: [
        { id: 'f1', name: 'F1', giColor: '#ffffff', beltColor: '#000000', walkSpeed: 0.1, hitTolerance: 0.5 },
        { id: 'f2', name: 'F2', giColor: '#ffffff', beltColor: '#000000', walkSpeed: 0.1, hitTolerance: 0.5 },
      ],
      arenas: [{ id: 'a1', name: 'Arena', floorColor: '#ffffff', backdropColor: '#000000', bounds: 5 }],
      rulesets: [{ id: 'r1', name: 'R1', pointsToWin: 2, timerTicks: 40, refereeTicks: 5, startSeparation: 1 }],
    };
    const options = { content: divergeContent, rulesetId: 'r1', arenaId: 'a1' };

    const { state: baseline, replay } = runMatch(options, () => NEUTRAL_FRAME);
    expect(baseline.phase).toBe('over');
    expect(baseline.draw).toBe(true);

    const frames = [...replay.frames];
    const firstFightTick = frames.length - 40; // ready-phase length is fixed; this is self-computed from it
    frames[firstFightTick] = packFrame({
      p1: { left: 'neutral', right: 'right' },
      p2: { left: 'neutral', right: 'neutral' },
    });

    const tampered = { ...replay, frames };
    const result = playback(tampered, options);

    expect(result.matches).toBe(false);
  });
});
