import type { Dir4 } from '@smkk/sim';

/**
 * A four-way gate for a surface that has no gate.
 *
 * A physical stick gives your thumb a corner to find. Glass gives nothing, so
 * the gate is reconstructed in software: a dead zone so resting contact reads
 * as neutral, dominant-axis selection so the four directions stay exclusive,
 * and hysteresis so a thumb wobbling on a diagonal does not chatter between
 * two techniques.
 */
export interface GateOptions {
  /** Pixels of travel before any direction registers. */
  readonly deadZone: number;
  /** How much the challenger axis must beat the held axis to take over. */
  readonly switchBias: number;
}

export const DEFAULT_GATE: GateOptions = { deadZone: 15, switchBias: 1.35 };

export function resolveDirection(
  dx: number,
  dy: number,
  held: Dir4,
  options: GateOptions = DEFAULT_GATE,
): Dir4 {
  const distance = Math.hypot(dx, dy);
  if (distance < options.deadZone) return 'neutral';

  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);
  const heldIsHorizontal = held === 'left' || held === 'right';
  const heldIsVertical = held === 'up' || held === 'down';

  let useHorizontal = horizontal >= vertical;
  if (heldIsHorizontal) useHorizontal = !(vertical > horizontal * options.switchBias);
  else if (heldIsVertical) useHorizontal = horizontal > vertical * options.switchBias;

  if (useHorizontal) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/**
 * Holds a technique press until the simulation has actually seen it.
 *
 * Input is read once per simulation tick, but ticks are drained in bursts at
 * frame boundaries — so a flick of the technique stick that begins and ends
 * between two frames is never sampled at all, and the technique simply does
 * not come out. That is worst exactly when the device is struggling, which is
 * exactly when a dropped input is least forgivable.
 *
 * The latch records a press the simulation has not consumed yet and replays it
 * on the next read. It replays for one read only, so the right stick still
 * passes back through neutral and a held direction cannot machine-gun.
 */
export class PressLatch<T> {
  private pending: T | null = null;
  private delivered = true;

  /** Call when the stick leaves neutral. */
  press(value: T): void {
    this.pending = value;
    this.delivered = false;
  }

  /** Call when the stick returns to neutral. Keeps an unseen press queued. */
  release(): void {
    if (this.delivered) this.pending = null;
  }

  /** The live value if there is one, otherwise a press nobody has seen yet. */
  resolve(live: T | null): T | null {
    if (live !== null) {
      this.delivered = true;
      this.pending = null;
      return live;
    }
    if (this.pending !== null) {
      const replayed = this.pending;
      this.pending = null;
      this.delivered = true;
      return replayed;
    }
    return null;
  }
}
