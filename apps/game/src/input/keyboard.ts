import type { Dir4, StickPair } from '@smkk/sim';
import { PressLatch } from './stick.js';

const LEFT_KEYS: Record<string, Dir4> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const RIGHT_KEYS: Record<string, Dir4> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyI: 'up',
  KeyK: 'down',
  KeyJ: 'left',
  KeyL: 'right',
};

/** Two four-direction key clusters, standing in for the cabinet's two sticks. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly cleanup: Array<() => void> = [];
  /** A keypress can begin and end between two frames, exactly like a flick. */
  private readonly latch = new PressLatch<StickPair>();
  private previousRight: Dir4 = 'neutral';

  constructor(target: Window = window) {
    const down = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.code in LEFT_KEYS || event.code in RIGHT_KEYS) {
        this.held.add(event.code);
        event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent): void => {
      this.held.delete(event.code);
    };
    const blur = (): void => this.held.clear();

    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    this.cleanup.push(() => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    });
  }

  private resolve(map: Record<string, Dir4>): Dir4 {
    for (const code of this.held) {
      const dir = map[code];
      if (dir !== undefined) return dir;
    }
    return 'neutral';
  }

  read(): StickPair {
    const left = this.resolve(LEFT_KEYS);
    const right = this.resolve(RIGHT_KEYS);

    if (right !== 'neutral' && right !== this.previousRight) this.latch.press({ left, right });
    if (right === 'neutral' && this.previousRight !== 'neutral') this.latch.release();
    this.previousRight = right;

    const resolved = this.latch.resolve(right === 'neutral' ? null : { left, right });
    return resolved ?? { left, right: 'neutral' };
  }

  dispose(): void {
    for (const off of this.cleanup) off();
  }
}
