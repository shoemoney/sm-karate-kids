import { describe, expect, test } from 'vitest';
import {
  createMatch,
  step,
  scores,
  checksumOf,
  fnv1a,
  hex8,
  CpuController,
  ARCHETYPES,
  type ContentBundle,
  type MatchState,
} from '@smkk/sim';
import { content } from '../src/index.js';

const MAX_TICKS = 7200;

interface SoakResult {
  readonly state: MatchState;
  readonly trace: string;
  readonly boundsOk: boolean;
  readonly timerOk: boolean;
}

function playSeeded(seed: number, bundle: ContentBundle): SoakResult {
  const state = createMatch({ content: bundle });
  const cpu0 = new CpuController(ARCHETYPES.pressure, seed, 0);
  const cpu1 = new CpuController(ARCHETYPES.counter, seed + 10000, 1);

  let trace = 0x811c9dc5;
  let boundsOk = true;
  let timerOk = true;
  const bounds = state.arena.bounds;
  const epsilon = 1e-6;

  for (let tick = 0; tick < MAX_TICKS && state.phase !== 'over'; tick += 1) {
    const frame = { p1: cpu0.poll(state), p2: cpu1.poll(state) };
    step(state, frame);
    trace = fnv1a(checksumOf(state), trace);

    if (state.timerTicks < 0) timerOk = false;
    for (const fighter of state.fighters) {
      if (fighter.x < -bounds - epsilon || fighter.x > bounds + epsilon) boundsOk = false;
    }
  }

  return { state, trace: hex8(trace), boundsOk, timerOk };
}

describe('soak: 25 seeded CPU-vs-CPU matches', () => {
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);

  test.each(seeds)('seed %i terminates cleanly, stays in bounds, and is stable', (seed) => {
    const first = playSeeded(seed, content);

    expect(first.state.phase).toBe('over');
    expect(first.boundsOk).toBe(true);
    expect(first.timerOk).toBe(true);

    const second = playSeeded(seed, content);
    expect(second.trace).toBe(first.trace);
    expect(scores(second.state)).toEqual(scores(first.state));
  });
});
