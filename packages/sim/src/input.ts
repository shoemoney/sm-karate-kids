/**
 * The input contract. Every adapter — touch, keyboard, gamepad, replay, CPU —
 * produces exactly this shape. The simulation knows nothing else about input.
 */
export type Dir4 = 'neutral' | 'up' | 'down' | 'left' | 'right';

export const DIR4: readonly Dir4[] = ['neutral', 'up', 'down', 'left', 'right'] as const;

/** Two independent four-way sticks, as the cabinet had. */
export interface StickPair {
  readonly left: Dir4;
  readonly right: Dir4;
}

export interface InputFrame {
  readonly p1: StickPair;
  readonly p2: StickPair;
}

export const NEUTRAL_PAIR: StickPair = { left: 'neutral', right: 'neutral' };
export const NEUTRAL_FRAME: InputFrame = { p1: NEUTRAL_PAIR, p2: NEUTRAL_PAIR };

const DIR_CODE: Record<Dir4, number> = { neutral: 0, up: 1, down: 2, left: 3, right: 4 };
const CODE_DIR: readonly Dir4[] = ['neutral', 'up', 'down', 'left', 'right'];

/** Packs a frame into one byte-range integer so replays stay small and exact. */
export function packFrame(frame: InputFrame): number {
  return (
    DIR_CODE[frame.p1.left] * 125 +
    DIR_CODE[frame.p1.right] * 25 +
    DIR_CODE[frame.p2.left] * 5 +
    DIR_CODE[frame.p2.right]
  );
}

export function unpackFrame(code: number): InputFrame {
  const p1l = CODE_DIR[Math.floor(code / 125) % 5] ?? 'neutral';
  const p1r = CODE_DIR[Math.floor(code / 25) % 5] ?? 'neutral';
  const p2l = CODE_DIR[Math.floor(code / 5) % 5] ?? 'neutral';
  const p2r = CODE_DIR[code % 5] ?? 'neutral';
  return { p1: { left: p1l, right: p1r }, p2: { left: p2l, right: p2r } };
}

/** Mirrors a horizontal direction so both players share one command table. */
export function toFacingRelative(dir: Dir4, facing: 1 | -1): Dir4 {
  if (facing === 1) return dir;
  if (dir === 'left') return 'right';
  if (dir === 'right') return 'left';
  return dir;
}
