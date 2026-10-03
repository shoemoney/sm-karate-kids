import { describe, expect, test } from 'vitest';
import { KeyboardInput } from '../../src/input/keyboard.js';

function rig(): { keys: KeyboardInput; press: (code: string) => void; release: (code: string) => void } {
  const target = new EventTarget();
  const fire = (type: string, code: string): void => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, repeat: false });
    target.dispatchEvent(event);
  };
  return {
    keys: new KeyboardInput(target as unknown as Window),
    press: (code) => fire('keydown', code),
    release: (code) => fire('keyup', code),
  };
}

describe('keyboard technique taps', () => {
  test('a keydown and keyup between two reads still yields the technique', () => {
    const { keys, press, release } = rig();
    expect(keys.read().right).toBe('neutral');
    press('ArrowUp');
    release('ArrowUp');
    expect(keys.read().right).toBe('up');
    // Replays once only: a held direction must not machine-gun.
    expect(keys.read().right).toBe('neutral');
  });

  test('the left stick at the moment of the press travels with the tap', () => {
    const { keys, press, release } = rig();
    press('KeyW');
    press('KeyJ');
    release('KeyJ');
    expect(keys.read()).toEqual({ left: 'up', right: 'left' });
  });

  test('a key that is still held reads live and is not replayed afterwards', () => {
    const { keys, press, release } = rig();
    press('KeyL');
    expect(keys.read().right).toBe('right');
    expect(keys.read().right).toBe('right');
    release('KeyL');
    expect(keys.read().right).toBe('neutral');
  });
});
