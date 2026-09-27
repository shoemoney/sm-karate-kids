import { describe, expect, test } from 'vitest';
import { FixedClock, TICK_HZ, TICK_MS } from '@smkk/sim';

describe('FixedClock', () => {
  test('a steady 60fps frame yields one tick', () => {
    const clock = new FixedClock();
    expect(clock.drain(TICK_MS)).toBe(1);
  });

  test.each([
    { fps: 10, frameMs: 100 },
    { fps: 4, frameMs: 250 },
  ])('a $fps fps renderer still runs the match at real speed', ({ frameMs }) => {
    // One second of wall time must buy a second of simulation however slowly
    // the frames arrive. A whole tick of slack covers the remainder carried in
    // the accumulator, since 100ms is not a whole number of ticks.
    const clock = new FixedClock();
    let ticks = 0;
    for (let elapsed = 0; elapsed < 1000; elapsed += frameMs) ticks += clock.drain(frameMs);
    expect(ticks).toBeGreaterThanOrEqual(TICK_HZ - 1);
    expect(ticks).toBeLessThanOrEqual(TICK_HZ);
  });

  test('a suspended tab dilates rather than simulating the whole gap', () => {
    // Coming back from a 30 second background must not fast-forward the bout.
    const clock = new FixedClock();
    expect(clock.drain(30_000)).toBeLessThanOrEqual(15);
  });

  test('sub-tick deltas accumulate rather than vanishing', () => {
    const clock = new FixedClock();
    expect(clock.drain(TICK_MS / 2)).toBe(0);
    expect(clock.drain(TICK_MS / 2)).toBe(1);
  });

  test('negative and zero deltas are inert', () => {
    const clock = new FixedClock();
    expect(clock.drain(-500)).toBe(0);
    expect(clock.drain(0)).toBe(0);
    expect(clock.tick).toBe(0);
  });
});
