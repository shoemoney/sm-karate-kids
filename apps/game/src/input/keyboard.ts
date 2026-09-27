import type { Dir4, StickPair } from '@smkk/sim';

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
    return { left: this.resolve(LEFT_KEYS), right: this.resolve(RIGHT_KEYS) };
  }

  dispose(): void {
    for (const off of this.cleanup) off();
  }
}
