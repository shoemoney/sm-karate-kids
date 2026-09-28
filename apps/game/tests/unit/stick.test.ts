import { describe, expect, test } from 'vitest';
import { DEFAULT_GATE, PressLatch, resolveDirection } from '../../src/input/stick.js';

describe('the software gate', () => {
  test('a thumb resting inside the dead zone reads as neutral', () => {
    expect(resolveDirection(0, 0, 'neutral')).toBe('neutral');
    expect(resolveDirection(DEFAULT_GATE.deadZone - 1, 0, 'neutral')).toBe('neutral');
  });

  test('past the dead zone the dominant axis wins, exclusively', () => {
    expect(resolveDirection(40, 5, 'neutral')).toBe('right');
    expect(resolveDirection(-40, 5, 'neutral')).toBe('left');
    expect(resolveDirection(5, -40, 'neutral')).toBe('up');
    expect(resolveDirection(5, 40, 'neutral')).toBe('down');
  });

  test('a thumb wobbling on the diagonal does not chatter between directions', () => {
    // Held right, now marginally more vertical: without hysteresis this flips
    // every frame and the player throws a technique they never asked for.
    expect(resolveDirection(30, 33, 'right')).toBe('right');
    // Commit properly to the other axis and it does switch.
    expect(resolveDirection(30, 60, 'right')).toBe('down');
  });

  test('hysteresis works in both directions', () => {
    expect(resolveDirection(33, 30, 'down')).toBe('down');
    expect(resolveDirection(60, 30, 'down')).toBe('right');
  });
});

describe('PressLatch', () => {
  test('a live value passes straight through', () => {
    const latch = new PressLatch<string>();
    latch.press('up');
    expect(latch.resolve('up')).toBe('up');
  });

  test('a press released before anyone read it is replayed once', () => {
    const latch = new PressLatch<string>();
    latch.press('up');
    latch.release();
    expect(latch.resolve(null)).toBe('up');
    // Exactly once: the right stick must return to neutral before the next one.
    expect(latch.resolve(null)).toBeNull();
  });

  test('a press the simulation already saw is not replayed after release', () => {
    const latch = new PressLatch<string>();
    latch.press('up');
    expect(latch.resolve('up')).toBe('up');
    latch.release();
    expect(latch.resolve(null)).toBeNull();
  });

  test('nothing is invented when nothing was pressed', () => {
    const latch = new PressLatch<string>();
    expect(latch.resolve(null)).toBeNull();
  });
});
