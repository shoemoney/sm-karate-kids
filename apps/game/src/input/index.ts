import type { StickPair } from '@smkk/sim';
import { GamepadInput } from './gamepad.js';
import { KeyboardInput } from './keyboard.js';
import { TouchInput } from './touch.js';

const NEUTRAL: StickPair = { left: 'neutral', right: 'neutral' };

function isNeutral(pair: StickPair): boolean {
  return pair.left === 'neutral' && pair.right === 'neutral';
}

/**
 * Every device collapses to the same normalized pair before the simulation
 * sees it, so the sim never learns what is driving it. Touch leads, because
 * this is a phone game first.
 */
export class PlayerInput {
  readonly touch = new TouchInput();
  readonly keyboard = new KeyboardInput();
  readonly gamepad = new GamepadInput();

  read(): StickPair {
    const touch = this.touch.read();
    if (!isNeutral(touch)) return touch;
    const keys = this.keyboard.read();
    if (!isNeutral(keys)) return keys;
    const pad = this.gamepad.read();
    if (!isNeutral(pad)) return pad;
    return NEUTRAL;
  }

  dispose(): void {
    this.touch.dispose();
    this.keyboard.dispose();
  }
}

export { TouchInput, KeyboardInput, GamepadInput };
