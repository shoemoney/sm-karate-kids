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
