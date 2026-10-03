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

function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * An open techniques/settings sheet owns the keyboard so arrows can scroll it,
 * and the pause screen owns it so the key that resumes cannot also throw.
 */
function overlayOwnsKeys(): boolean {
  return typeof document !== 'undefined' && document.querySelector('.sheet:not([hidden]), .pause:not([hidden])') !== null;
}

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
      // Typing a name must type the name. The controls listen to the whole
      // page and swallow these keys, so they stand aside for any text field.
      if (isTyping(event.target)) return;
      if (overlayOwnsKeys()) return;
      if (event.code in LEFT_KEYS || event.code in RIGHT_KEYS) {
        this.held.add(event.code);
        event.preventDefault();
        // Latch on the press itself: a tap can end before the next read().
        const right = RIGHT_KEYS[event.code];
        if (right !== undefined) this.latch.press({ left: this.resolve(LEFT_KEYS), right });
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
